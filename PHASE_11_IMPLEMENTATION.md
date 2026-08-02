# Phase 11 Implementation Ledger

## Publishing and Compliance

Phase 11 turns the signed-off local delivery package into a controlled YouTube release workflow. It preserves the core NicheFoundry rule that local readiness, network transfer, platform processing, remote asset attachment, and release status are separate facts with separate evidence.

## Implemented architecture

### Local preflight

`lib/publishing_system.js` builds three immutable local artifacts:

- `metadata_package.json`
- `compliance_report.json`
- `publishing_package.json`

The package contains the reviewed YouTube snippet, audience declaration, synthetic-media declaration, paid-placement declaration, initial private status, optional future publication time, caption settings, and hashes for `final.mp4`, `captions.srt`, and `thumbnail.png`.

A publishing preflight requires current human render approval and passing render QA. It does not require final sign-off yet because the publisher must review the metadata and compliance artifacts before final sign-off can be recorded.

### Editorial dependency correction

The Phase 10 `release_compliance` task now reviews:

- editorial, audio, and render approval bundles
- final delivery media
- publishing metadata
- local compliance report
- publishing package

Final sign-off therefore depends on the exact package that will be uploaded. Rebuilding metadata or changing a delivery artifact invalidates the publisher task and final sign-off.

### OAuth and secret handling

The runtime accepts either:

- `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, and `YOUTUBE_REFRESH_TOKEN`; or
- a short-lived `YOUTUBE_ACCESS_TOKEN` for controlled testing

Refresh tokens and resumable session URLs never appear in browser responses. The database retains the resumable session URL for recovery, while API and event responses expose only its SHA-256 hash.

### Resumable media transfer

The YouTube upload path:

1. creates a resumable `videos.insert` session;
2. records the session in SQLite;
3. sends bounded MP4 chunks with `Content-Range`;
4. records byte progress after every accepted chunk;
5. queries the remote offset when resuming;
6. persists the returned YouTube video ID;
7. writes a redacted `youtube_upload_receipt.json`.

The default chunk size is 8 MiB and is configurable between 256 KiB and 32 MiB.

### Processing and remote assets

After transfer, the system separately:

- polls `videos.list` for processing state;
- records failure and rejection reasons;
- uploads the approved PNG thumbnail;
- uploads the approved SRT caption track;
- records caption and thumbnail receipts;
- retrieves the remote video resource again;
- compares title, category, privacy, audience, synthetic-media, paid-placement, and processing state with the reviewed metadata.

### Scheduling

Scheduling is allowed only when:

- the private upload is remotely verified;
- captions and thumbnail are attached;
- `publishAt` already exists in the reviewed metadata package;
- the requested timestamp exactly matches that package;
- the operator types `SCHEDULE VERIFIED VIDEO`.

The update request preserves `privacyStatus=private` while attaching the future publication time.

## Persistence

Phase 11 adds:

- `publishing_packages`
- `publishing_events`
- `youtube_upload_sessions`

The event ledger stores action, status, provider, timestamp, and redacted details. Upload sessions preserve progress across restarts.

## New evidence artifacts

```text
publishing_package.json
metadata_package.json
compliance_report.json
youtube_upload_receipt.json
youtube_processing_report.json
youtube_asset_uploads.json
publishing_verification.json
release_approval_bundle.json
```

## New API routes

```text
GET  /api/publishing-system
GET  /api/publishing-packages
POST /api/publishing-system/preflight
POST /api/publishing-system/upload
POST /api/publishing-system/poll
POST /api/publishing-system/assets
POST /api/publishing-system/verify
POST /api/publishing-system/schedule
```

## New stages

```text
Publishing metadata and compliance preflight
Final editorial sign-off
Private resumable YouTube upload
YouTube processing, captions, and thumbnail
Remote publication verification
Controlled schedule or private release
```

## Compatibility

The older `youtube` integration job remains as a non-executing compatibility alias for Phase 0-10 state consumers. New work is recorded under precise job types such as `youtube_preflight`, `youtube_upload`, `youtube_processing`, `youtube_assets`, `youtube_verify`, and `youtube_schedule`.

## Test coverage

Phase 11 adds eight tests covering:

- metadata and compliance validation
- publisher review dependencies
- OAuth refresh and redaction
- byte-range resumable upload
- processing polling
- thumbnail and caption attachment
- remote metadata verification
- exact reviewed scheduling
- SQLite persistence
- cockpit DOM and server routes

The complete inherited suite contains 78 passing tests.

## Honest boundary

No live YouTube upload was performed in the release environment because private Google OAuth credentials were not supplied. The HTTP protocol is implemented and verified with deterministic mocked official responses. The operator must configure credentials, complete OAuth consent, and perform the first private upload from their own Google Cloud and YouTube account.
