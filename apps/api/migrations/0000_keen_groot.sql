CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`phone` text,
	`role` text DEFAULT 'customer' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "chk_users_role" CHECK("users"."role" in ('admin','driver','customer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `driver_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`license_number` text,
	`vehicle_make` text,
	`vehicle_model` text,
	`vehicle_year` integer,
	`vehicle_color` text,
	`vehicle_plate` text,
	`status` text DEFAULT 'OFFLINE' NOT NULL,
	`is_verified` integer DEFAULT false NOT NULL,
	`current_lat` real,
	`current_lng` real,
	`last_seen` integer,
	`city_id` text,
	`rating` real,
	`total_trips` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_driver_profiles_status" CHECK("driver_profiles"."status" in ('AVAILABLE','RESERVED','BUSY','OFFLINE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `driver_profiles_user_id_unique` ON `driver_profiles` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_driver_profiles_status` ON `driver_profiles` (`status`);--> statement-breakpoint
CREATE TABLE `customer_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`preferred_payment_method` text,
	`total_trips` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_profiles_user_id_unique` ON `customer_profiles` (`user_id`);--> statement-breakpoint
CREATE TABLE `cities` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`country` text DEFAULT 'US' NOT NULL,
	`state` text,
	`timezone` text DEFAULT 'America/New_York' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`lat` real,
	`lng` real,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `zones` (
	`id` text PRIMARY KEY NOT NULL,
	`city_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL,
	`polygon` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `driver_zone_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`driver_id` text NOT NULL,
	`zone_id` text NOT NULL,
	`assigned_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`driver_id`) REFERENCES `driver_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`zone_id`) REFERENCES `zones`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_driver_zone` ON `driver_zone_assignments` (`driver_id`,`zone_id`);--> statement-breakpoint
CREATE TABLE `trip_events` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`status` text NOT NULL,
	`actor_id` text,
	`actor_role` text,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_trip_events_trip_id` ON `trip_events` (`trip_id`);--> statement-breakpoint
CREATE TABLE `trips` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`driver_id` text,
	`city_id` text,
	`pickup_lat` real NOT NULL,
	`pickup_lng` real NOT NULL,
	`pickup_address` text NOT NULL,
	`dropoff_lat` real NOT NULL,
	`dropoff_lng` real NOT NULL,
	`dropoff_address` text NOT NULL,
	`status` text DEFAULT 'REQUESTED' NOT NULL,
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
	CONSTRAINT "chk_trips_status" CHECK("trips"."status" in ('REQUESTED','DRIVER_ASSIGNED','DRIVER_ACCEPTED','DRIVER_REJECTED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','TRIP_STARTED','TRIP_COMPLETED','TRIP_CANCELLED','DRIVER_NO_RESPONSE','TIMEOUT')),
	CONSTRAINT "chk_trips_payment_method" CHECK("trips"."payment_method" in ('cash','card','online'))
);
--> statement-breakpoint
CREATE INDEX `idx_trips_customer_id` ON `trips` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_trips_driver_id` ON `trips` (`driver_id`);--> statement-breakpoint
CREATE INDEX `idx_trips_status` ON `trips` (`status`);--> statement-breakpoint
CREATE TABLE `payments` (
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
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payments_method" CHECK("payments"."method" in ('cash','card','online')),
	CONSTRAINT "chk_payments_status" CHECK("payments"."status" in ('PENDING','COMPLETED','FAILED','REFUNDED'))
);
--> statement-breakpoint
CREATE INDEX `idx_payments_trip_id` ON `payments` (`trip_id`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`action` text NOT NULL,
	`actor_id` text,
	`actor_role` text,
	`metadata` text,
	`ip_address` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_logs_entity` ON `audit_logs` (`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_actor_id` ON `audit_logs` (`actor_id`);--> statement-breakpoint
CREATE TABLE `push_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`platform` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_push_tokens_platform" CHECK("push_tokens"."platform" in ('ios','android'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_tokens_token_unique` ON `push_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `idx_push_tokens_user_id` ON `push_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`device_info` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refresh_tokens_token_hash_unique` ON `refresh_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_refresh_tokens_user_id` ON `refresh_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `driver_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`driver_id` text NOT NULL,
	`type` text NOT NULL,
	`r2_key` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`uploaded_at` integer DEFAULT (unixepoch()) NOT NULL,
	`reviewed_at` integer,
	`reviewed_by` text,
	FOREIGN KEY (`driver_id`) REFERENCES `driver_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_driver_documents_type" CHECK("driver_documents"."type" in ('license','background_check','photo')),
	CONSTRAINT "chk_driver_documents_status" CHECK("driver_documents"."status" in ('PENDING','APPROVED','REJECTED'))
);
--> statement-breakpoint
CREATE INDEX `idx_driver_documents_driver_id` ON `driver_documents` (`driver_id`);--> statement-breakpoint
CREATE TABLE `pricing_config` (
	`id` text PRIMARY KEY NOT NULL,
	`city_id` text,
	`base_fare_cents` integer DEFAULT 250 NOT NULL,
	`per_mile_cents` integer DEFAULT 120 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
