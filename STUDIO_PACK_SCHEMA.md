# Studio Pack Schema 1.0

A Studio Pack is a versioned JSON constitution for one narrowly defined media studio.

## Required root sections

```text
schema_version
studio
audience
promise
fit
research
content
visuals
voice
compliance
monetization
metrics
```

## Minimal shape

```json
{
  "schema_version": "1.0",
  "studio": {
    "id": "bounded_studio_id",
    "name": "Bounded Studio",
    "version": "1.0.0",
    "tagline": "A clear specialist promise.",
    "domain": "a narrowly bounded subject and transformation",
    "description": "What the studio consistently investigates or helps viewers accomplish."
  },
  "audience": {
    "primary_age": "18-44",
    "knowledge_level": "curious non-specialist",
    "motivations": ["motivation"],
    "viewer_jobs": ["teach me a bounded thing"],
    "vocabulary": "language policy"
  },
  "promise": {
    "statement": "The reliable transformation each episode delivers.",
    "required": ["required editorial behaviour"],
    "prohibited": ["forbidden editorial behaviour"]
  },
  "fit": {
    "keywords": ["at least five discriminating terms"],
    "negative_keywords": ["incompatible subjects"],
    "topic_examples": ["at least three concrete topics"],
    "minimum_score": 0.22
  },
  "research": {
    "minimum_independent_sources": 2,
    "primary_source_required": true,
    "enforcement_stage": "pre_production",
    "preferred_source_tiers": {
      "tier_1": ["primary evidence"],
      "tier_2": ["expert secondary evidence"]
    },
    "disallowed_sources": ["unreliable source class"],
    "conflict_policy": "How disagreement and uncertainty are represented.",
    "freshness_days": null
  },
  "content": {
    "default_archetype": "case_file",
    "archetypes": [
      {
        "id": "case_file",
        "name": "Case File",
        "description": "A bounded evidence-led investigation.",
        "required_story_beats": ["question", "context", "evidence_one", "evidence_two"],
        "hook_types": ["unanswered question"],
        "allowed_outputs": ["long_form", "short"]
      },
      {
        "id": "mechanism_explainer",
        "name": "Mechanism Explainer",
        "description": "A second materially different format.",
        "required_story_beats": ["mystery", "components", "process", "application"],
        "hook_types": ["surprising mechanism"],
        "allowed_outputs": ["long_form"]
      }
    ]
  },
  "visuals": {
    "language": ["distinctive visual rule"],
    "forbidden": ["visual anti-pattern"],
    "motion_rules": ["motion rule"],
    "palette": ["palette token"]
  },
  "voice": {
    "tone": "defined voice",
    "pacing": "defined pacing",
    "pronunciation_domains": ["specialist terminology"],
    "forbidden_traits": ["voice anti-pattern"]
  },
  "compliance": {
    "risk_level": "medium",
    "human_fact_review": true,
    "synthetic_reconstruction_disclosure": "disclosure rule",
    "upload_default": "private",
    "required_checks": ["studio-specific check"]
  },
  "monetization": {
    "paths": ["ethical commercial path"],
    "prohibited_relationships": ["commercial conflict"],
    "trust_rules": ["editorial independence rule"]
  },
  "metrics": {
    "primary": ["success metric"],
    "guardrails": ["quality or harm guardrail"]
  },
  "samples": []
}
```

## Validation rules

- Studio IDs use lowercase letters, numbers, and underscores.
- Versions use semantic versioning.
- Domains cannot be merely broad categories.
- Packs need at least five fit keywords and three concrete topic examples.
- At least two content archetypes are required.
- Each archetype needs at least four story beats.
- Source policy needs at least two tiers.
- Compliance, monetisation trust rules, primary metrics, and guardrails are mandatory.
- Niche-depth score must reach 70/100.
- Built-in Studio IDs cannot be replaced by custom installations.

Use the console Pack Lab or:

```text
POST /api/studios/validate
```

before installation.

## Phase 5 audience and channel-strategy extension

Studio Pack Schema 1.0 remains backward compatible. Phase 5 adds optional, validated fields under `audience` and a new optional root section named `channel_strategy`.

Recommended additions:

```text
audience.personas
audience.frustrations
audience.viewing_context
audience.desired_reward
audience.likely_next_action
channel_strategy.minimum_audience_fit_score
channel_strategy.promise_tests
channel_strategy.content_pillars
channel_strategy.portfolio_targets
channel_strategy.format_rotation
```

See `AUDIENCE_STRATEGY_SCHEMA.md` for the complete shape and validation rules.
