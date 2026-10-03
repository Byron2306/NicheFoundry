const STUDIO_MUSIC_THEMES = {
  history_under_glass: {
    searchTerms: ['documentary', 'cinematic', 'film score', 'instrumental', 'soundtrack', 'ancient'],
    tags: ['instrumental', 'cinematic', 'ambient'],
    description: 'Cinematic historical instrumentals with museum, archival, or ancient-world energy.'
  },
  puzzle_planet: {
    searchTerms: ['adventure', 'uplifting', 'fun', 'instrumental', 'soundtrack', 'exploration'],
    tags: ['instrumental', 'adventure', 'happy'],
    description: 'Bright family-safe adventure music with forward motion and playful energy.'
  },
  failure_atlas: {
    searchTerms: ['documentary', 'technology', 'investigation', 'dark', 'instrumental', 'soundtrack'],
    tags: ['instrumental', 'documentary', 'ambient'],
    description: 'Investigative documentary underscore with tension, systems, and forensic restraint.'
  },
  practical_open_source: {
    searchTerms: ['corporate', 'technology', 'minimal', 'clean', 'focused', 'instrumental'],
    tags: ['instrumental', 'corporate', 'electronic'],
    description: 'Clean focused tech underscore for explainers, walkthroughs, and software builds.'
  }
};

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueWords(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const normalized = normalizeWhitespace(value).toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalizeWhitespace(value));
  }
  return output;
}

function studioThemeProfile(pack, topic = '') {
  const studioId = pack?.studio?.id || 'puzzle_planet';
  const preset = STUDIO_MUSIC_THEMES[studioId] || STUDIO_MUSIC_THEMES.puzzle_planet;
  const fitKeywords = Array.isArray(pack?.fit?.keywords) ? pack.fit.keywords.slice(0, 6) : [];
  const topicWords = normalizeWhitespace(topic).split(/\s+/).filter((word) => word.length > 2).slice(0, 5);
  const searchTerms = uniqueWords([...preset.searchTerms, ...topicWords, ...fitKeywords]);
  const tags = uniqueWords(preset.tags);
  return {
    studio_id: studioId,
    studio_name: pack?.studio?.name || studioId,
    description: preset.description,
    topic: normalizeWhitespace(topic),
    search_terms: searchTerms,
    tags
  };
}

function jamendoSearchUrl(clientId, query, tags, limit) {
  const url = new URL('https://api.jamendo.com/v3.0/tracks/');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('audioformat', 'mp32');
  url.searchParams.set('audiodlformat', 'mp32');
  url.searchParams.set('boost', 'popularity_total');
  url.searchParams.set('include', 'musicinfo');
  url.searchParams.set('order', 'popularity_total');
  url.searchParams.set('search', query);
  url.searchParams.set('vocalinstrumental', 'instrumental');
  url.searchParams.set('speed', 'medium');
  url.searchParams.set('durationbetween', '45_420');
  // Commercial campaign videos may not use NC material, and synchronising or
  // trimming a track is incompatible with ND. Keep ShareAlike out as well so
  // the finished advert does not inherit an avoidable licence obligation.
  url.searchParams.set('ccnc', 'false');
  url.searchParams.set('ccnd', 'false');
  url.searchParams.set('ccsa', 'false');
  if (tags.length) url.searchParams.set('tags', tags.join(','));
  return url.toString();
}

function licenceKey(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('/publicdomain/zero/') || normalized === 'cc0') return 'cc0';
  if (normalized.includes('/publicdomain/mark/') || normalized === 'pdm') return 'pdm';
  if (normalized === 'by' || /\/licenses\/by\/[\d.]+\/?$/.test(normalized)) return 'by';
  return normalized;
}

function commercialRightsEvaluation({ licence, licenceUrl, downloadUrl }) {
  const key = licenceKey(licence || licenceUrl);
  const accepted = new Set(['cc0', 'pdm', 'by']);
  const issues = [];
  if (!accepted.has(key)) issues.push(`Licence '${key || 'unknown'}' is not approved for commercial campaign use.`);
  if (!downloadUrl) issues.push('No downloadable media URL was supplied.');
  return {
    passed: issues.length === 0,
    licence_key: key || null,
    commercial_use: accepted.has(key),
    adaptation_allowed: accepted.has(key),
    attribution_required: key === 'by',
    issues
  };
}

function scoreTrack(track, profile) {
  const haystack = [
    track.name,
    track.album_name,
    track.artist_name,
    track.musicinfo?.tags?.genres?.join(' '),
    track.musicinfo?.tags?.vartags?.join(' ')
  ].join(' ').toLowerCase();
  let score = Number(track.popularity_total || 0) / 1000;
  for (const term of profile.search_terms) {
    const token = String(term).toLowerCase();
    if (haystack.includes(token)) score += 1.4;
  }
  for (const tag of profile.tags) {
    const token = String(tag).toLowerCase();
    if (haystack.includes(token)) score += 1.1;
  }
  if (track.audiodownload_allowed) score += 0.6;
  if (track.license_ccurl) score += 0.4;
  return score;
}

function normalizeTrack(track, profile) {
  const normalized = {
    provider: 'jamendo',
    provider_label: 'Jamendo',
    id: track.id,
    title: track.name,
    artist: track.artist_name,
    album: track.album_name || null,
    duration_seconds: Number(track.duration || 0),
    preview_url: track.audio || null,
    page_url: track.shareurl || track.shorturl || null,
    download_url: track.audiodownload || null,
    download_allowed: Boolean(track.audiodownload_allowed),
    licence_url: track.license_ccurl || null,
    licence_name: track.license_cctitle || null,
    tags: uniqueWords([
      ...(track.musicinfo?.tags?.genres || []),
      ...(track.musicinfo?.tags?.vartags || [])
    ]).slice(0, 12),
    theme_match_reason: `Matched ${profile.studio_name} through ${profile.search_terms.slice(0, 4).join(', ')}.`,
    popularity: Number(track.popularity_total || 0)
  };
  normalized.rights = commercialRightsEvaluation({
    licenceUrl: normalized.licence_url,
    downloadUrl: normalized.download_url
  });
  return normalized;
}

function openverseSearchUrl(query, limit) {
  const url = new URL('https://api.openverse.org/v1/audio/');
  url.searchParams.set('q', query);
  // Anonymous Openverse clients currently allow at most 20 results per page.
  url.searchParams.set('page_size', String(Math.min(Math.max(limit, 10), 20)));
  url.searchParams.set('license', 'cc0,by,pdm');
  url.searchParams.set('license_type', 'commercial,modification');
  url.searchParams.set('extension', 'mp3,ogg,wav');
  url.searchParams.set('mature', 'false');
  return url.toString();
}

function normalizeOpenverseTrack(track, profile) {
  const normalized = {
    provider: 'openverse',
    provider_label: `Openverse / ${track.source || track.provider || 'open media'}`,
    id: track.id,
    title: track.title || 'Untitled track',
    artist: track.creator || 'Unknown creator',
    album: track.audio_set?.title || null,
    duration_seconds: Number(track.duration || 0) / 1000,
    preview_url: track.url || null,
    page_url: track.foreign_landing_url || track.detail_url || null,
    download_url: track.url || null,
    download_allowed: Boolean(track.url),
    licence_url: track.license_url || null,
    licence_name: [String(track.license || '').toUpperCase(), track.license_version].filter(Boolean).join(' '),
    attribution: track.attribution || null,
    tags: uniqueWords([
      ...(track.genres || []),
      ...(track.tags || []).map((tag) => typeof tag === 'string' ? tag : tag?.name)
    ]).slice(0, 12),
    theme_match_reason: `Matched ${profile.studio_name} through open-licence audio search.`,
    popularity: 0,
    source: track.source || null,
    filetype: track.filetype || null
  };
  normalized.rights = commercialRightsEvaluation({
    licence: track.license,
    licenceUrl: normalized.licence_url,
    downloadUrl: normalized.download_url
  });
  return normalized;
}

async function discoverOpenverseMusic({ pack, topic = '', limit = 5 }) {
  const profile = studioThemeProfile(pack, topic);
  const queries = uniqueWords([
    [profile.topic, 'background music'].filter(Boolean).join(' '),
    `${profile.search_terms.slice(0, 2).join(' ')} background music`,
    `${studioIdToFallbackQuery(profile.studio_id)} background`,
    'soft corporate background instrumental',
    'ambient documentary background instrumental'
  ]);
  const collected = new Map();
  const issues = [];

  for (const query of queries) {
    try {
      const response = await fetch(openverseSearchUrl(query, Math.max(limit * 4, 20)), {
        headers: { 'User-Agent': 'NicheFoundry/1.0 (open-licence media discovery)' }
      });
      if (!response.ok) {
        issues.push(`Openverse returned HTTP ${response.status} for query "${query}".`);
        continue;
      }
      const payload = await response.json();
      for (const raw of payload.results || []) {
        const track = normalizeOpenverseTrack(raw, profile);
        if (!track.id || !track.rights.passed || track.duration_seconds < 45) continue;
        collected.set(String(track.id), track);
      }
      if (collected.size >= limit * 2) break;
    } catch (error) {
      issues.push(`Openverse discovery failed for "${query}": ${error.message}`);
    }
  }

  const candidates = [...collected.values()]
    .map((track) => ({
      track,
      score: scoreTrack({
        name: track.title,
        album_name: track.album,
        artist_name: track.artist,
        musicinfo: { tags: { genres: track.tags, vartags: [] } }
      }, profile)
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ track }) => track);

  return {
    provider: 'openverse',
    configured: true,
    profile,
    candidates,
    issues: candidates.length ? issues : [...issues, 'No commercially reusable Openverse tracks matched the current theme.'],
    rights_policy: 'CC0, Public Domain Mark, or CC BY only; commercial use and adaptation required.',
    searched_at: new Date().toISOString()
  };
}

async function fetchOpenverseTrack({ id, pack, topic = '' }) {
  const profile = studioThemeProfile(pack, topic);
  const response = await fetch(`https://api.openverse.org/v1/audio/${encodeURIComponent(id)}/`, {
    headers: { 'User-Agent': 'NicheFoundry/1.0 (open-licence media discovery)' }
  });
  if (!response.ok) throw new Error(`Openverse returned HTTP ${response.status} for track '${id}'.`);
  const track = normalizeOpenverseTrack(await response.json(), profile);
  if (!track.rights.passed) throw new Error(track.rights.issues.join(' '));
  return track;
}

async function discoverThemeMusic({ pack, topic = '', limit = 5 }) {
  const clientId = process.env.JAMENDO_CLIENT_ID;
  const profile = studioThemeProfile(pack, topic);
  if (!clientId) {
    return {
      provider: 'jamendo',
      configured: false,
      profile,
      candidates: [],
      issues: ['JAMENDO_CLIENT_ID is not configured.'],
      searched_at: new Date().toISOString()
    };
  }

  const queries = [
    profile.search_terms.slice(0, 2).join(' '),
    profile.search_terms.slice(0, 1).join(' ') + ' instrumental',
    studioIdToFallbackQuery(profile.studio_id),
    [profile.topic, 'instrumental'].filter(Boolean).join(' '),
    'instrumental soundtrack'
  ].map((query) => normalizeWhitespace(query)).filter(Boolean);

  const collected = new Map();
  for (const query of queries) {
    for (const tagMode of [profile.tags, []]) {
      const response = await fetch(jamendoSearchUrl(clientId, query, tagMode, Math.max(limit * 4, 12)));
      if (!response.ok) throw new Error(`Jamendo returned HTTP ${response.status} for query "${query}".`);
      const payload = await response.json();
      for (const track of payload.results || []) {
        if (!track?.id) continue;
        collected.set(String(track.id), track);
      }
      if (collected.size >= limit * 3) break;
    }
    if (collected.size >= limit * 3) break;
  }

  const candidates = [...collected.values()]
    .map((track) => ({ track, score: scoreTrack(track, profile) }))
    .sort((left, right) => right.score - left.score)
    .map(({ track }) => normalizeTrack(track, profile))
    .filter((track) => track.rights.passed)
    .slice(0, limit);

  if (candidates.length < limit) {
    const openverse = await discoverOpenverseMusic({ pack, topic, limit });
    const merged = [...candidates];
    const seen = new Set(merged.map((track) => `${track.title}|${track.artist}`.toLowerCase()));
    for (const track of openverse.candidates) {
      const key = `${track.title}|${track.artist}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(track);
      if (merged.length >= limit) break;
    }
    return {
      provider: candidates.length ? 'jamendo+openverse' : 'openverse',
      configured: true,
      profile,
      candidates: merged,
      issues: merged.length ? openverse.issues : ['No commercially reusable tracks were returned.'],
      rights_policy: 'CC0, Public Domain Mark, or CC BY only; commercial use and adaptation required.',
      searched_at: new Date().toISOString()
    };
  }

  return {
    provider: 'jamendo',
    configured: true,
    profile,
    candidates,
    issues: candidates.length ? [] : ['No matching tracks were returned for the current studio theme.'],
    rights_policy: 'CC0, Public Domain Mark, or CC BY only; commercial use and adaptation required.',
    searched_at: new Date().toISOString()
  };
}

function studioIdToFallbackQuery(studioId) {
  if (studioId === 'history_under_glass') return 'documentary instrumental';
  if (studioId === 'puzzle_planet') return 'adventure instrumental';
  if (studioId === 'failure_atlas') return 'dark documentary instrumental';
  if (studioId === 'practical_open_source') return 'corporate instrumental';
  return 'instrumental soundtrack';
}

module.exports = {
  STUDIO_MUSIC_THEMES,
  studioThemeProfile,
  jamendoSearchUrl,
  licenceKey,
  commercialRightsEvaluation,
  discoverOpenverseMusic,
  fetchOpenverseTrack,
  discoverThemeMusic
};
