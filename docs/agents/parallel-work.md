# Parallel work

Rules for two or more agents working in PocketLibrary at the same time. The goal
is a conflict-free merge and one green gate, not maximum parallelism.

## One worktree per agent

Use a separate git worktree for any task that touches more than one file (or
runs a dev server / Playwright):

```bash
git worktree add ../PocketLibrary-<task> -b <task>
```

Do not share a checkout for multi-file work. Each worktree has its own
`node_modules`, `target/`, `dist/`, `test-results/` and dev server. Reading the
main checkout is fine; writing to another agent's worktree is not.

## Write an ownership table before starting

Before the first edit, put the table in the task/handoff note. Every file that
will be modified has exactly one owner.

| Agent | Owns (writes) | Reads only / must not touch |
|---|---|---|
| A | `core/src/migrations.rs`, `core/tests/command_api.rs` | `latest.json`, `scripts/check.sh` |
| B | `scripts/check-docs.mjs`, `README.md` | `core/**` |
| Integrator | `scripts/check.sh`, final merge commits | — |

A file is either owned by one agent or serialized through the integrator. "No
two agents in the same file" includes shared docs, lockfiles, manifests and
generated files that are tracked.

## Never replace a shared file wholesale

Do not use a whole-file `write` on a shared file (`README.md`, `AGENTS.md`,
`GLOSSARY.md`, `package.json`, `package-lock.json`, `scripts/check.sh`,
`latest.json`, `docs/updates.md`). Use a targeted edit, re-read the file
immediately before editing, and keep the diff to your owned lines. If a shared
file needs coordinated changes, claim it in the ownership table and let the
integrator apply the combined edit.

## Unique dev-server and Playwright ports

`vite.config.ts` and `playwright.config.ts` currently hardcode the dev server
on `1420` and the production preview on `1421`. Give each agent its own pair:

| Agent | Dev | Preview |
|---|---:|---:|
| A | 1420 | 1421 |
| B | 1430 | 1431 |
| C | 1440 | 1441 |

Pass `--port` to `vite` / `vite preview` and change the two constants in that
worktree's `playwright.config.ts` if needed. Do not point one agent's Playwright
run at another agent's server, and do not set `reuseExistingServer` loose in a
shared checkout. Run the full suite once at integration, not in every worktree
at the same time.

## Generated directories are not shared state

`src-tauri/gen/android`, `dist/`, `public/pdfjs/`, `node_modules/`, `target/`,
`perf/.build/`, `test-results/`, `playwright-report/` and `latest.json` are
build outputs. Never copy, merge or hand-edit them from another agent's tree.
Rebuild them in your worktree with the documented script. For the tracked
`src-tauri/gen/android` tree, run `scripts/android-patch.sh` (or
`scripts/android-build.sh`) rather than merging generated Gradle files by hand.

## One integrator runs the gate and commits

Workers leave their changes uncommitted and report. A single integrator:

1. reviews the ownership table and applies or merges the changes;
2. resolves shared-file edits with the file's owner;
3. runs `./scripts/check.sh` (or `./scripts/check.sh full` for a release) and
   `./scripts/release-check.sh` when preparing a release;
4. makes the commit(s).

Workers do not push or commit unless the task explicitly assigns it. If the gate
fails, the failing stage's owner fixes it; the integrator does not paper over it.

## Handoff note

A worker's report should name the worktree/branch, the files changed, the
commands run and their results, any known failures, and the ports it used. That
is enough for the integrator to finish without guessing.
