import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, desc, eq, gte, isNotNull, isNull, like, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  AdminCreateTripRequestSchema,
  AdminCreateUserRequestSchema,
  AdminDocumentReviewRequestSchema,
  AdminDriverListItemSchema,
  AdminReassignTripRequestSchema,
  AdminUpdateUserRequestSchema,
  AdminUserSchema,
  AdminVerifyDriverRequestSchema,
  SetTripReferralRequestSchema,
  AdminDriverEarningsQuerySchema,
  AdminDriverEarningsRowSchema,
  AdminTripLookupQuerySchema,
  AuditLogEntrySchema,
  AuditLogQuerySchema,
  AuthResponseSchema,
  FinancialSummaryQuerySchema,
  FinancialSummaryResponseSchema,
  CitySchema,
  CreateCityRequestSchema,
  DriverBalanceReportRowSchema,
  DriverCashCollectionSchema,
  DriverCollectionQuerySchema,
  DriverCommissionChargeSchema,
  DriverCommissionQuerySchema,
  DriverDocumentSchema,
  DriverSessionQuerySchema,
  DriverSessionSchema,
  ErrorResponseSchema,
  PricingConfigSchema,
  RecordCashCollectionRequestSchema,
  TripReportQuerySchema,
  TripReportRowSchema,
  TripResponseSchema,
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
  driverTripCommissionsTable,
  paymentsTable,
  pricingConfigTable,
  tripEventsTable,
  tripsTable,
  usersTable,
} from "@gnncab/db";
import type { AppBindings } from "../env";
import { AuditAction, logAudit } from "../lib/audit";
import { toCsv } from "../lib/csv";
import { decryptDocument } from "../lib/document-encryption";
import { driverProfileWithUserColumns } from "../lib/driver-queries";
import { closeOpenSession, computeDriverBalance, getDriverUsageRates, toSessionResponse } from "../lib/driver-sessions";
import { estimateFare } from "../lib/fare";
import { RoutingUnavailableError, roadDistanceMiles } from "../lib/routing";
import { sendPushToDriver, sendPushToUser } from "../lib/fcm";
import { hashPassword } from "../lib/password";
import { clientIp } from "../lib/request";
import { issueSession, toPublicUser } from "../lib/session";
import { customerTripNotification, NEW_TRIP_ASSIGNED_NOTIFICATION } from "../lib/trip-notifications";
import { authenticate, requireAdmin } from "../middlewares/auth";
import { toDocumentResponse } from "./driver_profile";
import { toTripResponse } from "./trips";

const admin = new OpenAPIHono<AppBindings>();

// A spreadsheet-ready file response — the report rows plus a dated filename so
// downloads don't all collide as "report.csv". The Flutter admin builds its
// own richly-formatted CSV/PDF client-side; this is the raw API export for
// curl/accounting-tool imports.
function csvResponse(rows: Record<string, unknown>[], name: string): Response {
  return new Response(toCsv(rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

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
admin.use("*", authenticate, requireAdmin());

function toAdminUser(user: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  isAdmin: boolean;
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
    isAdmin: user.isAdmin,
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
    403: { description: "Cannot create an admin", content: { "application/json": { schema: ErrorResponseSchema } } },
    409: { description: "Email already exists", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

admin.openapi(createUserRoute, async (c) => {
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);
  const authUser = c.get("user")!;

  // There is deliberately no API path that mints an admin. The one that
  // exists (bootstrap) is self-locking to a single account; every other
  // admin, if one is ever needed, is a direct database change — never
  // something reachable by calling an endpoint, including this one by an
  // already-authenticated admin.
  if (body.role === "admin") {
    return c.json({ error: "Forbidden", message: "Admin accounts cannot be created through the API" }, 403);
  }

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
    403: { description: "Cannot promote to admin", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

admin.openapi(updateUserRoute, async (c) => {
  const { userId } = c.req.valid("param");
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);
  const authUser = c.get("user")!;

  // Same rule as user creation: nothing reachable through the API can mint
  // an admin, including reassigning an existing account's role to one.
  if (body.role === "admin") {
    return c.json({ error: "Forbidden", message: "A user cannot be promoted to admin through the API" }, 403);
  }

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
  responses: {
    201: { description: "Created", content: { "application/json": { schema: CitySchema } } },
    409: { description: "Already exists", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

admin.openapi(createCityRoute, async (c) => {
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);
  const authUser = c.get("user")!;

  // Name+state, not name alone: "Portland" is a real ambiguity here (ME and
  // OR both exist), and the office's own settings copy already promises
  // coverage across several states.
  const [existing] = await db
    .select({ id: citiesTable.id })
    .from(citiesTable)
    .where(
      and(
        sql`lower(${citiesTable.name}) = lower(${body.name})`,
        body.state ? sql`lower(${citiesTable.state}) = lower(${body.state})` : isNull(citiesTable.state)
      )
    )
    .limit(1);
  if (existing) {
    return c.json({ error: "Conflict", message: "This service area has already been added" }, 409);
  }

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

// ─── DELETE /cities/{cityId} ────────────────────────────────────────────────
const deleteCityRoute = createRoute({
  method: "delete",
  path: "/cities/{cityId}",
  tags: ["admin"],
  summary: "Remove a service area",
  request: { params: z.object({ cityId: z.string().uuid() }) },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: z.object({ success: z.literal(true) }) } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    409: { description: "Still referenced elsewhere", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

admin.openapi(deleteCityRoute, async (c) => {
  const { cityId } = c.req.valid("param");
  const db = createDb(c.env.DB);
  const authUser = c.get("user")!;

  const [city] = await db.select({ id: citiesTable.id }).from(citiesTable).where(eq(citiesTable.id, cityId)).limit(1);
  if (!city) return c.json({ error: "NotFound", message: "Service area not found" }, 404);

  try {
    await db.delete(citiesTable).where(eq(citiesTable.id, cityId));
  } catch {
    // A trip or pricing row still references it (FOREIGN KEY, no cascade) —
    // nothing today actually sets a trip's cityId, but a stale reference is a
    // real possibility once city-specific pricing is used.
    return c.json(
      { error: "Conflict", message: "This service area is still referenced by existing trips or pricing and cannot be removed" },
      409
    );
  }

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "city",
      entityId: cityId,
      action: AuditAction.CITY_DELETED,
      actorId: authUser.userId,
      actorRole: "admin",
      ipAddress: clientIp(c),
    })
  );

  return c.json({ success: true as const }, 200);
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
      referralSource: tripsTable.referralSource,
      pickupAddress: tripsTable.pickupAddress,
      dropoffAddress: tripsTable.dropoffAddress,
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
    referralSource: r.referralSource,
    pickupAddress: r.pickupAddress,
    dropoffAddress: r.dropoffAddress,
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

// ─── GET /trips/lookup — find a trip by id or short prefix ─────────────────
// Powers the office's "give us your trip ID" support flow: a passenger or
// driver reads out the 8-char code and the admin pulls the whole trip. Prefix
// match, so the short code is enough; the id is sanitised to its own charset
// (hex + hyphen) before it touches LIKE.
const lookupDriverUser = alias(usersTable, "lookup_driver_user");
const lookupCustomerUser = alias(usersTable, "lookup_customer_user");

const tripLookupRoute = createRoute({
  method: "get",
  path: "/trips/lookup",
  tags: ["admin"],
  summary: "Find a trip by full id or short prefix (support lookup)",
  request: { query: AdminTripLookupQuerySchema },
  responses: {
    200: { description: "Matching trips (usually one)", content: { "application/json": { schema: z.array(TripResponseSchema) } } },
  },
});

admin.openapi(tripLookupRoute, async (c) => {
  const { q } = c.req.valid("query");
  const db = createDb(c.env.DB);

  // A trip id is lowercase hex + hyphens; anything else can't be part of one,
  // and dropping it also neutralises LIKE wildcards (% _) in one step.
  const prefix = q.toLowerCase().replace(/[^0-9a-f-]/g, "");
  if (prefix.length === 0) return c.json([], 200);

  const rows = await db
    .select({
      trip: tripsTable,
      driverFirst: lookupDriverUser.firstName,
      driverLast: lookupDriverUser.lastName,
      customerFirst: lookupCustomerUser.firstName,
      customerLast: lookupCustomerUser.lastName,
    })
    .from(tripsTable)
    .leftJoin(driverProfilesTable, eq(driverProfilesTable.id, tripsTable.driverId))
    .leftJoin(lookupDriverUser, eq(lookupDriverUser.id, driverProfilesTable.userId))
    .leftJoin(lookupCustomerUser, eq(lookupCustomerUser.id, tripsTable.customerId))
    .where(like(tripsTable.id, `${prefix}%`))
    .orderBy(desc(tripsTable.requestedAt))
    .limit(10);

  return c.json(
    rows.map((r) =>
      toTripResponse(r.trip, {
        driverName: r.driverFirst ? `${r.driverFirst} ${r.driverLast}` : null,
        customerName: r.customerFirst ? `${r.customerFirst} ${r.customerLast}` : (r.trip.guestName ?? null),
      })
    ),
    200
  );
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
  summary: "Pending balance owed per driver — usage fee + commission, minus cash already collected. JSON or CSV",
  request: { query: z.object({ format: z.enum(["json", "csv"]).default("json") }) },
  responses: {
    200: {
      description: "Balances (JSON by default) or a CSV file with ?format=csv",
      content: {
        "application/json": { schema: z.array(DriverBalanceReportRowSchema) },
        "text/csv": { schema: z.string() },
      },
    },
  },
});

admin.openapi(driverBalancesRoute, async (c) => {
  const { format } = c.req.valid("query");
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

  if (format === "csv") {
    return csvResponse(rows, "driver-balances");
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

// ─── GET /reports/driver-commissions — per-trip commission charges (Faz 5c) ─
const driverCommissionsReportRoute = createRoute({
  method: "get",
  path: "/reports/driver-commissions",
  tags: ["admin"],
  summary: "Commission charges from admin-assigned trips — filterable by driver/date range. JSON or CSV",
  request: { query: DriverCommissionQuerySchema },
  responses: {
    200: {
      description: "Commission charges (JSON by default) or a CSV file with ?format=csv",
      content: {
        "application/json": { schema: z.array(DriverCommissionChargeSchema) },
        "text/csv": { schema: z.string() },
      },
    },
  },
});

admin.openapi(driverCommissionsReportRoute, async (c) => {
  const query = c.req.valid("query");
  const db = createDb(c.env.DB);

  const conditions = [];
  if (query.driverId) conditions.push(eq(driverTripCommissionsTable.driverId, query.driverId));
  if (query.from) conditions.push(gte(driverTripCommissionsTable.createdAt, query.from));
  if (query.to) conditions.push(lte(driverTripCommissionsTable.createdAt, query.to));

  const rows = await db
    .select({
      id: driverTripCommissionsTable.id,
      driverId: driverTripCommissionsTable.driverId,
      driverFirstName: usersTable.firstName,
      driverLastName: usersTable.lastName,
      tripId: driverTripCommissionsTable.tripId,
      fareCents: driverTripCommissionsTable.fareCents,
      commissionPercent: driverTripCommissionsTable.commissionPercent,
      commissionCents: driverTripCommissionsTable.commissionCents,
      createdAt: driverTripCommissionsTable.createdAt,
    })
    .from(driverTripCommissionsTable)
    .innerJoin(driverProfilesTable, eq(driverTripCommissionsTable.driverId, driverProfilesTable.id))
    .innerJoin(usersTable, eq(driverProfilesTable.userId, usersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(driverTripCommissionsTable.createdAt))
    .limit(query.limit)
    .offset(query.offset);

  const reportRows = rows.map((r) => ({
    id: r.id,
    driverId: r.driverId,
    driverName: `${r.driverFirstName} ${r.driverLastName}`,
    tripId: r.tripId,
    fare: r.fareCents / 100,
    commissionPercent: r.commissionPercent,
    commission: r.commissionCents / 100,
    createdAt: r.createdAt.toISOString(),
  }));

  if (query.format === "csv") {
    return csvResponse(reportRows, "driver-commissions");
  }
  return c.json(reportRows, 200);
});

// ─── GET /reports/driver-earnings — per-driver completed-fare totals ───────
// The office-side mirror of the driver's own /driver/earnings: one totals row
// per driver so an admin can run the whole fleet, or hand a single driver
// their figure for a meeting (?driverId=). This is the *driver's* turnover
// (what passengers paid them) — GNN's own cut lives in the other reports.
const earningsDriverUser = alias(usersTable, "earnings_driver_user");

const adminDriverEarningsRoute = createRoute({
  method: "get",
  path: "/reports/driver-earnings",
  tags: ["admin"],
  summary: "Completed-fare earnings per driver — the whole fleet, or one driver with ?driverId",
  request: { query: AdminDriverEarningsQuerySchema },
  responses: {
    200: { description: "Earnings rows", content: { "application/json": { schema: z.array(AdminDriverEarningsRowSchema) } } },
  },
});

admin.openapi(adminDriverEarningsRoute, async (c) => {
  const query = c.req.valid("query");
  const db = createDb(c.env.DB);

  const conditions = [eq(tripsTable.status, "TRIP_COMPLETED")];
  if (query.driverId) conditions.push(eq(tripsTable.driverId, query.driverId));
  if (query.from) conditions.push(gte(tripsTable.completedAt, query.from));
  if (query.to) conditions.push(lte(tripsTable.completedAt, query.to));

  const rows = await db
    .select({
      driverId: tripsTable.driverId,
      driverFirstName: earningsDriverUser.firstName,
      driverLastName: earningsDriverUser.lastName,
      tripCount: sql<number>`count(*)`,
      totalCents: sql<number>`coalesce(sum(${tripsTable.finalFareCents}), 0)`,
      currency: sql<string>`coalesce(max(${tripsTable.currency}), 'USD')`,
    })
    .from(tripsTable)
    .innerJoin(driverProfilesTable, eq(tripsTable.driverId, driverProfilesTable.id))
    .innerJoin(earningsDriverUser, eq(driverProfilesTable.userId, earningsDriverUser.id))
    .where(and(...conditions))
    .groupBy(tripsTable.driverId, earningsDriverUser.firstName, earningsDriverUser.lastName)
    .orderBy(desc(sql`sum(${tripsTable.finalFareCents})`));

  return c.json(
    rows.map((r) => ({
      driverId: r.driverId!,
      driverName: `${r.driverFirstName} ${r.driverLastName}`,
      tripCount: r.tripCount,
      totalEarnings: r.totalCents / 100,
      currency: r.currency,
    })),
    200
  );
});

// ─── GET /reports/financial-summary — period totals for tax filing ─────────
// GNN LLC's income is rent (usage fees) + commission; the gross fares the
// passengers paid are the drivers' turnover, not GNN's, so they sit in a
// separate informational block. Every figure sums over [from, to]; omit
// either bound for an open-ended range. Aggregated in four grouped queries
// (usage / commission / collected / fares), then merged per driver.
const financialSummaryRoute = createRoute({
  method: "get",
  path: "/reports/financial-summary",
  tags: ["admin"],
  summary: "Period financial summary — GNN income (rent + commission), cash collected, and gross fares",
  request: { query: FinancialSummaryQuerySchema },
  responses: {
    200: { description: "Summary", content: { "application/json": { schema: FinancialSummaryResponseSchema } } },
  },
});

admin.openapi(financialSummaryRoute, async (c) => {
  const query = c.req.valid("query");
  const db = createDb(c.env.DB);

  const between = (col: Parameters<typeof gte>[0]) => {
    const cs = [];
    if (query.from) cs.push(gte(col, query.from));
    if (query.to) cs.push(lte(col, query.to));
    return cs;
  };

  // Usage fees (rent) — closed, priced sessions only.
  const usageRows = await db
    .select({
      driverId: driverSessionsTable.driverId,
      cents: sql<number>`coalesce(sum(${driverSessionsTable.chargeCents}), 0)`,
    })
    .from(driverSessionsTable)
    .where(and(isNotNull(driverSessionsTable.chargeCents), ...between(driverSessionsTable.endedAt)))
    .groupBy(driverSessionsTable.driverId);

  const commissionRows = await db
    .select({
      driverId: driverTripCommissionsTable.driverId,
      cents: sql<number>`coalesce(sum(${driverTripCommissionsTable.commissionCents}), 0)`,
    })
    .from(driverTripCommissionsTable)
    .where(between(driverTripCommissionsTable.createdAt).length ? and(...between(driverTripCommissionsTable.createdAt)) : undefined)
    .groupBy(driverTripCommissionsTable.driverId);

  const collectionRows = await db
    .select({
      driverId: driverCashCollectionsTable.driverId,
      cents: sql<number>`coalesce(sum(${driverCashCollectionsTable.amountCents}), 0)`,
    })
    .from(driverCashCollectionsTable)
    .where(between(driverCashCollectionsTable.collectedAt).length ? and(...between(driverCashCollectionsTable.collectedAt)) : undefined)
    .groupBy(driverCashCollectionsTable.driverId);

  const fareRows = await db
    .select({
      driverId: tripsTable.driverId,
      cents: sql<number>`coalesce(sum(${tripsTable.finalFareCents}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(tripsTable)
    .where(and(eq(tripsTable.status, "TRIP_COMPLETED"), ...between(tripsTable.completedAt)))
    .groupBy(tripsTable.driverId);

  // Names for every driver that appears in any bucket.
  const nameRows = await db
    .select({ id: driverProfilesTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(driverProfilesTable)
    .innerJoin(usersTable, eq(driverProfilesTable.userId, usersTable.id));
  const names = new Map(nameRows.map((n) => [n.id, `${n.firstName} ${n.lastName}`]));

  type Acc = { usage: number; commission: number; collected: number; fares: number; trips: number };
  const perDriver = new Map<string, Acc>();
  const bump = (id: string | null, patch: Partial<Acc>) => {
    if (!id) return;
    const cur = perDriver.get(id) ?? { usage: 0, commission: 0, collected: 0, fares: 0, trips: 0 };
    perDriver.set(id, {
      usage: cur.usage + (patch.usage ?? 0),
      commission: cur.commission + (patch.commission ?? 0),
      collected: cur.collected + (patch.collected ?? 0),
      fares: cur.fares + (patch.fares ?? 0),
      trips: cur.trips + (patch.trips ?? 0),
    });
  };
  for (const r of usageRows) bump(r.driverId, { usage: r.cents });
  for (const r of commissionRows) bump(r.driverId, { commission: r.cents });
  for (const r of collectionRows) bump(r.driverId, { collected: r.cents });
  for (const r of fareRows) bump(r.driverId, { fares: r.cents, trips: r.count });

  const drivers = [...perDriver.entries()]
    .map(([driverId, a]) => ({
      driverId,
      driverName: names.get(driverId) ?? "Unknown",
      usageFeesCharged: a.usage / 100,
      commissionCharged: a.commission / 100,
      gnnRevenue: (a.usage + a.commission) / 100,
      cashCollected: a.collected / 100,
      completedTripCount: a.trips,
      grossFares: a.fares / 100,
    }))
    .sort((x, y) => y.gnnRevenue - x.gnnRevenue);

  const sum = (pick: (a: Acc) => number) => [...perDriver.values()].reduce((s, a) => s + pick(a), 0);
  const usageTotal = sum((a) => a.usage);
  const commissionTotal = sum((a) => a.commission);

  return c.json(
    {
      from: query.from ? query.from.toISOString() : null,
      to: query.to ? query.to.toISOString() : null,
      currency: "USD",
      usageFeesCharged: usageTotal / 100,
      commissionCharged: commissionTotal / 100,
      gnnGrossRevenue: (usageTotal + commissionTotal) / 100,
      cashCollected: sum((a) => a.collected) / 100,
      completedTripCount: sum((a) => a.trips),
      grossFares: sum((a) => a.fares) / 100,
      drivers,
    },
    200
  );
});

// ─── POST /trips — admin directly assigns a trip to a chosen driver (Faz 5c) ─
// Skips DispatchCoordinator entirely (no nearest-driver search, no accept/
// reject timer) — the admin already chose who does this job. Uses RESERVED
// (defined since Faz 3 but never actually used anywhere) for its first real
// purpose: this driver is spoken for until they accept or are reassigned.
const REASSIGNABLE_STATUSES = new Set(["REQUESTED", "DRIVER_ASSIGNED", "DRIVER_REJECTED", "DRIVER_NO_RESPONSE", "TIMEOUT"]);

const adminCreateTripRoute = createRoute({
  method: "post",
  path: "/trips",
  tags: ["admin"],
  summary: "Directly assign a trip to a chosen driver, skipping auto-dispatch (e.g. a phoned-in booking)",
  request: { body: { required: true, content: { "application/json": { schema: AdminCreateTripRequestSchema } } } },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: TripResponseSchema } } },
    404: { description: "Driver or customer not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    409: { description: "Driver is not currently available", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

admin.openapi(adminCreateTripRoute, async (c) => {
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);
  const authUser = c.get("user")!;

  const [driver] = await db.select().from(driverProfilesTable).where(eq(driverProfilesTable.id, body.driverId)).limit(1);
  if (!driver) {
    return c.json({ error: "NotFound", message: "Driver not found" }, 404);
  }
  if (driver.status !== "AVAILABLE") {
    return c.json({ error: "Conflict", message: "This driver is not currently available" }, 409);
  }

  if (body.customerId) {
    const [customer] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.id, body.customerId), eq(usersTable.role, "customer")))
      .limit(1);
    if (!customer) {
      return c.json({ error: "NotFound", message: "Customer not found" }, 404);
    }
  }

  let distanceMiles: number | null = null;
  let estimatedFareCents: number | null = null;
  let currency = "USD";
  if (body.dropoffLat != null && body.dropoffLng != null) {
    const roadMiles = await roadDistanceMiles(c.env,
      { lat: body.pickupLat, lng: body.pickupLng },
      { lat: body.dropoffLat, lng: body.dropoffLng }
    );
    const fare = await estimateFare(db, roadMiles);
    distanceMiles = fare.distanceMiles;
    estimatedFareCents = fare.estimatedFareCents;
    currency = fare.currency;
  }

  const { commissionPercent } = await getDriverUsageRates(db);
  const now = new Date();

  await db.update(driverProfilesTable).set({ status: "RESERVED", updatedAt: now }).where(eq(driverProfilesTable.id, body.driverId));

  const [trip] = await db
    .insert(tripsTable)
    .values({
      customerId: body.customerId ?? null,
      guestName: body.guestName ?? null,
      guestPhone: body.guestPhone ?? null,
      driverId: body.driverId,
      pickupLat: body.pickupLat,
      pickupLng: body.pickupLng,
      pickupAddress: body.pickupAddress,
      dropoffLat: body.dropoffLat ?? null,
      dropoffLng: body.dropoffLng ?? null,
      dropoffAddress: body.dropoffAddress ?? null,
      distanceMiles,
      estimatedFareCents,
      currency,
      paymentMethod: body.paymentMethod,
      notes: body.notes,
      status: "DRIVER_ASSIGNED",
      origin: "ADMIN_ASSIGNED",
      // The office picked this driver, so it is a referral by definition —
      // the driver's checkbox arrives already ticked and they just accept.
      referralSource: "ADMIN_ASSIGNED",
      commissionPercent,
      assignedAt: now,
    })
    .returning();
  if (!trip) throw new Error("Insert into trips returned no row");

  await db.insert(tripEventsTable).values({
    tripId: trip.id,
    status: "DRIVER_ASSIGNED",
    actorId: authUser.userId,
    actorRole: "admin",
    metadata: { driverId: body.driverId },
  });

  if (estimatedFareCents != null) {
    await db
      .insert(paymentsTable)
      .values({ tripId: trip.id, amountCents: estimatedFareCents, currency, method: body.paymentMethod, status: "PENDING" });
  }

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "trip",
      entityId: trip.id,
      action: AuditAction.TRIP_ADMIN_ASSIGNED,
      actorId: authUser.userId,
      actorRole: "admin",
      metadata: { driverId: body.driverId, commissionPercent },
      ipAddress: clientIp(c),
    })
  );

  c.executionCtx.waitUntil(sendPushToDriver(db, c.env.FCM_SERVICE_ACCOUNT_KEY, body.driverId, NEW_TRIP_ASSIGNED_NOTIFICATION));
  if (trip.customerId) {
    const notification = customerTripNotification("DRIVER_ASSIGNED");
    if (notification) c.executionCtx.waitUntil(sendPushToUser(db, c.env.FCM_SERVICE_ACCOUNT_KEY, trip.customerId, notification));
  }

  return c.json(toTripResponse(trip), 201);
});

// ─── PUT /trips/{tripId}/referral — did GNN LLC refer this job? ───────────
//
// The office has the last word on this, by design. Commission rests on it,
// and nobody volunteers to pay commission — a system that trusted only the
// driver's checkbox would quietly lose money on every job they forgot or
// chose not to tick. The office knows what it handed out, so it can always
// correct the record, and every change is audit-logged so a later dispute has
// something to read.
//
// Only takes effect before completion: once the trip is done the commission
// row is already written, and silently re-deriving money after the fact is
// worse than making someone do it deliberately.
const adminSetTripReferralRoute = createRoute({
  method: "put",
  path: "/trips/{tripId}/referral",
  tags: ["admin"],
  summary: "Mark (or unmark) a trip as referred by GNN LLC",
  request: {
    params: z.object({ tripId: z.string() }),
    body: { required: true, content: { "application/json": { schema: SetTripReferralRequestSchema } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: TripResponseSchema } } },
    400: { description: "Trip already finished", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

admin.openapi(adminSetTripReferralRoute, async (c) => {
  const authUser = c.get("user")!;
  const { tripId } = c.req.valid("param");
  const { referred } = c.req.valid("json");
  const db = createDb(c.env.DB);

  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
  if (!trip) return c.json({ error: "NotFound", message: "Trip not found" }, 404);

  if (trip.status === "TRIP_COMPLETED") {
    return c.json(
      {
        error: "InvalidState",
        message: "This trip is finished and its commission is already booked. Adjust the driver's balance instead.",
      },
      400
    );
  }

  const { commissionPercent } = await getDriverUsageRates(db);
  const [updated] = await db
    .update(tripsTable)
    .set(
      referred
        ? { referralSource: "ADMIN_MARKED", commissionPercent, updatedAt: new Date() }
        : { referralSource: "NONE", commissionPercent: null, updatedAt: new Date() }
    )
    .where(eq(tripsTable.id, tripId))
    .returning();

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "trip",
      entityId: tripId,
      action: AuditAction.TRIP_REFERRAL_CHANGED,
      actorId: authUser.userId,
      actorRole: "admin",
      metadata: { from: trip.referralSource, to: updated!.referralSource, commissionPercent },
      ipAddress: clientIp(c),
    })
  );

  return c.json(toTripResponse(updated!), 200);
});

// ─── PUT /trips/{tripId}/reassign — pick a different driver (Faz 5c) ──────
// No DO accept/reject timer exists for admin-assigned trips (nothing ever
// called /dispatch for them) — if a driver rejects or never responds, the
// trip just sits there until an admin reassigns it here.
const adminReassignTripRoute = createRoute({
  method: "put",
  path: "/trips/{tripId}/reassign",
  tags: ["admin"],
  summary: "Reassign an admin-assigned trip to a different driver",
  request: {
    params: z.object({ tripId: z.string().uuid() }),
    body: { required: true, content: { "application/json": { schema: AdminReassignTripRequestSchema } } },
  },
  responses: {
    200: { description: "Reassigned", content: { "application/json": { schema: TripResponseSchema } } },
    400: { description: "Cannot reassign in the trip's current state", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Trip or driver not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    409: { description: "Driver is not currently available", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

admin.openapi(adminReassignTripRoute, async (c) => {
  const { tripId } = c.req.valid("param");
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);
  const authUser = c.get("user")!;

  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
  if (!trip) {
    return c.json({ error: "NotFound", message: "Trip not found" }, 404);
  }
  if (trip.origin !== "ADMIN_ASSIGNED") {
    return c.json({ error: "InvalidState", message: "Only admin-assigned trips can be reassigned this way" }, 400);
  }
  if (!REASSIGNABLE_STATUSES.has(trip.status)) {
    return c.json({ error: "InvalidState", message: `Cannot reassign a trip in status ${trip.status}` }, 400);
  }

  const [driver] = await db
    .select({ id: driverProfilesTable.id, status: driverProfilesTable.status })
    .from(driverProfilesTable)
    .where(eq(driverProfilesTable.id, body.driverId))
    .limit(1);
  if (!driver) {
    return c.json({ error: "NotFound", message: "Driver not found" }, 404);
  }
  if (driver.status !== "AVAILABLE") {
    return c.json({ error: "Conflict", message: "This driver is not currently available" }, 409);
  }

  const now = new Date();
  const previousDriverId = trip.driverId;

  if (previousDriverId && previousDriverId !== body.driverId) {
    await db.update(driverProfilesTable).set({ status: "AVAILABLE", updatedAt: now }).where(eq(driverProfilesTable.id, previousDriverId));
  }
  await db.update(driverProfilesTable).set({ status: "RESERVED", updatedAt: now }).where(eq(driverProfilesTable.id, body.driverId));

  const [updated] = await db
    .update(tripsTable)
    .set({ driverId: body.driverId, status: "DRIVER_ASSIGNED", assignedAt: now, updatedAt: now })
    .where(eq(tripsTable.id, tripId))
    .returning();

  await db.insert(tripEventsTable).values({
    tripId,
    status: "DRIVER_ASSIGNED",
    actorId: authUser.userId,
    actorRole: "admin",
    metadata: { driverId: body.driverId, reassigned: true },
  });

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "trip",
      entityId: tripId,
      action: AuditAction.TRIP_REASSIGNED,
      actorId: authUser.userId,
      actorRole: "admin",
      metadata: { fromDriverId: previousDriverId, toDriverId: body.driverId },
      ipAddress: clientIp(c),
    })
  );

  c.executionCtx.waitUntil(sendPushToDriver(db, c.env.FCM_SERVICE_ACCOUNT_KEY, body.driverId, NEW_TRIP_ASSIGNED_NOTIFICATION));
  if (updated?.customerId) {
    const notification = customerTripNotification("DRIVER_ASSIGNED");
    if (notification) c.executionCtx.waitUntil(sendPushToUser(db, c.env.FCM_SERVICE_ACCOUNT_KEY, updated.customerId, notification));
  }

  return c.json(toTripResponse(updated!), 200);
});

export default admin;
