# Migration Map

Historical record of the pre-rebuild planning docs (`.spec/`) and where their
content actually lives now. `.archive/docs-migration/2026-07-19/` held the
original files for reference during the migration; it was deleted on
2026-07-26 once every row below was confirmed fully captured elsewhere — the
Archive Path column is what those files' content is now, not a path that
still exists.

| Original Path | Now Lives In | Action | Notes |
|---|---|---|---|
| `.spec/rebuild_plan.md` | `.tasks/pipeline.md`, `.specs/constitution.md`, `.memory-bank/adr/0001-initial-stack.md`, `.memory-bank/adr/0002-cloudflare-deployment.md`, `.memory-bank/adr/0010-trackcar-cutover-and-domain-topology.md` | Migrated, source deleted | Locked decisions (stack, deployment, domain/cutover plan) and phase planning. |
| `.spec/srs_architecture_doc.md` | `.memory-bank/audits/srs-architecture.md` | Summarized, source deleted | Legacy architecture doc — dispatch engine, state machines, and the `zones`/`driver_zone_assignments` design (deleted in migration 0011, kept here as reference). |
