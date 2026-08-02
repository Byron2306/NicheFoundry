const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { safeResolve, sha256File } = require('./evidence');

const YOUTUBE_ENDPOINTS = Object.freeze({
  token: 'https://oauth2.googleapis.com/token',
  uploadVideos: 'https://www.googleapis.com/upload/youtube/v3/videos',
  videos: 'https://www.googleapis.com/youtube/v3/videos',
  uploadCaptions: 'https://www.googleapis.com/upload/youtube/v3/captions',
  uploadThumbnails: 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set'
});

const PUBLISHING_ARTIFACTS = Object.freeze([
  'publishing_package.json',
  'metadata_package.json',
  'compliance_report.json',
  'youtube_upload_receipt.json',
  'youtube_processing_report.json',
  'youtube_asset_uploads.json',
  'publishing_verification.json',
  'release_approval_bundle.json'
]);

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Value(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function nowIso() { return new Date().toISOString(); }

function clampText(value, limit) {
  const text = String(value || '').trim();
  return text.length <= limit ? text : text.slice(0, Math.max(0, limit - 1)).trimEnd();
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean)));
}

function defaultCategoryForStudio(studioId) {
  if (studioId === 'failure_atlas' || studioId === 'practical_open_source') return '28';
  return '27';
}

function sourceLines(packet, maxSources = 8) {
  const sources = packet.sourcePacket || packet.sources || [];
  return sources.slice(0, maxSources).map((source) => {
    const title = source.title || source.name || source.source_id || 'Source';
    const url = source.canonical_url || source.source_url || source.url;
    return url ? `- ${title}: ${url}` : `- ${title}`;
  });
}

function buildMetadataPackage(packet, overrides = {}) {
  const studioId = packet.brief?.studio_id || packet.episode?.studio?.id || 'puzzle_planet';
  const premise = packet.episode?.story_premise || packet.brief?.story_premise || '';
  const sourceBlock = sourceLines(packet);
  const disclosureLines = [];
  const containsSyntheticMedia = overrides.containsSyntheticMedia ?? Boolean(packet.brief?.contains_synthetic_media);
  if (containsSyntheticMedia) disclosureLines.push('Disclosure: This programme contains altered or synthetic media and is labelled accordingly.');
  if (overrides.hasPaidProductPlacement) disclosureLines.push('Disclosure: This programme contains paid promotion or product placement.');
  if (overrides.affiliateDisclosure) disclosureLines.push(String(overrides.affiliateDisclosure));
  const descriptionParts = [premise];
  if (sourceBlock.length) descriptionParts.push(`Sources and further reading:\n${sourceBlock.join('\n')}`);
  if (disclosureLines.length) descriptionParts.push(disclosureLines.join('\n'));
  const description = clampText(overrides.description || descriptionParts.filter(Boolean).join('\n\n'), 5000);
  const tags = uniqueStrings(overrides.tags || [
    packet.episode?.topic,
    packet.brief?.content_pillar_id,
    packet.brief?.archetype_id,
    packet.episode?.studio?.name,
    studioId.replaceAll('_', ' ')
  ]).map((tag) => clampText(tag, 80));
  const audienceMode = packet.brief?.audience_mode || 'general_family';
  const madeForKids = overrides.selfDeclaredMadeForKids ?? audienceMode === 'made_for_kids';
  const publishAt = overrides.publishAt || null;
  const privacyStatus = publishAt ? 'private' : (overrides.privacyStatus || 'private');
  const metadata = {
    schema: 'nichefoundry.youtube_metadata.v1',
    episode_id: packet.episode?.episode_id,
    snippet: {
      title: clampText(overrides.title || packet.episode?.title || packet.brief?.working_title || 'Untitled programme', 100),
      description,
      tags,
      categoryId: String(overrides.categoryId || defaultCategoryForStudio(studioId)),
      defaultLanguage: overrides.defaultLanguage || 'en'
    },
    status: {
      privacyStatus,
      selfDeclaredMadeForKids: Boolean(madeForKids),
      containsSyntheticMedia: Boolean(containsSyntheticMedia),
      embeddable: overrides.embeddable !== false,
      publicStatsViewable: overrides.publicStatsViewable !== false,
      license: overrides.license || 'youtube',
      ...(publishAt ? { publishAt } : {})
    },
    paidProductPlacementDetails: {
      hasPaidProductPlacement: Boolean(overrides.hasPaidProductPlacement)
    },
    upload: {
      notifySubscribers: false,
      captionLanguage: overrides.captionLanguage || 'en',
      captionName: clampText(overrides.captionName || 'English', 150),
      captionIsDraft: Boolean(overrides.captionIsDraft)
    },
    disclosures: {
      affiliate: overrides.affiliateDisclosure || null,
      sponsorship: overrides.sponsorshipDisclosure || null,
      sensitive_topic_reviewed: Boolean(overrides.sensitiveTopicReviewed)
    },
    generated_at: nowIso()
  };
  metadata.metadata_hash = sha256Value({ snippet: metadata.snippet, status: metadata.status, paidProductPlacementDetails: metadata.paidProductPlacementDetails, upload: metadata.upload, disclosures: metadata.disclosures });
  return metadata;
}

function fileState(episodeDir, relativePath) {
  let absolutePath;
  try { absolutePath = safeResolve(episodeDir, relativePath); }
  catch (_error) { return { relative_path: relativePath, exists: false, valid: false, error: 'unsafe_path', size_bytes: 0, sha256: null }; }
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    return { relative_path: relativePath, exists: false, valid: false, error: 'missing', size_bytes: 0, sha256: null };
  }
  const stat = fs.statSync(absolutePath);
  return { relative_path: relativePath, absolute_path: absolutePath, exists: true, valid: stat.size > 0, size_bytes: stat.size, sha256: sha256File(absolutePath) };
}

function validateMetadata(metadata, now = new Date()) {
  const issues = [];
  const warnings = [];
  const title = metadata?.snippet?.title || '';
  const description = metadata?.snippet?.description || '';
  const tags = metadata?.snippet?.tags || [];
  if (!title.trim()) issues.push({ code: 'title_missing', message: 'A video title is required.' });
  if (title.length > 100) issues.push({ code: 'title_too_long', message: 'The title exceeds 100 characters.' });
  if (description.length > 5000) issues.push({ code: 'description_too_long', message: 'The description exceeds 5000 characters.' });
  if (!/^\d+$/.test(String(metadata?.snippet?.categoryId || ''))) issues.push({ code: 'category_invalid', message: 'A numeric YouTube category ID is required.' });
  if (tags.join(',').length > 500) issues.push({ code: 'tags_too_long', message: 'Combined tags exceed the conservative 500-character budget.' });
  if (metadata?.status?.privacyStatus !== 'private') issues.push({ code: 'initial_privacy_not_private', message: 'The initial upload must remain private.' });
  if (typeof metadata?.status?.selfDeclaredMadeForKids !== 'boolean') issues.push({ code: 'audience_declaration_missing', message: 'The made-for-kids declaration must be explicit.' });
  if (typeof metadata?.status?.containsSyntheticMedia !== 'boolean') issues.push({ code: 'synthetic_declaration_missing', message: 'The altered or synthetic media declaration must be explicit.' });
  if (typeof metadata?.paidProductPlacementDetails?.hasPaidProductPlacement !== 'boolean') issues.push({ code: 'paid_placement_declaration_missing', message: 'The paid-product-placement declaration must be explicit.' });
  if (metadata?.status?.publishAt) {
    const date = new Date(metadata.status.publishAt);
    if (Number.isNaN(date.getTime())) issues.push({ code: 'publish_at_invalid', message: 'publishAt must be a valid ISO-8601 timestamp.' });
    else if (date.getTime() <= now.getTime() + 60_000) issues.push({ code: 'publish_at_not_future', message: 'A scheduled publication time must be in the future.' });
  }
  if (!description.includes('Sources and further reading:')) warnings.push({ code: 'source_list_absent', message: 'No source list appears in the description.' });
  return { passed: issues.length === 0, issues, warnings };
}

function buildComplianceReport({ packet, episodeDir, finalSignoff, metadata, now = new Date() }) {
  const video = fileState(episodeDir, 'final.mp4');
  const captions = fileState(episodeDir, 'captions.srt');
  const thumbnail = fileState(episodeDir, 'thumbnail.png');
  const metadataValidation = validateMetadata(metadata, now);
  const checks = [
    { id: 'render_qa', passed: Boolean(packet.render_production?.render_qa_report?.passed || packet.render_qa_report?.passed), detail: 'Final render QA must pass.' },
    { id: 'video', passed: video.valid, detail: video.valid ? `${video.size_bytes} bytes, SHA-256 ${video.sha256}` : video.error },
    { id: 'captions', passed: captions.valid && captions.size_bytes <= 100 * 1024 * 1024, detail: captions.valid ? `${captions.size_bytes} bytes, SHA-256 ${captions.sha256}` : captions.error },
    { id: 'thumbnail', passed: thumbnail.valid && thumbnail.size_bytes <= 2 * 1024 * 1024, detail: thumbnail.valid ? `${thumbnail.size_bytes} bytes, SHA-256 ${thumbnail.sha256}` : thumbnail.error },
    { id: 'metadata', passed: metadataValidation.passed, detail: metadataValidation.passed ? 'Metadata declarations and limits passed.' : `${metadataValidation.issues.length} metadata issue(s).` },
    { id: 'private_default', passed: metadata.status.privacyStatus === 'private', detail: 'The upload defaults to private.' },
    { id: 'audience_declaration', passed: typeof metadata.status.selfDeclaredMadeForKids === 'boolean', detail: `selfDeclaredMadeForKids=${metadata.status.selfDeclaredMadeForKids}` },
    { id: 'synthetic_declaration', passed: typeof metadata.status.containsSyntheticMedia === 'boolean', detail: `containsSyntheticMedia=${metadata.status.containsSyntheticMedia}` },
    { id: 'paid_placement_declaration', passed: typeof metadata.paidProductPlacementDetails.hasPaidProductPlacement === 'boolean', detail: `hasPaidProductPlacement=${metadata.paidProductPlacementDetails.hasPaidProductPlacement}` }
  ];
  const preflightChecks = checks;
  const report = {
    schema: 'nichefoundry.publishing_compliance.v1',
    episode_id: packet.episode?.episode_id,
    checks,
    issues: metadataValidation.issues,
    warnings: metadataValidation.warnings,
    delivery: { video: sanitiseFileState(video), captions: sanitiseFileState(captions), thumbnail: sanitiseFileState(thumbnail) },
    preflight_passed: preflightChecks.every((check) => check.passed),
    passed: checks.every((check) => check.passed),
    checked_at: now.toISOString()
  };
  report.report_hash = sha256Value({ checks: report.checks, issues: report.issues, warnings: report.warnings, delivery: report.delivery });
  return report;
}

function sanitiseFileState(state) {
  const { absolute_path, ...safe } = state;
  return safe;
}

function buildPublishingPackage({ packet, episodeDir, finalSignoff = null, overrides = {}, remote = null, now = new Date() }) {
  const metadata = buildMetadataPackage(packet, overrides);
  const compliance = buildComplianceReport({ packet, episodeDir, finalSignoff, metadata, now });
  const remoteState = remote || {
    video_id: null,
    upload: { status: 'not_started', bytes_uploaded: 0, total_bytes: compliance.delivery.video.size_bytes || 0 },
    processing: { status: 'not_started' },
    assets: { thumbnail: 'not_started', captions: 'not_started' },
    verification: { passed: false, status: 'not_started' },
    schedule: { status: 'not_scheduled', publish_at: null }
  };
  const releaseReady = Boolean(compliance.passed && remoteState.verification?.passed && remoteState.assets?.thumbnail === 'attached' && remoteState.assets?.captions === 'attached');
  const localStatus = remoteState.upload?.status && remoteState.upload.status !== 'not_started' ? remoteState.upload.status : 'preflight_passed';
  const localPackageHash = sha256Value({ episode_id: packet.episode?.episode_id, metadata_hash: metadata.metadata_hash, compliance_hash: compliance.report_hash, delivery: compliance.delivery });
  const publishingPackage = {
    schema: 'nichefoundry.publishing_package.v1',
    episode_id: packet.episode?.episode_id,
    studio_id: packet.brief?.studio_id || packet.episode?.studio?.id || null,
    metadata,
    compliance,
    remote: remoteState,
    status: releaseReady ? (remoteState.schedule?.status === 'scheduled' ? 'scheduled' : 'verified_private') : compliance.passed ? localStatus : 'blocked',
    preflight_passed: compliance.preflight_passed,
    private_upload_ready: Boolean(compliance.passed && finalSignoff?.valid),
    final_signoff_observed: Boolean(finalSignoff?.valid),
    release_ready: releaseReady,
    generated_at: now.toISOString(),
    package_hash: localPackageHash,
    remote_state_hash: sha256Value(remoteState)
  };
  return publishingPackage;
}

function buildPublishingVerification(publishingPackage) {
  const remote = publishingPackage.remote || {};
  const checks = [
    { id: 'local_compliance', passed: Boolean(publishingPackage.compliance?.passed) },
    { id: 'video_uploaded', passed: Boolean(remote.video_id && ['uploaded', 'processed'].includes(remote.upload?.status)) },
    { id: 'platform_processed', passed: remote.processing?.status === 'processed' },
    { id: 'thumbnail_attached', passed: remote.assets?.thumbnail === 'attached' },
    { id: 'captions_attached', passed: remote.assets?.captions === 'attached' },
    { id: 'remote_metadata_verified', passed: Boolean(remote.verification?.passed) },
    { id: 'private_or_scheduled', passed: ['private', 'scheduled'].includes(remote.verification?.privacy_state || '') }
  ];
  const verification = {
    schema: 'nichefoundry.publishing_verification.v1',
    episode_id: publishingPackage.episode_id,
    video_id: remote.video_id || null,
    checks,
    passed: checks.every((check) => check.passed),
    verified_at: nowIso()
  };
  verification.verification_hash = sha256Value({ video_id: verification.video_id, checks });
  return verification;
}

function buildReleaseApprovalBundle({ publishingPackage, verification, episodeDir }) {
  const localFiles = ['final.mp4', 'captions.srt', 'thumbnail.png', 'final_signoff_bundle.json', 'publishing_package.json', 'metadata_package.json', 'compliance_report.json', 'publishing_verification.json']
    .map((name) => sanitiseFileState(fileState(episodeDir, name)));
  const complete = Boolean(publishingPackage.release_ready && verification?.passed && localFiles.every((item) => item.exists && item.sha256));
  const bundle = {
    schema: 'nichefoundry.release_approval_bundle.v1',
    episode_id: publishingPackage.episode_id,
    video_id: publishingPackage.remote?.video_id || null,
    files: localFiles,
    remote: {
      processing: publishingPackage.remote?.processing || null,
      assets: publishingPackage.remote?.assets || null,
      verification: publishingPackage.remote?.verification || null,
      schedule: publishingPackage.remote?.schedule || null
    },
    complete,
    generated_at: nowIso()
  };
  bundle.bundle_hash = sha256Value({ episode_id: bundle.episode_id, video_id: bundle.video_id, files: bundle.files, remote: bundle.remote, complete });
  return bundle;
}

function writePublishingArtifacts(episodeDir, publishingPackage, { uploadReceipt = null, processingReport = null, assetUploads = null } = {}) {
  fs.mkdirSync(episodeDir, { recursive: true });
  const verification = buildPublishingVerification(publishingPackage);
  const localPackageArtifact = {
    schema: publishingPackage.schema,
    episode_id: publishingPackage.episode_id,
    studio_id: publishingPackage.studio_id,
    metadata_hash: publishingPackage.metadata?.metadata_hash || null,
    compliance_hash: publishingPackage.compliance?.report_hash || null,
    preflight_passed: publishingPackage.preflight_passed,
    delivery: publishingPackage.compliance?.delivery || null,
    package_hash: publishingPackage.package_hash,
    generated_at: publishingPackage.generated_at
  };
  const files = {
    'publishing_package.json': localPackageArtifact,
    'metadata_package.json': publishingPackage.metadata,
    'compliance_report.json': publishingPackage.compliance,
    'publishing_verification.json': verification
  };
  if (uploadReceipt) files['youtube_upload_receipt.json'] = uploadReceipt;
  if (processingReport) files['youtube_processing_report.json'] = processingReport;
  if (assetUploads) files['youtube_asset_uploads.json'] = assetUploads;
  for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(episodeDir, name), `${JSON.stringify(value, null, 2)}\n`);
  const releaseBundle = buildReleaseApprovalBundle({ publishingPackage, verification, episodeDir });
  fs.writeFileSync(path.join(episodeDir, 'release_approval_bundle.json'), `${JSON.stringify(releaseBundle, null, 2)}\n`);
  return { verification, release_bundle: releaseBundle };
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch (_error) { return { raw: text }; }
}

function googleApiError(status, payload, fallback) {
  const message = payload?.error?.message || payload?.error_description || payload?.message || fallback || `Google API request failed with HTTP ${status}.`;
  const error = new Error(message);
  error.statusCode = status;
  error.payload = payload;
  return error;
}

async function refreshAccessToken({ clientId, clientSecret = '', refreshToken, fetchImpl = globalThis.fetch, endpoints = YOUTUBE_ENDPOINTS }) {
  if (!clientId || !refreshToken) throw new Error('YOUTUBE_CLIENT_ID and YOUTUBE_REFRESH_TOKEN are required.');
  const form = new URLSearchParams({ client_id: clientId, refresh_token: refreshToken, grant_type: 'refresh_token' });
  if (clientSecret) form.set('client_secret', clientSecret);
  const response = await fetchImpl(endpoints.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  const payload = await parseJsonResponse(response);
  if (!response.ok || !payload.access_token) throw googleApiError(response.status, payload, 'Unable to refresh the YouTube access token.');
  return { access_token: payload.access_token, expires_in: payload.expires_in || null, scope: payload.scope || null, token_type: payload.token_type || 'Bearer', acquired_at: nowIso() };
}

function resourceFromMetadata(metadata) {
  return {
    snippet: metadata.snippet,
    status: metadata.status,
    paidProductPlacementDetails: metadata.paidProductPlacementDetails
  };
}

async function initiateResumableUpload({ accessToken, metadata, videoPath, fetchImpl = globalThis.fetch, endpoints = YOUTUBE_ENDPOINTS }) {
  const stat = fs.statSync(videoPath);
  const url = new URL(endpoints.uploadVideos);
  url.searchParams.set('uploadType', 'resumable');
  url.searchParams.set('part', 'snippet,status,paidProductPlacementDetails');
  url.searchParams.set('notifySubscribers', 'false');
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(stat.size),
      'X-Upload-Content-Type': 'video/mp4'
    },
    body: JSON.stringify(resourceFromMetadata(metadata))
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) throw googleApiError(response.status, payload, 'Unable to initiate the resumable YouTube upload.');
  const sessionUrl = response.headers.get('location');
  if (!sessionUrl) throw new Error('YouTube did not return a resumable upload session URL.');
  return { session_url: sessionUrl, session_url_hash: sha256Value(sessionUrl), total_bytes: stat.size, initiated_at: nowIso(), response: payload };
}

async function queryResumableOffset({ sessionUrl, totalBytes, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(sessionUrl, { method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': `bytes */${totalBytes}` } });
  if (response.status === 308) {
    const range = response.headers.get('range') || '';
    const match = range.match(/bytes=0-(\d+)/);
    return match ? Number(match[1]) + 1 : 0;
  }
  if (response.ok) return totalBytes;
  const payload = await parseJsonResponse(response);
  throw googleApiError(response.status, payload, 'Unable to query the resumable upload offset.');
}

async function uploadVideoChunks({ sessionUrl, videoPath, startOffset = 0, chunkSize = 8 * 1024 * 1024, fetchImpl = globalThis.fetch, onProgress = null }) {
  const totalBytes = fs.statSync(videoPath).size;
  const handle = fs.openSync(videoPath, 'r');
  let offset = Math.max(0, Number(startOffset) || 0);
  let finalPayload = null;
  try {
    while (offset < totalBytes) {
      const length = Math.min(chunkSize, totalBytes - offset);
      const chunk = Buffer.alloc(length);
      const bytesRead = fs.readSync(handle, chunk, 0, length, offset);
      const end = offset + bytesRead - 1;
      const response = await fetchImpl(sessionUrl, {
        method: 'PUT',
        headers: { 'Content-Length': String(bytesRead), 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${offset}-${end}/${totalBytes}` },
        body: chunk.subarray(0, bytesRead)
      });
      if (response.status === 308) {
        const range = response.headers.get('range') || '';
        const match = range.match(/bytes=0-(\d+)/);
        offset = match ? Number(match[1]) + 1 : end + 1;
        if (onProgress) await onProgress({ uploaded_bytes: offset, total_bytes: totalBytes, status: 'uploading' });
        continue;
      }
      const payload = await parseJsonResponse(response);
      if (!response.ok) throw googleApiError(response.status, payload, 'The YouTube media upload failed.');
      finalPayload = payload;
      offset = totalBytes;
      if (onProgress) await onProgress({ uploaded_bytes: offset, total_bytes: totalBytes, status: 'uploaded', video_id: payload.id || null });
    }
  } finally { fs.closeSync(handle); }
  if (!finalPayload?.id) throw new Error('YouTube completed the upload without returning a video ID.');
  return { video_id: finalPayload.id, uploaded_bytes: totalBytes, total_bytes: totalBytes, status: 'uploaded', response: finalPayload, completed_at: nowIso() };
}

async function getVideoRemoteState({ accessToken, videoId, fetchImpl = globalThis.fetch, endpoints = YOUTUBE_ENDPOINTS }) {
  const url = new URL(endpoints.videos);
  url.searchParams.set('part', 'snippet,status,processingDetails,contentDetails,paidProductPlacementDetails');
  url.searchParams.set('id', videoId);
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const payload = await parseJsonResponse(response);
  if (!response.ok) throw googleApiError(response.status, payload, 'Unable to retrieve the uploaded YouTube video.');
  const video = payload.items?.[0];
  if (!video) throw new Error(`YouTube video ${videoId} was not found.`);
  return video;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function pollVideoProcessing({ accessToken, videoId, fetchImpl = globalThis.fetch, endpoints = YOUTUBE_ENDPOINTS, maxAttempts = 20, intervalMs = 3000 }) {
  const history = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const video = await getVideoRemoteState({ accessToken, videoId, fetchImpl, endpoints });
    const uploadStatus = video.status?.uploadStatus || 'unknown';
    history.push({ attempt, upload_status: uploadStatus, checked_at: nowIso(), failure_reason: video.status?.failureReason || null, rejection_reason: video.status?.rejectionReason || null });
    if (uploadStatus === 'processed') return { status: 'processed', attempts: attempt, history, video, checked_at: nowIso() };
    if (uploadStatus === 'failed' || uploadStatus === 'rejected' || uploadStatus === 'deleted') {
      const error = new Error(`YouTube processing ended with status ${uploadStatus}: ${video.status?.failureReason || video.status?.rejectionReason || 'unspecified reason'}`);
      error.processing_report = { status: uploadStatus, attempts: attempt, history, video };
      throw error;
    }
    if (attempt < maxAttempts && intervalMs > 0) await sleep(intervalMs);
  }
  return { status: 'pending', attempts: maxAttempts, history, checked_at: nowIso() };
}

async function uploadThumbnail({ accessToken, videoId, thumbnailPath, fetchImpl = globalThis.fetch, endpoints = YOUTUBE_ENDPOINTS }) {
  const buffer = fs.readFileSync(thumbnailPath);
  if (buffer.length > 2 * 1024 * 1024) throw new Error('The thumbnail exceeds YouTube’s 2 MB upload limit.');
  const url = new URL(endpoints.uploadThumbnails);
  url.searchParams.set('videoId', videoId);
  url.searchParams.set('uploadType', 'media');
  const response = await fetchImpl(url, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'image/png', 'Content-Length': String(buffer.length) }, body: buffer });
  const payload = await parseJsonResponse(response);
  if (!response.ok) throw googleApiError(response.status, payload, 'Unable to upload the YouTube thumbnail.');
  return { status: 'attached', video_id: videoId, sha256: sha256File(thumbnailPath), response: payload, attached_at: nowIso() };
}

function buildMultipartBody(parts, boundary) {
  const chunks = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Type: ${part.contentType}\r\n\r\n`));
    chunks.push(Buffer.isBuffer(part.body) ? part.body : Buffer.from(String(part.body)));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

async function uploadCaptions({ accessToken, videoId, captionsPath, language = 'en', name = 'English', isDraft = false, fetchImpl = globalThis.fetch, endpoints = YOUTUBE_ENDPOINTS }) {
  const captions = fs.readFileSync(captionsPath);
  if (captions.length > 100 * 1024 * 1024) throw new Error('The caption file exceeds YouTube’s 100 MB upload limit.');
  const boundary = `nichefoundry_${crypto.randomBytes(12).toString('hex')}`;
  const resource = { snippet: { videoId, language, name, isDraft: Boolean(isDraft) } };
  const body = buildMultipartBody([
    { contentType: 'application/json; charset=UTF-8', body: JSON.stringify(resource) },
    { contentType: 'application/octet-stream', body: captions }
  ], boundary);
  const url = new URL(endpoints.uploadCaptions);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('uploadType', 'multipart');
  const response = await fetchImpl(url, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}`, 'Content-Length': String(body.length) }, body });
  const payload = await parseJsonResponse(response);
  if (!response.ok) throw googleApiError(response.status, payload, 'Unable to upload the YouTube caption track.');
  return { status: 'attached', video_id: videoId, caption_id: payload.id || null, sha256: sha256File(captionsPath), response: payload, attached_at: nowIso() };
}

function compareRemoteMetadata(video, metadata) {
  const issues = [];
  if (video.snippet?.title !== metadata.snippet.title) issues.push({ code: 'remote_title_mismatch', expected: metadata.snippet.title, actual: video.snippet?.title || null });
  if (String(video.snippet?.categoryId || '') !== String(metadata.snippet.categoryId)) issues.push({ code: 'remote_category_mismatch', expected: metadata.snippet.categoryId, actual: video.snippet?.categoryId || null });
  if (video.status?.privacyStatus !== metadata.status.privacyStatus) issues.push({ code: 'remote_privacy_mismatch', expected: metadata.status.privacyStatus, actual: video.status?.privacyStatus || null });
  if (typeof video.status?.selfDeclaredMadeForKids === 'boolean' && video.status.selfDeclaredMadeForKids !== metadata.status.selfDeclaredMadeForKids) issues.push({ code: 'remote_audience_mismatch', expected: metadata.status.selfDeclaredMadeForKids, actual: video.status.selfDeclaredMadeForKids });
  if (typeof video.status?.containsSyntheticMedia === 'boolean' && video.status.containsSyntheticMedia !== metadata.status.containsSyntheticMedia) issues.push({ code: 'remote_synthetic_mismatch', expected: metadata.status.containsSyntheticMedia, actual: video.status.containsSyntheticMedia });
  if (typeof video.paidProductPlacementDetails?.hasPaidProductPlacement === 'boolean' && video.paidProductPlacementDetails.hasPaidProductPlacement !== metadata.paidProductPlacementDetails.hasPaidProductPlacement) issues.push({ code: 'remote_paid_placement_mismatch', expected: metadata.paidProductPlacementDetails.hasPaidProductPlacement, actual: video.paidProductPlacementDetails.hasPaidProductPlacement });
  return {
    passed: issues.length === 0 && video.status?.uploadStatus === 'processed',
    issues,
    privacy_state: video.status?.publishAt ? 'scheduled' : video.status?.privacyStatus,
    upload_status: video.status?.uploadStatus || null,
    thumbnails_available: video.processingDetails?.thumbnailsAvailability || null,
    has_custom_thumbnail: video.contentDetails?.hasCustomThumbnail ?? null,
    checked_at: nowIso()
  };
}

async function verifyRemotePublication({ accessToken, videoId, metadata, fetchImpl = globalThis.fetch, endpoints = YOUTUBE_ENDPOINTS }) {
  const video = await getVideoRemoteState({ accessToken, videoId, fetchImpl, endpoints });
  return { ...compareRemoteMetadata(video, metadata), video_id: videoId, remote: video };
}

async function updateVideoRelease({ accessToken, videoId, metadata, publishAt = null, privacyStatus = 'private', fetchImpl = globalThis.fetch, endpoints = YOUTUBE_ENDPOINTS }) {
  if (privacyStatus !== 'private' && publishAt) throw new Error('Scheduled publication requires privacyStatus=private in the YouTube API request.');
  if (publishAt && new Date(publishAt).getTime() <= Date.now() + 60_000) throw new Error('publishAt must be a future ISO-8601 timestamp.');
  const url = new URL(endpoints.videos);
  url.searchParams.set('part', 'snippet,status,paidProductPlacementDetails');
  const resource = resourceFromMetadata({
    ...metadata,
    status: { ...metadata.status, privacyStatus, ...(publishAt ? { publishAt } : {}) }
  });
  resource.id = videoId;
  const response = await fetchImpl(url, { method: 'PUT', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(resource) });
  const payload = await parseJsonResponse(response);
  if (!response.ok) throw googleApiError(response.status, payload, 'Unable to update the YouTube release status.');
  return { video_id: videoId, status: publishAt ? 'scheduled' : privacyStatus, publish_at: publishAt, response: payload, updated_at: nowIso() };
}

function redactPublishingPackage(value) {
  if (Array.isArray(value)) return value.map(redactPublishingPackage);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|session_url|authorization|client_secret/i.test(key)) output[key] = item ? '[REDACTED]' : item;
    else output[key] = redactPublishingPackage(item);
  }
  return output;
}

module.exports = {
  YOUTUBE_ENDPOINTS,
  PUBLISHING_ARTIFACTS,
  stableStringify,
  sha256Value,
  buildMetadataPackage,
  validateMetadata,
  buildComplianceReport,
  buildPublishingPackage,
  buildPublishingVerification,
  buildReleaseApprovalBundle,
  writePublishingArtifacts,
  refreshAccessToken,
  initiateResumableUpload,
  queryResumableOffset,
  uploadVideoChunks,
  getVideoRemoteState,
  pollVideoProcessing,
  uploadThumbnail,
  uploadCaptions,
  verifyRemotePublication,
  updateVideoRelease,
  compareRemoteMetadata,
  redactPublishingPackage,
  resourceFromMetadata
};
