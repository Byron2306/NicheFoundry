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
  url.searchParams.set('boost', 'popularity_total');
  url.searchParams.set('include', 'musicinfo');
  url.searchParams.set('order', 'popularity_total');
  url.searchParams.set('search', query);
  url.searchParams.set('vocalinstrumental', 'instrumental');
  url.searchParams.set('speed', 'medium');
  url.searchParams.set('durationbetween', '45_420');
  if (tags.length) url.searchParams.set('tags', tags.join(','));
  return url.toString();
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
  return {
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
    .slice(0, limit)
    .map(({ track }) => normalizeTrack(track, profile));

  return {
    provider: 'jamendo',
    configured: true,
    profile,
    candidates,
    issues: candidates.length ? [] : ['No matching tracks were returned for the current studio theme.'],
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
  discoverThemeMusic
};
