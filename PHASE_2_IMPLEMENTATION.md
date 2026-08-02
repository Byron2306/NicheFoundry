# Phase 2 Implementation Ledger

## Objective

Implement the Niche Studio Pack system and instantiate the agreed pilot studios so the platform can govern different verticals through executable domain rules rather than prompt decoration.

## Implemented workstreams

### 1. Studio Pack registry

`lib/studios.js` implements:

- built-in and custom pack loading
- schema validation
- deterministic canonical JSON hashing
- duplicate Studio ID prevention
- built-in replacement protection
- custom pack installation with owner-only file permissions
- SQLite synchronisation

Installed pack metadata includes:

- studio ID
- name
- semantic version
- source: built-in or custom
- immutable content hash
- installation and update timestamps

### 2. Niche-depth validation

Every pack receives a 100-point depth assessment across:

1. domain specificity
2. audience clarity
3. editorial promise
4. fit discrimination
5. research rigour
6. format depth
7. visual distinctiveness
8. voice definition
9. risk governance
10. commercial fit
11. measurement quality
12. operational readiness

A pack fails when its score is below 70 or its domain is merely a broad category such as `history`, `science`, `technology`, or `facts`.

Current built-in scores:

- Failure Atlas: 96/100
- History Under Glass: 96/100
- Practical Open Source: 96/100
- Puzzle Planet: 93/100

### 3. Topic-fit engine

A brief is compared with the selected pack using:

- positive niche keywords
- negative or incompatible keywords
- concrete topic examples
- non-generic domain terms
- pack-specific fit threshold

Generation stops with HTTP 422 when the selected studio does not fit the brief.

The fit report records:

- score
- threshold
- pass/fail
- matched keywords
- matched examples
- matched domain terms
- negative matches
- human-readable explanation

### 4. Archetype registry

Each pack supplies multiple named content archetypes. Every archetype defines:

- ID and title
- description
- required story beats
- allowed hook types
- allowed output formats

The selected archetype is validated against the pack before research begins.

### 5. Claim-to-story mapping

`buildStudioBlueprint()` ranks available claims and assigns them across the archetype's required story beats.

Each story beat records:

- stable beat ID
- order
- beat name
- editorial purpose
- supporting claim IDs
- supporting source IDs

The mapping is currently a deterministic evidence distribution, not a finished narrative script.

### 6. Research policy audit

Every pack defines:

- minimum independent sources
- primary-source requirement
- enforcement stage
- preferred source tiers
- disallowed source classes
- conflict policy
- optional freshness window

Phase 2 enforces minimum source count. Missing primary sources and single-provider dependence remain explicit provisional warnings because automated specialist connectors have not yet been implemented.

### 7. Pilot Studio Packs

#### Failure Atlas

Four archetypes:

- failure chain
- mechanism explainer
- redesign scenario
- timeline reconstruction

Distinctive governance includes technical causality, victim dignity, attribution evidence, restrained reconstructions, and design lessons.

#### History Under Glass

Four archetypes:

- object biography
- historical case file
- map journey
- myth audit

Distinctive governance includes primary/secondary source separation, provenance, contested interpretation, anachronism checks, and disclosure of synthetic archival treatment.

#### Practical Open Source

Four archetypes:

- guided tutorial
- tool comparison
- problem and fix
- update briefing

Distinctive governance includes declared environments, versions, reproducible commands, validation output, secret redaction, licence checks, and stale-instruction warnings.

#### Puzzle Planet compatibility pack

Two archetypes:

- adventure quiz
- story-led learning

This preserves the working Phase 1 pipeline and allows old dinosaur episodes to migrate without being misclassified as engineering or software content.

### 8. Immutable episode constitution

Every new episode writes:

- `studio_pack_snapshot.json`
- `studio_fit_report.json`
- `studio_blueprint.json`

The snapshot includes the full pack, content hash, and snapshot timestamp. The episode itself records the studio ID, version, archetype, story map, channel promise, and production mode.

### 9. Approval expansion

The deterministic approval bundle now includes the Studio Pack snapshot, fit report, and blueprint.

Changing any of the following invalidates approval:

- brief
- Studio Pack snapshot
- fit report
- blueprint or story map
- sources
- claims
- research report
- duplicate report
- episode
- verification

### 10. Persistent Studio Pack database

Phase 2 adds `studio_packs` to SQLite with:

- studio ID
- name
- version
- source
- content hash
- full JSON constitution
- installed timestamp
- updated timestamp

The filesystem remains the executable pack source; SQLite supplies a persistent registry and audit record.

### 11. Studio APIs

Implemented:

- `GET /api/studios`
- `GET /api/studios/<id>`
- `POST /api/studios/fit`
- `POST /api/studios/validate`
- `POST /api/studios/install`

Pack installation emits an audit event with the Studio ID, version, and content hash.

### 12. Studio-aware console

The Phase 2 console adds:

- Studio selector
- archetype selector
- selected constitution profile
- installed Studio Registry
- native sample loader
- pre-generation fit checker
- Studio Blueprint panel
- Studio Fit panel
- pack-specific approval checklist
- Pack Lab JSON editor
- custom pack validation
- custom pack installation

### 13. Legacy migration

On first import, pre-Phase-2 episodes receive:

- Puzzle Planet Studio ID
- default adventure archetype
- Studio Pack snapshot
- fit report
- Studio Blueprint
- Studio policy verification entry

Old completion flags remain untrusted.

### 14. Truthful phase boundary

For specialist non-trivia studios, Phase 2 does not pretend to have completed full narrative generation or studio-specific rendering.

The blueprint records:

- studio governance: active
- topic-fit enforcement: active
- claim-to-story map: active
- full archetype script generation: planned Phase 6
- archetype-specific renderer: planned Phase 9
- legacy claim-question scaffold: active for pipeline compatibility

This prevents the new studio layer from becoming another optimistic status costume.

## Automated proof

Run:

```bash
npm test
npm run check:studios
```

The combined suite currently contains nine passing tests covering all previous trust and research protections plus Phase 2 pack governance.

## Explicitly deferred

- automatic official-report, museum, academic, standards, and software-documentation connectors
- expert reviewer routing
- full archetype-specific narrative generation
- studio-specific scene and visual generation
- semantic topic-fit embeddings
- studio version upgrade and migration workflow
- custom pack deletion and rollback UI
- team permissions around pack installation
- portfolio analytics across studios
- final multimedia and publishing integrations
