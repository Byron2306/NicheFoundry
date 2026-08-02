const { normalizeWhitespace, sha256Text, stableId } = require('./text');

const DEFAULT_WIKI_API = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = process.env.FOUNDRY_USER_AGENT || 'NicheFoundry/0.4 (local research tool; contact configured by operator)';

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function fetchJson(url, options = {}) {
  const attempts = Math.max(1, Math.min(Number(options.attempts || 3), 5));
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const timeout = withTimeout(Number(options.timeoutMs || 15000));
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          ...(options.headers || {})
        },
        signal: timeout.signal
      });
      if (!response.ok) {
        const error = new Error(`Research request failed with HTTP ${response.status} for ${url}`);
        error.retryable = response.status === 429 || response.status >= 500;
        const retryAfter = Number(response.headers.get('retry-after') || 0);
        error.retryAfterMs = retryAfter > 0 ? retryAfter * 1000 : 0;
        throw error;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      const retryable = error.retryable || error.name === 'AbortError' || error.cause;
      if (!retryable || attempt === attempts) throw error;
      const delay = error.retryAfterMs || Math.min(250 * (2 ** (attempt - 1)), 2000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    } finally {
      timeout.done();
    }
  }
  throw lastError || new Error('Research request failed.');
}

function buildActionApiUrl(apiBase, params) {
  const url = new URL(apiBase || DEFAULT_WIKI_API);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });
  return url;
}

async function searchTitle(query, { apiBase = DEFAULT_WIKI_API, fetcher = fetchJson } = {}) {
  const url = buildActionApiUrl(apiBase, {
    action: 'query',
    format: 'json',
    formatversion: 2,
    list: 'search',
    srsearch: query,
    srlimit: 5,
    srnamespace: 0,
    utf8: 1
  });
  const data = await fetcher(url);
  return data?.query?.search || [];
}

function tokenSet(value) {
  return new Set(
    normalizeWhitespace(String(value || ''))
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((token) => token.length >= 3)
  );
}

function normalizeResearchQuery(query) {
  return normalizeWhitespace(String(query || ''))
    .replace(/\bfor kids\b/gi, ' ')
    .replace(/\bfacts?\b/gi, ' ')
    .replace(/\bquiz\b/gi, ' ')
    .replace(/\bchallenge\b/gi, ' ')
    .replace(/\bmission\b/gi, ' ')
    .replace(/\bexplained\b/gi, ' ')
    .replace(/\bbeginner\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rankSearchResult(query, candidate = {}) {
  const normalizedQuery = normalizeResearchQuery(query) || query;
  const queryTokens = [...tokenSet(normalizedQuery)];
  const titleTokens = tokenSet(candidate.title || '');
  const snippetTokens = tokenSet(candidate.snippet || '');
  if (!queryTokens.length) return 0;
  let score = 0;
  for (const token of queryTokens) {
    if (titleTokens.has(token)) score += 3;
    if (snippetTokens.has(token)) score += 1;
  }
  const loweredTitle = normalizeWhitespace(candidate.title || '').toLowerCase();
  if (loweredTitle === normalizeWhitespace(normalizedQuery).toLowerCase()) score += 5;
  if (/\b(list|episode|episodes|podcast|fiction|disambiguation|soundtrack|character)\b/i.test(candidate.title || '')) score -= 6;
  return score;
}

function chooseBestSearchTitle(query, results = []) {
  if (!results.length) return query;
  return [...results]
    .sort((left, right) => rankSearchResult(query, right) - rankSearchResult(query, left))
    .map((item) => item.title)
    .find(Boolean) || query;
}

async function fetchPage(title, query, { apiBase = DEFAULT_WIKI_API, fetcher = fetchJson } = {}) {
  const url = buildActionApiUrl(apiBase, {
    action: 'query',
    format: 'json',
    formatversion: 2,
    redirects: 1,
    prop: 'extracts|revisions|info',
    explaintext: 1,
    exsectionformat: 'plain',
    rvprop: 'ids|timestamp|sha1',
    inprop: 'url',
    titles: title,
    utf8: 1
  });
  const data = await fetcher(url);
  const page = data?.query?.pages?.[0];
  if (!page || page.missing || !page.extract) return null;
  const revision = page.revisions?.[0] || {};
  const canonicalUrl = page.canonicalurl || page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`;
  const extract = normalizeWhitespace(page.extract).slice(0, Number(process.env.FOUNDRY_MAX_SOURCE_CHARS || 30000));
  const retrievedAt = new Date().toISOString();
  const contentHash = sha256Text(extract);
  return {
    source_id: stableId('src', `${canonicalUrl}|${revision.revid || contentHash}`),
    query,
    title: page.title,
    canonical_url: canonicalUrl,
    source_url: canonicalUrl,
    provider: 'mediawiki_action_api',
    publisher: 'Wikipedia contributors',
    source_tier: 3,
    licence: 'CC BY-SA 4.0',
    retrieved_at: retrievedAt,
    revision_id: revision.revid || null,
    parent_revision_id: revision.parentid || null,
    revision_timestamp: revision.timestamp || null,
    revision_sha1: revision.sha1 || null,
    content_hash: contentHash,
    extract,
    retrieval_status: 'retrieved'
  };
}

function fixtureSources(brief) {
  const fixtures = {
    dinosaur: 'Dinosaurs are a diverse group of reptiles of the clade Dinosauria. They first appeared during the Triassic period, between 243 and 233 million years ago. Birds are feathered theropod dinosaurs and are the only known living dinosaurs.',
    fossil: 'A fossil is any preserved remains, impression, or trace of a once-living thing from a past geological age. Fossils include bones, shells, exoskeletons, stone imprints, objects preserved in amber, hair, petrified wood, oil, coal, and DNA remnants. Paleontology is the scientific study of life that existed before the start of the Holocene epoch.',
    tyrannosaurus: 'Tyrannosaurus was a genus of large theropod dinosaur. Tyrannosaurus rex lived throughout what is now western North America during the Late Cretaceous period. It was one of the largest known land predators.',
    'tacoma narrows bridge': 'The first Tacoma Narrows Bridge opened in 1940 as a suspension bridge across Puget Sound. Its narrow and flexible deck moved noticeably in wind. On November 7, 1940, the deck entered large torsional oscillations and collapsed. Investigations changed how engineers studied aerodynamic stability in long-span bridges.',
    aeroelasticity: 'Aeroelasticity studies interactions among aerodynamic forces, structural elasticity, and inertia. Flutter is a dynamic instability in which motion and aerodynamic loading can reinforce one another. Wind-tunnel testing and coupled structural analysis are used to evaluate aeroelastic behaviour. Design changes can alter stiffness, damping, and airflow around a structure.',
    'suspension bridge': 'A suspension bridge carries its deck from vertical hangers connected to main cables. The main cables transfer loads through towers to anchorages. Deck stiffness and aerodynamic shape influence how the span responds to wind. Engineers consider static loads, dynamic loads, fatigue, damping, and maintenance during design.',
    'vindolanda tablets': 'The Vindolanda tablets are thin wooden writing tablets recovered near Hadrian’s Wall. They preserve military records and private letters from Roman Britain. Their texts mention supplies, social invitations, travel, and daily administration. The tablets provide unusually direct evidence of ordinary life at a frontier fort.',
    caligae: 'Caligae were heavy-soled sandals associated with Roman soldiers. Their leather construction and iron hobnails suited marching but also left distinctive archaeological traces. Footwear evidence can reveal manufacture, repair, supply, and the movement of military communities. Different shoe forms also appear among civilians and children.',
    vindolanda: 'Vindolanda was a Roman auxiliary fort and settlement south of Hadrian’s Wall. Waterlogged soil preserved wood, leather, textiles, and written documents. Successive building phases created layered archaeological deposits. Excavated objects help reconstruct work, family life, trade, and military logistics.',
    'speech recognition': 'Speech recognition converts spoken language into text or commands. A local workflow usually captures audio, preprocesses it, runs an acoustic or neural model, and formats a transcript. Accuracy depends on language, microphone quality, noise, and model choice. Reproducible testing compares the transcript with known reference speech.',
    ffmpeg: 'FFmpeg is a free and open-source multimedia framework for recording, converting, filtering, and streaming audio and video. Command-line options specify inputs, codecs, filters, and output containers. Users can inspect media with ffprobe before and after conversion. Exit codes and generated metadata provide evidence that a workflow succeeded.',
    debian: 'Debian is a free operating system built from packages maintained through a structured repository system. Administrators use package tools to install software and resolve dependencies. Service logs, permissions, and device access often explain multimedia workflow failures. Version and architecture information should be recorded for reproducible troubleshooting.'
  };
  return (brief.source_queries || [brief.topic]).map((query) => {
    const key = String(query).toLowerCase();
    const extract = fixtures[key] || `${query} is a focused subject within ${brief.topic}. Reliable production requires evidence linked to specific claims about ${query}.`;
    const canonicalUrl = `fixture://wikipedia/${encodeURIComponent(query)}`;
    return {
      source_id: stableId('src', `${canonicalUrl}|${extract}`),
      query,
      title: query,
      canonical_url: canonicalUrl,
      source_url: canonicalUrl,
      provider: 'offline_test_fixture',
      publisher: 'NicheFoundry test fixture',
      source_tier: 4,
      licence: 'Internal test fixture',
      retrieved_at: new Date().toISOString(),
      revision_id: null,
      revision_timestamp: null,
      content_hash: sha256Text(extract),
      extract,
      retrieval_status: 'fixture'
    };
  });
}

async function retrieveWikipediaSources(brief, options = {}) {
  const queries = [...new Set((brief.source_queries || [brief.topic]).map((item) => normalizeWhitespace(item)).filter(Boolean))];
  if (process.env.FOUNDRY_ALLOW_OFFLINE_SOURCE_FIXTURES === '1') {
    return fixtureSources({ ...brief, source_queries: queries });
  }

  const output = [];
  const errors = [];
  for (const query of queries) {
    try {
      const normalizedQuery = normalizeResearchQuery(query) || query;
      let source = await fetchPage(normalizedQuery, query, options);
      if (!source) {
        const searchedTitle = chooseBestSearchTitle(query, await searchTitle(query, options));
        source = await fetchPage(searchedTitle, query, options);
      }
      if (!source) throw new Error(`No extract found for ${query}`);
      output.push(source);
    } catch (error) {
      const cause = error.cause?.message ? ` (${error.cause.message})` : '';
      errors.push({ query, error: `${error.message || String(error)}${cause}` });
    }
  }

  if (!output.length) {
    const message = errors.map((item) => `${item.query}: ${item.error}`).join('; ');
    throw new Error(`Source retrieval produced no usable sources. ${message}`);
  }

  output.retrieval_errors = errors;
  return output;
}

async function retrieveSources(brief, options = {}) {
  const mode = brief.source_mode || 'wikipedia';
  if (mode === 'wikipedia') return retrieveWikipediaSources(brief, options);
  if (mode === 'curated_packet' && Array.isArray(brief.curated_sources) && brief.curated_sources.length) {
    return brief.curated_sources.map((source, index) => {
      const extract = normalizeWhitespace(source.extract || source.content || '');
      if (!extract) throw new Error(`Curated source ${index + 1} has no extract.`);
      const canonicalUrl = source.url || `curated://source/${index + 1}`;
      return {
        source_id: stableId('src', `${canonicalUrl}|${extract}`),
        query: source.query || source.title || brief.topic,
        title: source.title || `Curated Source ${index + 1}`,
        canonical_url: canonicalUrl,
        source_url: canonicalUrl,
        provider: 'curated_packet',
        publisher: source.publisher || 'Curated by operator',
        source_tier: Number(source.source_tier || 2),
        licence: source.licence || 'Operator supplied',
        retrieved_at: new Date().toISOString(),
        revision_id: source.revision_id || null,
        revision_timestamp: source.revision_timestamp || null,
        content_hash: sha256Text(extract),
        extract,
        retrieval_status: 'curated'
      };
    });
  }
  throw new Error(`Unsupported or incomplete source mode: ${mode}`);
}

module.exports = {
  DEFAULT_WIKI_API,
  fetchJson,
  retrieveSources,
  retrieveWikipediaSources,
  fixtureSources
};
