# PocketLibrary

## Agent skills

Installed from [mattpocock/skills](https://github.com/mattpocock/skills) into `.agents/skills/`. Managed by `skills.sh`; update with `npx skills@latest update`, then re-run `npx skills@latest add` to pick up newly added skills.

The engineering skills assume the configuration below. Run `/ask-matt` to pick a skill or flow.

### Issue tracker

Issues and specs are tracked as local Markdown under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical defaults are used: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` at the repo root plus `docs/adr/`. See `docs/agents/domain.md`.

## Parallel work

Multiple agents need one worktree each and a file-ownership table; see [`docs/agents/parallel-work.md`](docs/agents/parallel-work.md).
