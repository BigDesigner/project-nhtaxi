# System Coherence Protocol

- **Session Start**: Verify `.memory-bank/active-session.json`. Follow lock file rules (`.session.lock`).
- **Operating Mode Detection**: Interative mode requires user approval. CI mode proceeds and logs warnings.
- **Discovery Approval Gate**: Validate the environment before taking action in Interactive Mode.
- **Worktree Checks**: Ensure the git tree is clean before making mass changes.
- **Branch Awareness**: Changes are contextualized to the current branch.
- **Context Drift Prevention**: Continually update the memory bank to reflect true repository state.
- **Checklists**: Always perform pre-change analysis and post-change validation.
- **Validation Rules**: Recommend validation commands (e.g. `pnpm run typecheck`, `pnpm run test`) but do not run automatically in Interactive mode.
- **Handoff**: Generate a `.tasks/handoff.md` file before concluding the session.
- **Locking Expectations**: Respect `.session.lock`. Max TTL is 10 minutes.
- **Unconfirmed Decisions**: Explicitly flag any `Unconfirmed` facts and seek user validation.
- **CI Mode Overrides**: Do not prompt the user in CI; log proposed decisions and issues for manual review.
