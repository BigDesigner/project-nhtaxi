ALTER TABLE `trips` ADD `search_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trips` ADD `next_search_at` integer;