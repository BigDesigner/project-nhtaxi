-- Seeds a local D1 with the shape that actually breaks a trips-table rebuild.
--
-- Migration 0002 passed locally and failed twice remotely for one reason:
-- local had trips but no *child* rows, so `DROP TABLE trips` had no foreign
-- key to violate. "It worked locally" was measuring nothing.
--
-- This seeds a trip with rows in all three children — trip_events, payments
-- and driver_trip_commissions — so a rebuild that gets the ordering wrong
-- fails here, on a laptop, instead of on production.
--
-- Usage (see the db:migrate:verify script):
--   wrangler d1 execute gnncab --local --file test/seed-migration-check.sql

INSERT OR IGNORE INTO users (id, email, password_hash, first_name, last_name, role)
VALUES ('seed-user-customer', 'seed-customer@example.com', 'x', 'Seed', 'Customer', 'customer');

INSERT OR IGNORE INTO users (id, email, password_hash, first_name, last_name, role)
VALUES ('seed-user-driver', 'seed-driver@example.com', 'x', 'Seed', 'Driver', 'driver');

INSERT OR IGNORE INTO driver_profiles (id, user_id, status, is_verified)
VALUES ('seed-driver-profile', 'seed-user-driver', 'AVAILABLE', 1);

INSERT OR IGNORE INTO trips (
  id, customer_id, driver_id, pickup_lat, pickup_lng, pickup_address,
  dropoff_lat, dropoff_lng, dropoff_address, status, origin, referral_source,
  commission_percent, distance_miles, estimated_fare_cents, final_fare_cents
) VALUES (
  'seed-trip', 'seed-user-customer', 'seed-driver-profile', 44.0537, -71.1281, 'Main St',
  42.3656, -71.0096, 'Logan Airport', 'TRIP_COMPLETED', 'ADMIN_ASSIGNED', 'ADMIN_ASSIGNED',
  20, 136.27, 17309, 17309
);

-- Child 1: the status trail.
INSERT OR IGNORE INTO trip_events (id, trip_id, status, actor_role)
VALUES ('seed-event-1', 'seed-trip', 'DRIVER_ASSIGNED', 'system');
INSERT OR IGNORE INTO trip_events (id, trip_id, status, actor_role)
VALUES ('seed-event-2', 'seed-trip', 'TRIP_COMPLETED', 'driver');

-- Child 2: payments.
INSERT OR IGNORE INTO payments (id, trip_id, amount_cents, currency, method, status)
VALUES ('seed-payment', 'seed-trip', 17309, 'USD', 'cash', 'COMPLETED');

-- Child 3: the one that was empty during 0002 and is not any more.
INSERT OR IGNORE INTO driver_trip_commissions (
  id, driver_id, trip_id, fare_cents, commission_percent, commission_cents
) VALUES ('seed-commission', 'seed-driver-profile', 'seed-trip', 17309, 20, 3462);
