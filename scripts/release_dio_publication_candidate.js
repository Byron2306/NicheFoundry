#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  refreshAccessToken,
  updateVideoRelease,
  getVideoRemoteState
} = require('../lib/publishing_system');

const ROOT = path.resolve(__dirname, '..');
const REGISTRY_PATH = path.resolve(ROOT, '../KnowEdge_AutoRelease_Suite/deliverables/dio_video_candidates/DIO_VIDEO_CANDIDATE_REGISTRY.json');
const episodeId = process.argv[process.argv.indexOf('--episode-id') + 1];
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const writeJson = (filePath, value) => fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);

function required(name) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
  return process.env[name];
}

function locate() {
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

async function verifyChannel(accessToken, expectedChannelId) {
  const response = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${accessToken}` } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || 'Unable to verify the authorised YouTube channel.');
  const channel = payload.items?.[0];
  if (!channel || channel.id !== expectedChannelId) throw new Error('YouTube channel lock refused public release.');
  return { id: channel.id, title: channel.snippet?.title || null };
}

async function main() {
  if (!episodeId || episodeId.startsWith('--')) throw new Error('Use --episode-id <candidate id>.');
  const { episodeDir, candidatePath, candidate } = locate();
  const videoId = candidate.youtube?.video_id;
  if (!videoId || !candidate.youtube?.verification_passed) throw new Error('A verified private YouTube upload is required before public release.');
  if (candidate.youtube.privacy_status === 'public') return console.log(JSON.stringify(candidate.youtube, null, 2));

  const metadata = readJson(path.join(episodeDir, 'metadata_package.json'));
  const token = await refreshAccessToken({
    clientId: required('YOUTUBE_CLIENT_ID'),
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET || '',
    refreshToken: required('YOUTUBE_REFRESH_TOKEN')
  });
  const channel = await verifyChannel(token.access_token, required('YOUTUBE_CHANNEL_ID'));
  await updateVideoRelease({ accessToken: token.access_token, videoId, metadata, privacyStatus: 'public' });
  const remote = await getVideoRemoteState({ accessToken: token.access_token, videoId });
  if (remote.status?.privacyStatus !== 'public' || remote.status?.uploadStatus !== 'processed') {
    throw new Error('YouTube did not verify the canonical video as processed and public.');
  }
  const publishedAt = new Date().toISOString();
  candidate.status = 'published_public_verified';
  candidate.youtube = {
    ...candidate.youtube,
    privacy_status: 'public',
    channel,
    published_at: publishedAt,
    public_verification_passed: true
  };
  writeJson(candidatePath, candidate);
  writeJson(path.join(episodeDir, 'youtube_publication_receipt.json'), {
    schema: 'dio.youtube_publication_receipt.v1',
    episode_id: episodeId,
    video_id: videoId,
    privacy_status: 'public',
    upload_status: remote.status.uploadStatus,
    channel,
    published_at: publishedAt
  });
  const registry = readJson(REGISTRY_PATH);
  const item = registry.candidates.find((value) => value.episode_id === episodeId);
  if (item) {
    item.status = candidate.status;
    item.youtube = candidate.youtube;
  }
  registry.generated_at = publishedAt;
  registry.counts.uploaded_private = registry.candidates.filter((value) => value.status === 'uploaded_private_verified').length;
  registry.counts.published_public = registry.candidates.filter((value) => value.status === 'published_public_verified').length;
  writeJson(REGISTRY_PATH, registry);
  console.log(JSON.stringify({ status: candidate.status, youtube: candidate.youtube }, null, 2));
}

main().then(() => process.exit(0), (error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

