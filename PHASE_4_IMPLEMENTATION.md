# Phase 4 Implementation: Connector Evidence and Research Governance

## Objective

Phase 4 turns the Phase 1 source list into a governed multi-connector research system. It adds explicit source hierarchies, publisher/domain independence, freshness enforcement, cross-source support and conflict analysis, and a guarded connector runtime.

## Governing laws

> Market signals do not become factual evidence.

> A connector run is evidence only after its provenance, trust ceiling, and output are recorded.

> A specialist studio may require more authoritative evidence than a connector can provide.

> Conflicting claims block automatic editorial readiness.

## Built-in connectors

| Connector | Capabilities | Default tier | Primary capable |
|---|---|---:|---|
| MediaWiki Research | research sources, discovery | 3 | No |
| Curated Evidence Packet | research sources | 2 | Yes, when record metadata supports it |
| RSS and Atom Monitor | discovery, research leads | 3 | No |
| Allowlisted Web Document | research sources | 2 | Yes |
| GitHub Release Intelligence | research, freshness, discovery | 1 | Yes |
| YouTube Public Discovery | discovery, competitor evidence, market signals | 4 | No |
| YouTube Owned-Channel Analytics | owned analytics, market signals, learning loop | 4 | No |

## Connector runtime

`lib/connectors.js` provides:

- declarative connector validation
- built-in and custom registries
- capability checks
- environment-variable authentication status
- secret redaction
- bounded retries and timeouts
- response-size limits
- HTTPS and hostname allowlisting
- private-network and DNS rebinding protection
- adapter execution
- normalised run output
- SQLite persistence
- research-plan orchestration

Custom connector definitions configure only approved adapter types. They cannot introduce arbitrary executable code.

## Research governance

`lib/research_governance.js` produces four approval-bound evidence objects.

### Source hierarchy

Checks:

- source-tier validity
- claim-eligible source count
- Studio Pack minimum source count
- publisher/domain independence
- primary-source requirements
- source-type distribution

### Freshness report

Checks the best available publication, revision, or retrieval date against the Studio Pack `freshness_days` policy.

Possible states:

- `fresh`
- `stale`
- `undated`
- `not_enforced`

A version-sensitive Practical Open Source episode is blocked when its only evidence is stale. Evergreen historical material may use a null freshness limit while still recording dates.

### Claim conflict graph

Compares claims from different sources and creates:

- support edges
- conflict edges
- corroboration clusters
- disputed claim states
- human-resolution requirements

Phase 4 detects strong semantic agreement, different numeric assertions, opposite negation, and opposing claim language. This is a conservative editorial warning system, not a universal theorem prover.

### Combined governance report

`research_governance.json` passes only when:

- source hierarchy passes
- freshness passes
- no unresolved conflict edges remain

Claims are reclassified as:

- `supported`
- `weakly_supported`
- `disputed`
- `outdated`

Only supported and weakly supported claims may continue into the compatibility content generator. Disputed and outdated claims remain visible for human review.

## Approval-bound artifacts

Phase 4 adds:

```text
connector_plan.json
connector_runs.json
research_governance.json
source_hierarchy.json
freshness_report.json
claim_conflict_graph.json
```

These join the opportunity, studio, brief, source, claim, episode, duplicate, and verification artifacts in the deterministic editorial bundle. A change to connector provenance, source status, freshness, or conflict resolution invalidates approval.

## SQLite additions

### `connector_definitions`

Stores installed connector metadata, version, adapter, source, content hash, and declarative definition.

### `connector_runs`

Stores redacted input, complete normalised output, status, errors, capability, episode/studio links, and timestamps.

## Dashboard additions

The Phase 4 console adds:

- installed connector registry
- authentication configuration status
- guarded connector test and run controls
- connector input editor
- persisted connector run history
- custom connector definition builder
- discovery-connector selection
- brief-level connector plan fields
- source hierarchy view
- freshness view
- conflict graph view

## Production boundary

Phase 4 does not claim that every specialist studio now has every ideal source connector.

It provides a safe framework and seven useful adapters. Domain packs still need curated allowlists and connector definitions for sources such as:

- government accident investigation repositories
- museum and archive collection APIs
- standards bodies
- academic databases with lawful access
- software documentation and project release feeds
- owned-channel platform analytics

The framework blocks a specialist packet when its source policy is not satisfied instead of quietly lowering the standard.

## Verification

Run:

```bash
npm test
npm run verify:phase4
npm run check:connectors
npm run check:environment
```

Phase 4 tests cover:

- connector definition validation
- adapter allowlisting
- secret redaction
- RSS and Atom parsing
- discovery lead versus claim evidence separation
- SSRF and private-network blocking
- YouTube public discovery normalisation
- YouTube OAuth refresh and analytics normalisation
- GitHub release evidence
- source independence
- primary-source requirements
- freshness enforcement
- numeric contradiction detection
- disputed claim status
- SQLite run persistence
- dashboard DOM integrity
- all Phase 0 to Phase 3 regressions
