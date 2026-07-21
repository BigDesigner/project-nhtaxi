CREATE TABLE `trip_ratings` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`driver_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`courtesy` integer NOT NULL,
	`safety` integer NOT NULL,
	`punctuality` integer NOT NULL,
	`communication` integer NOT NULL,
	`cleanliness` integer NOT NULL,
	`overall` real NOT NULL,
	`comment` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`driver_id`) REFERENCES `driver_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_trip_ratings_stars" CHECK("trip_ratings"."courtesy" between 1 and 5 and "trip_ratings"."safety" between 1 and 5 and "trip_ratings"."punctuality" between 1 and 5 and "trip_ratings"."communication" between 1 and 5 and "trip_ratings"."cleanliness" between 1 and 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trip_ratings_trip_id_unique` ON `trip_ratings` (`trip_id`);--> statement-breakpoint
CREATE INDEX `idx_trip_ratings_driver_id` ON `trip_ratings` (`driver_id`);--> statement-breakpoint
ALTER TABLE `driver_profiles` ADD `rating_count` integer DEFAULT 0 NOT NULL;