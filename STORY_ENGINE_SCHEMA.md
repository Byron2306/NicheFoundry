# NicheFoundry Story Engine Schema 1.0

Phase 6 converts approved opportunity, research, Studio Pack, and audience evidence into a complete narrative programme. The engine is deterministic by default so every story decision can be inspected, reproduced, and approved.

## Approval-bound artifacts

### `narrative_blueprint.json`

Defines the narrative contract before prose production.

```json
{
  "schema": "nichefoundry.narrative_blueprint.v1.0",
  "studio_id": "failure_atlas",
  "archetype_id": "failure_chain",
  "narrative_mode": "causal_reconstruction",
  "opening_question": "Which hidden condition turned an ordinary system into a cascading failure?",
  "narrative_tension": "The visible event is not yet the explanation.",
  "selected_hook": {
    "hook_id": "hook_...",
    "type": "visual anomaly",
    "text": "...",
    "claim_ids": ["claim_1"],
    "source_ids": ["source_1"]
  },
  "hook_alternatives": [],
  "required_story_beats": [],
  "retention_plan": [],
  "duration_plan": {
    "requested": 8,
    "evidence_supported_max": 6.4,
    "target": 6.4,
    "was_capped_by_evidence": true
  }
}
```

### `script_package.json`

Contains the full spoken programme and scene contracts.

Each scene includes:

- stable scene ID
- scene type and story beat
- editorial objective
- narration
- structured script segments
- claim IDs and source IDs
- citation records
- visual requirements
- retention device
- word count and estimated duration

A claim-bearing script segment must identify a known claim and its supporting source. Narrative bridges may connect evidence but may not invent facts.

### `timing_plan.json`

Records:

- requested duration
- evidence-supported maximum duration
- final estimated duration
- Studio Pack speaking rate
- scene-level words and seconds
- timing warnings

The engine will shorten a requested programme rather than pad thin evidence.

### `story_report.json`

Summarises the release gate:

- selected hook
- scene count
- grounded claim count
- grounded source count
- estimated duration
- critic issues
- critic warnings
- overall pass state

### `script.md`

A human-readable editorial script generated from the structured package. It is a review surface, not the canonical source of truth.

## Studio Pack story constitution

Each Studio Pack may define:

```json
{
  "story_engine": {
    "narrative_mode": "causal_reconstruction",
    "default_target_minutes": 9,
    "spoken_words_per_minute": 148,
    "opening_rules": [],
    "retention_devices": [],
    "closing_rules": [],
    "forbidden_phrases": [],
    "required_passes": [
      "evidence",
      "structure",
      "audience",
      "spoken_language",
      "timing",
      "originality",
      "sensationalism"
    ]
  }
}
```

## Required script passes

1. **Evidence**: every factual segment resolves to an approved claim and source.
2. **Structure**: every required archetype beat appears exactly once in sequence.
3. **Audience**: the script fulfils the selected persona, viewer job, and channel promise.
4. **Spoken language**: narration is suitable for speech rather than document prose.
5. **Timing**: duration remains inside the evidence-supported and format-specific range.
6. **Originality**: scenes and the complete narration are checked against the existing library.
7. **Sensationalism**: hype patterns and Studio Pack forbidden phrases are blocked.

## Narrative modes shipped in Phase 6

| Studio | Narrative mode | Native opening |
|---|---|---|
| Failure Atlas | `causal_reconstruction` | System behaviour and hidden vulnerability |
| History Under Glass | `evidence_investigation` | Object contradiction or unresolved exhibit |
| Practical Open Source | `reproducible_instruction` | Visible, testable working result |
| Puzzle Planet | `interactive_adventure` | Mission emergency and participatory challenge |

## Evidence and duration law

Requested length is advisory. The engine calculates an evidence-supported maximum from the number and quality of usable claims. It may cap the target duration and records that decision in the blueprint.

## Approval invalidation

The narrative blueprint, script package, timing plan, story report, and Markdown script are part of the editorial bundle hash. Editing any one of them invalidates existing approval.
