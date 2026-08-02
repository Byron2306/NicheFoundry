# Phase 10 Implementation Ledger

## Human Editorial Cockpit

Phase 10 adds a role-based, hash-bound editorial control plane above the existing research, story, visual, audio, and render systems.

## Implemented capabilities

### Specialist review roles

- Researcher
- Fact Checker
- Writer / Script Editor
- Visual Editor
- Audio Editor
- Channel Owner
- Publisher

### Review workflows

Eight review tasks are generated from the current episode artifacts. Seven are mandatory, while the researcher intake task is advisory and non-blocking:

1. Source intake and research packet *(advisory researcher task)*
2. Research and factual integrity *(mandatory independent fact-check)*
3. Narrative and script edit
4. Visual identity, rights, and storyboard
5. Host, pronunciation, and performance plan
6. Mastered audio performance
7. Finished programme watch-through
8. Release and compliance sign-off

Each task stores a deterministic artifact-bundle hash. If any included artifact changes, an approved task returns to `ready` or `blocked` and must be reviewed again.

### Persistent review ledger

SQLite now stores:

- review tasks
- assignments
- scene and timeline comments
- review decisions
- immutable version snapshots
- final sign-offs

### Scene and timeline comments

Comments can be bound to:

- a review task
- a scene ID
- a timeline position in seconds
- an artifact name and its current hash

Severity can be `note`, `suggestion`, or `blocker`. Open blockers prevent task, stage, and final approval.

### Version snapshots

The cockpit can capture a complete hash manifest of reviewable artifacts. Two snapshots can be compared to report exact added, removed, changed, and unchanged files.

### Dependency graph

The dependency map tracks:

```text
editorial review and approval
        ↓
audio review and approval
        ↓
render review and approval
        ↓
release compliance and final sign-off
```

### Final sign-off

Private-upload readiness now requires:

- current editorial approval
- current audio approval
- current render approval
- every required review task approved
- no unresolved blocking comments
- verified `final.mp4`
- verified `captions.srt`
- verified `thumbnail.png`
- current final sign-off bundle

The final sign-off bundle records all task hashes, approval hashes, and delivery file hashes. Any later drift invalidates it.

## New episode artifacts

```text
editorial_review_manifest.json
review_dependency_map.json
review_snapshot.json
final_signoff_bundle.json
editorial_audit_export.md
```

## New APIs

```text
GET  /api/editorial-cockpit
POST /api/editorial-cockpit/bootstrap
POST /api/editorial-cockpit/assign
POST /api/editorial-cockpit/comment
POST /api/editorial-cockpit/comment/resolve
POST /api/editorial-cockpit/decision
POST /api/editorial-cockpit/snapshot
GET  /api/editorial-cockpit/compare
POST /api/editorial-cockpit/final-signoff
GET  /api/editorial-cockpit/export
```

## Backward compatibility

Existing editorial, audio, and render approval buttons remain functional. When used, they also approve the corresponding ready Phase 10 review tasks under the same reviewer identity. This preserves prior workflows while adding a complete review ledger.

## Verification

Phase 10 adds tests for:

- role and workflow definitions
- artifact-hash drift invalidation
- SQLite persistence
- assignments
- comments and blockers
- review decisions
- snapshot comparison
- dependency mapping
- final sign-off binding
- dashboard DOM integrity
- server route exposure
