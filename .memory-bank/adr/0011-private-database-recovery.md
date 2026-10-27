# ADR 0011: Keep database recovery data out of public Actions artifacts

- **Status**: Accepted
- **Date**: 2026-10-27
- **Related**: ADR 0002 (deployment), ADR 0005 (migration safety)

## Context

The repository became public in July. Deploy and reset workflows still
uploaded plaintext D1 exports as Actions artifacts. Such exports may contain
password hashes, sessions and personal data. Avoiding public log output does
not make a public repository's artifacts private.

One retained artifact, `d1-backup-00bf1e1...`, was found during maintenance.
Its contents were not downloaded or inspected. The user explicitly approved
its permanent deletion; the subsequent artifact listing returned zero.
There is no evidence here establishing whether another person accessed it.

## Decision

- Keep the pre-migration/pre-reset export step, but keep SQL on the ephemeral
  runner. Never upload plaintext database exports to public Actions artifacts.
- Use Cloudflare D1 Time Travel as the durable recovery mechanism. Free-tier
  retention is **7 days**, not 30 or 90. It is always enabled on production D1.
- Ignore known local export paths in Git. Do not print export contents.
- Longer retention requires a separately designed private, encrypted backup
  destination. It is not provided by the ephemeral export step.

## Consequences

The former 90-day convenience artifact is intentionally removed. Recovery
must happen within the Time Travel window unless a private backup has been
arranged. This does not add monthly infrastructure cost or alter migrations.
No restore or production database reset was performed during maintenance.

The user should rotate the admin password through the app as a precaution,
because the old artifact could have contained its hash. Worker secrets were
not inspected or rotated; database exposure does not establish Worker-secret
exposure.

## Sources

- [GitHub Actions artifacts](https://docs.github.com/en/actions/using-workflows/storing-workflow-data-as-artifacts)
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [D1 retention limits](https://developers.cloudflare.com/d1/platform/limits/)
