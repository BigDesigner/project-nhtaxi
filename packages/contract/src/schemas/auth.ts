import { z } from "@hono/zod-openapi";

// Callers declare their platform explicitly (never sniffed from headers) so
// the server knows whether it's safe to also return raw tokens in the JSON
// body. For "web", tokens live ONLY in httpOnly cookies — echoing them in
// the body too would let an XSS payload read the response and steal the
// token, defeating the entire point of httpOnly.
export const CLIENT_PLATFORMS = ["web", "ios", "android"] as const;

// L15 — passenger self sign-up only; driver/admin accounts are created
// elsewhere (driver self-signup-with-documents lands in Faz 2; admin
// accounts are created by another admin).
export const RegisterRequestSchema = z
  .object({
    firstName: z.string().min(1).max(100).openapi({ example: "Jane" }),
    lastName: z.string().min(1).max(100).openapi({ example: "Doe" }),
    email: z.string().email().openapi({ example: "jane@example.com" }),
    phone: z.string().min(7).max(20).openapi({ example: "+16035551234" }),
    password: z.string().min(8).max(200),
    // Must be literally true — there is no implicit consent, and no way to
    // create an account without it. `acceptedTermsVersion` records *which*
    // wording was shown, so a later dispute has an answer.
    acceptedTerms: z.literal(true),
    acceptedTermsVersion: z.string().min(1).max(50),
    deviceInfo: z.string().max(200).optional(),
    platform: z.enum(CLIENT_PLATFORMS).default("web"),
  })
  .openapi("RegisterRequest");

// L15 — unified login for all roles (passenger/driver/admin); the UI just
// puts the passenger login front-and-center.
export const LoginRequestSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(1),
    deviceInfo: z.string().max(200).optional(),
    platform: z.enum(CLIENT_PLATFORMS).default("web"),
  })
  .openapi("LoginRequest");

// Web reads its refresh token from an httpOnly cookie, so the body is empty
// for that case — mobile has no cookies and must send it explicitly.
export const RefreshRequestSchema = z
  .object({
    refreshToken: z.string().optional(),
    platform: z.enum(CLIENT_PLATFORMS).default("web"),
  })
  .openapi("RefreshRequest");

// Changing your own password. The current one is required even though the
// caller is already authenticated: a token left behind on an unlocked or
// stolen device must not be enough to lock the real owner out of their
// account.
export const ChangePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(200),
  })
  .openapi("ChangePasswordRequest");

export const AuthUserSchema = z
  .object({
    id: z.string(),
    email: z.string().email(),
    firstName: z.string(),
    lastName: z.string(),
    phone: z.string().nullable(),
    role: z.enum(["admin", "driver", "customer"]),
  })
  .openapi("AuthUser");

// accessToken/refreshToken are only populated for platform !== "web" — a web
// caller gets `null` for both and must rely on the httpOnly cookies that
// were set alongside this response.
export const AuthResponseSchema = z
  .object({
    user: AuthUserSchema,
    accessToken: z.string().nullable(),
    refreshToken: z.string().nullable(),
  })
  .openapi("AuthResponse");
