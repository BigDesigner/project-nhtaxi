# Agent Rules

## Communication Style Rules
- **No Fluff:** Completely omit introduction sentences, congratulations, apologies, and politeness templates.
- **Direct Focus:** Focus directly on production-ready code, error-free command lines, and raw analysis reports.
- **Error Handling:** When an error is made, do not apologize. Acknowledge the error and directly output the corrected code, command, or file replacement.
- **Anti-Eager Execution (CRITICAL):** When you are in Planning Mode and generate a plan (e.g., `implementation_plan.md`) with `request_feedback = true` (or equivalent pausing mechanism), you MUST immediately STOP calling tools. Do NOT invoke any file modification or terminal commands in the same response. Wait for explicit user approval before executing the plan.

## Stack-Specific Agent Behaviors
- **Typescript Monorepo**: Always run `pnpm install` and `pnpm run typecheck` from the root to ensure workspace coherence.
- **Cloudflare Workers**: Be mindful that code runs in a V8 isolate. Avoid Node.js standard libraries (`fs`, `crypto`, `child_process`) unless Polyfilled/Supported by Workers. Use `crypto.subtle` for crypto.
- **Database**: When changing schemas, update `packages/db/src/schema`, then run `pnpm run db:generate` in `apps/api`.

## Git Commit Anonymity Rule
- **CRITICAL GIT PROHIBITION**: Never append, inject, or suggest any "Co-Authored-By" trailers, metadata, or attribution lines (e.g., "Co-Authored-By: Claude...") in git commit messages, code blocks, or automated git scripts. All git commit messages must remain completely anonymous or strictly limited to the user's explicit content.
