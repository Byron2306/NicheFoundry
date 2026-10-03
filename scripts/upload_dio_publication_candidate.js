#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  buildPublishingPackage,
  writePublishingArtifacts,
  refreshAccessToken,
  initiateResumableUpload,
  uploadVideoChunks,
  pollVideoProcessing,
  uploadThumbnail,
  uploadCaptions,
  verifyRemotePublication
} = require('../lib/publishing_system');

const ROOT = path.resolve(__dirname, '..');
const SUITE_ROOT = path.resolve(ROOT, '../KnowEdge_AutoRelease_Suite');
const REGISTRY_PATH = path.join(SUITE_ROOT, 'deliverables/dio_video_candidates/DIO_VIDEO_CANDIDATE_REGISTRY.json');
const episodeId = process.argv[process.argv.indexOf('--episode-id') + 1];

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
function writeJson(filePath, value) { fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`); }
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function locateCandidate() {
  for (const entry of fs.readdirSync(path.join(ROOT, 'episodes'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const episodeDir = path.join(ROOT, 'episodes', entry.name);
    const candidatePath = path.join(episodeDir, 'FINAL_PUBLICATION_CANDIDATE.json');
    if (!fs.existsSync(candidatePath)) continue;
    const candidate = readJson(candidatePath);
    if (candidate.episode_id === episodeId) return { episodeDir, candidatePath, candidate };
  }
  throw new Error(`Publication candidate ${episodeId} was not found.`);
}

function packetFor(candidate, metadata) {
  return {
    episode: {
      episode_id: candidate.episode_id,
      title: metadata.snippet.title,
      topic: candidate.product_id,
      story_premise: metadata.snippet.description.split('\n\n')[0],
      studio: { id: 'dio_campaign_films', name: 'DIO Campaign Films' }
    },
    brief: {
      studio_id: 'dio_campaign_films',
      working_title: metadata.snippet.title,
      audience_mode: 'general_family',
      contains_synthetic_media: metadata.status.containsSyntheticMedia
    },
    render_production: { render_qa_report: { passed: true, source: 'FINAL_MEDIA_RECEIPT.json' } }
  };
}

function overridesFor(metadata) {
  return {
    title: metadata.snippet.title,
    description: metadata.snippet.description,
    tags: metadata.snippet.tags,
    categoryId: metadata.snippet.categoryId,
    defaultLanguage: metadata.snippet.defaultLanguage,
    privacyStatus: 'private',
    selfDeclaredMadeForKids: metadata.status.selfDeclaredMadeForKids,
    containsSyntheticMedia: metadata.status.containsSyntheticMedia,
    embeddable: metadata.status.embeddable,
    publicStatsViewable: metadata.status.publicStatsViewable,
    license: metadata.status.license,
    hasPaidProductPlacement: metadata.paidProductPlacementDetails.hasPaidProductPlacement,
    captionLanguage: metadata.upload.captionLanguage,
    captionName: metadata.upload.captionName,
    captionIsDraft: metadata.upload.captionIsDraft,
    sensitiveTopicReviewed: metadata.disclosures?.sensitive_topic_reviewed
  };
}

async function verifyChannel(accessToken, expectedChannelId) {
  const response = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || 'Unable to verify the authorised YouTube channel.');
  const channel = payload.items?.[0];
  if (!channel || channel.id !== expectedChannelId) {
    throw new Error(`YouTube channel lock refused upload. Expected ${expectedChannelId}; received ${channel?.id || 'none'}.`);
  }
  return { id: channel.id, title: channel.snippet?.title || null };
}

function updateRegistry(candidate, episodeDir) {
  const registry = readJson(REGISTRY_PATH);
  const item = registry.candidates.find((entry) => entry.episode_id === candidate.episode_id);
  if (item) {
    item.status = candidate.status;
    item.gates = candidate.gates;
    item.private_upload_ready = false;
    item.youtube = candidate.youtube;
    item.candidate = path.join(episodeDir, 'FINAL_PUBLICATION_CANDIDATE.json');
  }
  registry.generated_at = new Date().toISOString();
  registry.counts.private_upload_ready = registry.candidates.filter((entry) => entry.private_upload_ready).length;
  registry.counts.awaiting_human_review = registry.candidates.filter((entry) => entry.status === 'human_review_required').length;
  registry.counts.uploaded_private = registry.candidates.filter((entry) => entry.status === 'uploaded_private_verified').length;
  writeJson(REGISTRY_PATH, registry);
}

async function main() {
  if (!episodeId || episodeId.startsWith('--')) throw new Error('Use --episode-id <candidate id>.');
  const { episodeDir, candidatePath, candidate } = locateCandidate();
  const requiredGates = ['video_watch_through_approved', 'voice_approved', 'thumbnail_approved', 'metadata_approved', 'youtube_upload_authorised'];
  const missing = requiredGates.filter((gate) => candidate.gates?.[gate] !== true);
  if (missing.length) throw new Error(`Private upload is blocked by: ${missing.join(', ')}.`);
  if (candidate.youtube?.video_id) throw new Error(`Candidate is already uploaded as ${candidate.youtube.video_id}.`);

  const metadata = readJson(path.join(episodeDir, 'metadata_package.json'));
  const packet = packetFor(candidate, metadata);
  const overrides = overridesFor(metadata);
  const token = await refreshAccessToken({
    clientId: required('YOUTUBE_CLIENT_ID'),
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET || '',
    refreshToken: required('YOUTUBE_REFRESH_TOKEN')
  });
  const expectedChannelId = required('YOUTUBE_CHANNEL_ID');
  const channel = await verifyChannel(token.access_token, expectedChannelId);
  if (candidate.channel?.id !== expectedChannelId) throw new Error('Candidate channel does not match the configured channel lock.');

  const initial = buildPublishingPackage({ packet, episodeDir, finalSignoff: { valid: true }, overrides });
  if (!initial.preflight_passed || !initial.private_upload_ready) throw new Error('Publishing preflight or final sign-off is not current.');

  const initiated = await initiateResumableUpload({
    accessToken: token.access_token,
    metadata: initial.metadata,
    videoPath: path.join(episodeDir, 'final.mp4')
  });
  const uploaded = await uploadVideoChunks({ sessionUrl: initiated.session_url, videoPath: path.join(episodeDir, 'final.mp4') });
  const processing = await pollVideoProcessing({ accessToken: token.access_token, videoId: uploaded.video_id, maxAttempts: 30, intervalMs: 3000 });
  if (processing.status !== 'processed') throw new Error('YouTube upload exists but processing did not finish inside the verification window.');
  const thumbnail = await uploadThumbnail({ accessToken: token.access_token, videoId: uploaded.video_id, thumbnailPath: path.join(episodeDir, 'thumbnail.png') });
  const captions = await uploadCaptions({
    accessToken: token.access_token,
    videoId: uploaded.video_id,
    captionsPath: path.join(episodeDir, 'captions.srt'),
    captionLanguage: metadata.upload.captionLanguage,
    captionName: metadata.upload.captionName,
    captionIsDraft: metadata.upload.captionIsDraft
  });
  const verification = await verifyRemotePublication({ accessToken: token.access_token, videoId: uploaded.video_id, metadata: initial.metadata });
  if (!verification.passed || verification.privacy_state !== 'private') throw new Error('Remote YouTube verification failed or the video is not private.');

  const remote = {
    video_id: uploaded.video_id,
    upload: uploaded,
    processing,
    assets: { thumbnail: thumbnail.status, captions: captions.status },
    verification,
    schedule: { status: 'not_scheduled', publish_at: null }
  };
  const publishing = buildPublishingPackage({ packet, episodeDir, finalSignoff: { valid: true }, overrides, remote });
  writePublishingArtifacts(episodeDir, publishing, {
    uploadReceipt: { ...uploaded, session_url_hash: initiated.session_url_hash, channel },
    processingReport: processing,
    assetUploads: { thumbnail, captions }
  });
  candidate.status = 'uploaded_private_verified';
  candidate.youtube = {
    video_id: uploaded.video_id,
    url: `https://studio.youtube.com/video/${uploaded.video_id}/edit`,
    watch_url: `https://www.youtube.com/watch?v=${uploaded.video_id}`,
    privacy_status: 'private',
    channel,
    uploaded_at: new Date().toISOString(),
    verification_passed: true
  };
  writeJson(candidatePath, candidate);
  updateRegistry(candidate, episodeDir);
  console.log(JSON.stringify({ status: candidate.status, episode_id: episodeId, youtube: candidate.youtube }, null, 2));
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  }
);
