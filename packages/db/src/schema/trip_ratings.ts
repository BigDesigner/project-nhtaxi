import { sqliteTable, text, integer, real, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { tripsTable } from "./trips";
import { driverProfilesTable } from "./drivers";
import { usersTable } from "./users";

/**
 * One passenger's rating of one completed trip.
 *
 * Five separate 1–5 star questions rather than a single overall score, because
 * "3 stars" tells a driver nothing they can act on — whereas "punctual but the
 * car wasn't clean" does. `overall` is their plain average, stored so a
 * driver's headline figure (driver_profiles.rating) can be recomputed without
 * re-reading every column of every row.
 *
 * A rating only exists for a TRIP_COMPLETED trip that a *registered* passenger
 * took: a guest/referral trip has no customer account behind it, so there is
 * nobody to attribute a rating to and none is ever collected there.
 *
 * `tripId` is unique — one rating per trip, no editing after the fact. A
 * rating is a record of how that ride felt at the time; letting it be
 * rewritten later would quietly change a driver's standing after the fact.
 */
export const RATING_QUESTIONS = [
  "courtesy",
  "safety",
  "punctuality",
  "communication",
  "cleanliness",
] as const;
export type RatingQuestion = (typeof RATING_QUESTIONS)[number];

const star = (name: string) =>
  integer(name).notNull();

export const tripRatingsTable = sqliteTable(
  "trip_ratings",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tripId: text("trip_id")
      .notNull()
      .unique()
      .references(() => tripsTable.id, { onDelete: "cascade" }),
    // Denormalized from the trip so a driver's whole rating history is one
    // indexed lookup, not a join through trips on every aggregate.
    driverId: text("driver_id")
      .notNull()
      .references(() => driverProfilesTable.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    courtesy: star("courtesy"),
    safety: star("safety"),
    punctuality: star("punctuality"),
    communication: star("communication"),
    cleanliness: star("cleanliness"),
    /** Plain average of the five, 1.0–5.0. Stored, not derived on read. */
    overall: real("overall").notNull(),
    comment: text("comment"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (table) => [
    index("idx_trip_ratings_driver_id").on(table.driverId),
    // Each star is a 1–5 integer. The TS type says "number"; these CHECKs are
    // the DB-level floor/ceiling, same defense-in-depth pattern as the status
    // enums elsewhere. All five in one constraint so it stays a single
    // CREATE TABLE with no follow-up ALTER.
    check(
      "chk_trip_ratings_stars",
      sql`${table.courtesy} between 1 and 5 and ${table.safety} between 1 and 5 and ${table.punctuality} between 1 and 5 and ${table.communication} between 1 and 5 and ${table.cleanliness} between 1 and 5`
    ),
  ]
);

export type TripRating = typeof tripRatingsTable.$inferSelect;
export type InsertTripRating = typeof tripRatingsTable.$inferInsert;
