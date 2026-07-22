# GEMINI.md

This project keeps its agent guidance in one canonical, tool-agnostic file:
**[`AGENTS.md`](AGENTS.md)**. Read it first — it applies to every agent
(Gemini included).

Then, to reconstruct full context before doing anything:
1. `.memory-bank/changelog/verified-worklog.md` — what's built, why, and how the
   non-obvious parts work.
2. `.tasks/handoff.md` — current commit, test counts, and the next action.
3. `.memory-bank/adr/` — the load-bearing architectural decisions.

## The rules most likely to bite (full list in AGENTS.md)

- **Commit anonymity**: never add `Co-Authored-By` or any AI attribution to git commits.
- **D1 has no transactions**: use `db.batch([...])` for atomic writes (ADR 0005).
- **Migrations**: prefer `ADD COLUMN`; a table rebuild is dangerous, goes alone, children repointed before the drop, smoke-test remote (ADR 0005).
- **Fares**: real road distance, fail closed with 503 — never a straight-line fallback (ADR 0004).
- **Commission** follows `trips.referralSource`, never `origin` (ADR 0003).
- **Secrets** are never typed into chat or committed — the user runs `wrangler secret put`.
- **Plan before code** on non-trivial work; **verify** (typecheck + tests + CI + live smoke) before claiming done.

## After every behavior-changing commit

Update `.memory-bank/changelog/verified-worklog.md`, refresh `.tasks/handoff.md`,
add an ADR if a real decision was made, and keep the changelog's test counts
current. See "Memory discipline" in `AGENTS.md`.
