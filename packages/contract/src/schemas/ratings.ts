import { z } from "@hono/zod-openapi";

/**
 * The five questions a passenger answers, each 1–5 stars. Kept as five
 * separate scores rather than one overall figure so a driver gets something
 * they can act on ("the car wasn't clean") instead of a bare number.
 */
const star = z.number().int().min(1).max(5);

export const SubmitRatingRequestSchema = z
  .object({
    courtesy: star,
    safety: star,
    punctuality: star,
    communication: star,
    cleanliness: star,
    comment: z.string().max(1000).optional(),
  })
  .openapi("SubmitRatingRequest");

export const TripRatingResponseSchema = z
  .object({
    id: z.string(),
    tripId: z.string(),
    courtesy: z.number().int(),
    safety: z.number().int(),
    punctuality: z.number().int(),
    communication: z.number().int(),
    cleanliness: z.number().int(),
    overall: z.number(),
    comment: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("TripRatingResponse");

/**
 * Whether this trip has been rated yet, so the app can show a prompt or a
 * read-only summary. `rating` is null when it hasn't.
 */
export const TripRatingStatusSchema = z
  .object({
    rated: z.boolean(),
    rating: TripRatingResponseSchema.nullable(),
  })
  .openapi("TripRatingStatus");

/**
 * A driver's public rating summary and recent comments, for the passenger
 * who taps a driver. Deliberately carries no reviewer identity — a passenger
 * seeing who said what about a driver would be a privacy leak, and the office
 * has the full record separately.
 */
export const DriverReviewSchema = z
  .object({
    overall: z.number(),
    comment: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("DriverReview");

export const DriverReviewsResponseSchema = z
  .object({
    driverId: z.string(),
    // Null until the driver has at least one rating — no stars beats a
    // misleading zero for a brand-new driver.
    rating: z.number().nullable(),
    ratingCount: z.number().int(),
    // Per-question averages, so the office (and the driver) can see *which*
    // part is strong or weak, not just the headline.
    averages: z
      .object({
        courtesy: z.number().nullable(),
        safety: z.number().nullable(),
        punctuality: z.number().nullable(),
        communication: z.number().nullable(),
        cleanliness: z.number().nullable(),
      })
      .nullable(),
    recent: z.array(DriverReviewSchema),
  })
  .openapi("DriverReviewsResponse");
