import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import {
  AuthResponseSchema,
  AuthUserSchema,
  ErrorResponseSchema,
  LoginRequestSchema,
  RefreshRequestSchema,
  RegisterRequestSchema,
} from "@gnncab/contract";
import { createDb, customerProfilesTable, usersTable } from "@gnncab/db";
import type { AppBindings } from "../env";
import { AuditAction, logAudit } from "../lib/audit";
import { clearAuthCookies, getRefreshTokenCookie, setAuthCookies } from "../lib/auth-cookie";
import { signAccessToken } from "../lib/jwt";
import { hashPassword, verifyPassword } from "../lib/password";
import { clientIp } from "../lib/request";
import { revokeRefreshToken, rotateRefreshToken } from "../lib/refresh-tokens";
import { issueSession, toPublicUser } from "../lib/session";
import { authenticate } from "../middlewares/auth";

const auth = new OpenAPIHono<AppBindings>();

// body.required: true matters beyond documentation here — @hono/zod-openapi
// only runs the zod validator (so schema .default()s actually apply) when
// either the body is marked required, or the request's Content-Type header
// is recognized as JSON. Without it, a request with no Content-Type header
// silently gets an unvalidated `{}` instead of a 400.

// ─── POST /register — passenger self sign-up only (L15) ──────────────────
const registerRoute = createRoute({
  method: "post",
  path: "/register",
  tags: ["auth"],
  summary: "Register a new passenger account",
  request: { body: { required: true, content: { "application/json": { schema: RegisterRequestSchema } } } },
  responses: {
    201: { description: "Account created", content: { "application/json": { schema: AuthResponseSchema } } },
    409: {
      description: "Email already registered",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

auth.openapi(registerRoute, async (c) => {
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
      role: "customer",
    })
    .returning();
  if (!user) throw new Error("Insert into users returned no row");

  await db.insert(customerProfilesTable).values({ userId: user.id });

  const session = await issueSession(c, db, toPublicUser(user), body.platform, body.deviceInfo);

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "user",
      entityId: user.id,
      action: AuditAction.REGISTER,
      actorId: user.id,
      actorRole: "customer",
      ipAddress: clientIp(c),
    })
  );

  return c.json(session, 201);
});

// ─── POST /login — unified across passenger/driver/admin (L15) ───────────
const loginRoute = createRoute({
  method: "post",
  path: "/login",
  tags: ["auth"],
  summary: "Log in",
  request: { body: { required: true, content: { "application/json": { schema: LoginRequestSchema } } } },
  responses: {
    200: { description: "Logged in", content: { "application/json": { schema: AuthResponseSchema } } },
    401: { description: "Invalid credentials", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Account deactivated", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

auth.openapi(loginRoute, async (c) => {
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, body.email)).limit(1);

  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    c.executionCtx.waitUntil(
      logAudit(db, {
        entity: "user",
        entityId: user?.id,
        action: AuditAction.LOGIN_FAILURE,
        metadata: { email: body.email },
        ipAddress: clientIp(c),
      })
    );
    return c.json({ error: "Unauthorized", message: "Invalid email or password" }, 401);
  }

  if (!user.isActive) {
    return c.json({ error: "Forbidden", message: "This account has been deactivated" }, 403);
  }

  const session = await issueSession(c, db, toPublicUser(user), body.platform, body.deviceInfo);

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "user",
      entityId: user.id,
      action: AuditAction.LOGIN_SUCCESS,
      actorId: user.id,
      actorRole: user.role,
      ipAddress: clientIp(c),
    })
  );

  return c.json(session, 200);
});

// ─── POST /refresh — rotates a refresh token (L11) ────────────────────────
const refreshRoute = createRoute({
  method: "post",
  path: "/refresh",
  tags: ["auth"],
  summary: "Rotate a refresh token for a new access/refresh pair",
  request: { body: { required: true, content: { "application/json": { schema: RefreshRequestSchema } } } },
  responses: {
    200: { description: "Rotated", content: { "application/json": { schema: AuthResponseSchema } } },
    401: {
      description: "Invalid, expired, or revoked refresh token",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

auth.openapi(refreshRoute, async (c) => {
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);
  const rawToken = body.refreshToken ?? getRefreshTokenCookie(c);

  if (!rawToken) {
    return c.json({ error: "Unauthorized", message: "Missing refresh token" }, 401);
  }

  const rotated = await rotateRefreshToken(db, rawToken);
  if (!rotated) {
    clearAuthCookies(c);
    c.executionCtx.waitUntil(
      logAudit(db, { entity: "user", action: AuditAction.TOKEN_REFRESH_REJECTED, ipAddress: clientIp(c) })
    );
    return c.json({ error: "Unauthorized", message: "Refresh token is invalid, expired, or revoked" }, 401);
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, rotated.userId)).limit(1);
  if (!user || !user.isActive) {
    await revokeRefreshToken(db, rotated.rawToken);
    clearAuthCookies(c);
    return c.json({ error: "Unauthorized", message: "Account is no longer active" }, 401);
  }

  const accessToken = await signAccessToken({ id: user.id, email: user.email, role: user.role }, c.env.JWT_SECRET);
  if (body.platform === "web") {
    setAuthCookies(c, { accessToken, refreshToken: rotated.rawToken, refreshExpiresAt: rotated.expiresAt });
  }

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "user",
      entityId: user.id,
      action: AuditAction.TOKEN_REFRESHED,
      actorId: user.id,
      actorRole: user.role,
      ipAddress: clientIp(c),
    })
  );

  return c.json(
    {
      user: toPublicUser(user),
      accessToken: body.platform === "web" ? null : accessToken,
      refreshToken: body.platform === "web" ? null : rotated.rawToken,
    },
    200
  );
});

// ─── POST /logout ──────────────────────────────────────────────────────────
const logoutRoute = createRoute({
  method: "post",
  path: "/logout",
  tags: ["auth"],
  summary: "Log out — revokes the refresh token and clears auth cookies",
  responses: {
    200: {
      description: "Logged out",
      content: { "application/json": { schema: z.object({ success: z.literal(true) }) } },
    },
  },
});

auth.openapi(logoutRoute, async (c) => {
  const db = createDb(c.env.DB);

  // Body is genuinely optional here (web relies only on the cookie) — read
  // it permissively instead of forcing a validated-body schema on callers
  // that send nothing at all.
  let bodyRefreshToken: string | undefined;
  try {
    const body: unknown = await c.req.json();
    if (body && typeof body === "object" && "refreshToken" in body && typeof body.refreshToken === "string") {
      bodyRefreshToken = body.refreshToken;
    }
  } catch {
    // No JSON body — fine.
  }

  const rawToken = bodyRefreshToken ?? getRefreshTokenCookie(c);
  const revokedUserId = rawToken ? await revokeRefreshToken(db, rawToken) : null;

  clearAuthCookies(c);

  if (revokedUserId) {
    c.executionCtx.waitUntil(
      logAudit(db, {
        entity: "user",
        entityId: revokedUserId,
        action: AuditAction.LOGOUT,
        actorId: revokedUserId,
        ipAddress: clientIp(c),
      })
    );
  }

  return c.json({ success: true as const }, 200);
});

// ─── GET /me ────────────────────────────────────────────────────────────────
const meRoute = createRoute({
  method: "get",
  path: "/me",
  tags: ["auth"],
  summary: "Get the currently authenticated user",
  responses: {
    200: { description: "Current user", content: { "application/json": { schema: AuthUserSchema } } },
    401: { description: "Not authenticated", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

auth.use("/me", authenticate);
auth.openapi(meRoute, async (c) => {
  const authUser = c.get("user");
  if (!authUser) {
    return c.json({ error: "Unauthorized", message: "Not authenticated" }, 401);
  }

  const db = createDb(c.env.DB);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, authUser.userId)).limit(1);
  if (!user) {
    return c.json({ error: "Unauthorized", message: "Account no longer exists" }, 401);
  }

  return c.json(toPublicUser(user), 200);
});

export default auth;
