import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { and, eq, inArray, ne } from "drizzle-orm";
import { DirectoryDriverListResponseSchema, DirectoryDriverQuerySchema } from "@gnncab/contract";
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
      // Driver sign-up doesn't collect an avatar yet; the field exists so the
      // app can render one the day it does, without an API change.
      photoUrl: null,
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

export default driversDirectory;
