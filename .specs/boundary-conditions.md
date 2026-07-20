# Boundary Conditions

## Security Constraints & Input Validation [Verified]
- **API Roles**: Operations are strictly segregated by `role` (Customer, Driver, Admin).
- **Web App**: Admin panel uses HttpOnly cookies + CSRF protection.
- **Mobile App**: Uses Bearer tokens (access + refresh tokens).
- **Data Minimization**: Passenger signup requests minimum required fields (phone, email, password).

## Document Encryption [Verified]
- Driver documents (License, background check) are uploaded to Cloudflare R2 (Private bucket).
- Files must be **Envelope Encrypted** on the application layer using `DOCUMENT_ENCRYPTION_KEY` wrapped via Web Crypto API.
- Viewing is proxied through an admin-authenticated Worker route that decrypts on the fly (`GET /api/admin/drivers/{driverId}/documents/{documentId}/file`). Note: signed URLs are **not** used — the R2 object never leaves the Worker, so no URL is ever handed to the client. Every access is audit-logged.
- Driver documents are **write-once**; drivers cannot delete their documents after approval.

## Auth & Rate Limiting [Verified]
- Refresh tokens have 30-day rotation and can be revoked per device.
- WebSocket location updates are rate-limited to 30 updates per 60 seconds **per connection** (the counter rides in the socket's `serializeAttachment`, so it survives hibernation). Note this is per-socket, not per-driver: a driver holding several concurrent sockets gets the allowance on each. Acceptable at 10-20 drivers; revisit if abuse ever appears.

## Transaction Safety [Verified]
- D1 has **no interactive transactions**. Drizzle's `.transaction()` emits BEGIN/COMMIT as separate round trips that D1 does not honour, so it must not be relied on. `db.batch()` is the atomicity primitive — it executes the whole statement list in one implicit transaction.
- Multi-row state transitions must be collected into a single `db.batch()` rather than sequential awaits. Applies especially to money paths (`trips.ts` status transitions, which touch driver profiles, commissions and payments together).
- Durable Objects manage state serialization for Dispatch logic; driver claiming additionally uses an atomic conditional `UPDATE ... WHERE status='AVAILABLE'`.

## Ecosystem-Specific Mitigations [Verified]
- D1 SQLite compatibility: Enums mapped to `text` + `check`, timestamps to integers/text.
- Node.js compatibility: Cloudflare Workers run on V8 isolates. Node APIs like `setTimeout` are unreliable across restarts; we MUST use Durable Object Alarms for dispatch timers.

## Secrets Management [Verified]
- **NEVER** commit secrets. `JWT_SECRET`, `DOCUMENT_ENCRYPTION_KEY`, `ADMIN_BOOTSTRAP_TOKEN`, `FCM_SERVICE_ACCOUNT_KEY` are stored in Cloudflare Workers Secrets.
