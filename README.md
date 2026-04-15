# magus-alpha

> Alpha distribution channel for [Magus](https://github.com/MadAppGang/magus) plugins.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Maintained by MadAppGang](https://img.shields.io/badge/Maintained%20by-MadAppGang-blue)](https://madappgang.com)

This marketplace hosts plugins that aren't ready for the stable [magus](https://github.com/MadAppGang/magus) channel yet — experimental features, partial wiring, evolving command surfaces, or integrations that need external infrastructure (Linear, webhooks, bots) to be useful.

**Expect breakage.** Versions may jump, flags may be renamed, commands may be removed. If stability matters, use the main `magus` marketplace instead.

## Install

```bash
/plugin marketplace add MadAppGang/magus-alpha
```

Then enable the specific plugins you want:

```bash
/plugin install autolinear@magus-alpha
```

## Where the code lives

Alpha plugins are developed in the main [MadAppGang/magus](https://github.com/MadAppGang/magus) monorepo under `plugins/`. This repository is a **lean distribution index** — it contains only `.claude-plugin/marketplace.json` and this README, referencing plugin source via `git-subdir` pinned to specific commit SHAs in the main repo. One source of truth, two distribution channels.

## Plugins

### autolinear — Linear → Claude Code autonomous bridge

**Version**: 0.3.0
**Category**: automation
**Source**: [`MadAppGang/magus/plugins/autolinear`](https://github.com/MadAppGang/magus/tree/main/plugins/autolinear)

Picks up Linear issues labeled `@autolinear`, routes them to the right agent via tag-to-command mapping, captures proof-of-work (screenshots, test output, coverage, build logs), scores confidence out of 100, and drives the Linear issue through `Todo → In Progress → In Review → Done` with a reviewer-comment feedback loop (max 5 iterations).

**Components:** 3 agents (`task-executor`, `proof-generator`, `feedback-processor`), 5 commands (`/autolinear:run`, `create-task`, `status`, `config`, `help`), 4 skills (`linear-integration`, `tag-command-mapping`, `proof-of-work`, `state-machine`), Bun-based webhook server, Linear SDK CLI.

**Requires:** `LINEAR_API_KEY`, `AUTOLINEAR_BOT_USER_ID`, optional `LINEAR_WEBHOOK_SECRET`, `@linear/sdk`, `playwright`.

**Status breakdown:**

| Area | State |
|---|---|
| Linear API CRUD, state transitions, comments | ✅ wired |
| Manual orchestrator `/autolinear:run <id>` | ✅ wired end-to-end |
| `task-executor` / `proof-generator` / `feedback-processor` agent prompts | ✅ wired |
| Webhook receiver (HMAC verify, queue push) | ✅ wired |
| Webhook queue → Claude Code dispatch | 🚧 stub (TODO in `scripts/webhook-server.ts:196-212`) |
| Linear file attachment (screenshots → issue) | 🚧 stub (TODO in `scripts/linear-client.ts:312-328`) |
| `validate-linear-state.sh` PreToolUse hook | 🚧 stub |
| Persistent task queue across restarts | ❌ not started (in-memory only) |

**Bottom line:** The manual path (`/autolinear:run <id>` after you create a Linear issue) works except for file attachment. The *autonomous* path — "webhook fires, bot executes, no human in the loop" — is the headline feature and it isn't shipped yet. Useful today if you want a structured agent pipeline for Linear tickets; not useful yet as a set-and-forget bot.

**Previously known as `autopilot@magus`.** If you had the old plugin installed, remove it (`/plugin remove autopilot@magus`) and reinstall from this marketplace.

---

## Promotion to stable

A plugin graduates from `magus-alpha` to `magus` when:

- All components marked 🚧 or ❌ in its status table are ✅
- It has run autonomously (no hand-holding) on real workloads for at least two weeks
- The command surface has been stable for at least one minor version
- A dedicated `autotest/` suite exercises the golden path

Until then, it stays here.

## Releasing

Alpha marketplace SHAs are synced from the main magus repo via `scripts/release-marketplace-alpha.sh` in `MadAppGang/magus`. Workflow:

1. Make changes to plugin code in `MadAppGang/magus/plugins/<name>/`
2. Commit and push to `main`
3. In `MadAppGang/magus`, run `./scripts/release-marketplace-alpha.sh` to bump SHAs
4. In `MadAppGang/magus-alpha`, pull the updated `marketplace.json` and commit

(The main `magus` marketplace has its own parallel release flow via `scripts/release.sh`.)

## License

MIT — see `LICENSE`.

---

**Maintained by:** Jack Rudenko @ [MadAppGang](https://madappgang.com)
