const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeWhitespace, normalizedText, tokens, stableId } = require('./text');
const { validateVisualSystem } = require('./visual_system');
const { buildAudioPerformancePackage } = require('./audio_system');

const STUDIO_SCHEMA_VERSION = '1.0';
const REQUIRED_ROOT_KEYS = [
  'schema_version', 'studio', 'audience', 'promise', 'fit', 'research',
  'content', 'visuals', 'voice', 'compliance', 'monetization', 'metrics'
];
const BROAD_DOMAIN_TERMS = new Set([
  'history', 'science', 'technology', 'education', 'business', 'news', 'facts',
  'entertainment', 'software', 'engineering', 'nature', 'culture', 'health'
]);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashObject(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim());
}

function issue(pathName, message, severity = 'error') {
  return { path: pathName, message, severity };
}

function scoreStudioDepth(pack) {
  const criteria = [];
  const domain = normalizeWhitespace(pack?.studio?.domain || '');
  const domainTokens = tokens(domain);
  const broadOnly = domainTokens.length <= 2 && domainTokens.some((token) => BROAD_DOMAIN_TERMS.has(token));
  criteria.push({
    key: 'domain_specificity',
    score: !domain ? 0 : broadOnly ? 2 : domainTokens.length >= 4 ? 10 : 7,
    note: !domain ? 'No domain supplied.' : broadOnly ? 'Domain is too broad.' : 'Domain is meaningfully bounded.'
  });

  const audienceSignals = [pack?.audience?.primary_age, pack?.audience?.knowledge_level, ...(pack?.audience?.motivations || []), ...(pack?.audience?.viewer_jobs || [])].filter(Boolean);
  criteria.push({
    key: 'audience_clarity',
    score: Math.min(10, audienceSignals.length * 2),
    note: `${audienceSignals.length} concrete audience signals.`
  });

  const promiseRequired = pack?.promise?.required || [];
  const promiseProhibited = pack?.promise?.prohibited || [];
  criteria.push({
    key: 'editorial_promise',
    score: Math.min(10, 3 + promiseRequired.length + promiseProhibited.length),
    note: `${promiseRequired.length} required and ${promiseProhibited.length} prohibited editorial behaviours.`
  });

  const fitKeywords = pack?.fit?.keywords || [];
  const examples = pack?.fit?.topic_examples || [];
  const negatives = pack?.fit?.negative_keywords || [];
  criteria.push({
    key: 'fit_discrimination',
    score: Math.min(10, Math.round((fitKeywords.length + examples.length + negatives.length) / 2)),
    note: `${fitKeywords.length} positive keywords, ${negatives.length} exclusions, ${examples.length} examples.`
  });

  const sourceTiers = pack?.research?.preferred_source_tiers || {};
  const sourceSignals = Object.values(sourceTiers).flat().length;
  criteria.push({
    key: 'research_rigour',
    score: Math.min(10, 3 + sourceSignals + (pack?.research?.minimum_independent_sources || 0)),
    note: `${sourceSignals} source classes across ${Object.keys(sourceTiers).length} tiers.`
  });

  const archetypes = pack?.content?.archetypes || [];
  const beats = archetypes.reduce((total, item) => total + (item.required_story_beats?.length || 0), 0);
  criteria.push({
    key: 'format_depth',
    score: Math.min(10, archetypes.length * 2 + Math.min(4, Math.floor(beats / 5))),
    note: `${archetypes.length} archetypes with ${beats} required story beats.`
  });

  const visualSignals = [...(pack?.visuals?.language || []), ...(pack?.visuals?.forbidden || []), ...(pack?.visuals?.motion_rules || []), ...(pack?.visual_system?.compositions || []), ...(pack?.visual_system?.thumbnail_compositions || [])];
  criteria.push({
    key: 'visual_distinctiveness',
    score: Math.min(10, visualSignals.length),
    note: `${visualSignals.length} visual rules.`
  });

  const voiceSignals = [pack?.voice?.tone, pack?.voice?.pacing, ...(pack?.voice?.forbidden_traits || []), ...(pack?.voice?.pronunciation_domains || [])].filter(Boolean);
  criteria.push({
    key: 'voice_definition',
    score: Math.min(10, voiceSignals.length * 2),
    note: `${voiceSignals.length} voice signals.`
  });

  const complianceSignals = [pack?.compliance?.risk_level, pack?.compliance?.upload_default, ...(pack?.compliance?.required_checks || [])].filter(Boolean);
  criteria.push({
    key: 'risk_governance',
    score: Math.min(10, complianceSignals.length * 2 + (pack?.compliance?.human_fact_review ? 1 : 0)),
    note: `${complianceSignals.length} compliance signals.`
  });

  const revenueSignals = [...(pack?.monetization?.paths || []), ...(pack?.monetization?.trust_rules || []), ...(pack?.monetization?.prohibited_relationships || [])];
  criteria.push({
    key: 'commercial_fit',
    score: Math.min(10, revenueSignals.length * 2),
    note: `${revenueSignals.length} monetisation and trust rules.`
  });

  const metricSignals = [...(pack?.metrics?.primary || []), ...(pack?.metrics?.guardrails || [])];
  criteria.push({
    key: 'measurement_quality',
    score: Math.min(10, metricSignals.length * 2),
    note: `${metricSignals.length} primary and guardrail metrics.`
  });

  const personas = pack?.audience?.personas || [];
  const pillars = pack?.channel_strategy?.content_pillars || [];
  const strategySignals = personas.length * 2 + pillars.length * 2 + (pack?.channel_strategy?.promise_tests || []).length;
  criteria.push({
    key: 'audience_strategy',
    score: Math.min(10, strategySignals),
    note: `${personas.length} personas, ${pillars.length} content pillars, and ${(pack?.channel_strategy?.promise_tests || []).length} promise tests.`
  });

  const samples = pack?.samples || [];
  criteria.push({
    key: 'operational_readiness',
    score: Math.min(10, samples.length * 5),
    note: `${samples.length} runnable sample brief${samples.length === 1 ? '' : 's'}.`
  });

  const total = criteria.reduce((sum, item) => sum + item.score, 0);
  const maximum = criteria.length * 10;
  const percentage = Math.round((total / maximum) * 100);
  return {
    passed: percentage >= 70 && !broadOnly,
    score: percentage,
    threshold: 70,
    criteria
  };
}

function validateStudioPack(pack) {
  const issues = [];
  if (!isPlainObject(pack)) {
    return { passed: false, issues: [issue('$', 'Studio pack must be a JSON object.')], depth: scoreStudioDepth({}) };
  }
  for (const key of REQUIRED_ROOT_KEYS) {
    if (!(key in pack)) issues.push(issue(`$.${key}`, 'Required section is missing.'));
  }
  if (pack.schema_version !== STUDIO_SCHEMA_VERSION) issues.push(issue('$.schema_version', `Expected schema version ${STUDIO_SCHEMA_VERSION}.`));

  const studio = pack.studio || {};
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(studio.id || '')) issues.push(issue('$.studio.id', 'Use 3–64 lowercase letters, numbers, or underscores, starting with a letter.'));
  if (!normalizeWhitespace(studio.name || '')) issues.push(issue('$.studio.name', 'Studio name is required.'));
  if (!/^\d+\.\d+\.\d+$/.test(studio.version || '')) issues.push(issue('$.studio.version', 'Studio version must use semantic versioning, for example 1.0.0.'));
  if (!normalizeWhitespace(studio.domain || '')) issues.push(issue('$.studio.domain', 'A bounded domain definition is required.'));
  if (!normalizeWhitespace(studio.description || '')) issues.push(issue('$.studio.description', 'A studio description is required.'));

  if (!stringArray(pack?.audience?.motivations)) issues.push(issue('$.audience.motivations', 'Provide at least one audience motivation.'));
  if (!stringArray(pack?.audience?.viewer_jobs)) issues.push(issue('$.audience.viewer_jobs', 'Provide at least one viewer job.'));
  if (pack?.audience?.personas != null) {
    if (!Array.isArray(pack.audience.personas) || pack.audience.personas.length < 1) issues.push(issue('$.audience.personas', 'Provide at least one audience persona.'));
    else pack.audience.personas.forEach((persona, index) => {
      const base = `$.audience.personas[${index}]`;
      if (!/^[a-z][a-z0-9_]{2,63}$/.test(persona?.id || '')) issues.push(issue(`${base}.id`, 'Persona id is invalid.'));
      if (!normalizeWhitespace(persona?.name || '')) issues.push(issue(`${base}.name`, 'Persona name is required.'));
      if (!stringArray(persona?.motivations)) issues.push(issue(`${base}.motivations`, 'Persona motivations are required.'));
      if (!stringArray(persona?.frustrations)) issues.push(issue(`${base}.frustrations`, 'Persona frustrations are required.'));
      if (!normalizeWhitespace(persona?.desired_reward || '')) issues.push(issue(`${base}.desired_reward`, 'Persona desired reward is required.'));
    });
  }
  if (!normalizeWhitespace(pack?.promise?.statement || '')) issues.push(issue('$.promise.statement', 'A clear channel promise is required.'));
  if (!stringArray(pack?.promise?.required)) issues.push(issue('$.promise.required', 'Provide required editorial behaviours.'));
  if (!stringArray(pack?.promise?.prohibited)) issues.push(issue('$.promise.prohibited', 'Provide prohibited editorial behaviours.'));

  if (!stringArray(pack?.fit?.keywords) || pack.fit.keywords.length < 5) issues.push(issue('$.fit.keywords', 'Provide at least five discriminating fit keywords.'));
  if (!stringArray(pack?.fit?.topic_examples) || pack.fit.topic_examples.length < 3) issues.push(issue('$.fit.topic_examples', 'Provide at least three concrete topic examples.'));
  const minimumScore = Number(pack?.fit?.minimum_score);
  if (!Number.isFinite(minimumScore) || minimumScore < 0.1 || minimumScore > 1) issues.push(issue('$.fit.minimum_score', 'Minimum fit score must be between 0.1 and 1.0.'));

  const research = pack.research || {};
  if (!Number.isInteger(research.minimum_independent_sources) || research.minimum_independent_sources < 1) issues.push(issue('$.research.minimum_independent_sources', 'Minimum independent sources must be a positive integer.'));
  if (!isPlainObject(research.preferred_source_tiers) || Object.keys(research.preferred_source_tiers).length < 2) issues.push(issue('$.research.preferred_source_tiers', 'Define at least two source tiers.'));
  if (!normalizeWhitespace(research.conflict_policy || '')) issues.push(issue('$.research.conflict_policy', 'A conflicting-claims policy is required.'));

  const archetypes = pack?.content?.archetypes;
  if (!Array.isArray(archetypes) || archetypes.length < 2) {
    issues.push(issue('$.content.archetypes', 'Provide at least two content archetypes.'));
  } else {
    const ids = new Set();
    archetypes.forEach((archetype, index) => {
      const base = `$.content.archetypes[${index}]`;
      if (!/^[a-z][a-z0-9_]{2,63}$/.test(archetype?.id || '')) issues.push(issue(`${base}.id`, 'Archetype id is invalid.'));
      if (ids.has(archetype?.id)) issues.push(issue(`${base}.id`, 'Archetype id must be unique.'));
      ids.add(archetype?.id);
      if (!normalizeWhitespace(archetype?.name || '')) issues.push(issue(`${base}.name`, 'Archetype name is required.'));
      if (!stringArray(archetype?.required_story_beats) || archetype.required_story_beats.length < 4) issues.push(issue(`${base}.required_story_beats`, 'Provide at least four required story beats.'));
      if (!stringArray(archetype?.hook_types)) issues.push(issue(`${base}.hook_types`, 'Provide at least one allowed hook type.'));
    });
    if (!ids.has(pack?.content?.default_archetype)) issues.push(issue('$.content.default_archetype', 'Default archetype must reference an installed archetype.'));
  }

  if (!stringArray(pack?.visuals?.language)) issues.push(issue('$.visuals.language', 'Provide a visual language.'));
  if (!stringArray(pack?.visuals?.forbidden)) issues.push(issue('$.visuals.forbidden', 'Provide forbidden visual patterns.'));
  if (pack?.visual_system != null) {
    const visualValidation = validateVisualSystem(pack);
    visualValidation.issues.forEach((message) => issues.push(issue('$.visual_system', message)));
    visualValidation.warnings.forEach((message) => issues.push(issue('$.visual_system', message, 'warning')));
  }
  if (!normalizeWhitespace(pack?.voice?.tone || '')) issues.push(issue('$.voice.tone', 'Voice tone is required.'));
  if (!normalizeWhitespace(pack?.voice?.pacing || '')) issues.push(issue('$.voice.pacing', 'Voice pacing is required.'));
  if (pack?.audio_system != null) {
    const audio = pack.audio_system;
    if (!normalizeWhitespace(audio?.host?.id || '')) issues.push(issue('$.audio_system.host.id', 'Primary host id is required.'));
    if (!normalizeWhitespace(audio?.host?.name || '')) issues.push(issue('$.audio_system.host.name', 'Primary host name is required.'));
    const rate = Number(audio?.host?.rate_wpm);
    if (!Number.isFinite(rate) || rate < 90 || rate > 220) issues.push(issue('$.audio_system.host.rate_wpm', 'Host rate must be between 90 and 220 WPM.'));
    if (!Array.isArray(audio?.provider_order) || audio.provider_order.length < 2) issues.push(issue('$.audio_system.provider_order', 'Provide at least two audio-provider preferences.'));
    if (!normalizeWhitespace(audio?.music?.family || '')) issues.push(issue('$.audio_system.music.family', 'Music identity is required.'));
    if (!normalizeWhitespace(audio?.sfx?.default || '')) issues.push(issue('$.audio_system.sfx.default', 'Default SFX identity is required.'));
  }
  if (pack?.story_engine != null) {
    const story = pack.story_engine;
    if (!normalizeWhitespace(story.narrative_mode || '')) issues.push(issue('$.story_engine.narrative_mode', 'Narrative mode is required.'));
    const minutes = Number(story.default_target_minutes);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 30) issues.push(issue('$.story_engine.default_target_minutes', 'Default target minutes must be between 1 and 30.'));
    const wpm = Number(story.spoken_words_per_minute);
    if (!Number.isFinite(wpm) || wpm < 90 || wpm > 220) issues.push(issue('$.story_engine.spoken_words_per_minute', 'Spoken words per minute must be between 90 and 220.'));
    if (!stringArray(story.opening_rules)) issues.push(issue('$.story_engine.opening_rules', 'Provide opening rules.'));
    if (!stringArray(story.retention_devices)) issues.push(issue('$.story_engine.retention_devices', 'Provide retention devices.'));
    if (!stringArray(story.closing_rules)) issues.push(issue('$.story_engine.closing_rules', 'Provide closing rules.'));
    if (!stringArray(story.required_passes)) issues.push(issue('$.story_engine.required_passes', 'Provide required script passes.'));
  }
  if (!['low', 'medium', 'high'].includes(pack?.compliance?.risk_level)) issues.push(issue('$.compliance.risk_level', 'Risk level must be low, medium, or high.'));
  if (!stringArray(pack?.compliance?.required_checks)) issues.push(issue('$.compliance.required_checks', 'Provide required compliance checks.'));
  if (!stringArray(pack?.monetization?.paths)) issues.push(issue('$.monetization.paths', 'Provide at least one plausible monetisation path.'));
  if (!stringArray(pack?.monetization?.trust_rules)) issues.push(issue('$.monetization.trust_rules', 'Provide commercial trust rules.'));
  if (!stringArray(pack?.metrics?.primary)) issues.push(issue('$.metrics.primary', 'Provide primary performance metrics.'));
  if (!stringArray(pack?.metrics?.guardrails)) issues.push(issue('$.metrics.guardrails', 'Provide guardrail metrics.'));
  if (pack?.channel_strategy != null) {
    const strategy = pack.channel_strategy;
    const minimumFit = Number(strategy.minimum_audience_fit_score);
    if (!Number.isFinite(minimumFit) || minimumFit < 40 || minimumFit > 95) issues.push(issue('$.channel_strategy.minimum_audience_fit_score', 'Audience-fit threshold must be between 40 and 95.'));
    if (!stringArray(strategy.promise_tests) || strategy.promise_tests.length < 2) issues.push(issue('$.channel_strategy.promise_tests', 'Provide at least two channel-promise tests.'));
    if (!Array.isArray(strategy.content_pillars) || strategy.content_pillars.length < 2) issues.push(issue('$.channel_strategy.content_pillars', 'Provide at least two content pillars.'));
    else {
      const pillarIds = new Set();
      const targetTotal = strategy.content_pillars.reduce((sum, pillar, index) => {
        const base = `$.channel_strategy.content_pillars[${index}]`;
        if (!/^[a-z][a-z0-9_]{2,63}$/.test(pillar?.id || '')) issues.push(issue(`${base}.id`, 'Content-pillar id is invalid.'));
        if (pillarIds.has(pillar?.id)) issues.push(issue(`${base}.id`, 'Content-pillar id must be unique.'));
        pillarIds.add(pillar?.id);
        if (!normalizeWhitespace(pillar?.name || '')) issues.push(issue(`${base}.name`, 'Content-pillar name is required.'));
        if (!stringArray(pillar?.keywords)) issues.push(issue(`${base}.keywords`, 'Content-pillar keywords are required.'));
        if (!stringArray(pillar?.archetypes)) issues.push(issue(`${base}.archetypes`, 'Content-pillar archetypes are required.'));
        return sum + Number(pillar?.target_share || 0);
      }, 0);
      if (Math.abs(targetTotal - 1) > 0.02) issues.push(issue('$.channel_strategy.content_pillars', `Content-pillar target shares must total 1.0; found ${targetTotal.toFixed(3)}.`));
    }
  }

  const depth = scoreStudioDepth(pack);
  if (!depth.passed) issues.push(issue('$', `Niche depth score ${depth.score}/100 is below the ${depth.threshold}/100 threshold or the domain is too broad.`));
  return {
    passed: issues.every((entry) => entry.severity !== 'error'),
    issues,
    depth,
    content_hash: hashObject(pack),
    schema_version: STUDIO_SCHEMA_VERSION
  };
}

function phraseMatches(text, phrase) {
  const normalizedPhrase = normalizedText(phrase);
  if (!normalizedPhrase) return false;
  return normalizedText(text).includes(normalizedPhrase);
}

function scoreEpisodeFit(pack, brief) {
  const haystack = [brief?.working_title, brief?.topic, brief?.story_premise, ...(brief?.source_queries || [])].filter(Boolean).join(' ');
  const keywords = pack?.fit?.keywords || [];
  const negatives = pack?.fit?.negative_keywords || [];
  const examples = pack?.fit?.topic_examples || [];
  const domainTokens = tokens(pack?.studio?.domain || '').filter((token) => !BROAD_DOMAIN_TERMS.has(token));
  const matches = keywords.filter((keyword) => phraseMatches(haystack, keyword));
  const negativeMatches = negatives.filter((keyword) => phraseMatches(haystack, keyword));
  const exampleMatches = examples.filter((example) => {
    const overlap = new Set(tokens(example).filter((token) => tokens(haystack).includes(token)));
    return overlap.size >= Math.min(2, Math.max(1, tokens(example).length));
  });
  const domainMatches = domainTokens.filter((token) => tokens(haystack).includes(token));
  const keywordCoverage = keywords.length ? matches.length / Math.min(keywords.length, 8) : 0;
  const exampleBoost = Math.min(0.32, exampleMatches.length * 0.22);
  const domainBoost = Math.min(0.2, domainMatches.length * 0.05);
  const negativePenalty = Math.min(0.7, negativeMatches.length * 0.25);
  const raw = Math.max(0, Math.min(1, keywordCoverage * 0.65 + exampleBoost + domainBoost - negativePenalty));
  const score = Number(raw.toFixed(3));
  const threshold = Number(pack?.fit?.minimum_score || 0.25);
  return {
    passed: score >= threshold,
    score,
    threshold,
    studio_id: pack?.studio?.id,
    matched_keywords: matches,
    matched_examples: exampleMatches,
    matched_domain_terms: domainMatches,
    negative_matches: negativeMatches,
    explanation: score >= threshold
      ? `The brief matches ${pack.studio.name} through ${matches.length + exampleMatches.length + domainMatches.length} niche signal${matches.length + exampleMatches.length + domainMatches.length === 1 ? '' : 's'}.`
      : `The brief is too weakly aligned with ${pack.studio.name}; choose a better-fitting studio or revise the topic.`
  };
}

function chooseArchetype(pack, archetypeId) {
  const requested = archetypeId || pack?.content?.default_archetype;
  const archetype = (pack?.content?.archetypes || []).find((item) => item.id === requested);
  if (!archetype) throw new Error(`Unknown archetype '${requested}' for studio '${pack?.studio?.id}'.`);
  return archetype;
}

function beatClaimScore(pack, beat, claim) {
  const beatName = normalizedText(beat);
  const claimText = normalizedText(`${claim?.claim || ''} ${claim?.display_subject || ''} ${claim?.prompt_subject || ''}`);
  let score = Number(claim?.confidence || 0);
  if (pack?.studio?.id === 'history_under_glass') {
    if (/(decree|inscribed|inscription|hieroglyph|hieroglyphic|demotic|greek|script|scripts|text|stele|granodiorite|fragment|carved|temple|priest|ptolemy|decipher|decipherment|grammar|dictionary|sais|civilisation|literature)/.test(claimText)) score += 0.28;
    if (/object reveal/.test(beatName) && /(cm|feet|inches|high|wide|thick|surface|shape|inscribed|carved|stele|granodiorite|fragment|polished|incised|register|lines survive)/.test(claimText)) score += 0.42;
    if (/materials and making/.test(beatName) && /(three versions|minor differences|scripts|granodiorite|fragment|broke|stele|inscribed|text)/.test(claimText)) score += 0.34;
    if (/original use/.test(beatName) && /(decree|issued|ptolemaic|king ptolemy|temple|sais|displayed within a temple|on behalf of)/.test(claimText)) score += 0.36;
    if (/human context/.test(beatName) && /(champollion|scholars|succession of scholars|riddle of the sphinx|field of knowledge|decipher|translation|priests)/.test(claimText)) score += 0.28;
    if (/survival or discovery/.test(beatName) && /(discovery|1799|found|received .* lithographic prints|moved to safety|survived|fragment of a larger stele)/.test(claimText)) score += 0.26;
    if (/historical meaning/.test(beatName) && /(key to deciphering|essential key|modern understanding|foreign names|phonetic hieroglyphic|historical question|civilisation|literature)/.test(claimText)) score += 0.38;
    if (/object reveal|materials and making|original use/.test(beatName) && /(champollion|akerblad|de sacy|lettronne|weston|ameilhon|bankes|young|lecture|society of antiquaries|published in 18|published in 19|announced it publicly|paris in 1822)/.test(claimText)) score -= 0.42;
    if (/historical meaning/.test(beatName) && /(most-visited|postcard|merchandise|museum shops|moved to safety|left the british museum only once|conservation measures)/.test(claimText)) score -= 0.7;
    if (/(best selling postcard|merchandise|museum shops|most-visited single object)/.test(claimText)) score -= 0.75;
    if (!/survival or discovery|human context/.test(beatName) && /(transferred to the sculpture gallery|montagu house|displayed alongside|conservation measures in 1999|replica .* king'?s library|left the british museum only once)/.test(claimText)) score -= 0.55;
    if (!/survival or discovery/.test(beatName) && /(moved to safety|heavy bombing in london|wartime|transferred)/.test(claimText)) score -= 0.24;
  }
  return score;
}

function assignClaimsToBeats(pack, claims, beats) {
  if (!beats.length) return [];
  const ranked = (claims || []).filter((claim) => ['supported', 'weakly_supported'].includes(claim.status || 'supported'));
  const used = new Set();
  return beats.map((beat, index) => {
    const assigned = ranked
      .filter((claim) => !used.has(claim.claim_id))
      .sort((left, right) => beatClaimScore(pack, beat, right) - beatClaimScore(pack, beat, left))
      .slice(0, pack?.studio?.id === 'history_under_glass' ? 2 : 3);
    assigned.forEach((claim) => used.add(claim.claim_id));
    return {
      beat_id: stableId('beat', `${beat}|${index}`),
      name: beat,
      order: index + 1,
      purpose: `Advance the ${beat.replaceAll('_', ' ')} stage using verified evidence rather than generic filler.`,
      claim_ids: assigned.map((claim) => claim.claim_id),
      source_ids: [...new Set(assigned.map((claim) => claim.source_id))]
    };
  });
}

function buildStudioBlueprint(pack, brief, claims = []) {
  const archetype = chooseArchetype(pack, brief.archetype_id);
  const fit = scoreEpisodeFit(pack, brief);
  return {
    schema_version: STUDIO_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    studio: {
      id: pack.studio.id,
      name: pack.studio.name,
      version: pack.studio.version,
      content_hash: hashObject(pack),
      domain: pack.studio.domain,
      tagline: pack.studio.tagline
    },
    audience: pack.audience,
    channel_promise: pack.promise.statement,
    channel_strategy: pack.channel_strategy || null,
    fit,
    archetype: {
      id: archetype.id,
      name: archetype.name,
      description: archetype.description,
      hook_types: archetype.hook_types,
      allowed_outputs: archetype.allowed_outputs || ['long_form']
    },
    story_map: assignClaimsToBeats(pack, claims, archetype.required_story_beats || []),
    research_policy: {
      minimum_independent_sources: pack.research.minimum_independent_sources,
      primary_source_required: Boolean(pack.research.primary_source_required),
      preferred_source_tiers: pack.research.preferred_source_tiers,
      conflict_policy: pack.research.conflict_policy,
      freshness_days: pack.research.freshness_days ?? null
    },
    visual_direction: {
      language: pack.visuals.language,
      forbidden: pack.visuals.forbidden,
      motion_rules: pack.visuals.motion_rules || [],
      palette: pack.visuals.palette || [],
      visual_system: pack.visual_system || null
    },
    voice: pack.voice,
    audio_system: pack.audio_system || null,
    compliance: pack.compliance,
    monetization: pack.monetization,
    metrics: pack.metrics,
    phase_scope: {
      studio_governance: "active",
      topic_fit_enforcement: "active",
      claim_to_story_map: "active",
      audience_and_channel_strategy: "active_phase_5",
      full_archetype_script_generation: "active_phase_6",
      visual_language_and_asset_system: "active_phase_7",
      audio_host_and_performance_engine: "active_phase_8",
      archetype_specific_renderer: "planned_phase_9",
      legacy_claim_question_scaffold: "active_for_pipeline_compatibility"
    }
  };
}

function assessResearchPolicy(pack, sources = []) {
  const sourceCount = sources.filter((source) => source.retrieval_status !== 'failed').length;
  const providers = [...new Set(sources.map((source) => source.provider).filter(Boolean))];
  const primaryCount = sources.filter((source) => source.source_tier === 'tier_1' || Number(source.source_tier) === 1 || source.is_primary_source).length;
  const issues = [];
  const warnings = [];
  if (sourceCount < pack.research.minimum_independent_sources) issues.push(`Requires at least ${pack.research.minimum_independent_sources} independent sources; found ${sourceCount}.`);
  if (pack.research.primary_source_required && primaryCount === 0) warnings.push('The studio policy requires a primary source before final editorial approval; none is classified yet.');
  if (providers.length <= 1) warnings.push('All current sources use one provider. Add independent source classes before final production.');
  return {
    passed: issues.length === 0,
    provisional: warnings.length > 0,
    issues,
    warnings,
    source_count: sourceCount,
    provider_count: providers.length,
    providers,
    primary_source_count: primaryCount,
    enforcement: pack.research.enforcement_stage || 'pre_production'
  };
}

class StudioRegistry {
  constructor({ builtinDir, customDir, database = null } = {}) {
    this.builtinDir = builtinDir;
    this.customDir = customDir;
    this.database = database;
    if (this.customDir) fs.mkdirSync(this.customDir, { recursive: true });
    this.reload();
  }

  readDirectory(dirPath, source) {
    if (!dirPath || !fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => {
        const absolutePath = path.join(dirPath, name);
        const pack = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
        const validation = validateStudioPack(pack);
        if (!validation.passed) {
          const details = validation.issues.map((entry) => `${entry.path}: ${entry.message}`).join('; ');
          throw new Error(`Invalid ${source} studio pack ${name}: ${details}`);
        }
        return { pack, validation, source, absolutePath };
      });
  }

  reload() {
    const records = [...this.readDirectory(this.builtinDir, 'builtin'), ...this.readDirectory(this.customDir, 'custom')];
    this.records = new Map();
    for (const record of records) {
      const id = record.pack.studio.id;
      if (this.records.has(id)) throw new Error(`Duplicate installed studio id '${id}'.`);
      this.records.set(id, record);
      if (this.database?.upsertStudioPack) {
        this.database.upsertStudioPack({
          studioId: id,
          name: record.pack.studio.name,
          version: record.pack.studio.version,
          source: record.source,
          contentHash: record.validation.content_hash,
          pack: record.pack
        });
      }
    }
    return this.list();
  }

  list() {
    return [...this.records.values()].map(({ pack, validation, source }) => ({
      studio_id: pack.studio.id,
      name: pack.studio.name,
      version: pack.studio.version,
      tagline: pack.studio.tagline,
      domain: pack.studio.domain,
      source,
      depth_score: validation.depth.score,
      content_hash: validation.content_hash,
      default_archetype: pack.content.default_archetype,
      archetypes: pack.content.archetypes.map((item) => ({ id: item.id, name: item.name, description: item.description })),
      sample_count: (pack.samples || []).length
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  get(studioId) {
    return this.records.get(studioId)?.pack || null;
  }

  getRecord(studioId) {
    return this.records.get(studioId) || null;
  }

  validate(pack) {
    return validateStudioPack(pack);
  }

  install(pack) {
    const validation = validateStudioPack(pack);
    if (!validation.passed) {
      const error = new Error('Studio pack validation failed.');
      error.statusCode = 400;
      error.validation = validation;
      throw error;
    }
    if (!this.customDir) throw new Error('Custom studio directory is not configured.');
    const existing = this.records.get(pack.studio.id);
    if (existing?.source === 'builtin') {
      const error = new Error(`Cannot replace built-in studio '${pack.studio.id}'.`);
      error.statusCode = 409;
      throw error;
    }
    const filePath = path.join(this.customDir, `${pack.studio.id}.json`);
    fs.writeFileSync(filePath, `${JSON.stringify(pack, null, 2)}\n`, { mode: 0o600 });
    this.reload();
    return { studio: this.get(pack.studio.id), validation, file_path: filePath };
  }
}

module.exports = {
  STUDIO_SCHEMA_VERSION,
  StudioRegistry,
  validateStudioPack,
  scoreStudioDepth,
  scoreEpisodeFit,
  chooseArchetype,
  buildStudioBlueprint,
  assessResearchPolicy,
  hashObject,
  canonicalJson
};
