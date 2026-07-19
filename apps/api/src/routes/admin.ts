import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, eq, isNull } from "drizzle-orm";
import {
  AdminCreateUserRequestSchema,
  AdminDocumentReviewRequestSchema,
  AdminDriverListItemSchema,
  AdminUpdateUserRequestSchema,
  AdminUserSchema,
  AdminVerifyDriverRequestSchema,
  CitySchema,
  CreateCityRequestSchema,
  DriverDocumentSchema,
  ErrorResponseSchema,
  PricingConfigSchema,
  UpdatePricingConfigRequestSchema,
  USER_ROLES,
} from "@gnncab/contract";
import {
  citiesTable,
  createDb,
  customerProfilesTable,
  driverDocumentsTable,
  driverProfilesTable,
  pricingConfigTable,
  usersTable,
} from "@gnncab/db";
import type { AppBindings } from "../env";
import { AuditAction, logAudit } from "../lib/audit";
import { decryptDocument } from "../lib/document-encryption";
import { driverProfileWithUserColumns } from "../lib/driver-queries";
import { hashPassword } from "../lib/password";
import { clientIp } from "../lib/request";
import { authenticate, requireRole } from "../middlewares/auth";
import { toDocumentResponse } from "./driver_profile";

const admin = new OpenAPIHono<AppBindings>();

// Every route in this file is admin-only (L16) — safe to gate with a single
// wildcard, unlike driver_profile.ts which also has a public register route.
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
      { id: "unset", cityId: null, baseFare: 2.5, perMile: 1.2, currency: "USD", updatedAt: new Date(0).toISOString() },
      200
    );
  }

  return c.json(
    {
      id: row.id,
      cityId: row.cityId,
      baseFare: row.baseFareCents / 100,
      perMile: row.perMileCents / 100,
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

  const [existing] = await db
    .select({ id: pricingConfigTable.id })
    .from(pricingConfigTable)
    .where(isNull(pricingConfigTable.cityId))
    .limit(1);

  if (existing) {
    await db
      .update(pricingConfigTable)
      .set({ baseFareCents, perMileCents, updatedAt: new Date(), updatedBy: authUser.userId })
      .where(eq(pricingConfigTable.id, existing.id));
  } else {
    await db.insert(pricingConfigTable).values({ baseFareCents, perMileCents, updatedBy: authUser.userId });
  }

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "pricing_config",
      action: AuditAction.PRICING_UPDATED,
      actorId: authUser.userId,
      actorRole: "admin",
      metadata: { baseFareCents, perMileCents },
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
      currency: row!.currency,
      updatedAt: row!.updatedAt.toISOString(),
    },
    200
  );
});

export default admin;
