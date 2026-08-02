const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { normalizeWhitespace, tokens, stableId, clamp, sha256Text } = require('./text');

const AUDIO_SCHEMA_VERSION = '1.0';

const STUDIO_AUDIO_DEFAULTS = {
  failure_atlas: {
    host: { id: 'systems_investigator', name: 'The Systems Investigator', style: 'measured forensic narrator', rate_wpm: 148, pitch: 44, amplitude: 158, espeak_voice: 'en-gb', energy: 0.46 },
    secondary_host: { id: 'evidence_console', name: 'Evidence Console', style: 'brief neutral evidence readout', rate_wpm: 136, pitch: 38, amplitude: 148, espeak_voice: 'en-sc' },
    music: { family: 'low mechanical pulse', base_hz: 82, secondary_hz: 123, bed_db: -33, target_lufs: -16, true_peak_db: -1.5 },
    sfx: { default: 'mechanical_marker', frequency_hz: 220 }
  },
  history_under_glass: {
    host: { id: 'curator', name: 'The Curator', style: 'quietly cinematic evidence-led guide', rate_wpm: 142, pitch: 49, amplitude: 154, espeak_voice: 'en-gb', energy: 0.39 },
    secondary_host: { id: 'archive_voice', name: 'Archive Voice', style: 'restrained catalogue annotation', rate_wpm: 132, pitch: 42, amplitude: 146, espeak_voice: 'en-uk-north' },
    music: { family: 'museum chamber texture', base_hz: 196, secondary_hz: 293, bed_db: -32, target_lufs: -16, true_peak_db: -1.5 },
    sfx: { default: 'archive_chime', frequency_hz: 523 }
  },
  practical_open_source: {
    host: { id: 'maintainer', name: 'The Maintainer', style: 'calm practical technical guide', rate_wpm: 154, pitch: 46, amplitude: 160, espeak_voice: 'en-us', energy: 0.48 },
    secondary_host: { id: 'terminal_voice', name: 'Terminal Voice', style: 'precise command and validation readout', rate_wpm: 128, pitch: 35, amplitude: 150, espeak_voice: 'en-us' },
    music: { family: 'restrained digital pulse', base_hz: 110, secondary_hz: 440, bed_db: -34, target_lufs: -16, true_peak_db: -1.5 },
    sfx: { default: 'terminal_confirm', frequency_hz: 880 }
  },
  puzzle_planet: {
    host: { id: 'expedition_guide', name: 'The Expedition Guide', style: 'warm energetic adventure host', rate_wpm: 166, pitch: 58, amplitude: 168, espeak_voice: 'en-us', energy: 0.68 },
    secondary_host: { id: 'mission_computer', name: 'Mission Computer', style: 'playful concise mission readout', rate_wpm: 145, pitch: 64, amplitude: 160, espeak_voice: 'en-us' },
    music: { family: 'bright expedition pulse', base_hz: 164, secondary_hz: 329, bed_db: -30, target_lufs: -16, true_peak_db: -1.5 },
    sfx: { default: 'mission_ping', frequency_hz: 988 }
  }
};

const COMMON_PRONUNCIATIONS = {
  'FFmpeg': 'eff eff em peg',
  'ffmpeg': 'eff eff em peg',
  'SQLite': 'sequel lite',
  'JSON': 'jay son',
  'YAML': 'yam ul',
  'API': 'A P I',
  'CLI': 'C L I',
  'CPU': 'C P U',
  'GPU': 'G P U',
  'URL': 'U R L',
  'HTTP': 'H T T P',
  'HTTPS': 'H T T P S',
  'SSH': 'S S H',
  'Linux': 'lin ux',
  'GitHub': 'git hub',
  'YouTube': 'you tube',
  'OAuth': 'oh auth',
  'SRT': 'S R T',
  'LUFS': 'luffs'
};

function hashObject(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function studioDefaults(pack) {
  const id = pack?.studio?.id || 'puzzle_planet';
  const base = STUDIO_AUDIO_DEFAULTS[id] || STUDIO_AUDIO_DEFAULTS.puzzle_planet;
  const custom = pack.audio_system || {};
  const envBedDb = process.env.FOUNDRY_MUSIC_BED_DB;
  const resolvedBedDb = envBedDb == null || envBedDb === '' ? null : Number(envBedDb);
  const mergedMusic = {
    ...base.music,
    ...(custom.music || {}),
    ...(Number.isFinite(resolvedBedDb) ? { bed_db: resolvedBedDb } : {})
  };
  const minimumBedDbByStudio = {
    failure_atlas: -30,
    history_under_glass: -27,
    practical_open_source: -31,
    puzzle_planet: -28
  };
  const minimumBedDb = minimumBedDbByStudio[id] ?? -30;
  if (Number.isFinite(mergedMusic.bed_db) && mergedMusic.bed_db < minimumBedDb) {
    mergedMusic.bed_db = minimumBedDb;
  }
  return {
    host: { ...base.host, ...(custom.host || {}) },
    secondary_host: { ...base.secondary_host, ...(custom.secondary_host || {}) },
    music: mergedMusic,
    sfx: { ...base.sfx, ...(custom.sfx || {}) },
    provider_order: custom.provider_order || ['imported', 'voicebox', 'kokoro', 'piper', 'elevenlabs', 'openvoice', 'espeak'],
    language: custom.language || 'en',
    pronunciation_lexicon: custom.pronunciation_lexicon || []
  };
}

function buildHostProfile(pack, brief = {}) {
  const defaults = studioDefaults(pack);
  const voice = pack.voice || {};
  const host = {
    ...defaults.host,
    tone: voice.tone || defaults.host.style,
    pacing: voice.pacing || 'measured and intelligible',
    pronunciation_domains: voice.pronunciation_domains || [],
    forbidden_traits: voice.forbidden_traits || [],
    language: brief.language || defaults.language,
    provider_preferences: defaults.provider_order,
    disclosure: 'Synthetic narration must be disclosed when required by the Studio Pack or publishing jurisdiction.'
  };
  const secondary = {
    ...defaults.secondary_host,
    language: host.language,
    permitted_uses: pack?.studio?.id === 'practical_open_source'
      ? ['commands', 'paths', 'validation results']
      : pack?.studio?.id === 'puzzle_planet'
        ? ['mission prompts', 'countdowns', 'answer reveals']
        : ['source labels', 'short evidence readouts']
  };
  return {
    schema: `nichefoundry.host_profile.v${AUDIO_SCHEMA_VERSION}`,
    studio_id: pack.studio.id,
    primary_host: host,
    secondary_host: secondary,
    voice_direction: {
      emotional_ceiling: pack.studio.id === 'puzzle_planet' ? 'animated but controlled' : 'restrained and evidence-led',
      never_do: voice.forbidden_traits || [],
      pause_policy: 'Pause before causal conclusions, interpretive verdicts, commands, and answer reveals.',
      number_policy: 'Read measurements, dates, versions, and units in a form understandable without the screen.'
    },
    profile_hash: hashObject({ host, secondary, voice })
  };
}

function detectPronunciationEntries(text) {
  const found = new Map();
  const source = String(text || '');
  for (const [term, spoken] of Object.entries(COMMON_PRONUNCIATIONS)) {
    if (source.includes(term)) found.set(term, { term, spoken_form: spoken, source: 'builtin', review_required: false });
  }
  for (const match of source.matchAll(/\b[A-Z][A-Z0-9]{1,7}\b/g)) {
    const term = match[0];
    if (/^(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV)$/.test(term)) continue;
    if (!found.has(term)) found.set(term, { term, spoken_form: term.split('').join(' '), source: 'detected_acronym', review_required: true });
  }
  for (const match of source.matchAll(/(?:^|\s)(--?[a-z0-9][a-z0-9-]*)\b/gi)) {
    const term = match[1];
    found.set(term, { term, spoken_form: term.replace(/^--/, 'double dash ').replace(/^-/, 'dash ').replace(/-/g, ' '), source: 'detected_flag', review_required: true });
  }
  for (const match of source.matchAll(/(?:^|\s)(\.?\/?[\w.-]+\/[\w./-]+)/g)) {
    const term = match[1];
    found.set(term, { term, spoken_form: term.replace(/\//g, ' slash ').replace(/\./g, ' dot ').replace(/_/g, ' underscore ').replace(/-/g, ' dash '), source: 'detected_path', review_required: true });
  }
  return [...found.values()];
}

function buildPronunciationLexicon(pack, scriptPackage, brief = {}) {
  const text = (scriptPackage?.scenes || []).map((scene) => scene.narration || '').join('\n');
  const entries = new Map(detectPronunciationEntries(text).map((entry) => [entry.term, entry]));
  const defaults = studioDefaults(pack);
  const supplied = [
    ...(defaults.pronunciation_lexicon || []),
    ...(Array.isArray(brief.pronunciation_overrides) ? brief.pronunciation_overrides : [])
  ];
  for (const item of supplied) {
    if (!item || !item.term || !item.spoken_form) continue;
    entries.set(String(item.term), {
      term: String(item.term),
      spoken_form: String(item.spoken_form),
      source: item.source || 'studio_or_brief_override',
      review_required: item.review_required === true,
      notes: item.notes || null
    });
  }
  const ordered = [...entries.values()].sort((a, b) => b.term.length - a.term.length || a.term.localeCompare(b.term));
  return {
    schema: `nichefoundry.pronunciation_lexicon.v${AUDIO_SCHEMA_VERSION}`,
    studio_id: pack.studio.id,
    language: brief.language || defaults.language,
    pronunciation_domains: pack.voice?.pronunciation_domains || [],
    entries: ordered,
    unresolved_entries: ordered.filter((entry) => entry.review_required),
    lexicon_hash: hashObject(ordered)
  };
}

function applyPronunciations(text, lexicon) {
  let output = String(text || '');
  for (const entry of lexicon?.entries || []) {
    const escaped = entry.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    output = output.replace(new RegExp(`(?<![\\w])${escaped}(?![\\w])`, 'g'), entry.spoken_form);
  }
  return normalizeWhitespace(normalizeSpokenNumbersAndUnits(output));
}

function romanNumeralToWords(value) {
  const map = {
    I: 'the First',
    II: 'the Second',
    III: 'the Third',
    IV: 'the Fourth',
    V: 'the Fifth',
    VI: 'the Sixth',
    VII: 'the Seventh',
    VIII: 'the Eighth',
    IX: 'the Ninth',
    X: 'the Tenth',
    XI: 'the Eleventh',
    XII: 'the Twelfth',
    XIII: 'the Thirteenth',
    XIV: 'the Fourteenth',
    XV: 'the Fifteenth'
  };
  return map[String(value || '').toUpperCase()] || null;
}

function normalizeSpokenNumbersAndUnits(text) {
  let output = String(text || '');
  output = output.replace(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV)\b/g, (match, name, numeral) => {
    const spoken = romanNumeralToWords(numeral);
    return spoken ? `${name} ${spoken}` : match;
  });
  output = output.replace(/\b(\d+(?:\.\d+)?)\s*cm\b/gi, (_m, value) => `${value} centimeters`);
  output = output.replace(/\b(\d+(?:\.\d+)?)\s*mm\b/gi, (_m, value) => `${value} millimeters`);
  output = output.replace(/\b(\d+(?:\.\d+)?)\s*m\b/gi, (_m, value) => `${value} meters`);
  output = output.replace(/\b(\d+(?:\.\d+)?)\s*ft\b/gi, (_m, value) => `${value} feet`);
  output = output.replace(/\b(\d+(?:\.\d+)?)\s*in\b/gi, (_m, value) => `${value} inches`);
  output = output.replace(/\b(\d+(?:\.\d+)?)\s*kg\b/gi, (_m, value) => `${value} kilograms`);
  output = output.replace(/\b(\d+(?:\.\d+)?)\s*km\b/gi, (_m, value) => `${value} kilometers`);
  output = output.replace(/\b(\d+(?:\.\d+)?)\s*mi\b/gi, (_m, value) => `${value} miles`);
  output = output.replace(/\b(\d+(?:\.\d+)?)\s*BC\b/g, (_m, value) => `${value} B C`);
  output = output.replace(/\((\d+(?:\.\d+)?)\s*feet\s+(\d+(?:\.\d+)?)\s*inches\)/gi, (_m, feet, inches) => `, or about ${feet} feet ${inches} inches,`);
  output = output.replace(/\((\d+(?:\.\d+)?)\s*feet\s+(\d+)\s*inches\)/gi, (_m, feet, inches) => `, or about ${feet} feet ${inches} inches,`);
  output = output.replace(/\((\d+(?:\.\d+)?)\s*inches\)/gi, (_m, inches) => `, or about ${inches} inches,`);
  output = output.replace(/\s+,/g, ',');
  return output;
}

function pickImportedMusicBed(episodeDir) {
  const explicit = [
    'imports/music_bed.wav',
    'imports/music_bed.mp3',
    'imports/music_bed.m4a',
    'imports/music_bed.ogg'
  ].map((relative) => path.join(episodeDir, relative)).find((file) => fs.existsSync(file));
  if (explicit) return explicit;
  const choicesDir = path.join(episodeDir, 'imports', 'music_choices');
  if (!fs.existsSync(choicesDir)) return null;
  const ranked = fs.readdirSync(choicesDir)
    .filter((name) => /\.(mp3|wav|m4a|ogg)$/i.test(name))
    .map((name) => {
      const lower = name.toLowerCase();
      let score = 0;
      if (/selected|final|approved/.test(lower)) score += 100;
      if (/ambient|documentary|entering|history|cinematic/.test(lower)) score += 20;
      if (/classical|rain|storm|beats-of-heaven/.test(lower)) score -= 10;
      return { file: path.join(choicesDir, name), score, name };
    })
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
  return ranked[0]?.file || null;
}

function detectLeadingSilenceSeconds(trackPath) {
  const result = spawnSync('ffmpeg', [
    '-i', trackPath,
    '-af', 'silencedetect=noise=-40dB:d=0.2',
    '-f', 'null', '-'
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const text = `${result.stderr || ''}\n${result.stdout || ''}`;
  const match = text.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/);
  return match ? Number(match[1]) : 0;
}

function generateImportedBed(trackPath, startSeconds, targetSeconds, outputWav, music, options = {}) {
  const fadeOut = Math.max(0, targetSeconds - 1.2).toFixed(3);
  const gainDb = Number.isFinite(music?.bed_db) ? Math.max(music.bed_db + 10, -16) : -15;
  const filters = [
    `atrim=start=${startSeconds}:end=${Number(startSeconds) + Number(targetSeconds)}`,
    'asetpts=N/SR/TB',
    'highpass=f=70',
    'lowpass=f=9000',
    `volume=${gainDb}dB`,
    'acompressor=threshold=-24dB:ratio=2.0:attack=12:release=180'
  ];
  if (options.fadeIn) filters.push('afade=t=in:st=0:d=0.15');
  if (options.fadeOut) filters.push(`afade=t=out:st=${fadeOut}:d=1.2`);
  filters.push('loudnorm=I=-24:TP=-2:LRA=8');
  run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-stream_loop', '-1', '-i', trackPath,
    '-filter_complex',
    `[0:a]${filters.join(',')}[bed]`,
    '-map', '[bed]', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', outputWav
  ]);
}

function scenePerformance(pack, scene, index, hostProfile, lexicon, timingScene) {
  const studioId = pack.studio.id;
  const beat = scene.story_beat || scene.beat_id || scene.role || 'scene';
  const isTechnicalReadout = studioId === 'practical_open_source' && /(environment|setup|validation|failure|recovery)/i.test(beat);
  const isMissionReadout = studioId === 'puzzle_planet' && /(challenge|reveal|progress|mission|countdown)/i.test(beat);
  const useSecondary = isTechnicalReadout || isMissionReadout || (index > 0 && index % 5 === 0 && studioId !== 'failure_atlas');
  const host = useSecondary ? hostProfile.secondary_host : hostProfile.primary_host;
  const baseRate = Number(host.rate_wpm || 150);
  const paceModifier = /(conclusion|lesson|meaning|verdict|validation|reveal)/i.test(beat) ? -10 : /(timeline|workflow|chronology|progress)/i.test(beat) ? 8 : 0;
  const energy = clamp(Number(host.energy || 0.5) + (index === 0 ? 0.08 : 0) - (/(conclusion|meaning|verdict)/i.test(beat) ? 0.08 : 0), 0.2, 0.85);
  const emphasis = tokens(scene.narration || '', { minLength: 6 }).slice(0, 3);
  const targetSeconds = Number(timingScene?.target_duration_seconds || scene.estimated_duration_seconds || scene.duration_seconds || Math.max(5, (String(scene.narration || '').split(/\s+/).length / baseRate) * 60 + 1.2));
  const spokenText = applyPronunciations(scene.narration || '', lexicon);
  const cacheBasis = {
    text: spokenText,
    host_id: host.id,
    rate_wpm: baseRate + paceModifier,
    pitch: host.pitch,
    language: host.language,
    lexicon_hash: lexicon.lexicon_hash,
    studio_id: studioId
  };
  return {
    scene_id: scene.scene_id,
    story_beat: beat,
    host_id: host.id,
    host_name: host.name,
    narration_text: scene.narration || '',
    spoken_text: spokenText,
    target_duration_seconds: Number(targetSeconds.toFixed(3)),
    performance: {
      intention: studioId === 'failure_atlas' ? 'reconstruct causality without spectacle'
        : studioId === 'history_under_glass' ? 'invite interpretation while preserving uncertainty'
          : studioId === 'practical_open_source' ? 'guide a reproducible action and make failure safe'
            : 'sustain curiosity and reward progress',
      pace_wpm: baseRate + paceModifier,
      energy,
      pitch: host.pitch,
      amplitude: host.amplitude,
      pause_before_ms: index === 0 ? 0 : (/(conclusion|lesson|meaning|verdict|reveal)/i.test(beat) ? 500 : 180),
      pause_after_ms: /(command|validation|reveal|lesson|verdict)/i.test(beat) ? 650 : 300,
      emphasis_words: emphasis,
      forbidden_traits: pack.voice?.forbidden_traits || []
    },
    cache_key: sha256Text(JSON.stringify(cacheBasis)),
    output: {
      narration_wav: `audio/narration/${String(index + 1).padStart(2, '0')}_${scene.scene_id}.wav`,
      scene_mix_wav: `audio/scenes/${String(index + 1).padStart(2, '0')}_${scene.scene_id}.wav`,
      scene_mix_mp3: `audio/scenes/${String(index + 1).padStart(2, '0')}_${scene.scene_id}.mp3`
    }
  };
}

function providerScopedCacheKey(scene, provider) {
  return sha256Text(JSON.stringify({
    base_cache_key: scene.cache_key,
    provider,
    voicebox_api_url: provider === 'voicebox' ? process.env.VOICEBOX_API_URL || 'http://127.0.0.1:17493' : null,
    voicebox_profile: provider === 'voicebox' ? process.env.VOICEBOX_PROFILE || null : null,
    voicebox_engine: provider === 'voicebox' ? process.env.VOICEBOX_ENGINE || 'qwen' : null,
    voicebox_model_size: provider === 'voicebox' ? process.env.VOICEBOX_MODEL_SIZE || '0.6B' : null,
    kokoro_voice: provider === 'kokoro' ? process.env.KOKORO_VOICE || 'af_heart' : null,
    kokoro_lang_code: provider === 'kokoro' ? process.env.KOKORO_LANG_CODE || 'a' : null,
    kokoro_command: provider === 'kokoro' ? process.env.KOKORO_COMMAND || null : null,
    elevenlabs_voice_id: provider === 'elevenlabs' ? process.env.ELEVENLABS_VOICE_ID || null : null,
    elevenlabs_model_id: provider === 'elevenlabs' ? process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2' : null,
    openvoice_reference_audio: provider === 'openvoice' ? process.env.OPENVOICE_REFERENCE_AUDIO || null : null,
    openvoice_command: provider === 'openvoice' ? process.env.OPENVOICE_COMMAND || null : null,
    piper_model_name: provider === 'piper' ? process.env.PIPER_MODEL_NAME || null : null,
    espeak_bin: provider === 'espeak' ? process.env.ESPEAK_BIN || null : null
  }));
}

function buildSoundDesignPlan(pack, scriptPackage) {
  const defaults = studioDefaults(pack);
  const scenes = (scriptPackage?.scenes || []).map((scene, index) => ({
    scene_id: scene.scene_id,
    music_cue: index === 0 ? 'identity_open' : index === (scriptPackage.scenes.length - 1) ? 'identity_resolve' : 'continuity_bed',
    music_family: defaults.music.family,
    sfx_cues: index === 0 || /(reveal|validation|event|lesson|verdict|failure)/i.test(scene.story_beat || '') ? [defaults.sfx.default] : [],
    ducking: { mode: 'sidechain_reference', narration_priority: true, bed_gain_db: defaults.music.bed_db },
    transition: index === 0 ? 'fade_in' : 'crossfade',
    disclosure: 'Procedural reference music and effects are project-owned placeholders until replaced by cleared production assets.'
  }));
  return {
    schema: `nichefoundry.sound_design_plan.v${AUDIO_SCHEMA_VERSION}`,
    studio_id: pack.studio.id,
    music_identity: defaults.music,
    sfx_identity: defaults.sfx,
    scenes,
    rights: { creator: 'NicheFoundry procedural reference engine', licence: 'project-owned', rights_status: 'cleared', final_replacement_optional: true },
    sound_design_hash: hashObject({ music: defaults.music, sfx: defaults.sfx, scenes })
  };
}

function validateAudioPlan({ hostProfile, lexicon, performancePlan, soundDesignPlan, scriptPackage }) {
  const issues = [];
  const warnings = [];
  const scenes = performancePlan?.scenes || [];
  if (!hostProfile?.primary_host?.id) issues.push('Primary host identity is missing.');
  if (!hostProfile?.primary_host?.tone) issues.push('Primary host tone is missing.');
  if (scenes.length !== (scriptPackage?.scenes || []).length) issues.push('Audio scene coverage does not match the script package.');
  for (const scene of scenes) {
    if (!scene.spoken_text) issues.push(`Scene ${scene.scene_id} has no spoken text.`);
    if (!scene.host_id) issues.push(`Scene ${scene.scene_id} has no assigned host.`);
    if (!(scene.target_duration_seconds > 0)) issues.push(`Scene ${scene.scene_id} has no valid duration target.`);
    if (!scene.cache_key) issues.push(`Scene ${scene.scene_id} has no deterministic cache key.`);
  }
  if ((lexicon?.unresolved_entries || []).length) warnings.push(`${lexicon.unresolved_entries.length} pronunciation entries require editorial review.`);
  if (!(soundDesignPlan?.scenes || []).length) issues.push('Sound design plan is empty.');
  const uniqueHosts = new Set(scenes.map((scene) => scene.host_id));
  const plan = {
    passed: issues.length === 0,
    issues,
    warnings,
    scene_count: scenes.length,
    unique_host_count: uniqueHosts.size,
    pronunciation_entry_count: lexicon?.entries?.length || 0,
    unresolved_pronunciation_count: lexicon?.unresolved_entries?.length || 0,
    checked_at: new Date().toISOString()
  };
  return plan;
}

function buildAudioPerformancePackage({ pack, brief, scriptPackage, timingPlan, episodeId }) {
  const hostProfile = buildHostProfile(pack, brief);
  const lexicon = buildPronunciationLexicon(pack, scriptPackage, brief);
  const timingByScene = new Map((timingPlan?.scenes || []).map((scene) => [scene.scene_id, scene]));
  const scenes = (scriptPackage?.scenes || []).map((scene, index) => scenePerformance(pack, scene, index, hostProfile, lexicon, timingByScene.get(scene.scene_id)));
  const performancePlan = {
    schema: `nichefoundry.audio_performance_plan.v${AUDIO_SCHEMA_VERSION}`,
    episode_id: episodeId,
    studio_id: pack.studio.id,
    provider_policy: {
      order: studioDefaults(pack).provider_order,
      imported_assets_first: true,
      scene_level_cache: true,
      remote_provider_requires_secret: true,
      local_fallback: 'espeak_reference'
    },
    mastering: {
      sample_rate_hz: 48000,
      channels: 2,
      narration_target_lufs: -18,
      programme_target_lufs: studioDefaults(pack).music.target_lufs,
      true_peak_db: studioDefaults(pack).music.true_peak_db,
      loudness_range_target: 9,
      highpass_hz: 75,
      lowpass_hz: 14500
    },
    scenes,
    plan_hash: hashObject({ host: hostProfile.profile_hash, lexicon: lexicon.lexicon_hash, scenes })
  };
  const soundDesignPlan = buildSoundDesignPlan(pack, scriptPackage);
  const preflightReport = validateAudioPlan({ hostProfile, lexicon, performancePlan, soundDesignPlan, scriptPackage });
  return {
    schema: `nichefoundry.audio_package.v${AUDIO_SCHEMA_VERSION}`,
    episode_id: episodeId,
    studio_id: pack.studio.id,
    host_profile: hostProfile,
    pronunciation_lexicon: lexicon,
    audio_performance_plan: performancePlan,
    sound_design_plan: soundDesignPlan,
    audio_preflight_report: preflightReport,
    passed: preflightReport.passed
  };
}

function commandExists(command) {
  const result = spawnSync(command, ['--help'], { stdio: 'ignore', timeout: 5000, killSignal: 'SIGKILL' });
  return !result.error;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 60000, killSignal: 'SIGKILL', ...options });
  if (result.error) throw new Error(`${command} failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
  return result;
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function copyFile(source, target) { ensureDir(path.dirname(target)); fs.copyFileSync(source, target); }
function resolvePiper(root) {
  const candidates = [process.env.PIPER_BIN, path.join(root, 'tools', 'piper', 'piper'), 'piper'].filter(Boolean);
  const modelDir = process.env.PIPER_MODEL_DIR || path.join(root, 'assets', 'piper', 'en_US-lessac-high');
  const modelName = process.env.PIPER_MODEL_NAME || 'en_US-lessac-high';
  const model = process.env.PIPER_MODEL_FILE || `${modelName}.onnx`;
  const config = process.env.PIPER_CONFIG_FILE || `${modelName}.onnx.json`;
  const binary = candidates.find((candidate) => candidate === 'piper' ? commandExists('piper') : fs.existsSync(candidate));
  if (!binary || !fs.existsSync(path.join(modelDir, model)) || !fs.existsSync(path.join(modelDir, config))) return null;
  return { binary, model: path.join(modelDir, model), config: path.join(modelDir, config), name: modelName };
}

function espeakBinary() {
  if (process.env.ESPEAK_BIN) return process.env.ESPEAK_BIN;
  if (commandExists('espeak-ng')) return 'espeak-ng';
  return 'espeak';
}

function selectProvider(root, requested = 'auto') {
  if (requested && requested !== 'auto') return requested;
  if (resolveVoicebox()) return 'voicebox';
  if (resolveKokoro(root)) return 'kokoro';
  if (resolvePiper(root)) return 'piper';
  if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID) return 'elevenlabs';
  if (resolveOpenVoice(root)) return 'openvoice';
  if (commandExists(espeakBinary())) return 'espeak';
  throw new Error('No audio provider is available. Install Piper or eSpeak, configure ElevenLabs, or import scene audio.');
}

function resolveVoicebox() {
  const apiUrl = (process.env.VOICEBOX_API_URL || 'http://127.0.0.1:17493').replace(/\/+$/, '');
  const profile = process.env.VOICEBOX_PROFILE || '';
  if (!apiUrl || !profile) return null;
  return {
    apiUrl,
    profile,
    engine: process.env.VOICEBOX_ENGINE || 'qwen',
    modelSize: process.env.VOICEBOX_MODEL_SIZE || '0.6B',
    language: process.env.VOICEBOX_LANGUAGE || 'en',
    clientId: process.env.VOICEBOX_CLIENT_ID || 'nichefoundry'
  };
}

function resolveKokoro(root) {
  const command = process.env.KOKORO_COMMAND || path.join(root, '.venv-kokoro', 'bin', 'python');
  const wrapper = process.env.KOKORO_WRAPPER || path.join(root, 'scripts', 'kokoro_synthesize.py');
  const commandAvailable = command.includes(path.sep) ? fs.existsSync(command) : commandExists(command);
  if (!commandAvailable || !fs.existsSync(wrapper)) return null;
  return {
    command,
    wrapper,
    voice: process.env.KOKORO_VOICE || 'af_heart',
    langCode: process.env.KOKORO_LANG_CODE || 'a',
    speed: Number(process.env.KOKORO_SPEED || 1)
  };
}

function resolveOpenVoice(root) {
  const referenceAudio = process.env.OPENVOICE_REFERENCE_AUDIO || path.join(root, 'assets', 'voices', 'elevenlabs_curator', 'reference.wav');
  const command = process.env.OPENVOICE_COMMAND || path.join(root, '.venv-openvoice', 'bin', 'python');
  const wrapper = process.env.OPENVOICE_WRAPPER || path.join(root, 'scripts', 'openvoice_convert.py');
  if (!fs.existsSync(referenceAudio) || !fs.existsSync(wrapper)) return null;
  const commandAvailable = command.includes(path.sep) ? fs.existsSync(command) : commandExists(command);
  if (!commandAvailable) return null;
  return { command, wrapper, referenceAudio };
}

function synthesizeEspeak(scene, outputWav) {
  ensureDir(path.dirname(outputWav));
  run(espeakBinary(), ['-v', scene.host_id === 'terminal_voice' ? 'en-us' : 'en', '-s', String(scene.performance.pace_wpm), '-p', String(scene.performance.pitch), '-a', String(scene.performance.amplitude), '-w', outputWav, scene.spoken_text]);
}

function synthesizePiper(root, scene, outputWav) {
  const piper = resolvePiper(root);
  if (!piper) throw new Error('Piper executable or model is unavailable.');
  ensureDir(path.dirname(outputWav));
  const textFile = `${outputWav}.txt`;
  fs.writeFileSync(textFile, `${scene.spoken_text}\n`);
  run(piper.binary, ['-m', piper.model, '-c', piper.config, '-i', textFile, '-f', outputWav, '--length-scale', String(clamp(150 / scene.performance.pace_wpm, 0.75, 1.35)), '--sentence-silence', '0.15']);
  fs.unlinkSync(textFile);
}

function synthesizeKokoro(root, scene, outputWav) {
  const kokoro = resolveKokoro(root);
  if (!kokoro) throw new Error('Kokoro is unavailable. Run scripts/install_kokoro.sh or set KOKORO_COMMAND to a working Kokoro Python environment.');
  ensureDir(path.dirname(outputWav));
  const textFile = `${outputWav}.txt`;
  fs.writeFileSync(textFile, `${scene.spoken_text}\n`);
  run(kokoro.command, [
    kokoro.wrapper,
    '--text-file', textFile,
    '--output', outputWav,
    '--voice', process.env.KOKORO_VOICE || kokoro.voice,
    '--lang-code', process.env.KOKORO_LANG_CODE || kokoro.langCode,
    '--speed', String(Number(process.env.KOKORO_SPEED || kokoro.speed || 1))
  ], { timeout: Number(process.env.KOKORO_TIMEOUT_MS || 300000) });
  fs.unlinkSync(textFile);
}

async function synthesizeElevenLabs(scene, outputWav) {
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': process.env.ELEVENLABS_API_KEY },
    body: JSON.stringify({
      text: scene.spoken_text,
      model_id: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
      voice_settings: {
        stability: clamp(0.72 - scene.performance.energy * 0.18, 0.35, 0.8),
        similarity_boost: 0.78,
        style: clamp(scene.performance.energy, 0, 1),
        use_speaker_boost: true
      }
    })
  });
  if (!response.ok) throw new Error(`ElevenLabs returned HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
  const mp3 = `${outputWav}.source.mp3`;
  fs.writeFileSync(mp3, Buffer.from(await response.arrayBuffer()));
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp3, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', outputWav]);
  fs.unlinkSync(mp3);
}

async function synthesizeVoicebox(scene, outputWav) {
  const voicebox = resolveVoicebox();
  if (!voicebox) throw new Error('Voicebox is unavailable. Start the local Voicebox backend and set VOICEBOX_PROFILE in .env.');
  ensureDir(path.dirname(outputWav));

  const profilesResponse = await fetch(`${voicebox.apiUrl}/profiles`);
  if (!profilesResponse.ok) {
    throw new Error(`Voicebox /profiles returned HTTP ${profilesResponse.status}`);
  }
  const profiles = await profilesResponse.json();
  const profile = profiles.find((item) =>
    String(item.id || '') === voicebox.profile ||
    String(item.name || '').toLowerCase() === String(voicebox.profile).toLowerCase()
  );
  if (!profile?.id) {
    throw new Error(`Voicebox profile '${voicebox.profile}' was not found.`);
  }

  const generateResponse = await fetch(`${voicebox.apiUrl}/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Voicebox-Client-Id': voicebox.clientId
    },
    body: JSON.stringify({
      profile_id: profile.id,
      text: scene.spoken_text,
      language: voicebox.language,
      engine: voicebox.engine,
      model_size: voicebox.modelSize,
      instruct: scene.performance?.intention || null,
      normalize: true
    })
  });
  if (!generateResponse.ok) {
    throw new Error(`Voicebox /generate returned HTTP ${generateResponse.status}: ${(await generateResponse.text()).slice(0, 400)}`);
  }
  const generation = await generateResponse.json();
  const generationId = generation.id;
  if (!generationId) throw new Error('Voicebox /generate did not return a generation id.');

  const timeoutMs = Number(process.env.VOICEBOX_TIMEOUT_MS || 300000);
  const pollIntervalMs = Number(process.env.VOICEBOX_POLL_INTERVAL_MS || 1500);
  const startedAt = Date.now();
  let status = generation.status || 'generating';
  while (!['completed', 'failed'].includes(status)) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`Voicebox generation timed out after ${timeoutMs}ms.`);
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const historyResponse = await fetch(`${voicebox.apiUrl}/history/${encodeURIComponent(generationId)}`, {
      headers: { 'X-Voicebox-Client-Id': voicebox.clientId }
    });
    if (!historyResponse.ok) continue;
    const historyItem = await historyResponse.json();
    status = historyItem.status || status;
    if (status === 'failed') {
      throw new Error(`Voicebox generation failed: ${historyItem.error || 'unknown error'}`);
    }
    if (status === 'completed') break;
  }

  const audioResponse = await fetch(`${voicebox.apiUrl}/audio/${encodeURIComponent(generationId)}`, {
    headers: { 'X-Voicebox-Client-Id': voicebox.clientId }
  });
  if (!audioResponse.ok) {
    throw new Error(`Voicebox /audio/${generationId} returned HTTP ${audioResponse.status}`);
  }
  const sourceFile = `${outputWav}.voicebox-source`;
  fs.writeFileSync(sourceFile, Buffer.from(await audioResponse.arrayBuffer()));
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', sourceFile, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', outputWav]);
  fs.unlinkSync(sourceFile);
}

function synthesizeOpenVoice(root, scene, outputWav) {
  const openvoice = resolveOpenVoice(root);
  if (!openvoice) throw new Error('OpenVoice is unavailable. Run scripts/build_voice_reference.js and scripts/install_openvoice.sh, or set OPENVOICE_COMMAND and OPENVOICE_REFERENCE_AUDIO.');
  ensureDir(path.dirname(outputWav));
  const baseWav = `${outputWav}.base.wav`;
  if (resolvePiper(root)) synthesizePiper(root, scene, baseWav);
  else synthesizeEspeak(scene, baseWav);
  run(openvoice.command, [
    openvoice.wrapper,
    '--source', baseWav,
    '--reference', openvoice.referenceAudio,
    '--output', outputWav,
    '--repo', process.env.OPENVOICE_REPO || path.join(root, 'vendor', 'OpenVoice'),
    '--checkpoint', process.env.OPENVOICE_CHECKPOINT || path.join(root, 'vendor', 'OpenVoice', 'checkpoints_v2'),
    '--language', process.env.OPENVOICE_LANGUAGE || 'EN_NEWEST'
  ], { timeout: Number(process.env.OPENVOICE_TIMEOUT_MS || 300000) });
  if (fs.existsSync(baseWav)) fs.unlinkSync(baseWav);
}

function audioProbe(filePath) {
  const result = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,sample_rate,channels', '-of', 'json', filePath]);
  const parsed = JSON.parse(result.stdout);
  return {
    duration_seconds: Number(Number(parsed.format?.duration || 0).toFixed(3)),
    codec: parsed.streams?.[0]?.codec_name || null,
    sample_rate_hz: Number(parsed.streams?.[0]?.sample_rate || 0),
    channels: Number(parsed.streams?.[0]?.channels || 0)
  };
}

function measureLoudness(filePath) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', filePath, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const text = `${result.stderr || ''}\n${result.stdout || ''}`;
  const integrated = [...text.matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)].pop();
  const lra = [...text.matchAll(/LRA:\s*(-?\d+(?:\.\d+)?)\s*LU/g)].pop();
  const peak = [...text.matchAll(/Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/g)].pop();
  return {
    integrated_lufs: integrated ? Number(integrated[1]) : null,
    loudness_range_lu: lra ? Number(lra[1]) : null,
    true_peak_dbfs: peak ? Number(peak[1]) : null,
    measurable: Boolean(integrated)
  };
}

function masterNarration(sourceWav, targetWav, plan) {
  ensureDir(path.dirname(targetWav));
  const m = plan.mastering;
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', sourceWav, '-af', `highpass=f=${m.highpass_hz},lowpass=f=${m.lowpass_hz},acompressor=threshold=-20dB:ratio=2.5:attack=15:release=160,loudnorm=I=${m.narration_target_lufs}:TP=-2:LRA=${m.loudness_range_target}`, '-ar', String(m.sample_rate_hz), '-ac', '1', '-c:a', 'pcm_s16le', targetWav]);
}

function generateBed(scene, sound, targetSeconds, outputWav) {
  const music = sound.music_identity;
  const fadeOut = Math.max(0, targetSeconds - 0.8).toFixed(3);
  const family = String(music.family || '').toLowerCase();
  let args;
  if (family.includes('museum chamber texture')) {
    args = ['-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `sine=frequency=${music.base_hz}:sample_rate=48000:duration=${targetSeconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=${(music.base_hz * 1.5).toFixed(3)}:sample_rate=48000:duration=${targetSeconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=${music.secondary_hz}:sample_rate=48000:duration=${targetSeconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=${(music.secondary_hz * 1.333).toFixed(3)}:sample_rate=48000:duration=${targetSeconds}`,
      '-f', 'lavfi', '-i', `anoisesrc=color=violet:sample_rate=48000:duration=${targetSeconds}:amplitude=0.015`,
      '-filter_complex',
      `[0:a]volume='if(lt(mod(t\\,4.0)\\,0.50)\\,0.22*(1-mod(t\\,4.0)/0.50)\\,0)',lowpass=f=620,highpass=f=110[a0];` +
      `[1:a]volume='if(lt(mod(t+0.90\\,4.0)\\,0.32)\\,0.12*(1-mod(t+0.90\\,4.0)/0.32)\\,0)',lowpass=f=920,highpass=f=220[a1];` +
      `[2:a]volume='if(lt(mod(t+0.28\\,2.0)\\,0.22)\\,0.11*(1-mod(t+0.28\\,2.0)/0.22)\\,0)',lowpass=f=1600,highpass=f=340[a2];` +
      `[3:a]volume='if(lt(mod(t+1.10\\,6.0)\\,0.75)\\,0.06*(1-mod(t+1.10\\,6.0)/0.75)\\,0)',lowpass=f=2100,highpass=f=500[a3];` +
      `[4:a]volume=${music.bed_db + 18}dB,highpass=f=2600,lowpass=f=7800,apulsator=mode=sine:hz=0.11:amount=0.16[a4];` +
      `[a0][a1][a2][a3][a4]amix=inputs=5:normalize=0,volume=26dB,acompressor=threshold=-24dB:ratio=2.0:attack=12:release=160,afade=t=in:st=0:d=1.2,afade=t=out:st=${fadeOut}:d=0.8,loudnorm=I=-27:TP=-2:LRA=7[bed]`,
      '-map', '[bed]', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', outputWav];
  } else if (family.includes('bright expedition pulse')) {
    args = ['-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `sine=frequency=${music.base_hz}:sample_rate=48000:duration=${targetSeconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=${(music.base_hz * 1.25).toFixed(3)}:sample_rate=48000:duration=${targetSeconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=${music.secondary_hz}:sample_rate=48000:duration=${targetSeconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=${(music.secondary_hz * 1.5).toFixed(3)}:sample_rate=48000:duration=${targetSeconds}`,
      '-f', 'lavfi', '-i', `anoisesrc=color=white:sample_rate=48000:duration=${targetSeconds}:amplitude=0.012`,
      '-filter_complex',
      `[0:a]volume='if(lt(mod(t\\,1.6)\\,0.20)\\,0.20*(1-mod(t\\,1.6)/0.20)\\,0)',highpass=f=120,lowpass=f=900[a0];` +
      `[1:a]volume='if(lt(mod(t+0.20\\,0.80)\\,0.12)\\,0.16*(1-mod(t+0.20\\,0.80)/0.12)\\,0)',highpass=f=300,lowpass=f=1800[a1];` +
      `[2:a]volume='if(lt(mod(t+0.40\\,0.80)\\,0.12)\\,0.14*(1-mod(t+0.40\\,0.80)/0.12)\\,0)',highpass=f=650,lowpass=f=2800[a2];` +
      `[3:a]volume='if(lt(mod(t+0.60\\,0.80)\\,0.12)\\,0.12*(1-mod(t+0.60\\,0.80)/0.12)\\,0)',highpass=f=1100,lowpass=f=4200[a3];` +
      `[4:a]volume=${music.bed_db + 22}dB,highpass=f=3000,lowpass=f=8000,apulsator=mode=sine:hz=5.5:amount=0.65[a4];` +
      `[a0][a1][a2][a3][a4]amix=inputs=5:normalize=0,volume=24dB,acompressor=threshold=-24dB:ratio=2.2:attack=8:release=120,afade=t=in:st=0:d=0.25,afade=t=out:st=${fadeOut}:d=0.8,loudnorm=I=-26:TP=-2:LRA=7[bed]`,
      '-map', '[bed]', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', outputWav];
  } else if (family.includes('restrained digital pulse')) {
    args = ['-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `sine=frequency=${music.base_hz}:sample_rate=48000:duration=${targetSeconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=${(music.base_hz * 1.5).toFixed(3)}:sample_rate=48000:duration=${targetSeconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=${music.secondary_hz}:sample_rate=48000:duration=${targetSeconds}`,
      '-f', 'lavfi', '-i', `anoisesrc=color=white:sample_rate=48000:duration=${targetSeconds}:amplitude=0.01`,
      '-filter_complex',
      `[0:a]volume='if(lt(mod(t\\,2.0)\\,0.14)\\,0.17*(1-mod(t\\,2.0)/0.14)\\,0)',highpass=f=110,lowpass=f=760[a0];` +
      `[1:a]volume='if(lt(mod(t+0.28\\,1.0)\\,0.09)\\,0.11*(1-mod(t+0.28\\,1.0)/0.09)\\,0)',highpass=f=240,lowpass=f=1400[a1];` +
      `[2:a]volume='if(lt(mod(t+0.56\\,1.0)\\,0.09)\\,0.08*(1-mod(t+0.56\\,1.0)/0.09)\\,0)',highpass=f=1200,lowpass=f=2600[a2];` +
      `[3:a]volume=${music.bed_db + 24}dB,highpass=f=3200,lowpass=f=7000,apulsator=mode=sine:hz=4.6:amount=0.55[a3];` +
      `[a0][a1][a2][a3]amix=inputs=4:normalize=0,volume=24dB,acompressor=threshold=-24dB:ratio=2.0:attack=8:release=120,afade=t=in:st=0:d=0.3,afade=t=out:st=${fadeOut}:d=0.8,loudnorm=I=-28:TP=-2:LRA=7[bed]`,
      '-map', '[bed]', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', outputWav];
  } else {
    args = ['-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `sine=frequency=${music.base_hz}:sample_rate=48000:duration=${targetSeconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=${(music.base_hz * 1.5).toFixed(3)}:sample_rate=48000:duration=${targetSeconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=${music.secondary_hz}:sample_rate=48000:duration=${targetSeconds}`,
      '-f', 'lavfi', '-i', `anoisesrc=color=pink:sample_rate=48000:duration=${targetSeconds}:amplitude=0.012`,
      '-filter_complex',
      `[0:a]volume='if(lt(mod(t\\,1.4)\\,0.16)\\,0.18*(1-mod(t\\,1.4)/0.16)\\,0)',highpass=f=80,lowpass=f=620[a0];` +
      `[1:a]volume='if(lt(mod(t+0.32\\,1.4)\\,0.13)\\,0.12*(1-mod(t+0.32\\,1.4)/0.13)\\,0)',highpass=f=180,lowpass=f=980[a1];` +
      `[2:a]volume='if(lt(mod(t+0.72\\,2.8)\\,0.18)\\,0.09*(1-mod(t+0.72\\,2.8)/0.18)\\,0)',highpass=f=300,lowpass=f=1500[a2];` +
      `[3:a]volume=${music.bed_db + 22}dB,highpass=f=2200,lowpass=f=6000,apulsator=mode=sine:hz=3.2:amount=0.35[a3];` +
      `[a0][a1][a2][a3]amix=inputs=4:normalize=0,volume=25dB,acompressor=threshold=-23dB:ratio=2.1:attack=10:release=140,afade=t=in:st=0:d=0.4,afade=t=out:st=${fadeOut}:d=0.8,loudnorm=I=-27:TP=-2:LRA=7[bed]`,
      '-map', '[bed]', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', outputWav];
  }
  run('ffmpeg', args);
}

function generateSfx(sceneSound, sound, targetSeconds, outputWav) {
  const hasCue = (sceneSound.sfx_cues || []).length > 0;
  if (!hasCue) {
    run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=mono:d=${targetSeconds}`, '-c:a', 'pcm_s16le', outputWav]);
    return;
  }
  const start = Math.min(0.65, Math.max(0.15, targetSeconds * 0.08));
  run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${sound.sfx_identity.frequency_hz}:sample_rate=48000:duration=0.22`, '-filter_complex', `[0:a]volume=-18dB,afade=t=out:st=0.08:d=0.14,adelay=${Math.round(start * 1000)}|${Math.round(start * 1000)},apad=pad_dur=${targetSeconds}[s]`, '-map', '[s]', '-t', String(targetSeconds), '-c:a', 'pcm_s16le', outputWav]);
}

function mixScene(narrationWav, bedWav, sfxWav, targetSeconds, outputWav, outputMp3, mastering) {
  const narrationDuration = audioProbe(narrationWav).duration_seconds;
  const resolvedSeconds = Math.max(Number(targetSeconds || 0), narrationDuration + 0.45);
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', narrationWav, '-i', bedWav, '-i', sfxWav,
    '-filter_complex', `[0:a]apad=pad_dur=${resolvedSeconds},atrim=0:${resolvedSeconds}[voice];[1:a][voice]sidechaincompress=threshold=0.045:ratio=2.2:attack=16:release=180[ducked];[ducked]volume=2.8[bed_up];[voice][bed_up][2:a]amix=inputs=3:weights='1 1.25 0.8':normalize=0,loudnorm=I=${mastering.programme_target_lufs}:TP=${mastering.true_peak_db}:LRA=${mastering.loudness_range_target},aformat=channel_layouts=stereo[mix]`,
    '-map', '[mix]', '-t', String(resolvedSeconds), '-ar', String(mastering.sample_rate_hz), '-ac', '2', '-c:a', 'pcm_s16le', outputWav]);
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', outputWav, '-c:a', 'libmp3lame', '-b:a', '192k', outputMp3]);
  return resolvedSeconds;
}

function fileHash(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }

async function produceAudioAssets({ root, episodeDir, audioPackage, provider = 'auto', force = false }) {
  if (!audioPackage?.audio_preflight_report?.passed) throw new Error('Audio preflight did not pass.');
  if (!commandExists('ffmpeg') || !commandExists('ffprobe')) throw new Error('FFmpeg and FFprobe are required.');
  const selectedProvider = selectProvider(root, provider);
  const audioRoot = path.join(episodeDir, 'audio');
  const cacheDir = path.join(audioRoot, 'cache');
  const narrationDir = path.join(audioRoot, 'narration');
  const sceneDir = path.join(audioRoot, 'scenes');
  const bedDir = path.join(audioRoot, 'music_beds');
  const tempDir = path.join(audioRoot, 'tmp');
  [cacheDir, narrationDir, sceneDir, bedDir, tempDir].forEach(ensureDir);
  const soundByScene = new Map(audioPackage.sound_design_plan.scenes.map((scene) => [scene.scene_id, scene]));
  const importedMusicBed = pickImportedMusicBed(episodeDir);
  const importedMusicBedLeadIn = importedMusicBed ? detectLeadingSilenceSeconds(importedMusicBed) : 0;
  const importedMusicBedDuration = importedMusicBed ? Math.max(0.1, audioProbe(importedMusicBed).duration_seconds - importedMusicBedLeadIn) : 0;
  let importedMusicCursor = 0;
  const lastSceneIndex = Math.max(0, audioPackage.audio_performance_plan.scenes.length - 1);
  const assets = [];
  const sceneResults = [];
  const importRegistryPath = path.join(episodeDir, 'audio_imports.json');
  let importRegistry = { assets: [] };
  if (fs.existsSync(importRegistryPath)) {
    try { importRegistry = JSON.parse(fs.readFileSync(importRegistryPath, 'utf8')); }
    catch (error) { throw new Error(`audio_imports.json is invalid: ${error.message}`); }
  }
  const importsByScene = new Map((importRegistry.assets || []).map((asset) => [asset.scene_id, asset]));
  let cacheHits = 0;
  for (const [sceneIndex, scene] of audioPackage.audio_performance_plan.scenes.entries()) {
    const raw = path.join(tempDir, `${scene.scene_id}.raw.wav`);
    const narrationWav = path.join(episodeDir, scene.output.narration_wav);
    let usedProvider = selectedProvider;
    let cacheHit = false;
    const registeredImport = importsByScene.get(scene.scene_id);
    const registeredPath = registeredImport?.relative_path ? path.resolve(episodeDir, registeredImport.relative_path) : null;
    const importedCandidates = [registeredPath].filter(Boolean);
    const imported = importedCandidates.find((candidate) => {
      const relative = path.relative(episodeDir, candidate);
      return relative && !relative.startsWith('..') && !path.isAbsolute(relative) && fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    });
    if (imported) usedProvider = 'imported';
    const masteredCache = path.join(cacheDir, `${providerScopedCacheKey(scene, usedProvider)}.wav`);
    if (!force && fs.existsSync(masteredCache)) {
      copyFile(masteredCache, narrationWav);
      cacheHit = true;
      cacheHits += 1;
    } else {
      if (usedProvider === 'imported') {
        run('ffmpeg', ['-y', '-loglevel', 'error', '-i', imported, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', raw]);
      } else if (usedProvider === 'voicebox') {
        await synthesizeVoicebox(scene, raw);
      } else if (usedProvider === 'kokoro') {
        synthesizeKokoro(root, scene, raw);
      } else if (usedProvider === 'piper') {
        synthesizePiper(root, scene, raw);
      } else if (usedProvider === 'openvoice') {
        synthesizeOpenVoice(root, scene, raw);
      } else if (usedProvider === 'elevenlabs') {
        await synthesizeElevenLabs(scene, raw);
      } else if (usedProvider === 'espeak') {
        synthesizeEspeak(scene, raw);
      } else {
        throw new Error(`Unsupported audio provider: ${usedProvider}`);
      }
      masterNarration(raw, masteredCache, audioPackage.audio_performance_plan);
      copyFile(masteredCache, narrationWav);
    }
    const sceneSound = soundByScene.get(scene.scene_id);
    const targetSeconds = Math.max(scene.target_duration_seconds, audioProbe(narrationWav).duration_seconds + 0.45);
    const bed = path.join(tempDir, `${scene.scene_id}.bed.wav`);
    const sfx = path.join(tempDir, `${scene.scene_id}.sfx.wav`);
    const exportedBedWav = path.join(bedDir, `${scene.scene_id}.wav`);
    const exportedBedMp3 = path.join(bedDir, `${scene.scene_id}.mp3`);
    if (importedMusicBed) {
      const musicalStart = importedMusicBedLeadIn + (importedMusicCursor % importedMusicBedDuration);
      generateImportedBed(importedMusicBed, musicalStart, targetSeconds, bed, audioPackage.sound_design_plan.music_identity, {
        fadeIn: sceneIndex === 0,
        fadeOut: sceneIndex === lastSceneIndex
      });
      importedMusicCursor += targetSeconds;
    } else {
      generateBed(scene, audioPackage.sound_design_plan, targetSeconds, bed);
    }
    copyFile(bed, exportedBedWav);
    run('ffmpeg', ['-y', '-loglevel', 'error', '-i', exportedBedWav, '-c:a', 'libmp3lame', '-b:a', '192k', exportedBedMp3]);
    generateSfx(sceneSound, audioPackage.sound_design_plan, targetSeconds, sfx);
    const mixWav = path.join(episodeDir, scene.output.scene_mix_wav);
    const mixMp3 = path.join(episodeDir, scene.output.scene_mix_mp3);
    const resolved = mixScene(narrationWav, bed, sfx, targetSeconds, mixWav, mixMp3, audioPackage.audio_performance_plan.mastering);
    const probe = audioProbe(mixWav);
    const loudness = measureLoudness(mixWav);
    const drift = scene.target_duration_seconds ? (resolved - scene.target_duration_seconds) / scene.target_duration_seconds : 0;
    sceneResults.push({
      scene_id: scene.scene_id, host_id: scene.host_id, provider: usedProvider, cache_hit: cacheHit,
      cache_key: scene.cache_key, target_duration_seconds: scene.target_duration_seconds,
      resolved_duration_seconds: Number(resolved.toFixed(3)), duration_drift_ratio: Number(drift.toFixed(4)),
      narration_wav: scene.output.narration_wav, target_audio: scene.output.scene_mix_mp3,
      scene_mix_wav: scene.output.scene_mix_wav, probe, loudness, status: 'audio_ready'
    });
    for (const [kind, rel] of [['narration_master', scene.output.narration_wav], ['scene_mix_wav', scene.output.scene_mix_wav], ['scene_mix_mp3', scene.output.scene_mix_mp3]]) {
      const abs = path.join(episodeDir, rel);
      assets.push({
        asset_id: stableId('aud', `${scene.scene_id}:${kind}:${fileHash(abs)}`),
        scene_id: scene.scene_id,
        asset_type: kind,
        relative_path: rel,
        provider: usedProvider,
        creator: usedProvider === 'imported' ? registeredImport.creator : `NicheFoundry ${usedProvider} adapter`,
        rights_status: usedProvider === 'imported' ? registeredImport.rights_status : 'cleared',
        licence: usedProvider === 'imported' ? registeredImport.licence : 'project-owned-output',
        source_relative_path: usedProvider === 'imported' ? registeredImport.relative_path : null,
        source_sha256: usedProvider === 'imported' ? registeredImport.sha256 || fileHash(imported) : null,
        sha256: fileHash(abs),
        size_bytes: fs.statSync(abs).size,
        status: 'ready'
      });
    }
    for (const [kind, abs] of [['music_bed_wav', exportedBedWav], ['music_bed_mp3', exportedBedMp3]]) {
      assets.push({
        asset_id: stableId('aud', `${scene.scene_id}:${kind}:${fileHash(abs)}`),
        scene_id: scene.scene_id,
        asset_type: kind,
        relative_path: path.relative(episodeDir, abs),
        provider: importedMusicBed ? 'imported_music_bed' : 'procedural_music_bed',
        creator: importedMusicBed ? 'Imported music bed' : 'NicheFoundry audio compositor',
        rights_status: 'cleared',
        licence: 'project-owned-output',
        source_relative_path: importedMusicBed ? path.relative(episodeDir, importedMusicBed) : null,
        source_sha256: importedMusicBed ? fileHash(importedMusicBed) : null,
        sha256: fileHash(abs),
        size_bytes: fs.statSync(abs).size,
        status: 'ready'
      });
    }
    for (const temp of [raw, bed, sfx]) if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  const concatList = path.join(tempDir, 'episode_scenes.txt');
  const bedConcatList = path.join(tempDir, 'episode_beds.txt');
  fs.writeFileSync(concatList, sceneResults.map((scene) => `file '${path.join(episodeDir, scene.scene_mix_wav).replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  fs.writeFileSync(bedConcatList, sceneResults.map((scene) => `file '${path.join(episodeDir, 'audio', 'music_beds', `${scene.scene_id}.wav`).replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  const episodeWav = path.join(audioRoot, 'episode_audio_preview.wav');
  const episodeMp3 = path.join(audioRoot, 'episode_audio_preview.mp3');
  const episodeBedWav = path.join(audioRoot, 'episode_music_bed_preview.wav');
  const episodeBedMp3 = path.join(audioRoot, 'episode_music_bed_preview.mp3');
  run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concatList, '-c:a', 'pcm_s16le', episodeWav]);
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', episodeWav, '-c:a', 'libmp3lame', '-b:a', '192k', episodeMp3]);
  run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', bedConcatList, '-c:a', 'pcm_s16le', episodeBedWav]);
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', episodeBedWav, '-c:a', 'libmp3lame', '-b:a', '192k', episodeBedMp3]);
  for (const [kind, abs] of [['episode_audio_preview_wav', episodeWav], ['episode_audio_preview_mp3', episodeMp3], ['episode_music_bed_preview_wav', episodeBedWav], ['episode_music_bed_preview_mp3', episodeBedMp3]]) {
    assets.push({ asset_id: stableId('aud', `${kind}:${fileHash(abs)}`), scene_id: null, asset_type: kind, relative_path: path.relative(episodeDir, abs), provider: selectedProvider, creator: 'NicheFoundry audio compositor', rights_status: 'cleared', licence: 'project-owned-output', sha256: fileHash(abs), size_bytes: fs.statSync(abs).size, status: 'ready' });
  }
  const loudnessReport = {
    schema: `nichefoundry.loudness_report.v${AUDIO_SCHEMA_VERSION}`,
    target_lufs: audioPackage.audio_performance_plan.mastering.programme_target_lufs,
    true_peak_limit_dbfs: audioPackage.audio_performance_plan.mastering.true_peak_db,
    episode: { probe: audioProbe(episodeWav), loudness: measureLoudness(episodeWav) },
    scenes: sceneResults.map((scene) => ({ scene_id: scene.scene_id, ...scene.loudness, duration_drift_ratio: scene.duration_drift_ratio }))
  };
  const issues = [];
  const warnings = [];
  for (const scene of sceneResults) {
    if (!scene.probe.duration_seconds || scene.probe.sample_rate_hz !== 48000 || scene.probe.channels !== 2) issues.push(`Scene ${scene.scene_id} has an invalid audio stream.`);
    if (Math.abs(scene.duration_drift_ratio) > 0.5) issues.push(`Scene ${scene.scene_id} duration drift exceeds 50%.`);
    else if (Math.abs(scene.duration_drift_ratio) > 0.2) warnings.push(`Scene ${scene.scene_id} duration drift exceeds 20%.`);
    if (scene.loudness.integrated_lufs != null && Math.abs(scene.loudness.integrated_lufs - audioPackage.audio_performance_plan.mastering.programme_target_lufs) > 4) warnings.push(`Scene ${scene.scene_id} loudness is outside the ±4 LU reference window.`);
    if (scene.loudness.true_peak_dbfs != null && scene.loudness.true_peak_dbfs > -0.8) issues.push(`Scene ${scene.scene_id} true peak is too high.`);
  }
  const performanceReport = {
    schema: `nichefoundry.audio_performance_report.v${AUDIO_SCHEMA_VERSION}`,
    passed: issues.length === 0,
    issues, warnings,
    provider: selectedProvider,
    scene_count: sceneResults.length,
    cache_hits: cacheHits,
    cache_hit_ratio: sceneResults.length ? Number((cacheHits / sceneResults.length).toFixed(3)) : 0,
    host_count: new Set(sceneResults.map((scene) => scene.host_id)).size,
    episode_duration_seconds: loudnessReport.episode.probe.duration_seconds,
    checked_at: new Date().toISOString()
  };
  const manifest = {
    schema: `nichefoundry.audio_manifest.v${AUDIO_SCHEMA_VERSION}`,
    generated_at: new Date().toISOString(), provider: selectedProvider,
    note: 'Scene-level narration, procedural reference sound design, mastering, and cached performance outputs.',
    episode_preview: path.relative(episodeDir, episodeMp3),
    scenes: sceneResults
  };
  const hashes = { schema: `nichefoundry.audio_asset_hashes.v${AUDIO_SCHEMA_VERSION}`, complete: assets.every((asset) => asset.sha256), assets: assets.map((asset) => ({ asset_id: asset.asset_id, relative_path: asset.relative_path, sha256: asset.sha256, size_bytes: asset.size_bytes })) };
  return { provider: selectedProvider, audio_manifest: manifest, audio_assets: assets, audio_asset_hashes: hashes, loudness_report: loudnessReport, performance_report: performanceReport, passed: performanceReport.passed };
}

function validateExternalAudioRecord(record) {
  const issues = [];
  if (!record?.relative_path || !/^imports\/audio\/[\w./-]+\.(wav|mp3|m4a|ogg)$/i.test(record.relative_path)) issues.push('Imported audio must be under imports/audio/ and use WAV, MP3, M4A, or OGG.');
  if (!record?.creator) issues.push('Imported audio requires a creator or provider.');
  if (!record?.licence) issues.push('Imported audio requires a licence or ownership declaration.');
  if (!['cleared', 'operator_declared'].includes(record?.rights_status)) issues.push('Imported audio rights must be cleared or operator-declared.');
  return { passed: issues.length === 0, issues };
}

module.exports = {
  AUDIO_SCHEMA_VERSION,
  STUDIO_AUDIO_DEFAULTS,
  buildHostProfile,
  buildPronunciationLexicon,
  applyPronunciations,
  buildSoundDesignPlan,
  buildAudioPerformancePackage,
  validateAudioPlan,
  produceAudioAssets,
  validateExternalAudioRecord,
  audioProbe,
  measureLoudness,
  selectProvider,
  hashObject
};
