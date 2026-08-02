const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const crypto = require('crypto');
const { retrieveWikipediaSources } = require('./research');
const { normalizeWhitespace, sha256Text, stableId, clamp } = require('./text');

const CONNECTOR_SCHEMA = 'nichefoundry.connector.v1';
const RUN_SCHEMA = 'nichefoundry.connector_run.v1';
const ALLOWED_ADAPTERS = new Set(['mediawiki', 'curated_packet', 'rss', 'youtube_public', 'youtube_analytics', 'github_releases', 'web_document']);
const DEFAULT_USER_AGENT = process.env.FOUNDRY_USER_AGENT || 'NicheFoundry/0.5 (local connector runtime; contact configured by operator)';

function nowIso() {
  return new Date().toISOString();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hashObject(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(number, max));
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function envStatus(definition, env = process.env) {
  const auth = definition.connector.auth || { env: [] };
  const required = auth.type === 'optional_token' || auth.type === 'optional_headers' ? [] : (auth.env || []);
  const missing = required.filter((name) => !env[name]);
  const available = (auth.env || []).filter((name) => Boolean(env[name]));
  return {
    configured: missing.length === 0,
    missing_env: missing,
    available_env: available,
    secret_values_exposed: false
  };
}

function validateConnectorDefinition(definition) {
  const errors = [];
  if (!definition || typeof definition !== 'object') errors.push('Connector definition must be an object.');
  if (definition?.schema !== CONNECTOR_SCHEMA) errors.push(`schema must equal ${CONNECTOR_SCHEMA}.`);
  const connector = definition?.connector || {};
  if (!/^[a-z0-9][a-z0-9_\-]{2,80}$/.test(String(connector.id || ''))) errors.push('connector.id must be a stable lowercase identifier.');
  if (!String(connector.name || '').trim()) errors.push('connector.name is required.');
  if (!/^\d+\.\d+\.\d+$/.test(String(connector.version || ''))) errors.push('connector.version must use semantic versioning.');
  if (!String(connector.adapter || '').trim()) errors.push('connector.adapter is required.');
  else if (!ALLOWED_ADAPTERS.has(connector.adapter)) errors.push(`connector.adapter must be one of: ${[...ALLOWED_ADAPTERS].join(', ')}.`);
  if (!Array.isArray(connector.capabilities) || !connector.capabilities.length) errors.push('connector.capabilities must contain at least one capability.');
  if (!connector.auth || !Array.isArray(connector.auth.env)) errors.push('connector.auth.env must be an array.');
  if (!Number.isFinite(Number(connector.default_source_tier)) || Number(connector.default_source_tier) < 1 || Number(connector.default_source_tier) > 4) errors.push('default_source_tier must be 1-4.');
  if (!connector.trust || typeof connector.trust.can_satisfy_primary_source !== 'boolean') errors.push('connector.trust.can_satisfy_primary_source must be explicit.');
  return {
    passed: errors.length === 0,
    errors,
    content_hash: errors.length ? null : hashObject(definition)
  };
}

class ConnectorRegistry {
  constructor({ builtinDir, customDir, database = null } = {}) {
    this.builtinDir = builtinDir;
    this.customDir = customDir;
    this.database = database;
    this.connectors = new Map();
    this.reload();
  }

  loadDirectory(directory, source) {
    if (!directory || !fs.existsSync(directory)) return;
    const files = fs.readdirSync(directory).filter((name) => name.endsWith('.json')).sort();
    for (const filename of files) {
      const filePath = path.join(directory, filename);
      const definition = readJson(filePath);
      const validation = validateConnectorDefinition(definition);
      if (!validation.passed) throw new Error(`Invalid connector ${filename}: ${validation.errors.join(' ')}`);
      const record = {
        ...definition,
        installed_content_hash: validation.content_hash,
        installed_source: source,
        installed_path: filePath
      };
      this.connectors.set(definition.connector.id, record);
      this.database?.upsertConnectorDefinition?.({
        connectorId: definition.connector.id,
        name: definition.connector.name,
        version: definition.connector.version,
        adapter: definition.connector.adapter,
        source,
        contentHash: validation.content_hash,
        definition
      });
    }
  }

  reload() {
    this.connectors.clear();
    this.loadDirectory(this.builtinDir, 'builtin');
    this.loadDirectory(this.customDir, 'custom');
  }

  get(connectorId) {
    return this.connectors.get(connectorId) || null;
  }

  list() {
    return [...this.connectors.values()].map((definition) => ({
      connector_id: definition.connector.id,
      name: definition.connector.name,
      version: definition.connector.version,
      adapter: definition.connector.adapter,
      description: definition.connector.description,
      capabilities: definition.connector.capabilities,
      auth: {
        type: definition.connector.auth.type,
        env_names: definition.connector.auth.env,
        ...envStatus(definition)
      },
      source_tier: definition.connector.default_source_tier,
      source_type: definition.connector.default_source_type,
      trust: definition.connector.trust,
      source: definition.installed_source,
      content_hash: definition.installed_content_hash
    }));
  }

  install(definition) {
    const validation = validateConnectorDefinition(definition);
    if (!validation.passed) return validation;
    if (!this.customDir) throw new Error('Custom connector directory is not configured.');
    if (this.get(definition.connector.id)?.installed_source === 'builtin') throw new Error('Built-in connector IDs cannot be replaced.');
    fs.mkdirSync(this.customDir, { recursive: true });
    const target = path.join(this.customDir, `${definition.connector.id}.json`);
    fs.writeFileSync(target, `${JSON.stringify(definition, null, 2)}\n`, { mode: 0o600 });
    this.reload();
    return validation;
  }
}

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function fetchResponse(url, options = {}) {
  const attempts = boundedNumber(options.attempts, 2, 1, 5);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const timeout = timeoutSignal(boundedNumber(options.timeoutMs, 15000, 500, 120000));
    try {
      const fetcher = options.fetcher || fetch;
      const response = await fetcher(url, {
        method: options.method || 'GET',
        headers: {
          'User-Agent': DEFAULT_USER_AGENT,
          Accept: options.accept || '*/*',
          ...(options.headers || {})
        },
        body: options.body,
        signal: timeout.signal,
        redirect: options.redirect || 'follow'
      });
      if (!response || typeof response.ok !== 'boolean') return response;
      if (!response.ok) {
        const error = new Error(`Connector request failed with HTTP ${response.status} for ${url}`);
        error.retryable = response.status === 429 || response.status >= 500;
        error.statusCode = response.status;
        throw error;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !(error.retryable || error.name === 'AbortError' || error.cause)) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(250 * (2 ** (attempt - 1)), 2000)));
    } finally {
      timeout.done();
    }
  }
  throw lastError;
}

async function requestJson(url, options = {}) {
  if (options.jsonFetcher) return options.jsonFetcher(url, options);
  const response = await fetchResponse(url, { ...options, accept: 'application/json' });
  return typeof response?.json === 'function' ? response.json() : response;
}

async function requestText(url, options = {}) {
  if (options.textFetcher) return options.textFetcher(url, options);
  const response = await fetchResponse(url, options);
  if (typeof response === 'string') return { text: response, finalUrl: String(url), headers: {} };
  const limit = boundedNumber(options.maxBytes, 3000000, 1000, 15000000);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > limit) throw new Error(`Connector response exceeded ${limit} bytes.`);
  return {
    text: buffer.toString('utf8'),
    finalUrl: response.url || String(url),
    headers: Object.fromEntries(response.headers?.entries?.() || [])
  };
}

function isPrivateIp(address) {
  if (!net.isIP(address)) return false;
  if (address === '::1' || address === '0.0.0.0') return true;
  if (address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:')) return true;
  const parts = address.split('.').map(Number);
  if (parts.length === 4) {
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168);
  }
  return false;
}

function hostAllowed(hostname, allowedHosts) {
  return allowedHosts.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`));
}

async function assertPublicAllowlistedUrl(rawUrl, allowedHosts, options = {}) {
  const url = new URL(rawUrl);
  const protocols = options.allowHttpForTests ? ['http:', 'https:'] : ['https:'];
  if (!protocols.includes(url.protocol)) throw new Error('Connector URLs must use HTTPS.');
  const hosts = uniqueStrings(allowedHosts).map((host) => host.toLowerCase());
  if (!hosts.length || !hostAllowed(url.hostname.toLowerCase(), hosts)) throw new Error(`Host '${url.hostname}' is not in this connector's allowlist.`);
  if (['localhost', 'localhost.localdomain'].includes(url.hostname.toLowerCase()) || isPrivateIp(url.hostname)) throw new Error('Private-network connector targets are forbidden.');
  if (!options.skipDnsCheck) {
    const records = await dns.lookup(url.hostname, { all: true });
    if (!records.length || records.some((record) => isPrivateIp(record.address))) throw new Error('Connector target resolves to a private or invalid address.');
  }
  return url;
}

function decodeXml(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

function stripHtml(value = '') {
  return normalizeWhitespace(decodeXml(String(value)).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
}

function firstTag(block, tags) {
  for (const tag of tags) {
    const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (match) return decodeXml(match[1]).trim();
  }
  return '';
}

function atomLink(block) {
  const alternate = block.match(/<link\b[^>]*rel=["']?alternate["']?[^>]*href=["']([^"']+)["'][^>]*>/i);
  const any = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
  return decodeXml((alternate || any || [])[1] || firstTag(block, ['link']));
}

function parseFeed(xml, feedUrl) {
  const isAtom = /<feed\b/i.test(xml);
  const blocks = isAtom
    ? [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((match) => match[1])
    : [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  const feedTitle = stripHtml(firstTag(xml, ['title']));
  return blocks.map((block, index) => {
    const title = stripHtml(firstTag(block, ['title'])) || `Feed item ${index + 1}`;
    const link = isAtom ? atomLink(block) : stripHtml(firstTag(block, ['link']));
    const description = stripHtml(firstTag(block, ['content:encoded', 'content', 'summary', 'description']));
    const publishedAt = stripHtml(firstTag(block, ['published', 'updated', 'pubDate', 'dc:date'])) || null;
    const author = stripHtml(firstTag(block, ['name', 'author', 'dc:creator'])) || null;
    const guid = stripHtml(firstTag(block, ['id', 'guid'])) || link || `${feedUrl}#${index}`;
    return { title, link, description, published_at: publishedAt, author, guid, feed_title: feedTitle, feed_url: feedUrl };
  });
}

function safeDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function normalizeResearchSource(connector, raw, overrides = {}) {
  const url = raw.source_url || raw.canonical_url || raw.url || `connector://${connector.connector.id}/${raw.id || stableId('record', JSON.stringify(raw))}`;
  const extract = normalizeWhitespace(raw.extract || raw.content || raw.description || raw.body || '');
  const sourceTier = Number(raw.source_tier || overrides.source_tier || connector.connector.default_source_tier || 3);
  const sourceType = raw.source_type || overrides.source_type || connector.connector.default_source_type || 'connector_record';
  const publishedAt = safeDate(raw.published_at || raw.publication_date || raw.updated_at || raw.revision_timestamp);
  return {
    source_id: raw.source_id || stableId('src', `${url}|${raw.revision_id || publishedAt || sha256Text(extract)}`),
    query: raw.query || overrides.query || raw.title,
    title: raw.title || 'Untitled connector source',
    canonical_url: url,
    source_url: url,
    provider: connector.connector.id,
    connector_id: connector.connector.id,
    publisher: raw.publisher || raw.author || overrides.publisher || 'Unknown publisher',
    author: raw.author || null,
    source_tier: sourceTier,
    source_type: sourceType,
    primary_source: raw.primary_source != null ? Boolean(raw.primary_source) : (sourceTier === 1 && connector.connector.trust.can_satisfy_primary_source),
    licence: raw.licence || overrides.licence || 'Review required',
    published_at: publishedAt,
    retrieved_at: raw.retrieved_at || nowIso(),
    revision_id: raw.revision_id || null,
    revision_timestamp: safeDate(raw.revision_timestamp),
    content_hash: raw.content_hash || sha256Text(extract),
    extract,
    retrieval_status: raw.retrieval_status || 'retrieved',
    content_completeness: raw.content_completeness || connector.connector.trust.content_completeness,
    eligible_for_claims: raw.eligible_for_claims !== false,
    trust_notes: raw.trust_notes || connector.connector.trust.notes,
    metadata: raw.metadata || {}
  };
}

function logSignal(value, scale = 6) {
  return clamp(Math.log10(Math.max(0, Number(value) || 0) + 1) / scale, 0, 1);
}

async function runMediaWiki(definition, input, options) {
  const queries = uniqueStrings(input.queries || input.source_queries || [input.query || input.topic]);
  if (!queries.length) throw new Error('MediaWiki connector requires at least one query.');
  const brief = { topic: input.topic || queries[0], source_queries: queries };
  const sources = await retrieveWikipediaSources(brief, {
    apiBase: input.api_base || definition.connector.default_config.api_base,
    fetcher: options.mediawikiFetcher
  });
  return {
    sources: sources.map((source) => normalizeResearchSource(definition, source)),
    candidates: [],
    analytics: [],
    records: [],
    usage: { requests_estimated: queries.length * 2, query_count: queries.length },
    warnings: sources.retrieval_errors || []
  };
}

async function runCuratedPacket(definition, input) {
  const packet = Array.isArray(input.sources) ? input.sources : [];
  if (!packet.length) throw new Error('Curated packet connector requires a non-empty sources array.');
  const sources = packet.map((source, index) => {
    if (!normalizeWhitespace(source.extract || source.content || '')) throw new Error(`Curated source ${index + 1} has no extract.`);
    return normalizeResearchSource(definition, {
      ...source,
      source_tier: Number(source.source_tier || definition.connector.default_source_tier),
      primary_source: Boolean(source.primary_source || Number(source.source_tier) === 1),
      retrieval_status: 'curated',
      eligible_for_claims: source.eligible_for_claims !== false
    });
  });
  return { sources, candidates: [], analytics: [], records: [], usage: { item_count: sources.length }, warnings: [] };
}

async function runRss(definition, input, options) {
  const config = { ...definition.connector.default_config, ...(input.config || {}) };
  const feedUrls = uniqueStrings(input.feed_urls || config.feed_urls);
  if (!feedUrls.length) throw new Error('RSS connector requires feed_urls.');
  const allowedHosts = uniqueStrings(input.allowed_hosts || config.allowed_hosts || feedUrls.map((value) => new URL(value).hostname));
  const maxPerFeed = boundedNumber(input.max_items_per_feed || config.max_items_per_feed, 20, 1, 100);
  const records = [];
  for (const rawUrl of feedUrls) {
    const url = await assertPublicAllowlistedUrl(rawUrl, allowedHosts, options);
    const payload = await requestText(url, {
      ...options,
      timeoutMs: definition.connector.limits.timeout_ms,
      attempts: definition.connector.limits.attempts,
      maxBytes: definition.connector.limits.max_bytes
    });
    const final = await assertPublicAllowlistedUrl(payload.finalUrl, allowedHosts, { ...options, skipDnsCheck: options.skipDnsCheck });
    parseFeed(payload.text, final.toString()).slice(0, maxPerFeed).forEach((item) => records.push(item));
  }
  const candidates = records.map((item) => ({
    title: item.title,
    topic: item.title,
    angle: item.description || `Investigate the source item published by ${item.feed_title || new URL(item.feed_url).hostname}.`,
    viewer_job: 'understand a fresh specialist development',
    source_hints: [item.link, item.feed_url].filter(Boolean),
    discovery_source: 'rss_connector',
    published_at: safeDate(item.published_at),
    connector_evidence: { connector_id: definition.connector.id, feed_title: item.feed_title, feed_url: item.feed_url, item_guid: item.guid }
  }));
  const sources = records.filter((item) => item.description).map((item) => normalizeResearchSource(definition, {
    title: item.title,
    source_url: item.link || item.feed_url,
    publisher: item.feed_title || new URL(item.feed_url).hostname,
    author: item.author,
    published_at: item.published_at,
    extract: item.description,
    source_type: 'feed_synopsis',
    primary_source: false,
    eligible_for_claims: false,
    content_completeness: 'synopsis',
    metadata: { feed_url: item.feed_url, guid: item.guid }
  }));
  return { sources, candidates, analytics: [], records, usage: { feed_count: feedUrls.length, item_count: records.length }, warnings: ['RSS/Atom descriptions are source leads and are not eligible for claim extraction by default.'] };
}

async function runYouTubePublic(definition, input, options) {
  const apiKey = options.env?.YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YOUTUBE_API_KEY is required for YouTube public discovery.');
  const query = normalizeWhitespace(input.query || input.topic || '');
  if (!query) throw new Error('YouTube public connector requires a query.');
  const config = { ...definition.connector.default_config, ...(input.config || {}) };
  const maxResults = boundedNumber(input.max_results || config.max_results, 10, 1, 50);
  const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
  const publishedAfterDays = boundedNumber(input.published_after_days || config.published_after_days, 730, 1, 3650);
  const publishedAfter = new Date(Date.now() - publishedAfterDays * 86400000).toISOString();
  Object.entries({
    part: 'snippet', type: 'video', q: query, maxResults,
    regionCode: input.region_code || config.region_code,
    relevanceLanguage: input.relevance_language || config.relevance_language,
    publishedAfter,
    key: apiKey
  }).forEach(([key, value]) => value && searchUrl.searchParams.set(key, String(value)));
  const searchData = await requestJson(searchUrl, options);
  const ids = (searchData.items || []).map((item) => item.id?.videoId).filter(Boolean);
  if (!ids.length) return { sources: [], candidates: [], analytics: [], records: [], usage: { requests: 1, result_count: 0 }, warnings: [] };
  const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
  videosUrl.searchParams.set('part', 'snippet,statistics,contentDetails');
  videosUrl.searchParams.set('id', ids.join(','));
  videosUrl.searchParams.set('key', apiKey);
  const videosData = await requestJson(videosUrl, options);
  const records = (videosData.items || []).map((item) => ({
    video_id: item.id,
    title: item.snippet?.title || 'Untitled video',
    description: normalizeWhitespace(item.snippet?.description || ''),
    channel_id: item.snippet?.channelId || null,
    channel_title: item.snippet?.channelTitle || null,
    published_at: item.snippet?.publishedAt || null,
    views: Number(item.statistics?.viewCount || 0),
    likes: Number(item.statistics?.likeCount || 0),
    comments: Number(item.statistics?.commentCount || 0),
    duration: item.contentDetails?.duration || null,
    url: `https://www.youtube.com/watch?v=${item.id}`
  }));
  const resultCount = Number(searchData.pageInfo?.totalResults || records.length);
  const candidates = records.map((record) => {
    const engagement = record.views ? (record.likes + record.comments * 2) / record.views : 0;
    return {
      title: record.title,
      topic: record.title,
      angle: `Assess the specialist content gap around “${record.title}” rather than copying the existing video.`,
      viewer_job: 'understand a specialist topic competitors already address',
      source_hints: [record.url],
      competitor_count: resultCount,
      competitor_examples: records.slice(0, 5).map((item) => `${item.title} — ${item.channel_title}`),
      discovery_source: 'youtube_public_connector',
      signals: {
        audience_demand: Number(logSignal(record.views, 7).toFixed(3)),
        content_gap: Number(clamp(1 - logSignal(resultCount, 6) * 0.65, 0.15, 0.9).toFixed(3))
      },
      signal_details: {
        audience_demand: { basis: 'public view count', raw: record.views, formula: 'log10(views+1)/7' },
        content_gap: { basis: 'approximate search result count', raw: resultCount, formula: '1 - 0.65*log10(results+1)/6' },
        engagement_rate: Number(engagement.toFixed(6))
      },
      connector_evidence: { connector_id: definition.connector.id, video: record }
    };
  });
  return {
    sources: [],
    candidates,
    analytics: [],
    records,
    usage: { requests: 2, search_results_approximate: resultCount, returned_videos: records.length },
    warnings: ['YouTube public metadata is opportunity evidence and cannot satisfy script source requirements.']
  };
}

async function refreshGoogleAccessToken(options = {}) {
  const env = options.env || process.env;
  if (env.YOUTUBE_ACCESS_TOKEN && !env.YOUTUBE_REFRESH_TOKEN) return env.YOUTUBE_ACCESS_TOKEN;
  const required = ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Missing YouTube OAuth environment variables: ${missing.join(', ')}`);
  const body = new URLSearchParams({
    client_id: env.YOUTUBE_CLIENT_ID,
    client_secret: env.YOUTUBE_CLIENT_SECRET,
    refresh_token: env.YOUTUBE_REFRESH_TOKEN,
    grant_type: 'refresh_token'
  });
  const data = await requestJson('https://oauth2.googleapis.com/token', {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  if (!data.access_token) throw new Error('Google OAuth refresh returned no access token.');
  return data.access_token;
}

async function runYouTubeAnalytics(definition, input, options) {
  const token = await refreshGoogleAccessToken(options);
  const config = { ...definition.connector.default_config, ...(input.config || {}) };
  const endDate = safeDate(input.end_date || new Date())?.slice(0, 10);
  const startDefault = new Date(`${endDate}T00:00:00Z`);
  startDefault.setUTCDate(startDefault.getUTCDate() - boundedNumber(input.lookback_days || config.lookback_days, 90, 1, 3650));
  const startDate = safeDate(input.start_date || startDefault)?.slice(0, 10);
  const metrics = uniqueStrings(input.metrics || config.metrics);
  const dimensions = uniqueStrings(input.dimensions || config.dimensions);
  const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
  url.searchParams.set('ids', 'channel==MINE');
  url.searchParams.set('startDate', startDate);
  url.searchParams.set('endDate', endDate);
  url.searchParams.set('metrics', metrics.join(','));
  if (dimensions.length) url.searchParams.set('dimensions', dimensions.join(','));
  url.searchParams.set('sort', input.sort || '-views');
  url.searchParams.set('maxResults', String(boundedNumber(input.max_results || config.max_results, 200, 1, 200)));
  const data = await requestJson(url, { ...options, headers: { Authorization: `Bearer ${token}` } });
  const headers = (data.columnHeaders || []).map((item) => item.name);
  const analytics = (data.rows || []).map((row) => Object.fromEntries(headers.map((name, index) => [name, row[index]])));
  return {
    sources: [], candidates: [], analytics, records: analytics,
    usage: { requests: 2, row_count: analytics.length, start_date: startDate, end_date: endDate, metrics, dimensions },
    warnings: []
  };
}

async function runGitHubReleases(definition, input, options) {
  const config = { ...definition.connector.default_config, ...(input.config || {}) };
  const repositories = uniqueStrings(input.repositories || config.repositories);
  if (!repositories.length) throw new Error('GitHub release connector requires repositories in owner/name form.');
  const token = options.env?.GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': input.api_version || config.api_version || '2026-03-10',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
  const sources = [];
  const records = [];
  const candidates = [];
  for (const repository of repositories) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error(`Invalid GitHub repository '${repository}'.`);
    const repo = await requestJson(`https://api.github.com/repos/${repository}`, { ...options, headers });
    const releases = await requestJson(`https://api.github.com/repos/${repository}/releases?per_page=${boundedNumber(input.per_page || config.per_page, 10, 1, 50)}`, { ...options, headers });
    const repositoryRecord = {
      repository,
      description: repo.description || '',
      stars: Number(repo.stargazers_count || 0),
      forks: Number(repo.forks_count || 0),
      open_issues: Number(repo.open_issues_count || 0),
      default_branch: repo.default_branch,
      pushed_at: repo.pushed_at,
      updated_at: repo.updated_at,
      url: repo.html_url
    };
    records.push({ type: 'repository', ...repositoryRecord });
    const published = Array.isArray(releases) ? releases.filter((release) => !release.draft) : [];
    if (!published.length) {
      sources.push(normalizeResearchSource(definition, {
        title: `${repository} repository record`,
        source_url: repo.html_url,
        publisher: repository.split('/')[0],
        published_at: repo.updated_at,
        extract: `${repo.full_name} is ${repo.description || 'an open-source repository'}. The default branch is ${repo.default_branch}. The repository was last pushed at ${repo.pushed_at}.`,
        source_type: 'official_repository_record',
        source_tier: 1,
        primary_source: true,
        metadata: repositoryRecord
      }));
    }
    for (const release of published) {
      const body = normalizeWhitespace(release.body || 'No release notes were supplied.');
      const source = normalizeResearchSource(definition, {
        title: `${repository} ${release.name || release.tag_name}`,
        source_url: release.html_url,
        publisher: repository.split('/')[0],
        author: release.author?.login,
        published_at: release.published_at || release.created_at,
        revision_id: release.id,
        extract: `${release.name || release.tag_name}. ${body}`,
        source_type: 'official_release_record',
        source_tier: 1,
        primary_source: true,
        metadata: { repository, tag_name: release.tag_name, prerelease: Boolean(release.prerelease), assets: (release.assets || []).map((asset) => ({ name: asset.name, digest: asset.digest || null, size: asset.size })) }
      });
      sources.push(source);
      records.push({ type: 'release', repository, tag_name: release.tag_name, published_at: release.published_at, url: release.html_url });
      candidates.push({
        title: `${repository}: ${release.name || release.tag_name}`,
        topic: `${repository} ${release.tag_name} release changes`,
        angle: `Explain, test, and verify the maintainer-published changes in ${release.tag_name}.`,
        viewer_job: 'understand a current open-source release',
        source_hints: [release.html_url, repo.html_url],
        discovery_source: 'github_releases_connector',
        signals: { evidence_availability: 0.95, freshness_risk: 0.12, visual_potential: 0.62 },
        connector_evidence: { connector_id: definition.connector.id, repository, release_id: release.id }
      });
    }
  }
  return { sources, candidates, analytics: [], records, usage: { repository_count: repositories.length, request_count: repositories.length * 2, source_count: sources.length }, warnings: [] };
}

function htmlMeta(html, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const first = html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'));
    const reversed = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, 'i'));
    if (first || reversed) return decodeXml((first || reversed)[1]);
  }
  return '';
}

async function runWebDocument(definition, input, options) {
  const config = { ...definition.connector.default_config, ...(input.config || {}) };
  const urls = uniqueStrings(input.urls || config.urls);
  const allowedHosts = uniqueStrings(input.allowed_hosts || config.allowed_hosts);
  if (!urls.length) throw new Error('Web document connector requires urls.');
  if (!allowedHosts.length) throw new Error('Web document connector requires an explicit allowed_hosts list.');
  const sources = [];
  for (const rawUrl of urls) {
    const url = await assertPublicAllowlistedUrl(rawUrl, allowedHosts, options);
    const payload = await requestText(url, {
      ...options,
      timeoutMs: definition.connector.limits.timeout_ms,
      attempts: definition.connector.limits.attempts,
      maxBytes: definition.connector.limits.max_bytes,
      headers: input.headers || {}
    });
    const finalUrl = await assertPublicAllowlistedUrl(payload.finalUrl, allowedHosts, { ...options, skipDnsCheck: options.skipDnsCheck });
    const title = stripHtml(firstTag(payload.text, ['title'])) || finalUrl.hostname;
    const publishedAt = htmlMeta(payload.text, ['article:published_time', 'date', 'datePublished', 'dc.date']);
    const author = htmlMeta(payload.text, ['author', 'article:author']);
    const text = stripHtml(payload.text).slice(0, boundedNumber(input.max_source_chars, 50000, 1000, 200000));
    if (text.length < 200) throw new Error(`Web document '${finalUrl}' produced too little readable text.`);
    sources.push(normalizeResearchSource(definition, {
      title,
      source_url: finalUrl.toString(),
      publisher: input.publisher_by_host?.[finalUrl.hostname] || finalUrl.hostname,
      author,
      published_at: publishedAt,
      extract: text,
      source_tier: Number(input.source_tier || config.source_tier || definition.connector.default_source_tier),
      source_type: input.source_type || config.source_type,
      primary_source: input.primary_source === true || Number(input.source_tier || config.source_tier) === 1,
      licence: input.licence || 'Review required',
      metadata: { content_type: payload.headers['content-type'] || null }
    }));
  }
  return { sources, candidates: [], analytics: [], records: [], usage: { request_count: urls.length, source_count: sources.length }, warnings: [] };
}

const ADAPTERS = {
  mediawiki: runMediaWiki,
  curated_packet: runCuratedPacket,
  rss: runRss,
  youtube_public: runYouTubePublic,
  youtube_analytics: runYouTubeAnalytics,
  github_releases: runGitHubReleases,
  web_document: runWebDocument
};

function redactConfig(value, envNames = []) {
  const secrets = new Set(envNames.map((name) => name.toLowerCase()));
  function visit(item, key = '') {
    if (Array.isArray(item)) return item.map((entry) => visit(entry));
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([name, child]) => [name, visit(child, name)]));
    if (/token|secret|password|api[_-]?key|authorization/i.test(key) || secrets.has(key.toLowerCase())) return '[REDACTED]';
    return item;
  }
  return visit(value);
}

async function executeConnector(definition, input = {}, options = {}) {
  if (!definition) throw new Error('Connector definition not found.');
  const validation = validateConnectorDefinition(definition);
  if (!validation.passed) throw new Error(`Connector definition failed validation: ${validation.errors.join(' ')}`);
  const adapter = ADAPTERS[definition.connector.adapter];
  if (!adapter) throw new Error(`No runtime adapter exists for '${definition.connector.adapter}'.`);
  const auth = envStatus(definition, options.env || process.env);
  if (!auth.configured) throw new Error(`Connector '${definition.connector.id}' is missing environment variables: ${auth.missing_env.join(', ')}`);
  const startedAt = nowIso();
  const base = {
    schema: RUN_SCHEMA,
    run_id: options.runId || stableId('connector_run', `${definition.connector.id}|${startedAt}|${crypto.randomBytes(6).toString('hex')}`),
    connector_id: definition.connector.id,
    connector_version: definition.connector.version,
    adapter: definition.connector.adapter,
    capabilities: definition.connector.capabilities,
    input: redactConfig(input, definition.connector.auth.env),
    started_at: startedAt
  };
  try {
    const payload = await adapter(definition, input, options);
    return {
      ...base,
      status: 'completed',
      finished_at: nowIso(),
      sources: payload.sources || [],
      candidates: payload.candidates || [],
      analytics: payload.analytics || [],
      records: payload.records || [],
      usage: payload.usage || {},
      warnings: payload.warnings || [],
      error: null
    };
  } catch (error) {
    return {
      ...base,
      status: 'failed',
      finished_at: nowIso(),
      sources: [], candidates: [], analytics: [], records: [], usage: {}, warnings: [],
      error: error.message || String(error)
    };
  }
}

function defaultResearchConnectorIds(brief) {
  if (Array.isArray(brief.research_connector_ids) && brief.research_connector_ids.length) return uniqueStrings(brief.research_connector_ids);
  if (brief.source_mode === 'curated_packet') return ['curated_packet'];
  return ['mediawiki_research'];
}

function inferredConnectorInput(connectorId, brief) {
  const supplied = brief.connector_inputs?.[connectorId] || {};
  if (connectorId === 'mediawiki_research') return { topic: brief.topic, queries: brief.source_queries, ...supplied };
  if (connectorId === 'curated_packet') return { sources: brief.curated_sources || [], ...supplied };
  return supplied;
}

async function runResearchConnectorPlan(registry, brief, options = {}) {
  const connectorIds = defaultResearchConnectorIds(brief);
  const runs = [];
  const sources = [];
  const failures = [];
  for (const connectorId of connectorIds) {
    const definition = registry.get(connectorId);
    if (!definition) {
      failures.push({ connector_id: connectorId, error: 'Connector is not installed.' });
      continue;
    }
    if (!definition.connector.capabilities.includes('research_sources')) {
      failures.push({ connector_id: connectorId, error: 'Connector does not declare research_sources capability.' });
      continue;
    }
    const run = await executeConnector(definition, inferredConnectorInput(connectorId, brief), options);
    runs.push(run);
    if (run.status === 'completed') sources.push(...run.sources.filter((source) => source.eligible_for_claims !== false));
    else failures.push({ connector_id: connectorId, error: run.error });
  }
  const deduped = [];
  const seen = new Set();
  for (const source of sources) {
    const key = `${source.source_url}|${source.content_hash}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(source);
  }
  if (!deduped.length) throw new Error(`Research connector plan produced no claim-eligible sources. ${failures.map((item) => `${item.connector_id}: ${item.error}`).join('; ')}`);
  return {
    schema: 'nichefoundry.research_connector_plan.v1',
    connector_ids: connectorIds,
    executed_at: nowIso(),
    runs,
    failures,
    sources: deduped,
    passed: deduped.length > 0
  };
}

module.exports = {
  CONNECTOR_SCHEMA,
  RUN_SCHEMA,
  ConnectorRegistry,
  validateConnectorDefinition,
  executeConnector,
  runResearchConnectorPlan,
  parseFeed,
  stripHtml,
  normalizeResearchSource,
  assertPublicAllowlistedUrl,
  refreshGoogleAccessToken,
  redactConfig
};
