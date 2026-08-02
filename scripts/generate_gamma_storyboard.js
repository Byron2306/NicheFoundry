const { database, refreshPacketEvidence, persistEpisode, runGamma } = require('../server');

async function main() {
  const episodeId = String(process.argv[2] || '').trim();
  if (!episodeId) {
    console.error('Usage: node scripts/generate_gamma_storyboard.js <episode_id>');
    process.exit(1);
  }
  const packet = database.getEpisode(episodeId);
  if (!packet) {
    console.error(`Episode not found: ${episodeId}`);
    process.exit(1);
  }
  const refreshed = refreshPacketEvidence(packet, { save: true });
  const result = await runGamma(refreshed);
  persistEpisode(refreshed);
  console.log(JSON.stringify({
    episode_id: episodeId,
    summary: result.summary,
    imported_assets: result.imported_assets || [],
    thumbnail_relative_path: result.thumbnail_relative_path || null,
    gamma_id: result.gamma_id || null,
    generation_id: result.generation_id || null
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
