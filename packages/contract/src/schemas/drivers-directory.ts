import { z } from "@hono/zod-openapi";

import { DRIVER_STATUSES } from "./driver";

// Faz 7 — the passenger-facing driver map. Deliberately a *narrow* projection
// of driver_profiles: it carries what a passenger needs to choose someone
// (where they are, whether they're free, what car to look for, how to reach
// them) and nothing else. Licence numbers, verification state, ratings,
// earnings and document keys all stay out.
export const DirectoryDriverSchema = z
  .object({
    driverId: z.string(),
    firstName: z.string(),
    // Surnames are omitted on purpose — a first name plus the plate is enough
    // to identify the right car at the kerb.
    status: z.enum(DRIVER_STATUSES),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    /** Straight-line miles from the passenger, when they shared a location. */
    distanceMiles: z.number().nullable(),
    phone: z.string().nullable(),
    vehicleMake: z.string().nullable(),
    vehicleModel: z.string().nullable(),
    vehicleColor: z.string().nullable(),
    vehiclePlate: z.string().nullable(),
    /** Populated once driver sign-up collects an avatar; null until then. */
    photoUrl: z.string().nullable(),
    /**
     * Rough minutes until a BUSY driver is free again, derived from their
     * current trip's distance at an assumed average speed. Null whenever we
     * can't compute it honestly — a missing estimate is better than a
     * confident wrong one, since a passenger may wait on the strength of it.
     */
    freeInMinutes: z.number().int().nullable(),
    lastSeen: z.string().nullable(),
    /** Headline star average, null until the driver has been rated at least once. */
    rating: z.number().nullable(),
    /** How many ratings the average is over — shown as "4.6 (23)". */
    ratingCount: z.number().int(),
  })
  .openapi("DirectoryDriver");

export const DirectoryDriverListResponseSchema = z
  .object({
    drivers: z.array(DirectoryDriverSchema),
  })
  .openapi("DirectoryDriverListResponse");

export const DirectoryDriverQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});
