import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  AdminCreateUserRequestSchema,
  AdminDocumentReviewRequestSchema,
  AdminDriverListItemSchema,
  AdminUpdateUserRequestSchema,
  AdminUserSchema,
  AdminVerifyDriverRequestSchema,
  AuditLogEntrySchema,
  AuditLogQuerySchema,
  AuthResponseSchema,
  CitySchema,
  CreateCityRequestSchema,
  DriverBalanceReportRowSchema,
  DriverCashCollectionSchema,
  DriverCollectionQuerySchema,
  DriverDocumentSchema,
  DriverSessionQuerySchema,
  DriverSessionSchema,
  ErrorResponseSchema,
  PricingConfigSchema,
  RecordCashCollectionRequestSchema,
  TripReportQuerySchema,
  TripReportRowSchema,
  UpdatePricingConfigRequestSchema,
  USER_ROLES,
} from "@gnncab/contract";
import {
  auditLogsTable,
  citiesTable,
  createDb,
  customerProfilesTable,
  driverCashCollectionsTable,
  driverDocumentsTable,
  driverProfilesTable,
  driverSessionsTable,
  pricingConfigTable,
  tripsTable,
  usersTable,
} from "@gnncab/db";
import type { AppBindings } from "../env";
import { AuditAction, logAudit } from "../lib/audit";
import { toCsv } from "../lib/csv";
import { decryptDocument } from "../lib/document-encryption";
import { driverProfileWithUserColumns } from "../lib/driver-queries";
import { closeOpenSession, computeDriverBalance, getDriverUsageRates, toSessionResponse } from "../lib/driver-sessions";
import { hashPassword } from "../lib/password";
import { clientIp } from "../lib/request";
import { issueSession, toPublicUser } from "../lib/session";
import { authenticate, requireRole } from "../middlewares/auth";
import { toDocumentResponse } from "./driver_profile";

const admin = new OpenAPIHono<AppBindings>();

// ─── POST /bootstrap — create the first admin, self-locking ───────────────
// There's no self-service admin sign-up (L15/L16) and no CLI/SQL should be
// needed to get the very first one either. This works exactly once: it
// 401s without a matching ADMIN_BOOTSTRAP_TOKEN header, and 409s the moment
// any admin already exists — after that it's permanently inert.
const BootstrapAdminRequestSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  platform: z.enum(["web", "ios", "android"]).default("web"),
});

const bootstrapRoute = createRoute({
  method: "post",
  path: "/bootstrap",
  tags: ["admin"],
  summary: "Create the first admin account (only while none exist yet)",
  request: {
    body: { required: true, content: { "application/json": { schema: BootstrapAdminRequestSchema } } },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: AuthResponseSchema } } },
    401: {
      description: "Missing or invalid bootstrap token",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    409: {
      description: "An admin already exists",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

admin.openapi(bootstrapRoute, async (c) => {
  const token = c.req.header("X-Bootstrap-Token");
  if (!token || token !== c.env.ADMIN_BOOTSTRAP_TOKEN) {
    return c.json({ error: "Unauthorized", message: "Missing or invalid bootstrap token" }, 401);
  }

  const db = createDb(c.env.DB);
  // count(*) always returns exactly one row, even over zero matches.
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(usersTable)
    .where(eq(usersTable.role, "admin"));
  if (Number(row!.count) > 0) {
    return c.json({ error: "Conflict", message: "An admin account already exists" }, 409);
  }

  const body = c.req.valid("json");
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, body.email))
    .limit(1);
  if (existing) {
    return c.json({ error: "Conflict", message: "An account with this email already exists" }, 409);
  }

  const passwordHash = await hashPassword(body.password);
  const [user] = await db
    .insert(usersTable)
    .values({ email: body.email, passwordHash, firstName: body.firstName, lastName: body.lastName, role: "admin" })
    .returning();
  if (!user) throw new Error("Insert into users returned no row");

  const session = await issueSession(c, db, toPublicUser(user), body.platform);

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "user",
      entityId: user.id,
      action: AuditAction.REGISTER,
      actorId: user.id,
      actorRole: "admin",
      metadata: { via: "bootstrap" },
      ipAddress: clientIp(c),
    })
  );

  return c.json(session, 201);
});

// Every OTHER route in this file is admin-only (L16) — registered after
// bootstrap so the wildcard doesn't shadow that one public route (same
// pattern as driver_profile.ts's public /register).
admin.use("*", authenticate, requireRole("admin"));

function toAdminUser(user: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    role: user.role as (typeof USER_ROLES)[number],
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
  };
}

// ─── GET /users — list, optional role/isActive filter ─────────────────────
const listUsersRoute = createRoute({
  method: "get",
  path: "/users",
  tags: ["admin"],
  summary: "List users",
  request: {
    query: z.object({
      role: z.enum(USER_ROLES).optional(),
      isActive: z.enum(["true", "false"]).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }),
  },
  responses: {
    200: { description: "Users", content: { "application/json": { schema: z.array(AdminUserSchema) } } },
  },
});

admin.openapi(listUsersRoute, async (c) => {
  const query = c.req.valid("query");
  const db = createDb(c.env.DB);

  const conditions = [];
  if (query.role) conditions.push(eq(usersTable.role, query.role));
  if (query.isActive) conditions.push(eq(usersTable.isActive, query.isActive === "true"));

  const rows = await db
    .select()
    .from(usersTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .limit(query.limit)
    .offset(query.offset);

  return c.json(rows.map(toAdminUser), 200);
});

// ─── POST /users — create any role directly (L16) ─────────────────────────
const createUserRoute = createRoute({
  method: "post",
  path: "/users",
  tags: ["admin"],
  summary: "Manually create a user of any role",
  request: { body: { required: true, content: { "application/json": { schema: AdminCreateUserRequestSchema } } } },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: AdminUserSchema } } },
    409: { description: "Email already exists", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

admin.openapi(createUserRoute, async (c) => {
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);
  const authUser = c.get("user")!;

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, body.email))
    .limit(1);
  if (existing) {
    return c.json({ error: "Conflict", message: "An account with this email already exists" }, 409);
  }

  const passwordHash = await hashPassword(body.password);
  const [user] = await db
    .insert(usersTable)
    .values({
      email: body.email,
      passwordHash,
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone,
      role: body.role,
    })
    .returning();
  if (!user) throw new Error("Insert into users returned no row");

  if (body.role === "customer") {
    await db.insert(customerProfilesTable).values({ userId: user.id });
  } else if (body.role === "driver") {
    await db.insert(driverProfilesTable).values({
      userId: user.id,
      status: "OFFLINE",
      isVerified: body.isVerified ?? false,
    });
  }

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "user",
      entityId: user.id,
      action: AuditAction.USER_CREATED_BY_ADMIN,
      actorId: authUser.userId,
      actorRole: "admin",
      metadata: { role: body.role },
      ipAddress: clientIp(c),
    })
  );

  return c.json(toAdminUser(user), 201);
});

// ─── PUT /users/{userId} — update fields, reassign role (L16) ─────────────
const updateUserRoute = createRoute({
  method: "put",
  path: "/users/{userId}",
  tags: ["admin"],
  summary: "Update a user — including reassigning their role",
  request: {
    params: z.object({ userId: z.string().uuid() }),
    body: { required: true, content: { "application/json": { schema: AdminUpdateUserRequestSchema } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: AdminUserSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

admin.openapi(updateUserRoute, async (c) => {
  const { userId } = c.req.valid("param");
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);
  const authUser = c.get("user")!;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    return c.json({ error: "NotFound", message: "User not found" }, 404);
  }

  await db
    .update(usersTable)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));

  // Role changes need the matching profile row to exist — create it if this
  // is the user's first time in that role (L16).
  if (body.role && body.role !== user.role) {
    if (body.role === "customer") {
      const [profile] = await db
        .select({ id: customerProfilesTable.id })
        .from(customerProfilesTable)
        .where(eq(customerProfilesTable.userId, userId))
        .limit(1);
      if (!profile) await db.insert(customerProfilesTable).values({ userId });
    } else if (body.role === "driver") {
      const [profile] = await db
        .select({ id: driverProfilesTable.id })
        .from(driverProfilesTable)
        .where(eq(driverProfilesTable.userId, userId))
        .limit(1);
      if (!profile) {
        await db.insert(driverProfilesTable).values({ userId, status: "OFFLINE", isVerified: false });
      }
    }

    c.executionCtx.waitUntil(
      logAudit(db, {
        entity: "user",
        entityId: userId,
        action: AuditAction.USER_ROLE_CHANGED,
        actorId: authUser.userId,
        actorRole: "admin",
        metadata: { from: user.role, to: body.role },
        ipAddress: clientIp(c),
      })
    );
  } else {
    c.executionCtx.waitUntil(
      logAudit(db, {
        entity: "user",
        entityId: userId,
        action: AuditAction.USER_UPDATED_BY_ADMIN,
        actorId: authUser.userId,
        actorRole: "admin",
        ipAddress: clientIp(c),
      })
    );
  }

  const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return c.json(toAdminUser(updated!), 200);
});

// ─── GET /drivers — list, optional isVerified filter ───────────────────────
const listDriversRoute = createRoute({
  method: "get",
  path: "/drivers",
  tags: ["admin"],
  summary: "List drivers",
  request: {
    query: z.object({ isVerified: z.enum(["true", "false"]).optional() }),
  },
  responses: {
    200: { description: "Drivers", content: { "application/json": { schema: z.array(AdminDriverListItemSchema) } } },
  },
});

admin.openapi(listDriversRoute, async (c) => {
  const query = c.req.valid("query");
  const db = createDb(c.env.DB);

  const where = query.isVerified ? eq(driverProfilesTable.isVerified, query.isVerified === "true") : undefined;

  const rows = await db
    .select(driverProfileWithUserColumns())
    .from(driverProfilesTable)
    .innerJoin(usersTable, eq(driverProfilesTable.userId, usersTable.id))
    .where(where);

  return c.json(rows, 200);
});

// ─── GET /drivers/{driverId} — detail + document list ──────────────────────
const getDriverRoute = createRoute({
  method: "get",
  path: "/drivers/{driverId}",
  tags: ["admin"],
  summary: "Get a driver's profile and document statuses",
  request: { params: z.object({ driverId: z.string().uuid() }) },
  responses: {
    200: {
      description: "Driver + documents",
      content: {
        "application/json": {
          schema: AdminDriverListItemSchema.extend({ documents: z.array(DriverDocumentSchema) }),
        },
      },
    },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

admin.openapi(getDriverRoute, async (c) => {
  const { driverId } = c.req.valid("param");
  const db = createDb(c.env.DB);

  const [driver] = await db
    .select(driverProfileWithUserColumns())
    .from(driverProfilesTable)
    .innerJoin(usersTable, eq(driverProfilesTable.userId, usersTable.id))
    .where(eq(driverProfilesTable.id, driverId))
    .limit(1);
  if (!driver) {
    return c.json({ error: "NotFound", message: "Driver not found" }, 404);
  }

  const documents = await db
    .select()
    .from(driverDocumentsTable)
    .where(eq(driverDocumentsTable.driverId, driverId));

  return c.json({ ...driver, documents: documents.map((d) => toDocumentResponse(d)) }, 200);
});

// ─── PUT /drivers/{driverId}/verify ─────────────────────────────────────────
const verifyDriverRoute = createRoute({
  method: "put",
  path: "/drivers/{driverId}/verify",
  tags: ["admin"],
  summary: "Approve or revoke a driver's verification",
  request: {
    params: z.object({ driverId: z.string().uuid() }),
    body: { required: true, content: { "application/json": { schema: AdminVerifyDriverRequestSchema } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: AdminDriverListItemSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

admin.openapi(verifyDriverRoute, async (c) => {
  const { driverId } = c.req.valid("param");
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);
  const authUser = c.get("user")!;

  const [driver] = await db
    .select({ id: driverProfilesTable.id })
    .from(driverProfilesTable)
    .where(eq(driverProfilesTable.id, driverId))
    .limit(1);
  if (!driver) {
    return c.json({ error: "NotFound", message: "Driver not found" }, 404);
  }

  await db
    .update(driverProfilesTable)
    .set({ isVerified: body.isVerified, updatedAt: new Date() })
    .where(eq(driverProfilesTable.id, driverId));

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "driver_profile",
      entityId: driverId,
      action: body.isVerified ? AuditAction.DRIVER_VERIFIED : AuditAction.DRIVER_UNVERIFIED,
      actorId: authUser.userId,
      actorRole: "admin",
      ipAddress: clientIp(c),
    })
  );

  const [updated] = await db
    .select(driverProfileWithUserColumns())
    .from(driverProfilesTable)
    .innerJoin(usersTable, eq(driverProfilesTable.userId, usersTable.id))
    .where(eq(driverProfilesTable.id, driverId))
    .limit(1);
  return c.json(updated!, 200);
});

// ─── PUT /drivers/{driverId}/documents/{documentId} — approve/reject ───────
// Write-once (L17): once APPROVED, a document review can never be changed.
const reviewDocumentRoute = createRoute({
  method: "put",
  path: "/drivers/{driverId}/documents/{documentId}",
  tags: ["admin"],
  summary: "Approve or reject a driver document",
  request: {
    params: z.object({ driverId: z.string().uuid(), documentId: z.string().uuid() }),
    body: { required: true, content: { "application/json": { schema: AdminDocumentReviewRequestSchema } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: DriverDocumentSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    409: { description: "Already approved (immutable)", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

admin.openapi(reviewDocumentRoute, async (c) => {
  const { driverId, documentId } = c.req.valid("param");
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);
  const authUser = c.get("user")!;

  const [doc] = await db
    .select()
    .from(driverDocumentsTable)
    .where(and(eq(driverDocumentsTable.id, documentId), eq(driverDocumentsTable.driverId, driverId)))
    .limit(1);
  if (!doc) {
    return c.json({ error: "NotFound", message: "Document not found" }, 404);
  }
  if (doc.status === "APPROVED") {
    return c.json({ error: "Conflict", message: "An approved document cannot be changed" }, 409);
  }

  await db
    .update(driverDocumentsTable)
    .set({ status: body.status, reviewedAt: new Date(), reviewedBy: authUser.userId })
    .where(eq(driverDocumentsTable.id, documentId));

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "driver_document",
      entityId: documentId,
      action: body.status === "APPROVED" ? AuditAction.DOCUMENT_APPROVED : AuditAction.DOCUMENT_REJECTED,
      actorId: authUser.userId,
      actorRole: "admin",
      ipAddress: clientIp(c),
    })
  );

  const [updated] = await db.select().from(driverDocumentsTable).where(eq(driverDocumentsTable.id, documentId)).limit(1);
  return c.json(toDocumentResponse(updated!), 200);
});

// ─── GET /drivers/{driverId}/documents/{documentId}/file — decrypt+stream ──
// Admin-only per L17/L19 — drivers never get raw bytes back, only status.
const getDocumentFileRoute = createRoute({
  method: "get",
  path: "/drivers/{driverId}/documents/{documentId}/file",
  tags: ["admin"],
  summary: "Download a driver document's decrypted file",
  request: { params: z.object({ driverId: z.string().uuid(), documentId: z.string().uuid() }) },
  responses: {
    200: { description: "File bytes", content: { "application/octet-stream": { schema: z.string() } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

admin.openapi(getDocumentFileRoute, async (c) => {
  const { driverId, documentId } = c.req.valid("param");
  const db = createDb(c.env.DB);
  const authUser = c.get("user")!;

  const [doc] = await db
    .select()
    .from(driverDocumentsTable)
    .where(and(eq(driverDocumentsTable.id, documentId), eq(driverDocumentsTable.driverId, driverId)))
    .limit(1);
  if (!doc) {
    return c.json({ error: "NotFound", message: "Document not found" }, 404);
  }

  const object = await c.env.DOCS.get(doc.r2Key);
  if (!object) {
    return c.json({ error: "NotFound", message: "Stored file is missing" }, 404);
  }

  const meta = object.customMetadata ?? {};
  const ciphertext = await object.arrayBuffer();
  const plaintext = await decryptDocument(c.env.DOCUMENT_ENCRYPTION_KEY, {
    ciphertext,
    fileIv: meta.fileIv ?? "",
    wrappedKey: meta.wrappedKey ?? "",
    wrapIv: meta.wrapIv ?? "",
  });

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "driver_document",
      entityId: documentId,
      action: AuditAction.DOCUMENT_VIEWED,
      actorId: authUser.userId,
      actorRole: "admin",
      ipAddress: clientIp(c),
    })
  );

  return new Response(plaintext, {
    headers: { "Content-Type": meta.contentType ?? "application/octet-stream" },
  });
});

// ─── GET/POST /cities ───────────────────────────────────────────────────────
const listCitiesRoute = createRoute({
  method: "get",
  path: "/cities",
  tags: ["admin"],
  summary: "List cities",
  responses: { 200: { description: "Cities", content: { "application/json": { schema: z.array(CitySchema) } } } },
});

admin.openapi(listCitiesRoute, async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db.select().from(citiesTable);
  return c.json(rows, 200);
});

const createCityRoute = createRoute({
  method: "post",
  path: "/cities",
  tags: ["admin"],
  summary: "Create a city",
  request: { body: { required: true, content: { "application/json": { schema: CreateCityRequestSchema } } } },
  responses: { 201: { description: "Created", content: { "application/json": { schema: CitySchema } } } },
});

admin.openapi(createCityRoute, async (c) => {
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);
  const authUser = c.get("user")!;

  const [city] = await db.insert(citiesTable).values(body).returning();
  if (!city) throw new Error("Insert into cities returned no row");

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "city",
      entityId: city.id,
      action: AuditAction.CITY_CREATED,
      actorId: authUser.userId,
      actorRole: "admin",
      ipAddress: clientIp(c),
    })
  );

  return c.json(city, 201);
});

// ─── GET/PUT /pricing — admin-editable fare config (L8) ────────────────────
const getPricingRoute = createRoute({
  method: "get",
  path: "/pricing",
  tags: ["admin"],
  summary: "Get the global pricing config",
  responses: { 200: { description: "Config", content: { "application/json": { schema: PricingConfigSchema } } } },
});

admin.openapi(getPricingRoute, async (c) => {
  const db = createDb(c.env.DB);
  const [row] = await db.select().from(pricingConfigTable).where(isNull(pricingConfigTable.cityId)).limit(1);

  if (!row) {
    return c.json(
      {
        id: "unset",
        cityId: null,
        baseFare: 2.5,
        perMile: 1.2,
        driverUsagePerMinute: 0.25,
        driverCommissionPercent: 20,
        currency: "USD",
        updatedAt: new Date(0).toISOString(),
      },
      200
    );
  }

  return c.json(
    {
      id: row.id,
      cityId: row.cityId,
      baseFare: row.baseFareCents / 100,
      perMile: row.perMileCents / 100,
      driverUsagePerMinute: row.driverUsagePerMinuteCents / 100,
      driverCommissionPercent: row.driverCommissionPercent,
      currency: row.currency,
      updatedAt: row.updatedAt.toISOString(),
    },
    200
  );
});

const updatePricingRoute = createRoute({
  method: "put",
  path: "/pricing",
  tags: ["admin"],
  summary: "Update the global pricing config",
  request: {
    body: { required: true, content: { "application/json": { schema: UpdatePricingConfigRequestSchema } } },
  },
  responses: { 200: { description: "Updated", content: { "application/json": { schema: PricingConfigSchema } } } },
});

admin.openapi(updatePricingRoute, async (c) => {
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);
  const authUser = c.get("user")!;

  const baseFareCents = Math.round(body.baseFare * 100);
  const perMileCents = Math.round(body.perMile * 100);

  const [existing] = await db.select().from(pricingConfigTable).where(isNull(pricingConfigTable.cityId)).limit(1);

  // Faz 5b fields are optional (independent admin-UI editing) — fall back to
  // the current row's value, or the schema default if this is the first write.
  const driverUsagePerMinuteCents =
    body.driverUsagePerMinute != null ? Math.round(body.driverUsagePerMinute * 100) : (existing?.driverUsagePerMinuteCents ?? 25);
  const driverCommissionPercent = body.driverCommissionPercent ?? existing?.driverCommissionPercent ?? 20;

  if (existing) {
    await db
      .update(pricingConfigTable)
      .set({
        baseFareCents,
        perMileCents,
        driverUsagePerMinuteCents,
        driverCommissionPercent,
        updatedAt: new Date(),
        updatedBy: authUser.userId,
      })
      .where(eq(pricingConfigTable.id, existing.id));
  } else {
    await db
      .insert(pricingConfigTable)
      .values({ baseFareCents, perMileCents, driverUsagePerMinuteCents, driverCommissionPercent, updatedBy: authUser.userId });
  }

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "pricing_config",
      action: AuditAction.PRICING_UPDATED,
      actorId: authUser.userId,
      actorRole: "admin",
      metadata: { baseFareCents, perMileCents, driverUsagePerMinuteCents, driverCommissionPercent },
      ipAddress: clientIp(c),
    })
  );

  const [row] = await db.select().from(pricingConfigTable).where(isNull(pricingConfigTable.cityId)).limit(1);
  return c.json(
    {
      id: row!.id,
      cityId: row!.cityId,
      baseFare: row!.baseFareCents / 100,
      perMile: row!.perMileCents / 100,
      driverUsagePerMinute: row!.driverUsagePerMinuteCents / 100,
      driverCommissionPercent: row!.driverCommissionPercent,
      currency: row!.currency,
      updatedAt: row!.updatedAt.toISOString(),
    },
    200
  );
});

// ─── GET /reports/trips — trip + fare breakdown (L16 — vergi/güvenlik) ─────
// Filterable by driver/customer/status/date range; `?format=csv` streams a
// spreadsheet-ready file instead of JSON for import into accounting/tax tools.
const driverUser = alias(usersTable, "driver_user");
const customerUser = alias(usersTable, "customer_user");

const tripReportRoute = createRoute({
  method: "get",
  path: "/reports/trips",
  tags: ["admin"],
  summary: "Trip + fare report — filterable by driver/customer/status/date range, JSON or CSV",
  request: { query: TripReportQuerySchema },
  responses: {
    200: {
      description: "Report rows (JSON by default) or a CSV file with ?format=csv",
      content: {
        "application/json": { schema: z.array(TripReportRowSchema) },
        "text/csv": { schema: z.string() },
      },
    },
  },
});

admin.openapi(tripReportRoute, async (c) => {
  const query = c.req.valid("query");
  const db = createDb(c.env.DB);

  const conditions = [];
  if (query.driverId) conditions.push(eq(tripsTable.driverId, query.driverId));
  if (query.customerId) conditions.push(eq(tripsTable.customerId, query.customerId));
  if (query.status) conditions.push(eq(tripsTable.status, query.status));
  if (query.from) conditions.push(gte(tripsTable.requestedAt, query.from));
  if (query.to) conditions.push(lte(tripsTable.requestedAt, query.to));

  const rows = await db
    .select({
      tripId: tripsTable.id,
      status: tripsTable.status,
      requestedAt: tripsTable.requestedAt,
      completedAt: tripsTable.completedAt,
      driverId: tripsTable.driverId,
      driverFirstName: driverUser.firstName,
      driverLastName: driverUser.lastName,
      customerId: tripsTable.customerId,
      customerFirstName: customerUser.firstName,
      customerLastName: customerUser.lastName,
      distanceMiles: tripsTable.distanceMiles,
      estimatedFareCents: tripsTable.estimatedFareCents,
      finalFareCents: tripsTable.finalFareCents,
      currency: tripsTable.currency,
      paymentMethod: tripsTable.paymentMethod,
    })
    .from(tripsTable)
    .innerJoin(customerUser, eq(tripsTable.customerId, customerUser.id))
    .leftJoin(driverProfilesTable, eq(tripsTable.driverId, driverProfilesTable.id))
    .leftJoin(driverUser, eq(driverProfilesTable.userId, driverUser.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(tripsTable.requestedAt))
    .limit(query.limit)
    .offset(query.offset);

  const reportRows = rows.map((r) => ({
    tripId: r.tripId,
    status: r.status,
    requestedAt: r.requestedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    driverId: r.driverId,
    driverName: r.driverFirstName ? `${r.driverFirstName} ${r.driverLastName}` : null,
    customerId: r.customerId,
    customerName: `${r.customerFirstName} ${r.customerLastName}`,
    distanceMiles: r.distanceMiles,
    estimatedFare: r.estimatedFareCents != null ? r.estimatedFareCents / 100 : null,
    finalFare: r.finalFareCents != null ? r.finalFareCents / 100 : null,
    currency: r.currency,
    paymentMethod: r.paymentMethod,
  }));

  if (query.format === "csv") {
    return new Response(toCsv(reportRows), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="trip-report-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }
  return c.json(reportRows, 200);
});

// ─── GET /audit-logs — security/compliance trail (L16) ──────────────────────
const listAuditLogsRoute = createRoute({
  method: "get",
  path: "/audit-logs",
  tags: ["admin"],
  summary: "List audit log entries — filterable by entity/action/actor/date range",
  request: { query: AuditLogQuerySchema },
  responses: {
    200: { description: "Audit log entries", content: { "application/json": { schema: z.array(AuditLogEntrySchema) } } },
  },
});

admin.openapi(listAuditLogsRoute, async (c) => {
  const query = c.req.valid("query");
  const db = createDb(c.env.DB);

  const conditions = [];
  if (query.entity) conditions.push(eq(auditLogsTable.entity, query.entity));
  if (query.action) conditions.push(eq(auditLogsTable.action, query.action));
  if (query.actorId) conditions.push(eq(auditLogsTable.actorId, query.actorId));
  if (query.from) conditions.push(gte(auditLogsTable.createdAt, query.from));
  if (query.to) conditions.push(lte(auditLogsTable.createdAt, query.to));

  const rows = await db
    .select()
    .from(auditLogsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(query.limit)
    .offset(query.offset);

  return c.json(
    rows.map((r) => ({
      id: r.id,
      entity: r.entity,
      entityId: r.entityId,
      action: r.action,
      actorId: r.actorId,
      actorRole: r.actorRole,
      metadata: r.metadata,
      ipAddress: r.ipAddress,
      createdAt: r.createdAt.toISOString(),
    })),
    200
  );
});

// ─── POST /drivers/{driverId}/collections — record a cash payment (Faz 5b) ─
// A single lump-sum handover against the driver's combined balance (usage
// fee + commission together — a real cash handover isn't naturally split).
const recordCollectionRoute = createRoute({
  method: "post",
  path: "/drivers/{driverId}/collections",
  tags: ["admin"],
  summary: "Record a cash collection from a driver against their combined balance",
  request: {
    params: z.object({ driverId: z.string().uuid() }),
    body: { required: true, content: { "application/json": { schema: RecordCashCollectionRequestSchema } } },
  },
  responses: {
    201: { description: "Recorded", content: { "application/json": { schema: DriverCashCollectionSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

admin.openapi(recordCollectionRoute, async (c) => {
  const { driverId } = c.req.valid("param");
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);
  const authUser = c.get("user")!;

  const [driver] = await db
    .select(driverProfileWithUserColumns())
    .from(driverProfilesTable)
    .innerJoin(usersTable, eq(driverProfilesTable.userId, usersTable.id))
    .where(eq(driverProfilesTable.id, driverId))
    .limit(1);
  if (!driver) {
    return c.json({ error: "NotFound", message: "Driver not found" }, 404);
  }

  const [adminUser] = await db
    .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(usersTable)
    .where(eq(usersTable.id, authUser.userId))
    .limit(1);

  const amountCents = Math.round(body.amount * 100);
  const [collection] = await db
    .insert(driverCashCollectionsTable)
    .values({
      driverId,
      amountCents,
      collectedAt: body.collectedAt ?? new Date(),
      collectedBy: authUser.userId,
      notes: body.notes,
    })
    .returning();
  if (!collection) throw new Error("Insert into driver_cash_collections returned no row");

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "driver_cash_collection",
      entityId: collection.id,
      action: AuditAction.DRIVER_CASH_COLLECTED,
      actorId: authUser.userId,
      actorRole: "admin",
      metadata: { driverId, amountCents },
      ipAddress: clientIp(c),
    })
  );

  return c.json(
    {
      id: collection.id,
      driverId: collection.driverId,
      driverName: `${driver.firstName} ${driver.lastName}`,
      amount: collection.amountCents / 100,
      collectedAt: collection.collectedAt.toISOString(),
      collectedByName: adminUser ? `${adminUser.firstName} ${adminUser.lastName}` : authUser.email,
      notes: collection.notes,
      createdAt: collection.createdAt.toISOString(),
    },
    201
  );
});

// ─── POST /drivers/{driverId}/close-session — manual override (Faz 5b) ────
// The stale-session cron sweep handles abandoned sessions automatically;
// this is for an admin to resolve a stuck one immediately (e.g. a dispute).
const closeSessionRoute = createRoute({
  method: "post",
  path: "/drivers/{driverId}/close-session",
  tags: ["admin"],
  summary: "Force-close a driver's open session right now",
  request: { params: z.object({ driverId: z.string().uuid() }) },
  responses: {
    200: { description: "Closed", content: { "application/json": { schema: DriverSessionSchema } } },
    404: { description: "This driver has no open session", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

admin.openapi(closeSessionRoute, async (c) => {
  const { driverId } = c.req.valid("param");
  const db = createDb(c.env.DB);
  const authUser = c.get("user")!;

  const [driver] = await db
    .select({ id: driverProfilesTable.id })
    .from(driverProfilesTable)
    .where(eq(driverProfilesTable.id, driverId))
    .limit(1);
  if (!driver) {
    return c.json({ error: "NotFound", message: "Driver not found" }, 404);
  }

  const { perMinuteCents } = await getDriverUsageRates(db);
  const now = new Date();
  const closed = await closeOpenSession(db, driverId, now, perMinuteCents, "ADMIN_FORCE_CLOSE");
  if (!closed) {
    return c.json({ error: "NotFound", message: "This driver has no open session" }, 404);
  }

  await db.update(driverProfilesTable).set({ status: "OFFLINE", updatedAt: now }).where(eq(driverProfilesTable.id, driverId));

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "driver_session",
      entityId: closed.id,
      action: AuditAction.DRIVER_SESSION_FORCE_CLOSED,
      actorId: authUser.userId,
      actorRole: "admin",
      metadata: { driverId, durationMinutes: closed.durationMinutes, chargeCents: closed.chargeCents },
      ipAddress: clientIp(c),
    })
  );

  return c.json(toSessionResponse(closed), 200);
});

// ─── GET /drivers/{driverId}/sessions — footprint (day/hour ranges, Faz 5b) ─
const driverSessionsRoute = createRoute({
  method: "get",
  path: "/drivers/{driverId}/sessions",
  tags: ["admin"],
  summary: "A driver's online-session footprint (when they were active in the app), newest first",
  request: { params: z.object({ driverId: z.string().uuid() }), query: DriverSessionQuerySchema },
  responses: {
    200: { description: "Sessions", content: { "application/json": { schema: z.array(DriverSessionSchema) } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

admin.openapi(driverSessionsRoute, async (c) => {
  const { driverId } = c.req.valid("param");
  const query = c.req.valid("query");
  const db = createDb(c.env.DB);

  const [driver] = await db
    .select({ id: driverProfilesTable.id })
    .from(driverProfilesTable)
    .where(eq(driverProfilesTable.id, driverId))
    .limit(1);
  if (!driver) {
    return c.json({ error: "NotFound", message: "Driver not found" }, 404);
  }

  const conditions = [eq(driverSessionsTable.driverId, driverId)];
  if (query.from) conditions.push(gte(driverSessionsTable.startedAt, query.from));
  if (query.to) conditions.push(lte(driverSessionsTable.startedAt, query.to));

  const rows = await db
    .select()
    .from(driverSessionsTable)
    .where(and(...conditions))
    .orderBy(desc(driverSessionsTable.startedAt))
    .limit(query.limit)
    .offset(query.offset);

  return c.json(rows.map(toSessionResponse), 200);
});

// ─── GET /reports/driver-balances — pending debt per driver (Faz 5b) ──────
const driverBalancesRoute = createRoute({
  method: "get",
  path: "/reports/driver-balances",
  tags: ["admin"],
  summary: "Pending balance owed per driver — usage fee + commission, minus cash already collected",
  responses: {
    200: { description: "Balances", content: { "application/json": { schema: z.array(DriverBalanceReportRowSchema) } } },
  },
});

admin.openapi(driverBalancesRoute, async (c) => {
  const db = createDb(c.env.DB);

  const drivers = await db
    .select(driverProfileWithUserColumns())
    .from(driverProfilesTable)
    .innerJoin(usersTable, eq(driverProfilesTable.userId, usersTable.id));

  const rows = [];
  for (const driver of drivers) {
    const balance = await computeDriverBalance(db, driver.id);
    rows.push({
      driverId: driver.id,
      driverName: `${driver.firstName} ${driver.lastName}`,
      usageFeeCharged: balance.usageFeeChargedCents / 100,
      commissionCharged: balance.commissionChargedCents / 100,
      totalCharged: balance.totalChargedCents / 100,
      totalCollected: balance.totalCollectedCents / 100,
      pendingBalance: balance.pendingBalanceCents / 100,
      hasOpenSession: balance.hasOpenSession,
    });
  }

  return c.json(rows, 200);
});

// ─── GET /reports/driver-collections — cash already collected (Faz 5b) ────
const collectionDriverUser = alias(usersTable, "collection_driver_user");
const collectionAdminUser = alias(usersTable, "collection_admin_user");

const driverCollectionsReportRoute = createRoute({
  method: "get",
  path: "/reports/driver-collections",
  tags: ["admin"],
  summary: "Cash collections recorded from drivers — filterable, JSON or CSV",
  request: { query: DriverCollectionQuerySchema },
  responses: {
    200: {
      description: "Collections (JSON by default) or a CSV file with ?format=csv",
      content: {
        "application/json": { schema: z.array(DriverCashCollectionSchema) },
        "text/csv": { schema: z.string() },
      },
    },
  },
});

admin.openapi(driverCollectionsReportRoute, async (c) => {
  const query = c.req.valid("query");
  const db = createDb(c.env.DB);

  const conditions = [];
  if (query.driverId) conditions.push(eq(driverCashCollectionsTable.driverId, query.driverId));
  if (query.from) conditions.push(gte(driverCashCollectionsTable.collectedAt, query.from));
  if (query.to) conditions.push(lte(driverCashCollectionsTable.collectedAt, query.to));

  const rows = await db
    .select({
      id: driverCashCollectionsTable.id,
      driverId: driverCashCollectionsTable.driverId,
      driverFirstName: collectionDriverUser.firstName,
      driverLastName: collectionDriverUser.lastName,
      amountCents: driverCashCollectionsTable.amountCents,
      collectedAt: driverCashCollectionsTable.collectedAt,
      adminFirstName: collectionAdminUser.firstName,
      adminLastName: collectionAdminUser.lastName,
      notes: driverCashCollectionsTable.notes,
      createdAt: driverCashCollectionsTable.createdAt,
    })
    .from(driverCashCollectionsTable)
    .innerJoin(driverProfilesTable, eq(driverCashCollectionsTable.driverId, driverProfilesTable.id))
    .innerJoin(collectionDriverUser, eq(driverProfilesTable.userId, collectionDriverUser.id))
    .innerJoin(collectionAdminUser, eq(driverCashCollectionsTable.collectedBy, collectionAdminUser.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(driverCashCollectionsTable.collectedAt))
    .limit(query.limit)
    .offset(query.offset);

  const reportRows = rows.map((r) => ({
    id: r.id,
    driverId: r.driverId,
    driverName: `${r.driverFirstName} ${r.driverLastName}`,
    amount: r.amountCents / 100,
    collectedAt: r.collectedAt.toISOString(),
    collectedByName: `${r.adminFirstName} ${r.adminLastName}`,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
  }));

  if (query.format === "csv") {
    return new Response(toCsv(reportRows), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="driver-collections-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }
  return c.json(reportRows, 200);
});

export default admin;
