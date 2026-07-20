import { z } from "@hono/zod-openapi";

/**
 * A job the office handed straight to a driver by phone, for a passenger who
 * is not in the app at all.
 *
 * The office rings the driver — "there's someone outside the Eastern Slope
 * Inn, go and get them". There is no booking, no passenger account, no typed
 * addresses. The driver taps *Referral* at the kerb the moment the passenger
 * gets in, and taps *Dropped off* when they get out. Both taps carry the
 * phone's own GPS, so pickup and dropoff are **captured as they happen**
 * rather than remembered afterwards.
 *
 * That is the entire reason this exists instead of a "log a manual trip" form
 * the driver fills in at the end of a shift. A form asks the driver to recall
 * where they went and what it should cost; this asks the phone. The fare comes
 * out computed rather than declared, and GNN LLC's commission on a job it
 * referred rests on the same routed distance as every other trip on the
 * platform — not on anybody's memory.
 */
export const StartReferralTripRequestSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    /**
     * Reverse-geocoded on the driver's phone where it can be. Optional
     * because a dead spot in the mountains must not stop a driver starting a
     * job — the server falls back to the coordinates, which are the part that
     * actually matters for pricing.
     */
    address: z.string().max(300).optional(),
    guestName: z.string().max(120).optional(),
    guestPhone: z.string().max(40).optional(),
  })
  .openapi("StartReferralTripRequest");

export const CompleteReferralTripRequestSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    address: z.string().max(300).optional(),
  })
  .openapi("CompleteReferralTripRequest");

/**
 * One recorded position. `recordedAt` is when the *device* saw it, not when
 * the server received it: a phone that loses signal on the Kancamagus uploads
 * its backlog later, and the order that matters is the order it was driven.
 */
export const BreadcrumbPointSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    recordedAt: z.string().datetime(),
  })
  .openapi("BreadcrumbPoint");

/**
 * Sent in batches rather than one point at a time — a trip produces a point
 * every ~30 seconds, and one request per point would spend the free tier's
 * request budget on nothing. The cap keeps a buggy or malicious client from
 * writing an unbounded number of rows in a single call.
 */
export const RecordBreadcrumbsRequestSchema = z
  .object({
    points: z.array(BreadcrumbPointSchema).min(1).max(200),
  })
  .openapi("RecordBreadcrumbsRequest");

export const RecordBreadcrumbsResponseSchema = z
  .object({
    recorded: z.number().int(),
  })
  .openapi("RecordBreadcrumbsResponse");

export const BreadcrumbResponseSchema = z
  .object({
    id: z.string(),
    lat: z.number(),
    lng: z.number(),
    recordedAt: z.string(),
  })
  .openapi("BreadcrumbResponse");
