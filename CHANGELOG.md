# Changelog

> Filtered view. This lists only the plugins published to the `magus-alpha` marketplace.
> The complete history across every plugin and channel lives in `CHANGELOG.md` at
> [MadAppGang/magus-src](https://github.com/MadAppGang/magus-src).

## [autolinear 0.5.0] - 2026-09-11

### Changed

- **`feedback-processor`, `proof-generator` and `task-executor` now say what the caller must
  hand over, and return a fixed completion template with an Obstacles Encountered section.**
  `feedback-processor` drops the `Agent` tool it had no step for, splits its BLOCKED outcome
  from a new FAILED outcome, and never marks a Linear task Done on a guessed
  classification.

---

## [magus-alpha 0.5.1] - 2026-08-19

### Changed

- Channel version aligned with Marketplace 9.3.0: `autolinear` v0.4.1. Same rationale
  as magus-marketing 2.0.1.

---

## [autolinear 0.3.0] - 2026-04-15

### Changed
- **Renamed from `autopilot`** and split out to the `magus-alpha` channel. Enable it as
  `autolinear@magus-alpha`.
