# Phase 6 Implementation Ledger

## Objective

Phase 6 implements the Content Architecture and Story Engine. It turns the outputs of Phases 1 through 5 into complete, evidence-bound programmes with specialist narrative grammar.

## Implemented components

### Story engine

`lib/story_engine.js` supplies:

- Studio Pack story settings
- hook candidate generation and editorial alternatives
- archetype-specific narrative blueprints
- claim-to-scene assignment
- scene-level script construction
- citations and visual requirement contracts
- retention-device planning
- evidence-bounded duration planning
- timing estimates based on Studio Pack voice rates
- seven script passes
- narrative critic and library-similarity checks
- structured and Markdown script exports

### Specialist narrative identities

The built-in pilots now produce materially different programmes:

- Failure Atlas uses causal reconstruction and separates trigger, hidden conditions, cascade, findings, and transferable lesson.
- History Under Glass uses evidence investigation, exhibits, chronology, competing interpretations, and a qualified verdict.
- Practical Open Source uses reproducible instruction, prerequisites, tested steps, failure recovery, validation, and next improvement.
- Puzzle Planet uses interactive adventure, mission beats, evidence challenges, progress, reveal, and educational payoff.

### Persistence

The SQLite schema now contains `story_packages`. Story packages are linked to episodes and retain:

- studio and archetype
- structured story JSON
- script hash
- creation and update timestamps

### Approval evidence

The following artifacts are written and verified:

```text
narrative_blueprint.json
script_package.json
timing_plan.json
story_report.json
script.md
```

All are included in the immutable approval bundle.

### Server and API

New endpoints:

```text
POST /api/story-engine/preview
GET  /api/story-engine
GET  /api/story-packages
```

The generation route now inserts narrative architecture before deterministic production manifests and editorial review.

### Production manifests

For specialist non-quiz studios, visual, narration, script, and render manifests now derive from narrative scenes rather than legacy question cards. Puzzle Planet retains backward-compatible question structures while also receiving the Phase 6 narrative evidence package.

### Dashboard

The Narrative Forge displays:

- selected hook and alternatives
- story blueprint
- scene-by-scene script
- timing plan
- critic results
- approval readiness

Operators may preview a story before generating the complete episode packet.

## Tests

Phase 6 adds seven tests covering:

- Studio Pack story constitutions
- four materially different programmes
- hype, unsupported-claim, and duplicate blocking
- evidence-bounded duration
- SQLite persistence
- live HTTP workflow and artifact verification
- dashboard DOM integrity

The complete Phase 0 through Phase 6 suite contains 39 tests.

## Honest boundary

Phase 6 produces complete structured scripts and production contracts. It does not yet create the final specialist visual assets, perform polished voice direction, or render the finished archetype-specific video. Those remain the responsibility of the visual, audio, and compositor phases.

The deterministic script is intentionally auditable. Optional model-assisted prose refinement can be introduced later only behind the same evidence, critic, and approval gates.
