# NicheFoundry Phase 3 Implementation

## Niche Intelligence and Opportunity Engine

Phase 3 adds a persistent pre-production intelligence layer. The platform no longer assumes that every manually entered topic deserves research and production. An opportunity must be discovered or declared, scored, checked for studio fit, audited for cannibalisation, assigned to a topic cluster and portfolio role, and deliberately promoted into the production brief.

The governing rule is:

> No hidden signal provenance. No silent topic duplication. No promoted opportunity without an immutable decision record.

## Implemented capabilities

### Persistent opportunity ledger

SQLite now stores:

- opportunity candidates
- lifecycle state
- transparent opportunity scores
- content roles
- cluster membership
- series plans
- editorial calendars
- audit events for scoring and lifecycle transitions

Opportunity lifecycle:

```text
discovered
→ screened
→ researched
→ approved
→ scheduled
→ produced
→ published
→ measured
→ expanded

side exits: rejected, retired
```

Invalid multi-stage jumps are rejected. Terminal records must be restored to `discovered` before returning to the active pipeline.

### Discovery adapters

Phase 3 includes three discovery modes:

1. **Studio Pack seeds**
   - Pack-authored sample briefs
   - Pack-authored topic examples
   - Native fit validation

2. **Manual candidate packets**
   - Structured JSON candidate arrays
   - Optional operator/provider signals
   - Optional competitor evidence
   - Source hints and series intent

3. **MediaWiki search**
   - Search-result titles and snippets
   - Word-count-derived evidence-availability proxy
   - Explicitly not treated as YouTube demand or trend evidence

### Transparent opportunity scoring

The positive benefit index uses:

| Signal | Weight |
|---|---:|
| Audience demand | 0.18 |
| Content gap | 0.16 |
| Studio authority fit | 0.18 |
| Series potential | 0.12 |
| Visual potential | 0.10 |
| Monetisation alignment | 0.09 |
| Evidence availability | 0.17 |

The risk index uses:

| Risk | Weight |
|---|---:|
| Production burden | 0.42 |
| Policy risk | 0.38 |
| Freshness risk | 0.20 |

Final score:

```text
benefit = weighted positive signals
risk = weighted risk signals
opportunity score = round(100 × benefit × (1 - 0.38 × risk))
```

Decision bands:

```text
72–100  prioritize
58–71   develop
43–57   watch
0–42    reject_low_value
```

A failed Studio Pack fit always becomes `reject_fit`, regardless of the numerical opportunity score.

### Signal provenance

Every signal is labelled as one of:

- `operator_or_provider_signal`
- `studio_pack_fit_engine`
- `documented_proxy_heuristic`

The UI and API state explicitly that proxy heuristics are not live demand measurements. The system never describes MediaWiki interest, word count, or internal heuristics as YouTube search volume.

### Competitor and content-gap evidence

Candidates can include:

```json
{
  "competitor_count": 4,
  "competitor_examples": [
    "Competitor title and channel or URL reference"
  ]
}
```

The analysis view reports:

- supplied competitor evidence
- content-gap score
- score provenance
- evidence coverage
- opportunities still relying on proxy gap estimates

### Cannibalisation protection

Each candidate is compared with:

- persisted opportunities in the same studio
- other candidates in the discovery batch
- previously generated episodes in the same studio

Similarity thresholds:

```text
0.48  warning
0.68  blocking overlap
```

Retired and rejected records do not create an active blocking match.

### Topic clustering

The engine groups opportunities using specialist token overlap and names clusters from their dominant terms. Every opportunity receives a persistent cluster ID. Clusters support:

- topic-map inspection
- series planning
- repetition warnings
- calendar diversification

### Portfolio roles

Every opportunity is assigned one role:

- `core_pillar`
- `search_evergreen`
- `experimental`
- `audience_request`
- `commercial_intent`

Default portfolio targets:

| Role | Target |
|---|---:|
| Core pillar | 50% |
| Search evergreen | 20% |
| Experimental | 15% |
| Audience request | 10% |
| Commercial intent | 5% |

The report marks each role as balanced, underrepresented, or overrepresented. These are planning defaults, not publishing quotas.

### Series planner

The planner converts topic clusters into durable series architectures containing:

- series ID
- series promise
- lead opportunity
- ordered opportunity membership
- recommended archetypes
- mean opportunity score
- portfolio report

Series plans are stored in SQLite and available through the API.

### Editorial calendar

The calendar builder accepts:

- start date
- number of weeks
- slots per week

It prioritises high-scoring eligible opportunities while penalising immediate reuse of the same cluster. Calendar entries include:

- proposed publish date
- opportunity ID
- cluster ID
- content role
- opportunity score
- selection rationale

It does not autonomously publish or change YouTube schedules.

### Production handoff

Selecting **Load Brief** creates a production brief containing the opportunity ID. When the episode is generated, Phase 3 writes:

```text
opportunity_snapshot.json
opportunity_report.json
```

These files are added to the approval bundle. The opportunity report includes:

- score
- decision
- signal values
- signal provenance
- scoring weights
- studio fit
- cannibalisation report
- portfolio role
- cluster
- lifecycle state

Editing either file after approval invalidates the approval hash.

Manual briefs remain supported. They receive an explicit manual-brief declaration instead of a fabricated score.

### Upgrade compatibility

Episodes created before Phase 3 receive:

- a `legacy_manual_brief` opportunity snapshot
- an explicit note that no historical market score exists
- new opportunity evidence files

They must be regenerated for a fully scored Phase 3 decision. Existing approvals are not silently carried across the changed approval bundle.

## API surface

```text
GET  /api/opportunities
POST /api/opportunities/score
POST /api/opportunities/discover
POST /api/opportunities/lifecycle
POST /api/opportunities/brief
GET  /api/opportunities/analysis
POST /api/opportunities/series-plan
GET  /api/series-plans
POST /api/opportunities/calendar
GET  /api/editorial-calendars
```

## Verification

Phase 3 automated tests cover:

- transparent score calculation
- off-niche rejection
- proxy provenance labelling
- cannibalisation blocking
- Studio Pack seed discovery
- mocked MediaWiki discovery
- cluster separation
- portfolio reporting
- series planning
- diversified editorial sequencing
- lifecycle transition validation
- SQLite persistence
- production-brief handoff
- dashboard DOM integrity
- all Phase 0, Phase 1, and Phase 2 regressions

A cold HTTP run additionally verifies:

- authenticated discovery
- opportunity persistence
- brief promotion
- episode generation
- opportunity evidence files
- approval-bundle inclusion
- series-plan persistence
- calendar persistence

## Honest Phase 3 boundary

Phase 3 does **not** yet provide live YouTube demand, search volume, audience analytics, competitor channel ingestion, RSS trend monitoring, or owned-channel performance signals.

Until those connectors are added, the following remain labelled proxies unless supplied by an operator or provider:

- audience demand
- content gap
- production burden
- policy risk
- freshness risk
- monetisation alignment

Phase 3 is therefore a truthful opportunity operating layer, not a clairvoyant trend oracle.
