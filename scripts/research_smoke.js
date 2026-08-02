const { retrieveSources } = require('../lib/research');

async function main() {
  const query = process.argv.slice(2).join(' ').trim() || 'Dinosaur';
  const sources = await retrieveSources({
    topic: query,
    source_mode: 'wikipedia',
    source_queries: [query]
  });
  const summary = sources.map((source) => ({
    source_id: source.source_id,
    title: source.title,
    source_url: source.source_url,
    revision_id: source.revision_id,
    revision_timestamp: source.revision_timestamp,
    retrieved_at: source.retrieved_at,
    content_hash: source.content_hash,
    extract_characters: source.extract.length
  }));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
