CREATE TABLE `driver_trip_commissions` (
	`id` text PRIMARY KEY NOT NULL,
	`driver_id` text NOT NULL,
	`trip_id` text NOT NULL,
	`fare_cents` integer NOT NULL,
	`commission_percent` real NOT NULL,
	`commission_cents` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`driver_id`) REFERENCES `driver_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_driver_trip_commissions_driver_id` ON `driver_trip_commissions` (`driver_id`);--> statement-breakpoint
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
	CONSTRAINT "chk_trips_origin" CHECK("__new_trips"."origin" in ('CUSTOMER_APP','ADMIN_ASSIGNED'))
);
--> statement-breakpoint
-- NOTE: hand-fixed after a failed remote deploy. drizzle-kit's generated
-- INSERT...SELECT listed "origin"/"commission_percent" as if they already
-- existed on the OLD `trips` table (they're brand new here). Since neither
-- column exists on the old table, SQLite's double-quoted-identifier fallback
-- silently treated `"origin"` as the string literal 'origin' instead of
-- erroring, which failed chk_trips_origin for every existing row (harmless
-- for a still-empty local DB, but production already had real rows). Fix:
-- omit both from the copy entirely so SQLite applies their real defaults
-- ('CUSTOMER_APP' and NULL) to existing rows instead, exactly as intended.
INSERT INTO `__new_trips`("id", "customer_id", "guest_name", "guest_phone", "driver_id", "city_id", "pickup_lat", "pickup_lng", "pickup_address", "dropoff_lat", "dropoff_lng", "dropoff_address", "status", "distance_miles", "estimated_fare_cents", "final_fare_cents", "currency", "payment_method", "cancellation_reason", "notes", "requested_at", "assigned_at", "started_at", "completed_at", "created_at", "updated_at") SELECT "id", "customer_id", "guest_name", "guest_phone", "driver_id", "city_id", "pickup_lat", "pickup_lng", "pickup_address", "dropoff_lat", "dropoff_lng", "dropoff_address", "status", "distance_miles", "estimated_fare_cents", "final_fare_cents", "currency", "payment_method", "cancellation_reason", "notes", "requested_at", "assigned_at", "started_at", "completed_at", "created_at", "updated_at" FROM `trips`;--> statement-breakpoint
DROP TABLE `trips`;--> statement-breakpoint
ALTER TABLE `__new_trips` RENAME TO `trips`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_trips_customer_id` ON `trips` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_trips_driver_id` ON `trips` (`driver_id`);--> statement-breakpoint
CREATE INDEX `idx_trips_status` ON `trips` (`status`);