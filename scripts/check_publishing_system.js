const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildMetadataPackage,
  buildPublishingPackage,
  writePublishingArtifacts,
  validateMetadata
} = require('../lib/publishing_system');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nichefoundry-publishing-check-'));
try {
  fs.writeFileSync(path.join(root, 'final.mp4'), Buffer.alloc(4096, 1));
  fs.writeFileSync(path.join(root, 'captions.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHello world\n');
  fs.writeFileSync(path.join(root, 'thumbnail.png'), Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.alloc(128)]));
  const packet = {
    episode: { episode_id: 'publishing_check', title: 'Publishing Check', story_premise: 'A local verification fixture.' },
    brief: { studio_id: 'failure_atlas', audience_mode: 'general_family', contains_synthetic_media: false },
    sourcePacket: [{ title: 'Fixture source', source_url: 'https://example.org/source' }],
    render_production: { render_qa_report: { passed: true } }
  };
  const metadata = buildMetadataPackage(packet, {});
  const packageResult = buildPublishingPackage({ packet, episodeDir: root, finalSignoff: { valid: false } });
  const written = writePublishingArtifacts(root, packageResult);
  const report = {
    schema: 'nichefoundry.publishing_environment_check.v1',
    metadata_valid: validateMetadata(metadata).passed,
    preflight_passed: packageResult.preflight_passed,
    initial_upload_private: metadata.status.privacyStatus === 'private',
    audience_declared: typeof metadata.status.selfDeclaredMadeForKids === 'boolean',
    synthetic_media_declared: typeof metadata.status.containsSyntheticMedia === 'boolean',
    paid_placement_declared: typeof metadata.paidProductPlacementDetails.hasPaidProductPlacement === 'boolean',
    release_bundle_complete_before_remote_upload: written.release_bundle.complete,
    youtube_credentials: {
      configured: Boolean(process.env.YOUTUBE_ACCESS_TOKEN || (process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_REFRESH_TOKEN)),
      refresh_flow_configured: Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_REFRESH_TOKEN),
      static_access_token_configured: Boolean(process.env.YOUTUBE_ACCESS_TOKEN),
      values_redacted: true
    },
    upload: {
      chunk_size_bytes: Number(process.env.YOUTUBE_UPLOAD_CHUNK_SIZE || 8 * 1024 * 1024),
      process_poll_interval_ms: Number(process.env.YOUTUBE_PROCESS_POLL_INTERVAL_MS || 3000),
      process_max_attempts: Number(process.env.YOUTUBE_PROCESS_MAX_ATTEMPTS || 20)
    }
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.metadata_valid || !report.preflight_passed || !report.initial_upload_private) process.exitCode = 1;
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
