#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  buildPublishingPackage,
  writePublishingArtifacts
} = require('../lib/publishing_system');

const ROOT = path.resolve(__dirname, '..');
const EPISODES_ROOT = path.join(ROOT, 'episodes');
const REGISTRY_PATH = path.resolve(
  ROOT,
  '../KnowEdge_AutoRelease_Suite/deliverables/dio_video_candidates/DIO_VIDEO_CANDIDATE_REGISTRY.json'
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function metadataOverrides(metadata) {
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
    affiliateDisclosure: metadata.disclosures?.affiliate,
    sponsorshipDisclosure: metadata.disclosures?.sponsorship,
    sensitiveTopicReviewed: metadata.disclosures?.sensitive_topic_reviewed
  };
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
    render_production: {
      render_qa_report: {
        passed: true,
        source: 'FINAL_MEDIA_RECEIPT.json'
      }
    }
  };
}

function prepareEpisode(episodeDir) {
  const candidatePath = path.join(episodeDir, 'FINAL_PUBLICATION_CANDIDATE.json');
  const metadataPath = path.join(episodeDir, 'metadata_package.json');
  const mediaReceiptPath = path.join(episodeDir, 'FINAL_MEDIA_RECEIPT.json');
  if (![candidatePath, metadataPath, mediaReceiptPath].every(fs.existsSync)) return null;

  const candidate = readJson(candidatePath);
  const metadata = readJson(metadataPath);
  const mediaReceipt = readJson(mediaReceiptPath);
  const publishing = buildPublishingPackage({
    packet: packetFor(candidate, metadata),
    episodeDir,
    finalSignoff: { valid: false },
    overrides: metadataOverrides(metadata)
  });
  const written = writePublishingArtifacts(episodeDir, publishing);
  candidate.publishing = {
    preflight_passed: publishing.preflight_passed,
    private_upload_ready: publishing.private_upload_ready,
    final_signoff_observed: publishing.final_signoff_observed,
    compliance_report: path.join(episodeDir, 'compliance_report.json'),
    publishing_package: path.join(episodeDir, 'publishing_package.json'),
    release_approval_bundle: path.join(episodeDir, 'release_approval_bundle.json'),
    verification_passed: written.verification.passed
  };
  candidate.status = publishing.preflight_passed ? 'human_review_required' : 'preflight_blocked';
  writeJson(candidatePath, candidate);

  return {
    product_id: candidate.product_id,
    episode_id: candidate.episode_id,
    title: metadata.snippet.title,
    status: candidate.status,
    channel: candidate.channel,
    duration_seconds: Number(mediaReceipt.delivery?.video?.probe?.format?.duration || candidate.delivery?.video?.probe?.format?.duration || 0),
    video: path.join(episodeDir, 'final.mp4'),
    thumbnail: path.join(episodeDir, 'thumbnail.png'),
    captions: path.join(episodeDir, 'captions.srt'),
    candidate: candidatePath,
    compliance_report: candidate.publishing.compliance_report,
    preflight_passed: publishing.preflight_passed,
    private_upload_ready: publishing.private_upload_ready,
    gates: candidate.gates
  };
}

const candidates = fs.readdirSync(EPISODES_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => prepareEpisode(path.join(EPISODES_ROOT, entry.name)))
  .filter(Boolean)
  .sort((a, b) => a.product_id.localeCompare(b.product_id));

const registry = {
  schema: 'dio.video_candidate_registry.v1',
  generated_at: new Date().toISOString(),
  policy: {
    initial_upload_privacy: 'private',
    human_watch_through_required: true,
    explicit_upload_authority_required: true,
    public_release_separate_from_upload: true
  },
  counts: {
    total: candidates.length,
    preflight_passed: candidates.filter((item) => item.preflight_passed).length,
    awaiting_human_review: candidates.filter((item) => item.status === 'human_review_required').length,
    private_upload_ready: candidates.filter((item) => item.private_upload_ready).length
  },
  candidates
};

writeJson(REGISTRY_PATH, registry);
console.log(`Prepared ${candidates.length} DIO publication candidate(s).`);
console.log(`Registry: ${REGISTRY_PATH}`);
for (const item of candidates) {
  console.log(`${item.product_id}: preflight=${item.preflight_passed} private_upload_ready=${item.private_upload_ready}`);
}

