ALTER TABLE `trips` ADD `path_verification` text DEFAULT 'NOT_CHECKED' NOT NULL;--> statement-breakpoint
ALTER TABLE `trips` ADD `path_deviation_miles` real;