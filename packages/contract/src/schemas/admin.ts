import { z } from "@hono/zod-openapi";
import { DRIVER_STATUSES } from "./driver";

export const USER_ROLES = ["admin", "driver", "customer"] as const;

export const AdminUserSchema = z
  .object({
    id: z.string(),
    email: z.string().email(),
    firstName: z.string(),
    lastName: z.string(),
    phone: z.string().nullable(),
    role: z.enum(USER_ROLES),
    isActive: z.boolean(),
    // Orthogonal to role — true only for the owner-operator account, which
    // is why the admin panel needs to be able to see it: it's the only
    // visible sign that an account with role "driver" also carries admin
    // rights.
    isAdmin: z.boolean(),
    createdAt: z.string(),
  })
  .openapi("AdminUser");

// L16 — admin can create any role directly. Driver-specific fields are
// optional; admin can leave them for the driver (or a later PUT) to fill in.
export const AdminCreateUserRequestSchema = z
  .object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    email: z.string().email(),
    phone: z.string().min(7).max(20).optional(),
    password: z.string().min(8).max(200),
    role: z.enum(USER_ROLES),
    isVerified: z.boolean().optional(),
  })
  .openapi("AdminCreateUserRequest");

// L16 — role reassignment (customer↔driver↔admin) is explicitly allowed;
// the route creates/keeps the matching profile row as needed.
export const AdminUpdateUserRequestSchema = z
  .object({
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    phone: z.string().min(7).max(20).optional(),
    role: z.enum(USER_ROLES).optional(),
    isActive: z.boolean().optional(),
  })
  .openapi("AdminUpdateUserRequest");

export const AdminDriverListItemSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    email: z.string().email(),
    firstName: z.string(),
    lastName: z.string(),
    phone: z.string().nullable(),
    vehicleMake: z.string().nullable(),
    vehicleModel: z.string().nullable(),
    vehiclePlate: z.string().nullable(),
    status: z.enum(DRIVER_STATUSES),
    isVerified: z.boolean(),
    cityId: z.string().nullable(),
    rating: z.number().nullable(),
    totalTrips: z.number().int(),
  })
  .openapi("AdminDriverListItem");

export const AdminDocumentReviewRequestSchema = z
  .object({
    status: z.enum(["APPROVED", "REJECTED"]),
  })
  .openapi("AdminDocumentReviewRequest");

export const AdminVerifyDriverRequestSchema = z
  .object({
    isVerified: z.boolean(),
  })
  .openapi("AdminVerifyDriverRequest");
