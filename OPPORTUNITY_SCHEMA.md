# NicheFoundry Opportunity Schema 1.0

## Minimal candidate

```json
{
  "title": "The Walkway Connection That Failed Under Load",
  "topic": "Hyatt Regency walkway connection failure",
  "angle": "Trace the load-path change, collapse chain, investigation, and design lesson."
}
```

## Grounded candidate

```json
{
  "title": "The Walkway Connection That Failed Under Load",
  "topic": "Hyatt Regency walkway structural connection failure and load-path redesign",
  "angle": "Trace the original load path, connection change, collapse chain, investigation, and transferable lesson.",
  "viewer_job": "teach me how a failure unfolded",
  "source_hints": [
    "Hyatt Regency walkway collapse",
    "NBS Building Science Series 143"
  ],
  "competitor_count": 4,
  "competitor_examples": [
    "Competitor title and channel or URL reference"
  ],
  "series_hint": "Small connection changes with large structural consequences",
  "content_role": "core_pillar",
  "signals": {
    "audience_demand": 0.72,
    "content_gap": 0.68,
    "series_potential": 0.82,
    "visual_potential": 0.90,
    "monetization_alignment": 0.55,
    "evidence_availability": 0.92,
    "production_burden": 0.48,
    "policy_risk": 0.40,
    "freshness_risk": 0.08
  },
  "operator_notes": "Demand estimate derived from an owned search export dated 2026-07-31."
}
```

## Signal scale

All numerical signals use a closed range from `0.0` to `1.0`.

For positive signals:

```text
0.0 = extremely weak
1.0 = extremely strong
```

For burden and risk signals:

```text
0.0 = minimal burden or risk
1.0 = extreme burden or risk
```

Missing values are allowed. The engine substitutes a documented heuristic and labels the provenance as `documented_proxy_heuristic`.

## Content roles

```text
core_pillar
search_evergreen
experimental
audience_request
commercial_intent
```

## Lifecycle

```text
discovered
screened
researched
approved
scheduled
produced
published
measured
expanded
retired
rejected
```

## Generated fields

The engine adds:

- `opportunity_id`
- `studio_id`
- `content_hash`
- `fit`
- `opportunity_score`
- `score_confidence`
- `decision`
- `benefit_index`
- `risk_index`
- `normalized_signals`
- `signal_provenance`
- `scoring_weights`
- `score_explanation`
- `cannibalization`
- `cluster_id`
- `discovered_at`
- `updated_at`
