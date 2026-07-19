import { z } from "@hono/zod-openapi";
import { PAYMENT_METHODS } from "./trips";

// Faz 5c — admin hand-picks a driver for a trip directly (e.g. a phoned-in
// booking), skipping the normal auto-dispatch flow entirely. Either an
// existing registered customer OR a quick guest name+phone (never both/
// neither) — urgent/walk-in bookings may have no app account. Dropoff is
// optional: the driver may not know the destination until pickup.
export const AdminCreateTripRequestSchema = z
  .object({
    driverId: z.string().uuid(),
    pickupLat: z.number().min(-90).max(90),
    pickupLng: z.number().min(-180).max(180),
    pickupAddress: z.string().min(1).max(500),
    customerId: z.string().uuid().optional(),
    guestName: z.string().min(1).max(200).optional(),
    guestPhone: z.string().min(7).max(20).optional(),
    dropoffLat: z.number().min(-90).max(90).optional(),
    dropoffLng: z.number().min(-180).max(180).optional(),
    dropoffAddress: z.string().min(1).max(500).optional(),
    paymentMethod: z.enum(PAYMENT_METHODS).default("cash"),
    notes: z.string().max(1000).optional(),
  })
  .refine(
    (data) => {
      const hasCustomer = Boolean(data.customerId);
      const hasGuestName = Boolean(data.guestName);
      const hasGuestPhone = Boolean(data.guestPhone);
      if (hasGuestName !== hasGuestPhone) return false; // guest fields must come as a pair
      return hasCustomer !== (hasGuestName && hasGuestPhone); // exactly one of customer/guest
    },
    { message: "Provide either an existing customerId or both guestName and guestPhone, not both or neither", path: ["customerId"] }
  )
  .refine(
    (data) => {
      const dropoffFields = [data.dropoffLat, data.dropoffLng, data.dropoffAddress];
      const providedCount = dropoffFields.filter((f) => f != null).length;
      return providedCount === 0 || providedCount === 3;
    },
    { message: "Dropoff fields must be provided all together or not at all", path: ["dropoffLat"] }
  )
  .openapi("AdminCreateTripRequest");

export const AdminReassignTripRequestSchema = z
  .object({
    driverId: z.string().uuid(),
  })
  .openapi("AdminReassignTripRequest");
