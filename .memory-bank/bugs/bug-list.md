# Bug List

| Issue | Status | Confidence | Details | Suggested Action |
|---|---|---|---|---|
| No open bugs | N/A | Verified | 204/204 backend + 104/104 Flutter tests pass; both CI workflows green as of the commit `.tasks/handoff.md` names. | Continue from `.tasks/handoff.md` → "Next recommended action". |

## Watch list (not bugs — known trade-offs / unproven-live)
- Any signed-in passenger can see every on-duty driver's live position, phone
  and vehicle with no booking first. Accepted for a ~15-driver local operation;
  revisit if the fleet/user base grows.
- Several paths are unproven against production because they need a real device
  or the admin account — see "Not yet proven live" in `.tasks/handoff.md`.
