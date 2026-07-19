CREATE TABLE `driver_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`driver_id` text NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`ended_at` integer,
	`duration_minutes` integer,
	`charge_cents` integer,
	`closed_reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`driver_id`) REFERENCES `driver_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_driver_sessions_closed_reason" CHECK("driver_sessions"."closed_reason" is null or "driver_sessions"."closed_reason" in ('OFFLINE_TOGGLE','STALE_TIMEOUT','ADMIN_FORCE_CLOSE'))
);
--> statement-breakpoint
CREATE INDEX `idx_driver_sessions_driver_id` ON `driver_sessions` (`driver_id`);--> statement-breakpoint
CREATE INDEX `idx_driver_sessions_driver_open` ON `driver_sessions` (`driver_id`,`ended_at`);--> statement-breakpoint
CREATE TABLE `driver_cash_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`driver_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`collected_at` integer DEFAULT (unixepoch()) NOT NULL,
	`collected_by` text NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`driver_id`) REFERENCES `driver_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collected_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_driver_cash_collections_driver_id` ON `driver_cash_collections` (`driver_id`);--> statement-breakpoint
ALTER TABLE `pricing_config` ADD `driver_usage_per_minute_cents` integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE `pricing_config` ADD `driver_commission_percent` real DEFAULT 20 NOT NULL;