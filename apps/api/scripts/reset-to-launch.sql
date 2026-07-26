-- One-time launch reset. Wipes every trip/driver/customer/activity row,
-- keeping only the info@nhtaxi.com admin account — the app comes back up
-- as a blank slate for real customers, nothing else touched. Run exactly
-- once, manually, via the "Database Reset" GitHub Action — never
-- automatically, and never applied twice.
--
-- Order matters: every child row is deleted before the parent it
-- references, so this succeeds regardless of whether foreign key
-- enforcement is on.
DELETE FROM trip_ratings;
DELETE FROM driver_trip_commissions;
DELETE FROM driver_cash_collections;
DELETE FROM driver_sessions;
DELETE FROM driver_documents;
DELETE FROM payments;
DELETE FROM trip_breadcrumbs;
DELETE FROM trip_events;
DELETE FROM trips;
DELETE FROM audit_logs;
DELETE FROM push_tokens WHERE user_id NOT IN (SELECT id FROM users WHERE email = 'info@nhtaxi.com');
DELETE FROM refresh_tokens WHERE user_id NOT IN (SELECT id FROM users WHERE email = 'info@nhtaxi.com');
DELETE FROM driver_profiles;
DELETE FROM customer_profiles;
DELETE FROM users WHERE email != 'info@nhtaxi.com';
