import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { except } from "hono/combine";
import {
  AuthResponseSchema,
  DriverDocumentSchema,
  DriverEarningsQuerySchema,
  DriverEarningsSummarySchema,
  DriverOwnBalanceSchema,
  DriverProfileResponseSchema,
  DriverProfileUpdateRequestSchema,
  DriverRegisterRequestSchema,
  DriverSessionQuerySchema,
  DriverSessionSchema,
  DRIVER_DOCUMENT_TYPES,
  ErrorResponseSchema,
} from "@gnncab/contract";
import { createDb, driverDocumentsTable, driverProfilesTable, driverSessionsTable, tripsTable, usersTable } from "@gnncab/db";
import type { AppBindings } from "../env";
import { AuditAction, logAudit } from "../lib/audit";
import { encryptDocument } from "../lib/document-encryption";
import { getAdminEmails, sendEmail } from "../lib/email";
import { adminNewSignupEmail, welcomeEmail } from "../lib/email-templates";
import { closeOpenSession, computeDriverBalance, getDriverUsageRates, openSession, toSessionResponse } from "../lib/driver-sessions";
import { driverProfileWithUserColumns } from "../lib/driver-queries";
import { hashPassword } from "../lib/password";
import { clientIp } from "../lib/request";
import { issueSession, toPublicUser } from "../lib/session";
import { authenticate, requireRole } from "../middlewares/auth";

const driverProfile = new OpenAPIHono<AppBindings>();

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB

function toDocumentResponse(doc: {
  id: string;
  type: string;
  status: string;
  uploadedAt: Date;
  reviewedAt: Date | null;
}) {
  return {
    id: doc.id,
    type: doc.type as (typeof DRIVER_DOCUMENT_TYPES)[number],
    status: doc.status as "PENDING" | "APPROVED" | "REJECTED",
    uploadedAt: doc.uploadedAt.toISOString(),
    reviewedAt: doc.reviewedAt?.toISOString() ?? null,
  };
}

// ─── POST /register — driver self sign-up (L15) ───────────────────────────
const registerRoute = createRoute({
  method: "post",
  path: "/register",
  tags: ["driver"],
  summary: "Register a new driver account (pending verification)",
  request: { body: { required: true, content: { "application/json": { schema: DriverRegisterRequestSchema } } } },
  responses: {
    201: { description: "Account created", content: { "application/json": { schema: AuthResponseSchema } } },
    409: {
      description: "Email already registered",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

driverProfile.openapi(registerRoute, async (c) => {
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);

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
      // Recorded at the moment of consent, with the version of the wording
      // they were shown — "they agreed" is worth little in a dispute without
      // saying what they agreed to.
      termsAcceptedAt: new Date(),
      termsVersion: body.acceptedTermsVersion,
      role: "driver",
    })
    .returning();
  if (!user) throw new Error("Insert into users returned no row");

  await db.insert(driverProfilesTable).values({
    userId: user.id,
    licenseNumber: body.licenseNumber,
    vehicleMake: body.vehicleMake,
    vehicleModel: body.vehicleModel,
    vehicleYear: body.vehicleYear,
    vehicleColor: body.vehicleColor,
    vehiclePlate: body.vehiclePlate,
    status: "OFFLINE",
    isVerified: false,
  });

  const session = await issueSession(c, db, toPublicUser(user), body.platform, body.deviceInfo);

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "user",
      entityId: user.id,
      action: AuditAction.REGISTER,
      actorId: user.id,
      actorRole: "driver",
      ipAddress: clientIp(c),
    })
  );

  c.executionCtx.waitUntil(
    (async () => {
      const welcome = welcomeEmail(user.firstName, "driver");
      await sendEmail(c.env.BREVO_API_KEY, { to: [{ email: user.email, name: user.firstName }], subject: welcome.subject, htmlContent: welcome.html });

      // Every driver needs the office to review their documents before they
      // can go online — this is the notice that starts that clock.
      const adminEmails = await getAdminEmails(db);
      if (adminEmails.length > 0) {
        const notice = adminNewSignupEmail(`${user.firstName} ${user.lastName}`, user.email, "driver");
        await sendEmail(c.env.BREVO_API_KEY, { to: adminEmails, subject: notice.subject, htmlContent: notice.html });
      }
    })()
  );

  return c.json(session, 201);
});

// Everything in this router is driver-only except sign-up, which by
// definition has no session yet.
//
// This deliberately guards "*" and carves out the one public path, rather
// than listing each protected route. The previous per-route list meant a new
// endpoint shipped **unauthenticated by default** — adding /photo silently
// exposed it until a test caught the crash, and a handler that didn't happen
// to dereference `user` would have simply worked for anyone on the internet.
// Protected-by-default is the only version of this that's safe to extend.
// `driver-auth.test.ts` asserts every route here rejects an anonymous caller.
driverProfile.use("*", except("/api/driver/register", authenticate, requireRole("driver")));

// ─── GET /profile — own driver profile ─────────────────────────────────────
const getProfileRoute = createRoute({
  method: "get",
  path: "/profile",
  tags: ["driver"],
  summary: "Get my own driver profile",
  responses: {
    200: { description: "Profile", content: { "application/json": { schema: DriverProfileResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

driverProfile.openapi(getProfileRoute, async (c) => {
  const authUser = c.get("user")!;
  const db = createDb(c.env.DB);

  const [profile] = await db
    .select(driverProfileWithUserColumns())
    .from(driverProfilesTable)
    .innerJoin(usersTable, eq(driverProfilesTable.userId, usersTable.id))
    .where(eq(driverProfilesTable.userId, authUser.userId))
    .limit(1);

  if (!profile) {
    return c.json({ error: "NotFound", message: "Driver profile not found" }, 404);
  }
  return c.json(profile, 200);
});

// ─── PUT /profile — update own vehicle info / toggle AVAILABLE↔OFFLINE ────
const updateProfileRoute = createRoute({
  method: "put",
  path: "/profile",
  tags: ["driver"],
  summary: "Update my own driver profile (vehicle info, AVAILABLE/OFFLINE status)",
  request: {
    body: { required: true, content: { "application/json": { schema: DriverProfileUpdateRequestSchema } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: DriverProfileResponseSchema } } },
    403: {
      description: "Cannot go AVAILABLE before verification",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

driverProfile.openapi(updateProfileRoute, async (c) => {
  const authUser = c.get("user")!;
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);

  const [existing] = await db
    .select({ id: driverProfilesTable.id, isVerified: driverProfilesTable.isVerified, status: driverProfilesTable.status })
    .from(driverProfilesTable)
    .where(eq(driverProfilesTable.userId, authUser.userId))
    .limit(1);
  if (!existing) {
    return c.json({ error: "NotFound", message: "Driver profile not found" }, 404);
  }

  if (body.status === "AVAILABLE" && !existing.isVerified) {
    return c.json(
      { error: "Forbidden", message: "Your account must be verified by an admin before you can go available" },
      403
    );
  }

  await db
    .update(driverProfilesTable)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(driverProfilesTable.id, existing.id));

  // Faz 5b — a "session" (billable active time) opens/closes only on this
  // OFFLINE<->non-OFFLINE toggle, never on trip activity.
  if (body.status && body.status !== existing.status) {
    const now = new Date();
    if (existing.status === "OFFLINE" && body.status !== "OFFLINE") {
      await openSession(db, existing.id, now);
      c.executionCtx.waitUntil(
        logAudit(db, {
          entity: "driver_session",
          entityId: existing.id,
          action: AuditAction.DRIVER_SESSION_OPENED,
          actorId: authUser.userId,
          actorRole: "driver",
          ipAddress: clientIp(c),
        })
      );
    } else if (existing.status !== "OFFLINE" && body.status === "OFFLINE") {
      const { perMinuteCents } = await getDriverUsageRates(db);
      const closed = await closeOpenSession(db, existing.id, now, perMinuteCents, "OFFLINE_TOGGLE");
      c.executionCtx.waitUntil(
        logAudit(db, {
          entity: "driver_session",
          entityId: existing.id,
          action: AuditAction.DRIVER_SESSION_CLOSED,
          actorId: authUser.userId,
          actorRole: "driver",
          metadata: closed ? { durationMinutes: closed.durationMinutes, chargeCents: closed.chargeCents } : undefined,
          ipAddress: clientIp(c),
        })
      );
    }
  }

  const [updated] = await db
    .select(driverProfileWithUserColumns())
    .from(driverProfilesTable)
    .innerJoin(usersTable, eq(driverProfilesTable.userId, usersTable.id))
    .where(eq(driverProfilesTable.id, existing.id))
    .limit(1);

  return c.json(updated!, 200);
});

// ─── POST /documents/{type} — upload + envelope-encrypt to R2 (L17/L19) ───
const uploadDocumentRoute = createRoute({
  method: "post",
  path: "/documents/{type}",
  tags: ["driver"],
  summary: "Upload a driver document (license, background check, or photo)",
  request: {
    params: z.object({ type: z.enum(DRIVER_DOCUMENT_TYPES) }),
    body: { content: { "application/octet-stream": { schema: z.string() } } },
  },
  responses: {
    201: { description: "Uploaded", content: { "application/json": { schema: DriverDocumentSchema } } },
    400: { description: "Empty or too large", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Driver profile not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

driverProfile.openapi(uploadDocumentRoute, async (c) => {
  const { type } = c.req.valid("param");
  const authUser = c.get("user")!;
  const db = createDb(c.env.DB);

  const [profile] = await db
    .select({ id: driverProfilesTable.id })
    .from(driverProfilesTable)
    .where(eq(driverProfilesTable.userId, authUser.userId))
    .limit(1);
  if (!profile) {
    return c.json({ error: "NotFound", message: "Driver profile not found" }, 404);
  }

  const declaredLength = Number(c.req.header("Content-Length") ?? "0");
  if (declaredLength > MAX_DOCUMENT_BYTES) {
    return c.json({ error: "ValidationError", message: "File too large (max 10 MB)" }, 400);
  }

  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0) {
    return c.json({ error: "ValidationError", message: "Empty file" }, 400);
  }
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    return c.json({ error: "ValidationError", message: "File too large (max 10 MB)" }, 400);
  }

  const contentType = c.req.header("Content-Type") ?? "application/octet-stream";
  const encrypted = await encryptDocument(c.env.DOCUMENT_ENCRYPTION_KEY, bytes);

  const documentId = crypto.randomUUID();
  const r2Key = `driver-documents/${profile.id}/${documentId}`;

  await c.env.DOCS.put(r2Key, encrypted.ciphertext, {
    customMetadata: {
      contentType,
      fileIv: encrypted.fileIv,
      wrappedKey: encrypted.wrappedKey,
      wrapIv: encrypted.wrapIv,
    },
  });

  const [doc] = await db
    .insert(driverDocumentsTable)
    .values({ id: documentId, driverId: profile.id, type, r2Key, status: "PENDING" })
    .returning();
  if (!doc) throw new Error("Insert into driver_documents returned no row");

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "driver_document",
      entityId: documentId,
      action: AuditAction.DOCUMENT_UPLOADED,
      actorId: authUser.userId,
      actorRole: "driver",
      metadata: { type },
      ipAddress: clientIp(c),
    })
  );

  return c.json(toDocumentResponse(doc), 201);
});

// ─── POST /photo — the driver's own profile picture ──────────────────────
//
// Kept entirely separate from the /documents pipeline above, which handles
// identity papers: those are envelope-encrypted and only an admin can ever
// read them. A profile photo is the opposite — it exists to be shown to
// passengers picking a driver — so it's stored in the clear under an
// `avatars/` prefix and served by the route below, which never reads any
// other prefix.
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

// Photographic formats only. SVG is deliberately absent: it can carry script,
// and this file gets served back to browsers.
const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const uploadPhotoRoute = createRoute({
  method: "post",
  path: "/photo",
  tags: ["driver"],
  summary: "Upload my profile photo (shown to passengers on the driver map)",
  request: { body: { content: { "image/*": { schema: z.string() } } } },
  responses: {
    200: { description: "Uploaded", content: { "application/json": { schema: DriverProfileResponseSchema } } },
    400: { description: "Empty, too large, or not an image", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Driver profile not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

driverProfile.openapi(uploadPhotoRoute, async (c) => {
  const authUser = c.get("user")!;
  const db = createDb(c.env.DB);

  const [profile] = await db
    .select({ id: driverProfilesTable.id, photoKey: driverProfilesTable.photoKey })
    .from(driverProfilesTable)
    .where(eq(driverProfilesTable.userId, authUser.userId))
    .limit(1);
  if (!profile) {
    return c.json({ error: "NotFound", message: "Driver profile not found" }, 404);
  }

  const contentType = (c.req.header("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!ALLOWED_AVATAR_TYPES.has(contentType)) {
    return c.json({ error: "ValidationError", message: "Upload a JPEG, PNG or WebP image" }, 400);
  }

  const declaredLength = Number(c.req.header("Content-Length") ?? "0");
  if (declaredLength > MAX_AVATAR_BYTES) {
    return c.json({ error: "ValidationError", message: "Photo too large (max 2 MB)" }, 400);
  }

  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0) {
    return c.json({ error: "ValidationError", message: "Empty file" }, 400);
  }
  if (bytes.byteLength > MAX_AVATAR_BYTES) {
    return c.json({ error: "ValidationError", message: "Photo too large (max 2 MB)" }, 400);
  }

  // A fresh key each time, so a replaced photo can't be served from a cache
  // keyed on the old URL.
  const r2Key = `avatars/${profile.id}/${crypto.randomUUID()}`;
  await c.env.DOCS.put(r2Key, bytes, { httpMetadata: { contentType } });

  await db
    .update(driverProfilesTable)
    .set({ photoKey: r2Key, updatedAt: new Date() })
    .where(eq(driverProfilesTable.id, profile.id));

  // Best effort: the profile row already points at the new object, so a
  // failure here leaves an orphan rather than a broken photo.
  if (profile.photoKey) c.executionCtx.waitUntil(c.env.DOCS.delete(profile.photoKey));

  const [updated] = await db
    .select(driverProfileWithUserColumns())
    .from(driverProfilesTable)
    .innerJoin(usersTable, eq(driverProfilesTable.userId, usersTable.id))
    .where(eq(driverProfilesTable.id, profile.id))
    .limit(1);

  return c.json(updated!, 200);
});

// ─── GET /documents — own document statuses (no file bytes, L17) ─────────
const listDocumentsRoute = createRoute({
  method: "get",
  path: "/documents",
  tags: ["driver"],
  summary: "List my own document upload statuses",
  responses: {
    200: { description: "List", content: { "application/json": { schema: z.array(DriverDocumentSchema) } } },
  },
});

driverProfile.openapi(listDocumentsRoute, async (c) => {
  const authUser = c.get("user")!;
  const db = createDb(c.env.DB);

  const [profile] = await db
    .select({ id: driverProfilesTable.id })
    .from(driverProfilesTable)
    .where(eq(driverProfilesTable.userId, authUser.userId))
    .limit(1);
  if (!profile) return c.json([], 200);

  const docs = await db.select().from(driverDocumentsTable).where(eq(driverDocumentsTable.driverId, profile.id));
  return c.json(
    docs.map((d) => toDocumentResponse(d)),
    200
  );
});

// ─── GET /earnings — own completed-trip earnings (4.10 — own tax record) ──
const earningsRoute = createRoute({
  method: "get",
  path: "/earnings",
  tags: ["driver"],
  summary: "My own completed-trip earnings summary, optionally filtered by date range",
  request: { query: DriverEarningsQuerySchema },
  responses: {
    200: { description: "Earnings summary", content: { "application/json": { schema: DriverEarningsSummarySchema } } },
  },
});

driverProfile.openapi(earningsRoute, async (c) => {
  const authUser = c.get("user")!;
  const query = c.req.valid("query");
  const db = createDb(c.env.DB);

  const [profile] = await db
    .select({ id: driverProfilesTable.id })
    .from(driverProfilesTable)
    .where(eq(driverProfilesTable.userId, authUser.userId))
    .limit(1);
  if (!profile) {
    return c.json({ tripCount: 0, totalEarnings: 0, currency: "USD", trips: [] }, 200);
  }

  const conditions = [eq(tripsTable.driverId, profile.id), eq(tripsTable.status, "TRIP_COMPLETED")];
  if (query.from) conditions.push(gte(tripsTable.completedAt, query.from));
  if (query.to) conditions.push(lte(tripsTable.completedAt, query.to));

  const rows = await db
    .select()
    .from(tripsTable)
    .where(and(...conditions))
    .orderBy(desc(tripsTable.completedAt));

  const totalCents = rows.reduce((sum, t) => sum + (t.finalFareCents ?? 0), 0);

  return c.json(
    {
      tripCount: rows.length,
      totalEarnings: totalCents / 100,
      currency: rows[0]?.currency ?? "USD",
      trips: rows.map((t) => ({
        tripId: t.id,
        completedAt: t.completedAt?.toISOString() ?? null,
        distanceMiles: t.distanceMiles,
        fare: t.finalFareCents != null ? t.finalFareCents / 100 : null,
        currency: t.currency,
        paymentMethod: t.paymentMethod,
      })),
    },
    200
  );
});

// ─── GET /balance — own usage-fee + commission debt owed to GNN LLC ───────
const balanceRoute = createRoute({
  method: "get",
  path: "/balance",
  tags: ["driver"],
  summary: "My own balance owed to GNN LLC (usage fee + commission debt, minus cash already collected)",
  responses: {
    200: { description: "Balance", content: { "application/json": { schema: DriverOwnBalanceSchema } } },
  },
});

driverProfile.openapi(balanceRoute, async (c) => {
  const authUser = c.get("user")!;
  const db = createDb(c.env.DB);

  const [profile] = await db
    .select({ id: driverProfilesTable.id })
    .from(driverProfilesTable)
    .where(eq(driverProfilesTable.userId, authUser.userId))
    .limit(1);
  if (!profile) {
    return c.json(
      { usageFeeCharged: 0, commissionCharged: 0, totalCharged: 0, totalCollected: 0, pendingBalance: 0, hasOpenSession: false },
      200
    );
  }

  const balance = await computeDriverBalance(db, profile.id);
  return c.json(
    {
      usageFeeCharged: balance.usageFeeChargedCents / 100,
      commissionCharged: balance.commissionChargedCents / 100,
      totalCharged: balance.totalChargedCents / 100,
      totalCollected: balance.totalCollectedCents / 100,
      pendingBalance: balance.pendingBalanceCents / 100,
      hasOpenSession: balance.hasOpenSession,
    },
    200
  );
});

// ─── GET /sessions — own online-session footprint (day/hour ranges) ───────
const listOwnSessionsRoute = createRoute({
  method: "get",
  path: "/sessions",
  tags: ["driver"],
  summary: "My own online-session footprint (when I was active in the app), newest first",
  request: { query: DriverSessionQuerySchema },
  responses: {
    200: { description: "Sessions", content: { "application/json": { schema: z.array(DriverSessionSchema) } } },
  },
});

driverProfile.openapi(listOwnSessionsRoute, async (c) => {
  const authUser = c.get("user")!;
  const query = c.req.valid("query");
  const db = createDb(c.env.DB);

  const [profile] = await db
    .select({ id: driverProfilesTable.id })
    .from(driverProfilesTable)
    .where(eq(driverProfilesTable.userId, authUser.userId))
    .limit(1);
  if (!profile) return c.json([], 200);

  const conditions = [eq(driverSessionsTable.driverId, profile.id)];
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

export default driverProfile;
export { toDocumentResponse };
