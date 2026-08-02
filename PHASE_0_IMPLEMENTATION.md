# Phase 0 Implementation Ledger

## Objective

Create a truthful foundation for NicheFoundry without discarding the working episode manifests and local production workers.

The governing rule is:

> No artifact, no completion. No current hash, no approval.

## Implemented workstreams

### 1. Persistent control plane

Implemented in `lib/database.js` using Node 22's SQLite interface.

Tables:

- `settings`
- `episodes`
- `jobs`
- `artifacts`
- `approvals`
- `audit_events`

The database uses WAL mode, foreign keys, a busy timeout, indexes, and JSON payloads for forward-compatible state.

### 2. Restart recovery and legacy migration

On startup the server:

1. scans the configured episodes directory
2. imports any episode containing `episode.json` and `brief.json`
3. discards legacy completion assumptions
4. recalculates artifact evidence
5. restores the selected episode from SQLite

A reset clears the selection only. It does not destroy work.

### 3. Dedicated public boundary

Only files under `public/` can be served.

The following are no longer reachable through static HTTP:

- `.env`
- `server.js`
- `lib/`
- `scripts/`
- `episodes/`
- `data/`
- provider credentials
- local environments

Dotfiles, traversal segments, malformed paths, and files outside the public root are rejected.

### 4. Local security posture

- server binds to `127.0.0.1` by default
- a non-loopback `HOST` requires `FOUNDRY_AUTH_TOKEN`
- loopback browser sessions receive an HTTP-only, SameSite-Strict cookie
- API routes require the session or a valid bearer/header token
- request bodies are limited
- security headers and a restrictive content-security policy are applied

### 5. Artifact evidence engine

Implemented in `lib/evidence.js`.

Evidence recorded per artifact:

- existence
- size
- SHA-256
- kind
- verification result
- verification reasons
- check timestamp

Verifiers:

- JSON parse verifier
- non-empty text verifier
- SRT syntax verifier
- image signature verifier
- FFprobe media verifier

Evidence is persisted to SQLite and `artifact_status.json`.

### 6. Evidence-derived QA

The application no longer mutates delivery booleans to `true` after integration calls.

QA states:

- `blocked_validation_failed`
- `blocked_pending_human_approval`
- `blocked_missing_verified_delivery_artifacts`
- `ready_for_private_upload`

The final state requires:

- deterministic validation passed
- a valid hash-bound approval
- verified `final.mp4`
- verified `captions.srt`
- verified `thumbnail.png`

### 7. Hash-bound approval

Approvals store:

- approval ID
- episode ID
- approval type
- artifact name
- artifact SHA-256
- reviewer
- decision
- notes
- timestamp

Every state refresh recalculates the approved artifact hash. An edit invalidates approval automatically.

### 8. Job ledger

Integration and generation activity is represented as jobs.

Supported statuses:

- `queued`
- `running`
- `blocked_for_review`
- `completed`
- `failed`
- `cancelled`
- `invalidated`

A provider request without verified output remains blocked. The rules job can complete because it points to a verified `episode.json`. YouTube is hard-blocked without the complete delivery set.

### 9. Truthful workflow display

The frontend reads server-provided `stage_statuses` rather than inferring that all future stages complete after approval.

The UI now displays:

- active, pending, blocked, failed, and completed stages
- evidence status and artifact sizes
- persistent episode library
- QA-derived next action
- truthful integration-job outcomes

### 10. Packaging repair

The release no longer requires a bundled `.venv-piper`.

Added:

- `scripts/install_piper.sh`
- `scripts/install_voice_pack.sh`
- `scripts/check_environment.js`
- optional Piper environment variables
- voice-model checksums
- `.gitignore` rules for environments, secrets, databases, and model binaries

The local voice models are packaged separately from source.

## Automated proof

Run:

```bash
npm test
```

The test suite proves:

- unauthenticated API access is rejected
- `.env` and traversal requests return 404
- generated episodes remain blocked without delivery artifacts
- approval is stored and restored
- integration calls cannot fabricate final video, captions, or thumbnail
- YouTube remains blocked
- state survives restart
- changing `episode.json` invalidates approval
- oversized requests receive HTTP 413
- malformed media does not verify
- decodable audio/video media verifies through FFprobe

## Phase 0 exit status

### Passed

- dedicated public static root
- loopback-by-default server
- remote token requirement
- request limit
- safe path resolution
- SQLite state and history
- restart recovery
- legacy episode import
- evidence-backed artifacts
- hash-bound approvals
- job records
- audit events
- false-completion removal
- environment checker
- slim source packaging path
- automated tests

### Explicitly deferred

- real source retrieval and source snapshots
- claim graph and citation spans
- duplicate and safety engine
- robust Gamma asynchronous generation and download
- scene-complete ElevenLabs generation and saved output
- captions and thumbnail generation
- final delivery master renderer
- proper YouTube resumable media upload and OAuth refresh
- team roles and remote login UI

These deferred capabilities are shown as pending or blocked. None are represented as complete.
