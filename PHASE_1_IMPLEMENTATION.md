# Phase 1 Implementation Ledger

## Objective

Replace placeholder grounding and workflow trivia with a real research-to-claim-to-content pipeline while preserving the Phase 0 security, persistence, evidence, and approval foundations.

## Implemented workstreams

### 1. Revisioned source retrieval

`lib/research.js` uses the MediaWiki Action API to retrieve plain-text page content and metadata.

Stored fields include:

- stable source ID
- original query
- resolved title
- canonical URL
- publisher and provider
- source tier
- licence
- retrieval timestamp
- revision ID and parent revision ID
- revision timestamp and revision SHA-1
- local SHA-256 content hash
- bounded source extract
- retrieval status

Direct title lookup falls back to MediaWiki search. Requests use timeouts, bounded retries, exponential backoff, and `Retry-After` support.

### 2. Source snapshots

Every generated episode writes:

- `sources.json`
- `research_report.json`
- one immutable JSON snapshot per source under `source_snapshots/`

The research report records source and claim coverage, retrieval errors, revision metadata, content hashes, and pass/fail status.

### 3. Atomic claim ledger

`lib/claims.js` converts source extracts into atomic supported claims.

Each claim records:

- stable claim ID
- source ID, title, and URL
- resolved subject
- claim text
- exact supporting passage
- passage offsets
- claim type
- confidence score
- support status
- source revision ID
- source content hash

Meta-production sentences and low-information fragments are rejected.

### 4. Persistent research database

Phase 1 adds SQLite tables:

- `sources`
- `claims`

Research replacement occurs inside a transaction. The `/api/research` endpoint reads the canonical source and claim rows from SQLite.

### 5. Claim-bound generation

`lib/generator.js` provides two modes.

#### Deterministic mode

- selects high-confidence claims with source and type diversity
- produces source-backed questions
- creates distinct options
- rotates correct-answer positions deterministically
- binds every question to one claim and source
- stores exact citation spans

#### Optional Ollama mode

- submits a bounded claim set
- requires a JSON-schema structured response
- uses temperature zero
- validates returned claim IDs
- sends every result through the independent critic
- falls back to deterministic generation unless strict mode is enabled

### 6. Independent editorial critic

`lib/quality.js` evaluates:

- question count and structure
- normalised option uniqueness
- correct-answer index alignment
- atomic claim and source binding
- citation-span presence
- forbidden workflow/meta content
- topic relevance
- answer-to-claim support overlap
- near-duplicate and ambiguous options
- age-band stem and option length
- advanced-vocabulary warnings
- correct-answer length leakage

The critic is separate from the generator and can block generated output.

### 7. Duplicate and safety audit

The duplicate engine compares complete knowledge units rather than only generic stems:

```text
question + answer + explanation
```

It checks:

- duplicates inside the current episode
- near-duplicates against persisted episodes
- forbidden workflow and production-oriented content

Blocking findings are written to `duplicate_report.json` and `verification.json`.

### 8. Editorial approval bundle

Phase 1 replaces approval of one file with a deterministic bundle containing SHA-256 hashes for:

- `brief.json`
- `sources.json`
- `claims.json`
- `research_report.json`
- `duplicate_report.json`
- `episode.json`
- `verification.json`

The bundle has no volatile timestamp, so identical evidence produces the same hash.

Any post-generation edit changes `approval_bundle.json`, invalidates an existing approval, marks editorial evidence stale, changes QA to `blocked_validation_failed`, and blocks reapproval until regeneration.

### 9. Evidence verification

`lib/evidence.js` now validates source and claim ledgers beyond simple JSON parsing.

A source packet requires:

- at least one source
- source ID
- title and URL
- content hash
- retrieval timestamp
- non-trivial extract

A claim ledger requires:

- at least one claim
- claim and source IDs
- claim text
- supporting passage
- supported status
- positive confidence

QA now requires structural validation, editorial audit, duplicate/safety audit, and current editorial evidence.

### 10. Research-aware UI

The console now displays:

- research status
- source revision and hash ledger
- atomic claims
- independent critic output
- duplicate and safety results
- approval-bundle evidence

The approval button remains disabled until all research and editorial gates pass.

### 11. Truthful episode-build jobs

The episode-build job is created before retrieval begins. Research failures are therefore recorded as failed jobs rather than disappearing before a job exists.

Successful jobs record:

- episode ID
- source count
- claim count
- verification status
- editorial-bundle evidence reference

## Automated proof

Run:

```bash
npm test
```

The suite covers:

- Phase 0 trust and security regression tests
- MediaWiki response parsing and revision metadata
- source hashing
- claim extraction and coverage
- claim-bound question generation
- citation-span presence
- critic acceptance of valid content
- meta/workflow rejection
- library duplicate rejection
- source and claim artifact verification
- approval invalidation after evidence drift
- rejection of stale reapproval

## Phase 1 exit status

### Passed

- real source retrieval implementation
- revisioned source snapshots
- content hashes
- atomic claim graph
- SQLite source and claim ledgers
- claim-bound deterministic generation
- optional Ollama structured generation
- independent editorial critic
- meta-question ban
- topic relevance audit
- ambiguity and readability audit
- library duplicate detection
- deterministic editorial approval bundle
- evidence-drift invalidation
- research UI and API
- regression and Phase 1 tests

### Explicitly deferred

- full Niche Studio Pack schema and domain policies
- domain-specific source-tier enforcement
- scholarly DOI and government-document connectors
- expert-review routing for high-risk niches
- semantic embeddings beyond token-based similarity
- complete Gamma export polling and asset ingestion
- scene-complete ElevenLabs output verification
- final captions and thumbnail production
- final-master renderer
- resumable YouTube media upload, OAuth refresh, caption upload, and thumbnail upload
- analytics learning loop
