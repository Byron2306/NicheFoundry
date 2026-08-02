# Publishing and Compliance Guide

## 1. Prepare Google access

Create or select a Google Cloud project, enable the YouTube Data API v3, configure the OAuth consent screen, and create an OAuth client suitable for a desktop application.

Place the client details in your private `.env` file:

```text
YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
```

Run:

```bash
npm run setup:youtube-oauth
```

Complete consent in the browser and place the returned value in `.env`:

```text
YOUTUBE_REFRESH_TOKEN=...
```

Never commit `.env` or share the refresh token.

The OAuth helper requests the permissions required for media upload, caption and metadata operations, remote verification, and read-only owned-channel analytics.

## 2. Build the local publishing preflight

A current final render approval is required.

In the Release Bridge:

1. Review the title and description.
2. Confirm that the description contains appropriate source and disclosure information.
3. Review tags and the YouTube category ID.
4. Explicitly set made-for-kids status.
5. Explicitly set altered or synthetic media status.
6. Explicitly set paid-placement status.
7. Optionally enter a future publication time.
8. Select **Build Compliance Preflight**.

The platform writes and hashes the metadata, compliance, and publishing packages.

## 3. Complete publisher review and final sign-off

Rebuild the Phase 10 review queue after preflight if necessary. The publisher's release-compliance task must review the exact metadata and delivery hashes.

Approve every mandatory review task, resolve every blocker, and record final sign-off.

Changing metadata after final sign-off invalidates the sign-off. Rebuild preflight, repeat publisher review, and sign again.

## 4. Upload privately

Select **Upload Privately**.

The system:

- refreshes a short-lived OAuth access token;
- opens a resumable upload session;
- transfers `final.mp4` in bounded chunks;
- persists progress and a session hash;
- stores the returned video ID.

If the process stops, the next attempt queries the accepted byte offset and resumes.

## 5. Verify processing

Select **Poll Processing**. The UI performs one poll per click so the browser does not remain tied up during long platform processing.

The runtime records:

- uploaded
- processed
- failed
- rejected
- deleted
- pending

Failure and rejection reasons remain in the evidence report.

## 6. Attach captions and thumbnail

After processing reaches `processed`, select **Attach Captions + Thumbnail**.

The runtime uploads:

- `thumbnail.png`
- `captions.srt`

The local hashes and returned caption ID are persisted.

## 7. Verify the remote resource

Select **Verify Remote Release**.

NicheFoundry retrieves the remote video and checks it against the reviewed package:

- title
- category
- privacy status
- processing status
- made-for-kids declaration
- altered or synthetic media declaration
- paid-placement declaration
- attached custom thumbnail

The video remains private after successful verification.

## 8. Schedule deliberately

Scheduling is optional.

It is available only when the future `publishAt` value was present during preflight and therefore reviewed by the publisher before final sign-off.

Type exactly:

```text
SCHEDULE VERIFIED VIDEO
```

Then select **Schedule Verified Video**.

NicheFoundry refuses:

- a different timestamp
- a past timestamp
- an unverified video
- a video missing captions or thumbnail
- a release without the exact confirmation phrase

## Environment controls

```text
YOUTUBE_UPLOAD_CHUNK_SIZE=8388608
YOUTUBE_PROCESS_POLL_INTERVAL_MS=3000
YOUTUBE_PROCESS_MAX_ATTEMPTS=20
```

For slower or unreliable networks, use a smaller chunk size. The server constrains the accepted range.

## Troubleshooting

### No refresh token returned

Revoke the previous application grant, ensure the OAuth request uses offline access and explicit consent, then rerun the helper.

### Upload session fails after interruption

Retry **Upload Privately**. The stored session is queried for its accepted offset before new chunks are sent.

### Video remains pending

Poll again later. Do not attach assets or schedule until the remote processing state is `processed`.

### Remote verification fails

Review `publishing_verification.json`. Correct the local metadata or remote state deliberately, rebuild preflight where required, repeat publisher review, and renew final sign-off.

### Metadata edit invalidated final sign-off

This is expected. Metadata is part of the release-compliance artifact bundle. Reapprove the modified package.
