# Audience and Channel Strategy Schema 1.0

Phase 5 adds a structured audience and channel-strategy layer to every Studio Pack and episode packet.

## Viewer-job taxonomy

```text
learn      Teach me
decide     Help me decide
solve      Help me solve something
story      Tell me a compelling story
change     Help me understand what changed
challenge  Let me test myself
belong     Help me belong to a specialist community
relax      Give me something restorative
```

A Studio Pack may use its own natural-language viewer jobs. The engine maps them into this shared taxonomy for portfolio analysis.

## Studio Pack audience extension

```json
{
  "audience": {
    "primary_age": "18-44",
    "knowledge_level": "curious non-specialist",
    "motivations": ["understand a bounded subject"],
    "viewer_jobs": ["teach me how a system failed"],
    "vocabulary": "plain language with defined specialist terms",
    "frustrations": ["generic coverage"],
    "viewing_context": ["focused television or desktop viewing"],
    "desired_reward": "A satisfying causal explanation.",
    "likely_next_action": "Watch a related episode.",
    "personas": [
      {
        "id": "curious_viewer",
        "name": "The Curious Viewer",
        "description": "A concrete audience description.",
        "age_range": "18-44",
        "knowledge_level": "curious non-specialist",
        "motivations": ["understand mechanisms"],
        "frustrations": ["unsupported certainty"],
        "viewing_context": ["focused evening viewing"],
        "desired_reward": "A clear explanation.",
        "likely_next_action": "Continue to a related episode."
      }
    ]
  }
}
```

## Channel strategy extension

```json
{
  "channel_strategy": {
    "minimum_audience_fit_score": 60,
    "promise_tests": [
      "Would an existing subscriber understand why this belongs here?",
      "Does the episode deliver a specific viewer reward?"
    ],
    "content_pillars": [
      {
        "id": "case_files",
        "name": "Case Files",
        "purpose": "Investigate bounded questions through evidence.",
        "keywords": ["case", "evidence", "investigation"],
        "archetypes": ["historical_case_file"],
        "target_share": 0.5
      },
      {
        "id": "object_stories",
        "name": "Object Stories",
        "purpose": "Reconstruct lives through material objects.",
        "keywords": ["object", "artefact", "material"],
        "archetypes": ["object_biography"],
        "target_share": 0.5
      }
    ],
    "portfolio_targets": {
      "core_pillar": 0.5,
      "search_evergreen": 0.2,
      "experimental": 0.15,
      "audience_request": 0.1,
      "commercial_intent": 0.05
    },
    "format_rotation": {
      "maximum_same_archetype_streak": 2,
      "maximum_same_pillar_streak": 2,
      "maximum_same_viewer_job_streak": 3,
      "maximum_same_output_streak": 3,
      "lookback_items": 8
    }
  }
}
```

Content-pillar target shares must total approximately `1.0`.

## Episode brief extension

```json
{
  "target_persona_id": "curious_viewer",
  "viewer_job": "Teach me",
  "content_pillar_id": "case_files",
  "output_format": "long_form"
}
```

These fields may be omitted. When omitted, the engine infers them and records warnings requiring human confirmation.

## Audience-fit report

```json
{
  "schema": "nichefoundry.audience_fit.v1.0",
  "passed": true,
  "score": 74,
  "threshold": 60,
  "persona": {},
  "viewer_job": {},
  "content_pillar": {},
  "channel_promise": {},
  "output_format": "long_form",
  "output_allowed": true,
  "value_proposition": "Teach me by delivering a bounded evidence-led investigation.",
  "desired_reward": "A clear explanation.",
  "likely_next_action": "Continue to a related episode.",
  "issues": [],
  "warnings": []
}
```

## Channel-strategy snapshot

The snapshot includes:

- audience profile
- personas
- channel promise and promise tests
- content pillars
- portfolio distribution
- fatigue report
- format-rotation recommendation
- deterministic strategy hash

## Fatigue rules

The engine checks the configured lookback window for:

- repeated archetype streaks
- repeated content-pillar streaks
- repeated viewer-job streaks
- repeated output-format streaks
- similar recent titles

A warning encourages deliberate variation. A proposed episode that exceeds the configured maximum streak becomes blocking.

## Approval binding

The following files are part of `approval_bundle.json`:

```text
audience_profile_snapshot.json
channel_strategy.json
audience_fit_report.json
fatigue_report.json
format_rotation.json
```

Any change invalidates the approval hash.
