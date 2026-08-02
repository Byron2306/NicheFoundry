const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FoundryDatabase } = require('../lib/database');
const { REVIEW_WORKFLOWS, buildReviewTasks } = require('../lib/editorial_cockpit');
const {
  buildMetadataPackage,
  buildPublishingPackage,
  buildPublishingVerification,
  writePublishingArtifacts,
  refreshAccessToken,
  initiateResumableUpload,
  uploadVideoChunks,
  pollVideoProcessing,
  uploadThumbnail,
  uploadCaptions,
  verifyRemotePublication,
  updateVideoRelease,
  redactPublishingPackage
} = require('../lib/publishing_system');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nichefoundry-phase11-'));
  fs.writeFileSync(path.join(root, 'final.mp4'), Buffer.alloc(10_240, 1));
  fs.writeFileSync(path.join(root, 'captions.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHello world\n');
  fs.writeFileSync(path.join(root, 'thumbnail.png'), Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.alloc(256)]));
  const packet = {
    episode: { episode_id: 'episode_publish', title: 'Why the Bridge Failed', story_premise: 'A sourced reconstruction of a cascading design failure.', topic: 'bridge failure' },
    brief: { studio_id: 'failure_atlas', audience_mode: 'general_family', contains_synthetic_media: true, archetype_id: 'failure_chain' },
    sourcePacket: [{ title: 'Official investigation', source_url: 'https://example.org/report' }],
    render_production: { render_qa_report: { passed: true } },
    render_qa_report: { passed: true }
  };
  return { root, packet };
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', ...headers } });
}

test('Phase 11 builds a private, explicit-declaration metadata package and passing local preflight', () => {
  const { root, packet } = fixture();
  try {
    const metadata = buildMetadataPackage(packet, { tags: ['engineering', 'failure analysis'], hasPaidProductPlacement: false });
    assert.equal(metadata.status.privacyStatus, 'private');
    assert.equal(metadata.status.selfDeclaredMadeForKids, false);
    assert.equal(metadata.status.containsSyntheticMedia, true);
    assert.equal(metadata.paidProductPlacementDetails.hasPaidProductPlacement, false);
    assert.match(metadata.snippet.description, /Sources and further reading/);
    const publishing = buildPublishingPackage({ packet, episodeDir: root, finalSignoff: { valid: false } });
    assert.equal(publishing.preflight_passed, true);
    assert.equal(publishing.status, 'preflight_passed');
    assert.equal(publishing.private_upload_ready, false);
    const written = writePublishingArtifacts(root, publishing);
    assert.equal(fs.existsSync(path.join(root, 'publishing_package.json')), true);
    assert.equal(written.verification.passed, false);
    assert.equal(written.release_bundle.complete, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Phase 11 adds immutable publishing metadata and compliance evidence to publisher review', () => {
  const release = REVIEW_WORKFLOWS.find((item) => item.review_type === 'release_compliance');
  assert.ok(release.artifacts.includes('publishing_package.json'));
  assert.ok(release.artifacts.includes('metadata_package.json'));
  assert.ok(release.artifacts.includes('compliance_report.json'));
  const { root, packet } = fixture();
  try {
    for (const workflow of REVIEW_WORKFLOWS) for (const name of workflow.artifacts) {
      const target = path.join(root, name);
      if (fs.existsSync(target)) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (name.endsWith('.mp4')) fs.writeFileSync(target, Buffer.alloc(2048, 1));
      else if (name.endsWith('.mp3')) fs.writeFileSync(target, Buffer.alloc(256, 1));
      else if (name.endsWith('.png')) fs.writeFileSync(target, Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.alloc(64)]));
      else if (name.endsWith('.srt')) fs.writeFileSync(target, '1\n00:00:00,000 --> 00:00:01,000\nHello\n');
      else if (name.endsWith('.md')) fs.writeFileSync(target, '# Review\n');
      else fs.writeFileSync(target, '{}\n');
    }
    const reviewPacket = { ...packet, verification: { editorial_audit: { passed: true } }, editorial_evidence_current: true, approved: true, audio_approved: true, render_approved: true, audio_production: { performance_report: { passed: true } } };
    const tasks = buildReviewTasks({ episodeId: packet.episode.episode_id, episodeDir: root, packet: reviewPacket, existingTasks: [] });
    const releaseTask = tasks.find((item) => item.review_type === 'release_compliance');
    assert.equal(releaseTask.ready, true);
    assert.equal(releaseTask.artifacts_complete, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Phase 11 refreshes OAuth access without exposing the refresh token', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url: String(url), options };
    return jsonResponse({ access_token: 'access_123', expires_in: 3600, scope: 'youtube.upload', token_type: 'Bearer' });
  };
  const token = await refreshAccessToken({ clientId: 'client', clientSecret: 'secret', refreshToken: 'refresh_very_private', fetchImpl });
  assert.equal(token.access_token, 'access_123');
  assert.match(request.options.body, /grant_type=refresh_token/);
  assert.match(request.options.body, /refresh_token=refresh_very_private/);
  assert.doesNotMatch(JSON.stringify(token), /refresh_very_private/);
  assert.deepEqual(redactPublishingPackage({ refresh_token: 'x', access_token: 'y', nested: { session_url: 'z' } }), { refresh_token: '[REDACTED]', access_token: '[REDACTED]', nested: { session_url: '[REDACTED]' } });
});

test('Phase 11 initiates and completes resumable chunk upload with byte ranges', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nichefoundry-upload-'));
  const videoPath = path.join(root, 'video.mp4');
  fs.writeFileSync(videoPath, Buffer.from('0123456789'));
  const calls = [];
  try {
    const metadata = { snippet: { title: 'T', description: '', tags: [], categoryId: '27' }, status: { privacyStatus: 'private', selfDeclaredMadeForKids: false, containsSyntheticMedia: false }, paidProductPlacementDetails: { hasPaidProductPlacement: false } };
    const initiation = await initiateResumableUpload({ accessToken: 'token', metadata, videoPath, fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return jsonResponse({}, 200, { location: 'https://upload.example/session/abc' });
    }, endpoints: { uploadVideos: 'https://upload.example/videos' } });
    assert.equal(initiation.total_bytes, 10);
    assert.equal(initiation.session_url, 'https://upload.example/session/abc');
    const responses = [
      new Response('', { status: 308, headers: { range: 'bytes=0-3' } }),
      new Response('', { status: 308, headers: { range: 'bytes=0-7' } }),
      jsonResponse({ id: 'video_123', status: { uploadStatus: 'uploaded' } })
    ];
    const ranges = [];
    const result = await uploadVideoChunks({ sessionUrl: initiation.session_url, videoPath, chunkSize: 4, fetchImpl: async (_url, options) => {
      ranges.push(options.headers['Content-Range']);
      return responses.shift();
    } });
    assert.deepEqual(ranges, ['bytes 0-3/10', 'bytes 4-7/10', 'bytes 8-9/10']);
    assert.equal(result.video_id, 'video_123');
    assert.equal(result.uploaded_bytes, 10);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Phase 11 polls processing, attaches thumbnail and captions, and verifies remote declarations', async () => {
  const { root, packet } = fixture();
  try {
    const metadata = buildMetadataPackage(packet, {});
    const videoBase = {
      id: 'video_123',
      snippet: { title: metadata.snippet.title, categoryId: metadata.snippet.categoryId },
      status: { privacyStatus: 'private', selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
      paidProductPlacementDetails: { hasPaidProductPlacement: false },
      processingDetails: { thumbnailsAvailability: 'available' },
      contentDetails: { hasCustomThumbnail: true }
    };
    let pollCount = 0;
    const processing = await pollVideoProcessing({ accessToken: 'token', videoId: 'video_123', maxAttempts: 2, intervalMs: 0, fetchImpl: async () => {
      pollCount += 1;
      return jsonResponse({ items: [{ ...videoBase, status: { ...videoBase.status, uploadStatus: pollCount === 1 ? 'uploaded' : 'processed' } }] });
    } });
    assert.equal(processing.status, 'processed');
    let thumbnailType = null;
    const thumbnail = await uploadThumbnail({ accessToken: 'token', videoId: 'video_123', thumbnailPath: path.join(root, 'thumbnail.png'), fetchImpl: async (_url, options) => {
      thumbnailType = options.headers['Content-Type'];
      return jsonResponse({ items: [{ default: { url: 'x' } }] });
    } });
    assert.equal(thumbnail.status, 'attached');
    assert.equal(thumbnailType, 'image/png');
    let captionType = null;
    const captions = await uploadCaptions({ accessToken: 'token', videoId: 'video_123', captionsPath: path.join(root, 'captions.srt'), fetchImpl: async (_url, options) => {
      captionType = options.headers['Content-Type'];
      assert.match(options.body.toString(), /video_123/);
      return jsonResponse({ id: 'caption_1', snippet: { videoId: 'video_123' } });
    } });
    assert.equal(captions.caption_id, 'caption_1');
    assert.match(captionType, /multipart\/related/);
    const verified = await verifyRemotePublication({ accessToken: 'token', videoId: 'video_123', metadata, fetchImpl: async () => jsonResponse({ items: [{ ...videoBase, status: { ...videoBase.status, uploadStatus: 'processed' } }] }) });
    assert.equal(verified.passed, true);
    assert.equal(verified.privacy_state, 'private');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Phase 11 requires an exact reviewed future schedule and preserves private status in the API request', async () => {
  const { packet } = fixture();
  const publishAt = new Date(Date.now() + 3_600_000).toISOString();
  const metadata = buildMetadataPackage(packet, { publishAt });
  let requestBody;
  const result = await updateVideoRelease({ accessToken: 'token', videoId: 'video_123', metadata, publishAt, fetchImpl: async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return jsonResponse({ id: 'video_123', status: { privacyStatus: 'private', publishAt } });
  } });
  assert.equal(result.status, 'scheduled');
  assert.equal(requestBody.status.privacyStatus, 'private');
  assert.equal(requestBody.status.publishAt, publishAt);
});

test('Phase 11 persists publishing packages, redacted events, and resumable sessions in SQLite', () => {
  const { root, packet } = fixture();
  const db = new FoundryDatabase(path.join(root, 'foundry.sqlite'));
  try {
    db.upsertEpisode({ episode: packet.episode, episode_dir: root, qa: { status: 'review' } });
    const publishing = buildPublishingPackage({ packet, episodeDir: root, finalSignoff: { valid: true } });
    db.savePublishingPackage('episode:episode_publish', 'episode_publish', 'failure_atlas', publishing);
    assert.equal(db.getPublishingPackageForEpisode('episode_publish').package_hash, publishing.package_hash);
    db.recordPublishingEvent({ eventId: 'event_1', episodeId: 'episode_publish', action: 'upload', status: 'started', details: { session_url_hash: 'abc' } });
    assert.equal(db.listPublishingEvents('episode_publish').length, 1);
    db.saveYouTubeUploadSession({ sessionId: 'session_1', episodeId: 'episode_publish', sessionUrl: 'https://upload.example/secret', sessionUrlHash: 'hash', totalBytes: 100, uploadedBytes: 20, status: 'uploading' });
    db.updateYouTubeUploadSession('episode_publish', { uploaded_bytes: 80 });
    assert.equal(db.getYouTubeUploadSession('episode_publish').uploaded_bytes, 80);
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('Phase 11 console and server expose the full Publishing and Compliance cockpit', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const ids = ['publishingStatusBadge','publishingTitle','publishingDescription','publishingTags','publishingCategory','publishingMadeForKids','publishingSyntheticMedia','publishingPaidPlacement','publishingPublishAt','publishingPreflightButton','publishingUploadButton','publishingPollButton','publishingAssetsButton','publishingVerifyButton','publishingScheduleConfirmation','publishingScheduleButton','publishingMetadataJson','publishingComplianceJson','publishingRemoteJson','publishingEventsJson'];
  for (const id of ids) assert.match(html, new RegExp(`id=["']${id}["']`), `missing ${id}`);
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const routes = ['/api/publishing-system','/api/publishing-system/preflight','/api/publishing-system/upload','/api/publishing-system/poll','/api/publishing-system/assets','/api/publishing-system/verify','/api/publishing-system/schedule','/api/publishing-packages'];
  for (const route of routes) assert.match(server, new RegExp(route.replaceAll('/', '\\/')));
});
