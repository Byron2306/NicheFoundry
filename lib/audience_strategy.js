const crypto = require('crypto');
const { normalizeWhitespace, normalizedText, tokens, jaccard, stableId, clamp } = require('./text');
const { scoreEpisodeFit } = require('./studios');

const AUDIENCE_STRATEGY_SCHEMA = '1.0';
const VIEWER_JOB_TAXONOMY = [
  { id: 'learn', label: 'Teach me', keywords: ['teach', 'learn', 'understand', 'explain', 'show me how', 'knowledge', 'lesson'] },
  { id: 'decide', label: 'Help me decide', keywords: ['decide', 'compare', 'choose', 'recommend', 'trade-off', 'tradeoff', 'which tool', 'best option'] },
  { id: 'solve', label: 'Help me solve something', keywords: ['solve', 'fix', 'repair', 'troubleshoot', 'workflow', 'setup', 'install', 'diagnose'] },
  { id: 'story', label: 'Tell me a compelling story', keywords: ['story', 'reconstruct', 'journey', 'case', 'mystery', 'what happened', 'human'] },
  { id: 'change', label: 'Help me understand what changed', keywords: ['changed', 'update', 'release', 'news', 'briefing', 'migration', 'current'] },
  { id: 'challenge', label: 'Let me test myself', keywords: ['quiz', 'challenge', 'test myself', 'mission', 'choice', 'solve a puzzle'] },
  { id: 'belong', label: 'Help me belong to a specialist community', keywords: ['community', 'practitioner', 'researcher', 'enthusiast', 'member', 'shared language'] },
  { id: 'relax', label: 'Give me something restorative', keywords: ['relax', 'calm', 'ambient', 'slow', 'comfort', 'unwind'] }
];

const DEFAULT_ROLE_TARGETS = {
  core_pillar: 0.5,
  search_evergreen: 0.2,
  experimental: 0.15,
  audience_request: 0.1,
  commercial_intent: 0.05
};

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

function round(value, places = 3) {
  const scale = 10 ** places;
  return Math.round(Number(value || 0) * scale) / scale;
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => normalizeWhitespace(value)).filter(Boolean))];
}

function phraseOverlap(left, right) {
  const leftTokens = tokens(left);
  const rightTokens = new Set(tokens(right));
  if (!leftTokens.length || !rightTokens.size) return 0;
  return leftTokens.filter((token) => rightTokens.has(token)).length / Math.min(leftTokens.length, rightTokens.size);
}

function classifyViewerJob(text, viewerJobs = []) {
  const haystack = [text, ...(viewerJobs || [])].filter(Boolean).join(' ');
  const scored = VIEWER_JOB_TAXONOMY.map((job) => {
    const matches = job.keywords.filter((keyword) => normalizedText(haystack).includes(normalizedText(keyword)));
    return { ...job, score: matches.length, matches };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const winner = scored[0];
  return {
    id: winner?.score ? winner.id : 'learn',
    label: winner?.score ? winner.label : 'Teach me',
    confidence: winner?.score ? round(Math.min(1, 0.45 + winner.score * 0.18)) : 0.35,
    matched_signals: winner?.matches || [],
    taxonomy: VIEWER_JOB_TAXONOMY.map(({ id, label }) => ({ id, label }))
  };
}

function defaultPersona(pack) {
  const audience = pack.audience || {};
  return {
    id: 'primary_viewer',
    name: `${pack.studio.name} primary viewer`,
    description: `${audience.knowledge_level || 'Curious viewer'} seeking ${uniqueStrings(audience.motivations).join(', ') || 'reliable specialist value'}.`,
    age_range: audience.primary_age || 'unspecified',
    knowledge_level: audience.knowledge_level || 'curious general audience',
    motivations: uniqueStrings(audience.motivations),
    frustrations: uniqueStrings(audience.frustrations || ['generic coverage', 'unsupported certainty', 'content that wastes time']),
    viewing_context: uniqueStrings(audience.viewing_context || ['focused viewing on desktop, mobile, or television']),
    desired_reward: audience.desired_reward || `A clear, trustworthy understanding of ${pack.studio.domain}.`,
    likely_next_action: audience.likely_next_action || 'Continue to a related episode or save the resource for later.'
  };
}

function normalizePersonas(pack) {
  const personas = Array.isArray(pack?.audience?.personas) && pack.audience.personas.length
    ? pack.audience.personas
    : [defaultPersona(pack)];
  return personas.map((persona, index) => ({
    id: String(persona.id || `persona_${index + 1}`).replace(/[^a-z0-9_]/gi, '_').toLowerCase(),
    name: normalizeWhitespace(persona.name || `${pack.studio.name} viewer ${index + 1}`),
    description: normalizeWhitespace(persona.description || ''),
    age_range: normalizeWhitespace(persona.age_range || pack.audience.primary_age || 'unspecified'),
    knowledge_level: normalizeWhitespace(persona.knowledge_level || pack.audience.knowledge_level || 'general audience'),
    motivations: uniqueStrings(persona.motivations || pack.audience.motivations),
    frustrations: uniqueStrings(persona.frustrations || pack.audience.frustrations || ['generic or repetitive content']),
    viewing_context: uniqueStrings(persona.viewing_context || pack.audience.viewing_context || ['focused viewing']),
    desired_reward: normalizeWhitespace(persona.desired_reward || pack.audience.desired_reward || pack.promise.statement),
    likely_next_action: normalizeWhitespace(persona.likely_next_action || pack.audience.likely_next_action || 'Continue to a related episode.')
  }));
}

function derivePillars(pack) {
  if (Array.isArray(pack.channel_strategy?.content_pillars) && pack.channel_strategy.content_pillars.length) {
    const rawTargets = pack.channel_strategy.content_pillars.map((pillar) => Number(pillar.target_share || 0));
    const total = rawTargets.reduce((sum, value) => sum + value, 0) || 1;
    return pack.channel_strategy.content_pillars.map((pillar, index) => ({
      id: String(pillar.id || `pillar_${index + 1}`).replace(/[^a-z0-9_]/gi, '_').toLowerCase(),
      name: normalizeWhitespace(pillar.name || `Pillar ${index + 1}`),
      purpose: normalizeWhitespace(pillar.purpose || pack.promise.statement),
      keywords: uniqueStrings(pillar.keywords),
      archetypes: uniqueStrings(pillar.archetypes || pack.content.archetypes.map((item) => item.id)),
      target_share: round(Number(pillar.target_share || (1 / pack.channel_strategy.content_pillars.length)) / total)
    }));
  }
  const archetypes = pack.content.archetypes || [];
  const target = archetypes.length ? 1 / archetypes.length : 1;
  return archetypes.map((archetype) => ({
    id: `${archetype.id}_pillar`,
    name: archetype.name,
    purpose: archetype.description,
    keywords: uniqueStrings([archetype.name, ...(archetype.hook_types || []), ...(archetype.required_story_beats || [])]),
    archetypes: [archetype.id],
    target_share: round(target)
  }));
}

function deriveFormatRules(pack) {
  const allowed = uniqueStrings((pack.content.archetypes || []).flatMap((item) => item.allowed_outputs || ['long_form']));
  const supplied = pack.channel_strategy?.format_rotation || {};
  return {
    allowed_outputs: allowed,
    maximum_same_archetype_streak: Number(supplied.maximum_same_archetype_streak || 2),
    maximum_same_pillar_streak: Number(supplied.maximum_same_pillar_streak || 2),
    maximum_same_viewer_job_streak: Number(supplied.maximum_same_viewer_job_streak || 3),
    maximum_same_output_streak: Number(supplied.maximum_same_output_streak || 3),
    lookback_items: Number(supplied.lookback_items || 8)
  };
}

function buildAudienceProfile(pack) {
  const personas = normalizePersonas(pack);
  const declaredJobs = uniqueStrings(pack.audience.viewer_jobs);
  const classified = declaredJobs.map((job) => ({ declared_job: job, classification: classifyViewerJob(job, []) }));
  return {
    schema: `nichefoundry.audience_profile.v${AUDIENCE_STRATEGY_SCHEMA}`,
    studio_id: pack.studio.id,
    studio_name: pack.studio.name,
    generated_at: new Date().toISOString(),
    primary_age: pack.audience.primary_age || null,
    knowledge_level: pack.audience.knowledge_level || null,
    vocabulary: pack.audience.vocabulary || null,
    personas,
    declared_viewer_jobs: declaredJobs,
    viewer_job_taxonomy: VIEWER_JOB_TAXONOMY.map(({ id, label }) => ({ id, label })),
    classified_viewer_jobs: classified,
    channel_promise: pack.promise.statement,
    motivations: uniqueStrings(pack.audience.motivations),
    profile_hash: hashObject({ studio_id: pack.studio.id, audience: pack.audience, promise: pack.promise.statement, personas })
  };
}

function choosePersona(profile, brief) {
  const requested = String(brief.target_persona_id || '').trim();
  if (requested) {
    const exact = profile.personas.find((persona) => persona.id === requested);
    if (exact) return { persona: exact, confidence: 1, requested: true };
  }
  const haystack = [brief.working_title, brief.topic, brief.story_premise, brief.age_band, brief.audience_mode].filter(Boolean).join(' ');
  const scored = profile.personas.map((persona) => {
    const personaText = [persona.description, persona.age_range, persona.knowledge_level, ...persona.motivations, ...persona.frustrations, ...persona.viewing_context].join(' ');
    return { persona, score: Math.max(jaccard(haystack, personaText), phraseOverlap(haystack, personaText)) };
  }).sort((a, b) => b.score - a.score);
  return { persona: scored[0]?.persona || profile.personas[0], confidence: round(Math.max(0.45, scored[0]?.score || 0)), requested: false };
}

function choosePillar(pillars, brief, archetypeId) {
  const requested = String(brief.content_pillar_id || '').trim();
  if (requested) {
    const exact = pillars.find((pillar) => pillar.id === requested);
    if (exact) return { pillar: exact, confidence: 1, requested: true };
  }
  const haystack = [brief.working_title, brief.topic, brief.story_premise, archetypeId].filter(Boolean).join(' ');
  const scored = pillars.map((pillar) => {
    const archetypeBoost = pillar.archetypes.includes(archetypeId) ? 0.45 : 0;
    const overlap = Math.max(jaccard(haystack, [pillar.name, pillar.purpose, ...pillar.keywords].join(' ')), phraseOverlap(haystack, [pillar.name, pillar.purpose, ...pillar.keywords].join(' ')));
    return { pillar, score: clamp(archetypeBoost + overlap, 0, 1) };
  }).sort((a, b) => b.score - a.score);
  return { pillar: scored[0]?.pillar || pillars[0], confidence: round(Math.max(0.4, scored[0]?.score || 0)), requested: false };
}

function ageMismatch(pack, brief) {
  const packAge = normalizedText(pack.audience.primary_age || '');
  const briefAge = normalizedText(brief.age_band || '');
  const childPack = /(5|6|7|8|9|10|11|12|13|child|family)/.test(packAge) && !/(16|18|44|54)/.test(packAge);
  const childBrief = /(5 7|8 13|made for kids|child)/.test(`${briefAge} ${normalizedText(brief.audience_mode || '')}`);
  if (childBrief && !childPack) return 'The brief targets children, but the selected studio is designed primarily for an older specialist audience.';
  if (!childBrief && childPack && /(18|adult|professional)/.test(briefAge)) return 'The brief targets adults or professionals, but the selected studio is designed primarily for children and family co-viewing.';
  return null;
}

function promiseAlignment(pack, brief) {
  const haystack = [brief.working_title, brief.topic, brief.story_premise, brief.visual_direction].filter(Boolean).join(' ');
  const required = uniqueStrings(pack.promise.required);
  const prohibited = uniqueStrings(pack.promise.prohibited);
  const matchedRequired = required.filter((rule) => phraseOverlap(haystack, rule) >= 0.18 || normalizedText(haystack).includes(normalizedText(rule)));
  const matchedProhibited = prohibited.filter((rule) => phraseOverlap(haystack, rule) >= 0.75 || normalizedText(haystack).includes(normalizedText(rule)));
  const semanticBase = Math.max(
    jaccard(haystack, pack.promise.statement),
    phraseOverlap(haystack, pack.promise.statement),
    matchedRequired.length / Math.max(1, Math.min(required.length, 4))
  );
  return {
    score: round(clamp(0.35 + semanticBase * 0.65 - matchedProhibited.length * 0.28, 0, 1)),
    matched_required_rules: matchedRequired,
    matched_prohibited_rules: matchedProhibited,
    statement: pack.promise.statement
  };
}

function scoreAudienceEpisodeFit(pack, brief, context = {}) {
  const profile = context.profile || buildAudienceProfile(pack);
  const pillars = context.pillars || derivePillars(pack);
  const studioFit = context.studio_fit || scoreEpisodeFit(pack, brief);
  const personaChoice = choosePersona(profile, brief);
  const declaredViewerJob = normalizeWhitespace(brief.viewer_job || '');
  const job = classifyViewerJob([declaredViewerJob, brief.working_title, brief.topic, brief.story_premise].join(' '), pack.audience.viewer_jobs);
  const pillarChoice = choosePillar(pillars, brief, brief.archetype_id || pack.content.default_archetype);
  const promise = promiseAlignment(pack, brief);
  const mismatch = ageMismatch(pack, brief);
  const outputFormat = normalizeWhitespace(brief.output_format || 'long_form');
  const archetype = (pack.content.archetypes || []).find((item) => item.id === (brief.archetype_id || pack.content.default_archetype));
  const outputAllowed = (archetype?.allowed_outputs || ['long_form']).includes(outputFormat);
  const specificityText = [brief.working_title, brief.topic, brief.story_premise].filter(Boolean).join(' ');
  const specificity = round(clamp(tokens(specificityText).length / 22, 0.2, 1));
  const viewerJobClarity = declaredViewerJob ? 1 : job.confidence;
  const personaRelevance = round(clamp(0.55 + personaChoice.confidence * 0.45, 0, 1));
  const pillarRelevance = round(clamp(0.45 + pillarChoice.confidence * 0.55, 0, 1));
  const valueProposition = `${job.label} by delivering ${pillarChoice.pillar?.purpose || pack.promise.statement}`;
  const studioFitContribution = studioFit.passed ? clamp(0.65 + studioFit.score * 0.35, 0, 1) : studioFit.score;
  const promiseContribution = promise.matched_prohibited_rules.length ? promise.score : Math.max(0.55, promise.score);
  const weighted = studioFitContribution * 0.2 + promiseContribution * 0.23 + viewerJobClarity * 0.17 + personaRelevance * 0.15 + pillarRelevance * 0.15 + specificity * 0.1;
  const issues = [];
  const warnings = [];
  if (!studioFit.passed) issues.push(`Studio fit is below threshold (${studioFit.score}/${studioFit.threshold}).`);
  if (promise.matched_prohibited_rules.length) issues.push(`The brief conflicts with prohibited channel behaviours: ${promise.matched_prohibited_rules.join('; ')}`);
  if (promise.score < 0.48) issues.push('The episode promise is too weakly aligned with the channel promise.');
  if (mismatch) issues.push(mismatch);
  if (!outputAllowed) issues.push(`Output '${outputFormat}' is not allowed by archetype '${archetype?.id || 'unknown'}'.`);
  if (!declaredViewerJob) warnings.push(`Viewer job was inferred as '${job.label}'. Confirm or select it explicitly before production.`);
  if (!brief.target_persona_id) warnings.push(`Persona was inferred as '${personaChoice.persona?.name}'.`);
  if (!brief.content_pillar_id) warnings.push(`Content pillar was inferred as '${pillarChoice.pillar?.name}'.`);
  const score = Math.round(clamp(weighted - issues.length * 0.18, 0, 1) * 100);
  const threshold = Number(pack.channel_strategy?.minimum_audience_fit_score || 58);
  return {
    schema: `nichefoundry.audience_fit.v${AUDIENCE_STRATEGY_SCHEMA}`,
    passed: issues.length === 0 && score >= threshold,
    score,
    threshold,
    studio_id: pack.studio.id,
    persona: personaChoice.persona,
    persona_confidence: personaChoice.confidence,
    viewer_job: job,
    content_pillar: pillarChoice.pillar,
    pillar_confidence: pillarChoice.confidence,
    channel_promise: promise,
    studio_fit: studioFit,
    output_format: outputFormat,
    output_allowed: outputAllowed,
    value_proposition: valueProposition,
    desired_reward: personaChoice.persona?.desired_reward || pack.promise.statement,
    likely_next_action: personaChoice.persona?.likely_next_action || 'Continue to a related episode.',
    issues,
    warnings,
    checked_at: new Date().toISOString()
  };
}

function strategyRecordFromEpisode(packet) {
  if (!packet?.episode) return null;
  return {
    record_id: packet.episode.episode_id,
    record_type: 'episode',
    title: packet.episode.title,
    created_at: packet.brief?.created_at || packet.episode?.created_at || packet.research_report?.retrieved_at || null,
    archetype_id: packet.episode.content_archetype?.id || packet.brief?.archetype_id || null,
    output_format: packet.audience_fit_report?.output_format || packet.brief?.output_format || 'long_form',
    persona_id: packet.audience_fit_report?.persona?.id || packet.episode.audience_strategy?.persona_id || null,
    viewer_job_id: packet.audience_fit_report?.viewer_job?.id || packet.episode.audience_strategy?.viewer_job_id || null,
    pillar_id: packet.audience_fit_report?.content_pillar?.id || packet.episode.audience_strategy?.content_pillar_id || null,
    content_role: packet.opportunity_report?.content_role || packet.opportunity_snapshot?.content_role || 'core_pillar',
    lifecycle: packet.qa?.status || 'produced'
  };
}

function strategyRecordFromOpportunity(opportunity, pack, pillars) {
  if (!opportunity) return null;
  const brief = {
    working_title: opportunity.title,
    topic: opportunity.topic,
    story_premise: opportunity.angle || opportunity.summary || '',
    archetype_id: opportunity.recommended_archetype || pack.content.default_archetype,
    output_format: opportunity.output_format || 'long_form'
  };
  const fit = scoreAudienceEpisodeFit(pack, brief, { pillars });
  return {
    record_id: opportunity.opportunity_id,
    record_type: 'opportunity',
    title: opportunity.title,
    created_at: opportunity.updated_at || opportunity.created_at || null,
    archetype_id: brief.archetype_id,
    output_format: fit.output_format,
    persona_id: fit.persona?.id || null,
    viewer_job_id: fit.viewer_job?.id || null,
    pillar_id: fit.content_pillar?.id || null,
    content_role: opportunity.content_role || 'core_pillar',
    lifecycle: opportunity.lifecycle || 'screened'
  };
}

function countDistribution(records, key) {
  const counts = {};
  records.forEach((record) => {
    const value = record?.[key] || 'unclassified';
    counts[value] = (counts[value] || 0) + 1;
  });
  const total = records.length || 1;
  return Object.entries(counts).map(([id, count]) => ({ id, count, share: round(count / total) })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

function targetStatus(actual, target) {
  if (actual < target * 0.55) return 'underrepresented';
  if (actual > target * 1.65) return 'overrepresented';
  return 'balanced';
}

function buildAudiencePortfolio(pack, records = []) {
  const pillars = derivePillars(pack);
  const roles = pack.channel_strategy?.portfolio_targets || DEFAULT_ROLE_TARGETS;
  const roleDistribution = countDistribution(records, 'content_role');
  const pillarDistribution = countDistribution(records, 'pillar_id');
  const roleMap = Object.fromEntries(roleDistribution.map((item) => [item.id, item]));
  const pillarMap = Object.fromEntries(pillarDistribution.map((item) => [item.id, item]));
  return {
    record_count: records.length,
    roles: Object.entries(roles).map(([id, target]) => ({
      id,
      target_share: Number(target),
      actual_share: roleMap[id]?.share || 0,
      count: roleMap[id]?.count || 0,
      status: targetStatus(roleMap[id]?.share || 0, Number(target))
    })),
    pillars: pillars.map((pillar) => ({
      id: pillar.id,
      name: pillar.name,
      target_share: pillar.target_share,
      actual_share: pillarMap[pillar.id]?.share || 0,
      count: pillarMap[pillar.id]?.count || 0,
      status: targetStatus(pillarMap[pillar.id]?.share || 0, pillar.target_share)
    })),
    viewer_jobs: countDistribution(records, 'viewer_job_id'),
    personas: countDistribution(records, 'persona_id'),
    archetypes: countDistribution(records, 'archetype_id'),
    output_formats: countDistribution(records, 'output_format')
  };
}

function trailingStreak(records, key) {
  if (!records.length) return { value: null, count: 0 };
  const value = records[0]?.[key] || null;
  let count = 0;
  for (const record of records) {
    if ((record?.[key] || null) !== value) break;
    count += 1;
  }
  return { value, count };
}

function buildFatigueReport(pack, records = []) {
  const rules = deriveFormatRules(pack);
  const sorted = [...records].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, rules.lookback_items);
  const checks = [
    ['archetype_id', rules.maximum_same_archetype_streak, 'archetype'],
    ['pillar_id', rules.maximum_same_pillar_streak, 'content pillar'],
    ['viewer_job_id', rules.maximum_same_viewer_job_streak, 'viewer job'],
    ['output_format', rules.maximum_same_output_streak, 'output format']
  ].map(([key, maximum, label]) => {
    const streak = trailingStreak(sorted, key);
    return {
      key,
      label,
      value: streak.value,
      current_streak: streak.count,
      maximum_streak: maximum,
      passed: streak.count < maximum,
      warning: streak.count >= maximum ? `${label} '${streak.value}' has appeared ${streak.count} times consecutively.` : null
    };
  });
  const similarityWarnings = [];
  for (let index = 0; index < Math.min(sorted.length, 6); index += 1) {
    for (let other = index + 1; other < Math.min(sorted.length, 6); other += 1) {
      const similarity = round(jaccard(sorted[index].title, sorted[other].title));
      if (similarity >= 0.55) similarityWarnings.push({ left: sorted[index].record_id, right: sorted[other].record_id, similarity, note: 'Recent titles may feel repetitive.' });
    }
  }
  const warnings = [...checks.filter((item) => !item.passed).map((item) => item.warning), ...similarityWarnings.map((item) => item.note)];
  return {
    schema: `nichefoundry.fatigue_report.v${AUDIENCE_STRATEGY_SCHEMA}`,
    passed: warnings.length === 0,
    rules,
    records_checked: sorted.length,
    checks,
    similarity_warnings: similarityWarnings,
    warnings,
    checked_at: new Date().toISOString()
  };
}

function leastRepresented(items, distribution, idKey = 'id') {
  const map = Object.fromEntries((distribution || []).map((item) => [item.id, item.share ?? item.actual_share ?? 0]));
  return [...items].sort((a, b) => (map[a[idKey]] || 0) - (map[b[idKey]] || 0) || String(a[idKey]).localeCompare(String(b[idKey])))[0] || null;
}

function buildFormatRotation(pack, records = [], portfolio = buildAudiencePortfolio(pack, records), fatigue = buildFatigueReport(pack, records)) {
  const pillars = derivePillars(pack);
  const archetypes = pack.content.archetypes || [];
  const outputs = deriveFormatRules(pack).allowed_outputs.map((id) => ({ id }));
  const recommendedPillar = leastRepresented(pillars, portfolio.pillars);
  const recommendedArchetype = leastRepresented(archetypes, portfolio.archetypes);
  const recommendedOutput = leastRepresented(outputs, portfolio.output_formats);
  const jobDistribution = portfolio.viewer_jobs;
  const viewerJobs = VIEWER_JOB_TAXONOMY.map((item) => ({ id: item.id, label: item.label }));
  const recommendedJob = leastRepresented(viewerJobs, jobDistribution);
  const reasons = [];
  if (recommendedPillar) reasons.push(`Pillar '${recommendedPillar.name}' is comparatively underused.`);
  if (recommendedArchetype) reasons.push(`Archetype '${recommendedArchetype.name}' improves format rotation.`);
  if (recommendedOutput) reasons.push(`Output '${recommendedOutput.id}' is comparatively underused.`);
  if (recommendedJob) reasons.push(`Viewer job '${recommendedJob.label}' broadens audience value.`);
  fatigue.checks.filter((item) => !item.passed).forEach((item) => reasons.push(`Break the current ${item.label} streak.`));
  return {
    schema: `nichefoundry.format_rotation.v${AUDIENCE_STRATEGY_SCHEMA}`,
    recommended_content_pillar_id: recommendedPillar?.id || null,
    recommended_archetype_id: recommendedArchetype?.id || pack.content.default_archetype,
    recommended_output_format: recommendedOutput?.id || 'long_form',
    recommended_viewer_job_id: recommendedJob?.id || 'learn',
    reasons,
    generated_at: new Date().toISOString()
  };
}

function buildChannelStrategy(pack, { episodes = [], opportunities = [] } = {}) {
  const profile = buildAudienceProfile(pack);
  const pillars = derivePillars(pack);
  const records = [
    ...episodes.map(strategyRecordFromEpisode),
    ...opportunities.map((item) => strategyRecordFromOpportunity(item, pack, pillars))
  ].filter(Boolean);
  const portfolio = buildAudiencePortfolio(pack, records);
  const fatigue = buildFatigueReport(pack, records);
  const rotation = buildFormatRotation(pack, records, portfolio, fatigue);
  return {
    schema: `nichefoundry.channel_strategy.v${AUDIENCE_STRATEGY_SCHEMA}`,
    studio_id: pack.studio.id,
    studio_name: pack.studio.name,
    generated_at: new Date().toISOString(),
    channel_promise: pack.promise.statement,
    promise_tests: uniqueStrings(pack.channel_strategy?.promise_tests || [
      'Would an existing subscriber immediately understand why this belongs on the channel?',
      'Does the episode deliver a specific viewer reward rather than merely cover a topic?',
      'Does the format contribute substantive variation rather than cosmetic variation?'
    ]),
    audience_profile: profile,
    content_pillars: pillars,
    portfolio,
    fatigue,
    format_rotation: rotation,
    strategy_hash: hashObject({ studio_id: pack.studio.id, profile, pillars, portfolio, fatigue, rotation })
  };
}

function assessEpisodeStrategy(pack, brief, history = {}) {
  const channelStrategy = history.channel_strategy || buildChannelStrategy(pack, history);
  const fit = scoreAudienceEpisodeFit(pack, brief, {
    profile: channelStrategy.audience_profile,
    pillars: channelStrategy.content_pillars,
    studio_fit: history.studio_fit
  });
  const recentRecords = [
    ...(history.episodes || []).map(strategyRecordFromEpisode),
    ...(history.opportunities || []).map((item) => strategyRecordFromOpportunity(item, pack, channelStrategy.content_pillars))
  ].filter(Boolean);
  const proposed = {
    record_id: stableId('proposal', [brief.working_title, brief.topic, brief.story_premise].join('|')),
    record_type: 'proposed_episode',
    title: brief.working_title,
    created_at: new Date().toISOString(),
    archetype_id: brief.archetype_id || pack.content.default_archetype,
    output_format: fit.output_format,
    persona_id: fit.persona?.id || null,
    viewer_job_id: fit.viewer_job?.id || null,
    pillar_id: fit.content_pillar?.id || null,
    content_role: brief.content_role || 'core_pillar',
    lifecycle: 'proposed'
  };
  const projectedPortfolio = buildAudiencePortfolio(pack, [proposed, ...recentRecords]);
  const projectedFatigue = buildFatigueReport(pack, [proposed, ...recentRecords]);
  const rotation = buildFormatRotation(pack, recentRecords, channelStrategy.portfolio, channelStrategy.fatigue);
  const warnings = [...fit.warnings, ...projectedFatigue.warnings];
  const fatigueBlocks = projectedFatigue.checks.filter((item) => !item.passed && item.current_streak > item.maximum_streak);
  const passed = fit.passed && fatigueBlocks.length === 0;
  return {
    schema: `nichefoundry.episode_strategy_assessment.v${AUDIENCE_STRATEGY_SCHEMA}`,
    passed,
    audience_fit: fit,
    projected_portfolio: projectedPortfolio,
    projected_fatigue: projectedFatigue,
    recommended_rotation: rotation,
    warnings,
    issues: [...fit.issues, ...fatigueBlocks.map((item) => `Proposed episode exceeds the maximum ${item.label} streak.`)],
    assessed_at: new Date().toISOString()
  };
}

module.exports = {
  AUDIENCE_STRATEGY_SCHEMA,
  VIEWER_JOB_TAXONOMY,
  DEFAULT_ROLE_TARGETS,
  classifyViewerJob,
  buildAudienceProfile,
  derivePillars,
  deriveFormatRules,
  scoreAudienceEpisodeFit,
  strategyRecordFromEpisode,
  strategyRecordFromOpportunity,
  buildAudiencePortfolio,
  buildFatigueReport,
  buildFormatRotation,
  buildChannelStrategy,
  assessEpisodeStrategy,
  hashObject
};
