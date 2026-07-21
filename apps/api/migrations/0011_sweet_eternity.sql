-- Drops the zones / driver-zone-assignment tables — a polygon-geofence layer
-- copied faithfully from the original project's SRS (which itself marked it
-- "Optional / Admin") and never wired to anything in this single-market build.
--
-- HAND-ORDERED. drizzle-kit emitted `DROP TABLE zones` first, but
-- driver_zone_assignments holds a FOREIGN KEY into zones. Dropping the parent
-- before the child is the exact class of ordering that broke 0002 and 0007
-- against remote D1. Both tables are empty, so this would likely pass either
-- way — but "likely" is what those two migrations also were locally. Drop the
-- child first so the order is correct regardless of FK enforcement.
DROP TABLE `driver_zone_assignments`;--> statement-breakpoint
DROP TABLE `zones`;
