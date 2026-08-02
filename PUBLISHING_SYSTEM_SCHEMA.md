# NicheFoundry Publishing System Schema 1.0

## Purpose

The Publishing System Schema separates local release intent from remote platform state.

## `metadata_package.json`

```json
{
  "schema": "nichefoundry.youtube_metadata.v1",
  "episode_id": "episode_id",
  "snippet": {
    "title": "Title",
    "description": "Description and source list",
    "tags": ["tag"],
    "categoryId": "27",
    "defaultLanguage": "en"
  },
  "status": {
    "privacyStatus": "private",
    "selfDeclaredMadeForKids": false,
    "containsSyntheticMedia": true,
    "embeddable": true,
    "publicStatsViewable": true,
    "license": "youtube",
    "publishAt": "optional future ISO-8601 timestamp"
  },
  "paidProductPlacementDetails": {
    "hasPaidProductPlacement": false
  },
  "upload": {
    "notifySubscribers": false,
    "captionLanguage": "en",
    "captionName": "English",
    "captionIsDraft": false
  },
  "disclosures": {
    "affiliate": null,
    "sponsorship": null,
    "sensitive_topic_reviewed": false
  },
  "metadata_hash": "sha256"
}
```

## `compliance_report.json`

Contains:

- metadata validation issues and warnings
- final render QA status
- delivery file existence, size, and SHA-256
- explicit audience, synthetic-media, and paid-placement checks
- private-by-default check
- `preflight_passed`
- deterministic `report_hash`

## `publishing_package.json`

```json
{
  "schema": "nichefoundry.publishing_package.v1",
  "episode_id": "episode_id",
  "studio_id": "studio_id",
  "metadata": {},
  "compliance": {},
  "remote": {
    "video_id": null,
    "upload": {
      "status": "not_started",
      "bytes_uploaded": 0,
      "total_bytes": 0
    },
    "processing": {
      "status": "not_started"
    },
    "assets": {
      "thumbnail": "not_started",
      "captions": "not_started"
    },
    "verification": {
      "passed": false,
      "status": "not_started"
    },
    "schedule": {
      "status": "not_scheduled",
      "publish_at": null
    }
  },
  "status": "preflight_passed",
  "preflight_passed": true,
  "private_upload_ready": false,
  "final_signoff_observed": false,
  "release_ready": false,
  "package_hash": "sha256",
  "remote_state_hash": "sha256"
}
```

## Status vocabulary

Local and remote states may include:

```text
blocked
preflight_passed
initiated
uploading
uploaded
processing
processed
assets_attached
verification_failed
verified_private
scheduled
failed
rejected
```

## Remote evidence

### `youtube_upload_receipt.json`

Stores video ID, session URL hash, byte counts, completion time, and transfer status. It never stores the raw session URL.

### `youtube_processing_report.json`

Stores processing attempts, upload status, timestamps, and any failure or rejection reason.

### `youtube_asset_uploads.json`

Stores caption ID, attachment status, local asset hashes, and attachment timestamps.

### `publishing_verification.json`

Checks:

- local compliance
- uploaded video ID
- processed platform state
- attached thumbnail
- attached captions
- remotely verified metadata and declarations
- private or scheduled release state

### `release_approval_bundle.json`

Binds the verified remote release to:

- final video
- captions
- thumbnail
- final sign-off bundle
- publishing package
- metadata package
- compliance report
- remote publishing verification

## Security invariants

- Raw OAuth tokens are never returned to the browser.
- Raw resumable session URLs are never returned to the browser.
- Remote events are redacted before persistence or response.
- Upload cannot begin without current final sign-off.
- Scheduling cannot use an unreviewed timestamp.
- The initial platform privacy state is always private.
