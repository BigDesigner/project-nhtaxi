-- Widens chk_trips_origin to allow DRIVER_REFERRAL, and adds trip_breadcrumbs.
--
-- HAND-WRITTEN. drizzle-kit's generated version reproduced the exact failure
-- that broke migration 0002 twice against remote D1, plus a new one:
--
--   1. It emitted `DROP TABLE trips` while trip_events, payments and
--      driver_trip_commissions still hold FKs to it, relying on
--      `PRAGMA foreign_keys=OFF`. That pragma does not reliably persist
--      across D1's remote per-statement HTTP requests the way it does over a
--      local connection. In 0002 this passed locally and failed remotely.
--      driver_trip_commissions is new to this problem: in 0002 it had just
--      been created and was still empty, so the drop had nothing to violate.
--      It holds real commission charges now.
--
--   2. It created trip_breadcrumbs referencing `trips` *before* the rebuild,
--      which would have bound it to the table about to be dropped.
--
-- The fix is the shape that finally worked in 0002: rebuild every child so it
-- points at `__new_trips` first, so that by the time the old table is dropped
-- nothing references the name "trips" at all — correct whether or not the
-- pragma has any effect. SQLite's post-3.25 ALTER TABLE RENAME then rewrites
-- the children's stored FK text from `__new_trips` back to `trips`.
-- trip_breadcrumbs is created at the very end, against the final table.
--
-- Verified locally against a database seeded with trips *and* rows in all
-- three child tables (test/seed-migration-check.sql). That seeding is the
-- whole point: 0002 passed locally only because local had no child rows, so
-- "it worked locally" proved nothing about the case that actually failed.

PRAGMA foreign_keys=OFF;--> statement-breakpoint

CREATE TABLE `__new_trips` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text,
	`guest_name` text,
	`guest_phone` text,
	`driver_id` text,
	`city_id` text,
	`pickup_lat` real NOT NULL,
	`pickup_lng` real NOT NULL,
	`pickup_address` text NOT NULL,
	`dropoff_lat` real,
	`dropoff_lng` real,
	`dropoff_address` text,
	`status` text DEFAULT 'REQUESTED' NOT NULL,
	`origin` text DEFAULT 'CUSTOMER_APP' NOT NULL,
	`referral_source` text DEFAULT 'NONE' NOT NULL,
	`search_attempts` integer DEFAULT 0 NOT NULL,
	`next_search_at` integer,
	`commission_percent` real,
	`distance_miles` real,
	`estimated_fare_cents` integer,
	`final_fare_cents` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`payment_method` text DEFAULT 'cash' NOT NULL,
	`cancellation_reason` text,
	`notes` text,
	`requested_at` integer DEFAULT (unixepoch()) NOT NULL,
	`assigned_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`driver_id`) REFERENCES `driver_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_trips_status" CHECK("__new_trips"."status" in ('REQUESTED','DRIVER_ASSIGNED','DRIVER_ACCEPTED','DRIVER_REJECTED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','TRIP_STARTED','TRIP_COMPLETED','TRIP_CANCELLED','DRIVER_NO_RESPONSE','TIMEOUT')),
	CONSTRAINT "chk_trips_payment_method" CHECK("__new_trips"."payment_method" in ('cash','card','online')),
	CONSTRAINT "chk_trips_origin" CHECK("__new_trips"."origin" in ('CUSTOMER_APP','ADMIN_ASSIGNED','DRIVER_REFERRAL'))
);--> statement-breakpoint

-- Every column already exists on the old table this time, so a straight copy
-- is safe. (0002's first failure was listing brand-new columns here, which
-- SQLite silently read as string literals rather than erroring.)
INSERT INTO `__new_trips`("id", "customer_id", "guest_name", "guest_phone", "driver_id", "city_id", "pickup_lat", "pickup_lng", "pickup_address", "dropoff_lat", "dropoff_lng", "dropoff_address", "status", "origin", "referral_source", "search_attempts", "next_search_at", "commission_percent", "distance_miles", "estimated_fare_cents", "final_fare_cents", "currency", "payment_method", "cancellation_reason", "notes", "requested_at", "assigned_at", "started_at", "completed_at", "created_at", "updated_at") SELECT "id", "customer_id", "guest_name", "guest_phone", "driver_id", "city_id", "pickup_lat", "pickup_lng", "pickup_address", "dropoff_lat", "dropoff_lng", "dropoff_address", "status", "origin", "referral_source", "search_attempts", "next_search_at", "commission_percent", "distance_miles", "estimated_fare_cents", "final_fare_cents", "currency", "payment_method", "cancellation_reason", "notes", "requested_at", "assigned_at", "started_at", "completed_at", "created_at", "updated_at" FROM `trips`;--> statement-breakpoint

-- ─── Repoint child 1 of 3: trip_events ────────────────────────────────────
CREATE TABLE `__new_trip_events` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`status` text NOT NULL,
	`actor_id` text,
	`actor_role` text,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `__new_trips`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_trip_events`("id", "trip_id", "status", "actor_id", "actor_role", "metadata", "created_at") SELECT "id", "trip_id", "status", "actor_id", "actor_role", "metadata", "created_at" FROM `trip_events`;--> statement-breakpoint
DROP TABLE `trip_events`;--> statement-breakpoint
ALTER TABLE `__new_trip_events` RENAME TO `trip_events`;--> statement-breakpoint

-- ─── Repoint child 2 of 3: payments ───────────────────────────────────────
CREATE TABLE `__new_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`method` text DEFAULT 'cash' NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`transaction_id` text,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `__new_trips`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payments_method" CHECK("__new_payments"."method" in ('cash','card','online')),
	CONSTRAINT "chk_payments_status" CHECK("__new_payments"."status" in ('PENDING','COMPLETED','FAILED','REFUNDED'))
);--> statement-breakpoint
INSERT INTO `__new_payments`("id", "trip_id", "amount_cents", "currency", "method", "status", "transaction_id", "metadata", "created_at", "updated_at") SELECT "id", "trip_id", "amount_cents", "currency", "method", "status", "transaction_id", "metadata", "created_at", "updated_at" FROM `payments`;--> statement-breakpoint
DROP TABLE `payments`;--> statement-breakpoint
ALTER TABLE `__new_payments` RENAME TO `payments`;--> statement-breakpoint

-- ─── Repoint child 3 of 3: driver_trip_commissions ────────────────────────
-- New to this problem. See the header note: it was empty during 0002.
CREATE TABLE `__new_driver_trip_commissions` (
	`id` text PRIMARY KEY NOT NULL,
	`driver_id` text NOT NULL,
	`trip_id` text NOT NULL,
	`fare_cents` integer NOT NULL,
	`commission_percent` real NOT NULL,
	`commission_cents` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`driver_id`) REFERENCES `driver_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trip_id`) REFERENCES `__new_trips`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_driver_trip_commissions`("id", "driver_id", "trip_id", "fare_cents", "commission_percent", "commission_cents", "created_at") SELECT "id", "driver_id", "trip_id", "fare_cents", "commission_percent", "commission_cents", "created_at" FROM `driver_trip_commissions`;--> statement-breakpoint
DROP TABLE `driver_trip_commissions`;--> statement-breakpoint
ALTER TABLE `__new_driver_trip_commissions` RENAME TO `driver_trip_commissions`;--> statement-breakpoint
CREATE INDEX `idx_driver_trip_commissions_driver_id` ON `driver_trip_commissions` (`driver_id`);--> statement-breakpoint

-- Nothing references the name "trips" any more, so this drop is safe whether
-- or not the pragma above took effect.
DROP TABLE `trips`;--> statement-breakpoint
ALTER TABLE `__new_trips` RENAME TO `trips`;--> statement-breakpoint

CREATE INDEX `idx_trips_customer_id` ON `trips` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_trips_driver_id` ON `trips` (`driver_id`);--> statement-breakpoint
CREATE INDEX `idx_trips_status` ON `trips` (`status`);--> statement-breakpoint
CREATE INDEX `idx_trip_events_trip_id` ON `trip_events` (`trip_id`);--> statement-breakpoint
CREATE INDEX `idx_payments_trip_id` ON `payments` (`trip_id`);--> statement-breakpoint

-- Created last, against the final `trips` table. drizzle-kit put this first,
-- which would have bound it to the table that then gets dropped.
CREATE TABLE `trip_breadcrumbs` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`recorded_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_trip_breadcrumbs_trip_id` ON `trip_breadcrumbs` (`trip_id`);--> statement-breakpoint

PRAGMA foreign_keys=ON;
