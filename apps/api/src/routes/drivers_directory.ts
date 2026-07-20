import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, eq, inArray, ne } from "drizzle-orm";
import {
  DirectoryDriverListResponseSchema,
  DirectoryDriverQuerySchema,
  ErrorResponseSchema,
} from "@gnncab/contract";
import { createDb, driverProfilesTable, tripsTable, usersTable } from "@gnncab/db";
import type { AppBindings } from "../env";
import { haversineMiles } from "../lib/fare";
import { authenticate } from "../middlewares/auth";

// Faz 7 — the "browse drivers" map. Any signed-in user can see the fleet:
// this is a ~15-driver local operation where the point is precisely that a
// passenger can spot the cab two streets over and ask for that one.
const driversDirectory = new OpenAPIHono<AppBindings>();
driversDirectory.use("*", authenticate);

/**
 * Rough town-driving average. Only used to turn a BUSY driver's remaining
 * trip distance into "free in ~N minutes", so precision matters far less
 * than not being wildly optimistic — a passenger who waits on this estimate
 * and gets it wrong has lost real time.
 */
const ASSUMED_AVERAGE_MPH = 25;

/** Round up to 5-minute buckets: the input is too rough to justify "~7 min". */
function bucketMinutes(minutes: number): number {
  return Math.max(5, Math.ceil(minutes / 5) * 5);
}

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["drivers"],
  summary: "List drivers with their status, vehicle and last known position",
  request: { query: DirectoryDriverQuerySchema },
  responses: {
    200: {
      description: "Drivers",
      content: { "application/json": { schema: DirectoryDriverListResponseSchema } },
    },
  },
});

driversDirectory.openapi(listRoute, async (c) => {
  const { lat, lng } = c.req.valid("query");
  const db = createDb(c.env.DB);

  // OFFLINE drivers are excluded rather than greyed out: they aren't working,
  // so showing their last known position would leak where they went home
  // without telling the passenger anything actionable.
  const rows = await db
    .select({
      driverId: driverProfilesTable.id,
      photoKey: driverProfilesTable.photoKey,
      status: driverProfilesTable.status,
      lat: driverProfilesTable.currentLat,
      lng: driverProfilesTable.currentLng,
      lastSeen: driverProfilesTable.lastSeen,
      vehicleMake: driverProfilesTable.vehicleMake,
      vehicleModel: driverProfilesTable.vehicleModel,
      vehicleColor: driverProfilesTable.vehicleColor,
      vehiclePlate: driverProfilesTable.vehiclePlate,
      firstName: usersTable.firstName,
      phone: usersTable.phone,
    })
    .from(driverProfilesTable)
    .innerJoin(usersTable, eq(usersTable.id, driverProfilesTable.userId))
    .where(and(ne(driverProfilesTable.status, "OFFLINE"), eq(usersTable.isActive, true)));

  // One extra query for every busy driver's current trip, so "free in ~N min"
  // can be derived. Batched by driver id rather than per-row to keep this a
  // single round trip regardless of fleet size.
  const busyIds = rows.filter((r) => r.status === "BUSY" || r.status === "RESERVED").map((r) => r.driverId);
  const activeTrips = busyIds.length
    ? await db
        .select({
          driverId: tripsTable.driverId,
          distanceMiles: tripsTable.distanceMiles,
          startedAt: tripsTable.startedAt,
        })
        .from(tripsTable)
        .where(
          and(
            inArray(tripsTable.driverId, busyIds),
            inArray(tripsTable.status, ["DRIVER_ACCEPTED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "TRIP_STARTED"])
          )
        )
    : [];

  const tripByDriver = new Map(activeTrips.filter((t) => t.driverId).map((t) => [t.driverId!, t]));
  const now = Date.now();

  const drivers = rows.map((r) => {
    const distanceMiles =
      lat != null && lng != null && r.lat != null && r.lng != null
        ? Math.round(haversineMiles(lat, lng, r.lat, r.lng) * 10) / 10
        : null;

    // Only estimate once the trip is actually under way; before that we have
    // no idea how long the pickup leg will take, so we say nothing.
    let freeInMinutes: number | null = null;
    const trip = tripByDriver.get(r.driverId);
    if (trip?.distanceMiles != null && trip.startedAt != null) {
      const totalMinutes = (trip.distanceMiles / ASSUMED_AVERAGE_MPH) * 60;
      const elapsedMinutes = (now - trip.startedAt.getTime()) / 60_000;
      const remaining = totalMinutes - elapsedMinutes;
      if (remaining > 0) freeInMinutes = bucketMinutes(remaining);
    }

    return {
      driverId: r.driverId,
      firstName: r.firstName,
      status: r.status,
      lat: r.lat,
      lng: r.lng,
      distanceMiles,
      phone: r.phone,
      vehicleMake: r.vehicleMake,
      vehicleModel: r.vehicleModel,
      vehicleColor: r.vehicleColor,
      vehiclePlate: r.vehiclePlate,
      // A path rather than an absolute URL: the client already knows its API
      // base, and hard-coding a host here would break the moment the API
      // moves or is reached through a different origin.
      photoUrl: r.photoKey ? `/api/drivers/${r.driverId}/photo` : null,
      freeInMinutes,
      lastSeen: r.lastSeen?.toISOString() ?? null,
    };
  });

  // Nearest first when we know where the passenger is, so the most useful
  // choices are at the top of the list view.
  if (lat != null && lng != null) {
    drivers.sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity));
  }

  return c.json({ drivers }, 200);
});

// ─── GET /{driverId}/photo — the driver's picture ─────────────────────────
//
// Served through the Worker rather than from a public bucket. It's a person's
// face, so it stays behind authentication instead of sitting on a URL anyone
// can guess or scrape; at this fleet size the extra request costs nothing.
//
// The security boundary is the prefix check below: this route reads the same
// R2 bucket as the envelope-encrypted identity documents, so it must never be
// able to hand back anything outside `avatars/`. `photoKey` is only ever
// written by the upload route, but an assertion here means a future bug in
// that route can't turn into a document leak through this one.
const photoRoute = createRoute({
  method: "get",
  path: "/{driverId}/photo",
  tags: ["drivers"],
  summary: "Fetch a driver's profile photo",
  request: { params: z.object({ driverId: z.string() }) },
  responses: {
    200: { description: "The image", content: { "image/*": { schema: z.string() } } },
    404: { description: "No photo", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

driversDirectory.openapi(photoRoute, async (c) => {
  const { driverId } = c.req.valid("param");
  const db = createDb(c.env.DB);

  const [driver] = await db
    .select({ photoKey: driverProfilesTable.photoKey })
    .from(driverProfilesTable)
    .where(eq(driverProfilesTable.id, driverId))
    .limit(1);

  if (!driver?.photoKey || !driver.photoKey.startsWith("avatars/")) {
    return c.json({ error: "NotFound", message: "This driver has no photo" }, 404);
  }

  const object = await c.env.DOCS.get(driver.photoKey);
  if (!object) {
    return c.json({ error: "NotFound", message: "This driver has no photo" }, 404);
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "image/jpeg",
      // The key changes on every upload, so a cached copy can never be stale.
      "Cache-Control": "private, max-age=86400",
    },
  });
});

export default driversDirectory;
