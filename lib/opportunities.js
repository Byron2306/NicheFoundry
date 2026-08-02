const crypto = require('crypto');
const { normalizeWhitespace, normalizedText, tokens, stableId } = require('./text');
const { scoreEpisodeFit } = require('./studios');
const { fetchJson, DEFAULT_WIKI_API } = require('./research');

const OPPORTUNITY_SCHEMA = 'nichefoundry.opportunity.v1';
const LIFECYCLE = Object.freeze([
  'discovered', 'screened', 'researched', 'approved', 'scheduled',
  'produced', 'published', 'measured', 'expanded', 'retired', 'rejected'
]);
const ROLE_TARGETS = Object.freeze({
  core_pillar: 0.50,
  search_evergreen: 0.20,
  experimental: 0.15,
  audience_request: 0.10,
  commercial_intent: 0.05
});
const STOP_WORDS = new Set([
  'the','a','an','and','or','of','to','in','on','for','with','from','by','why','how','what','when','this','that',
  'case','story','episode','video','explained','guide','history','science','engineering','software','open','source'
]);

function clamp(value, min = 0, max = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(Number(value) * factor) / factor;
}

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

function topicTokens(value) {
  return [...new Set(tokens(value).filter((token) => token.length > 2 && !STOP_WORDS.has(token)))];
}

function jaccard(a, b) {
  const left = new Set(topicTokens(a));
  const right = new Set(topicTokens(b));
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function textForCandidate(candidate) {
  return [candidate.title, candidate.topic, candidate.angle, candidate.viewer_job, candidate.series_hint]
    .filter(Boolean).join(' ');
}

function inferRole(candidate) {
  if (ROLE_TARGETS[candidate.content_role]) return candidate.content_role;
  const text = normalizedText(textForCandidate(candidate));
  if (/request|comment|subscriber|audience/.test(text)) return 'audience_request';
  if (/review|comparison|best|buy|choose|alternative|tool/.test(text)) return 'commercial_intent';
  if (/new|release|update|today|latest|breaking|version/.test(text)) return 'experimental';
  if (/how|guide|tutorial|explained|introduction|basics/.test(text)) return 'search_evergreen';
  return 'core_pillar';
}

function defaultSignal(name, candidate, pack) {
  const text = normalizedText(textForCandidate(candidate));
  const sourceCount = Array.isArray(candidate.source_hints) ? candidate.source_hints.length : 0;
  if (name === 'audience_demand') {
    let score = 0.45;
    if (/why|how|what|guide|failure|mystery|repair|collapse|hidden/.test(text)) score += 0.12;
    if (candidate.discovery_source === 'audience_request') score += 0.18;
    return clamp(score);
  }
  if (name === 'content_gap') return clamp(candidate.competitor_count == null ? 0.58 : 1 - Math.min(Number(candidate.competitor_count), 50) / 50);
  if (name === 'series_potential') {
    let score = 0.52;
    if (candidate.series_hint) score += 0.18;
    if ((pack?.content?.archetypes || []).length >= 3) score += 0.08;
    return clamp(score);
  }
  if (name === 'visual_potential') {
    let score = 0.48;
    if (/bridge|object|artefact|artifact|map|mechanism|diagram|screen|workflow|timeline|collapse|tool/.test(text)) score += 0.2;
    if ((pack?.visuals?.language || []).length >= 4) score += 0.08;
    return clamp(score);
  }
  if (name === 'monetization_alignment') {
    let score = 0.38;
    if (/tool|software|guide|comparison|design|training|course|book|diagram/.test(text)) score += 0.18;
    if ((pack?.monetization?.paths || []).length >= 3) score += 0.08;
    return clamp(score);
  }
  if (name === 'evidence_availability') {
    let score = 0.5 + Math.min(sourceCount, 4) * 0.08;
    if (/official|report|documentation|museum|archive|standard/.test(text)) score += 0.08;
    return clamp(score);
  }
  if (name === 'production_burden') {
    let score = 0.42;
    if (/reconstruction|animation|simulation|3d|daily|breaking/.test(text)) score += 0.22;
    if (/tutorial|screen recording|object biography/.test(text)) score -= 0.08;
    return clamp(score);
  }
  if (name === 'policy_risk') {
    let score = pack?.compliance?.risk_level === 'high' ? 0.72 : pack?.compliance?.risk_level === 'medium' ? 0.42 : 0.18;
    if (/death|disaster|victim|medical|financial|weapon|crime/.test(text)) score += 0.22;
    return clamp(score);
  }
  if (name === 'freshness_risk') {
    let score = pack?.research?.freshness_days ? 0.55 : 0.12;
    if (/new|latest|update|release|version|today|weekly/.test(text)) score += 0.25;
    return clamp(score);
  }
  return 0.5;
}

function normalizeCandidate(raw, pack, source = 'manual') {
  const title = normalizeWhitespace(raw?.title || raw?.working_title || raw?.topic || 'Untitled opportunity');
  const topic = normalizeWhitespace(raw?.topic || title);
  const angle = normalizeWhitespace(raw?.angle || raw?.story_premise || `Explain ${topic} through the ${pack.studio.name} channel promise.`);
  const opportunityId = raw?.opportunity_id || stableId('opp', `${pack.studio.id}|${title}|${topic}`);
  const candidate = {
    schema: OPPORTUNITY_SCHEMA,
    opportunity_id: opportunityId,
    studio_id: pack.studio.id,
    title,
    topic,
    angle,
    viewer_job: normalizeWhitespace(raw?.viewer_job || pack.audience?.viewer_jobs?.[0] || 'teach me'),
    discovery_source: raw?.discovery_source || source,
    source_reference: raw?.source_reference || null,
    source_hints: Array.isArray(raw?.source_hints) ? raw.source_hints.filter(Boolean) : [],
    competitor_examples: Array.isArray(raw?.competitor_examples) ? raw.competitor_examples.filter(Boolean).slice(0, 25) : [],
    competitor_count: raw?.competitor_count == null ? null : Math.max(0, Number(raw.competitor_count) || 0),
    series_hint: normalizeWhitespace(raw?.series_hint || ''),
    content_role: inferRole(raw || {}),
    lifecycle: LIFECYCLE.includes(raw?.lifecycle) ? raw.lifecycle : 'discovered',
    operator_notes: normalizeWhitespace(raw?.operator_notes || ''),
    signals: raw?.signals && typeof raw.signals === 'object' ? raw.signals : {},
    discovered_at: raw?.discovered_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  candidate.content_hash = hashObject(candidate);
  return candidate;
}

function scoreOpportunity(pack, rawCandidate, context = {}) {
  const candidate = normalizeCandidate(rawCandidate, pack, rawCandidate?.discovery_source || context.source || 'manual');
  const brief = {
    working_title: candidate.title,
    topic: candidate.topic,
    story_premise: candidate.angle,
    source_queries: candidate.source_hints.length ? candidate.source_hints : [candidate.topic]
  };
  const fit = scoreEpisodeFit(pack, brief);
  const authorityFit = clamp(fit.threshold > 0 ? fit.score / Math.max(fit.threshold * 2, 0.35) : fit.score);
  const signalNames = [
    'audience_demand', 'content_gap', 'series_potential', 'visual_potential',
    'monetization_alignment', 'evidence_availability', 'production_burden',
    'policy_risk', 'freshness_risk'
  ];
  const normalizedSignals = {};
  const provenance = {};
  let explicitCount = 0;
  for (const name of signalNames) {
    const raw = candidate.signals?.[name];
    if (raw != null && Number.isFinite(Number(raw))) {
      normalizedSignals[name] = round(clamp(raw));
      provenance[name] = 'operator_or_provider_signal';
      explicitCount += 1;
    } else {
      normalizedSignals[name] = round(defaultSignal(name, candidate, pack));
      provenance[name] = 'documented_proxy_heuristic';
    }
  }
  normalizedSignals.studio_authority_fit = round(authorityFit);
  provenance.studio_authority_fit = 'studio_pack_fit_engine';

  const weights = {
    audience_demand: 0.18,
    content_gap: 0.16,
    studio_authority_fit: 0.18,
    series_potential: 0.12,
    visual_potential: 0.10,
    monetization_alignment: 0.09,
    evidence_availability: 0.17
  };
  const benefit = Object.entries(weights).reduce((sum, [name, weight]) => sum + normalizedSignals[name] * weight, 0);
  const risk = normalizedSignals.production_burden * 0.42 + normalizedSignals.policy_risk * 0.38 + normalizedSignals.freshness_risk * 0.20;
  const score = Math.round(clamp(benefit * (1 - risk * 0.38)) * 100);
  const confidence = round(0.42 + (explicitCount / signalNames.length) * 0.43 + Math.min(candidate.source_hints.length, 3) * 0.05);
  const decision = !fit.passed ? 'reject_fit' : score >= 72 ? 'prioritize' : score >= 58 ? 'develop' : score >= 43 ? 'watch' : 'reject_low_value';
  const reasons = [
    fit.passed ? `Studio fit passed at ${fit.score}.` : `Studio fit failed at ${fit.score} against ${fit.threshold}.`,
    `Benefit index ${round(benefit)}; risk index ${round(risk)}.`,
    explicitCount ? `${explicitCount} signal${explicitCount === 1 ? '' : 's'} came from operator/provider evidence.` : 'All market signals are labelled proxy heuristics until connected data is supplied.'
  ];
  return {
    ...candidate,
    content_role: inferRole(candidate),
    fit,
    opportunity_score: score,
    score_confidence: confidence,
    decision,
    benefit_index: round(benefit),
    risk_index: round(risk),
    normalized_signals: normalizedSignals,
    signal_provenance: provenance,
    scoring_weights: weights,
    score_explanation: reasons,
    scored_at: new Date().toISOString()
  };
}

function buildCannibalizationReport(candidate, existing = [], options = {}) {
  const threshold = Number(options.blockThreshold || 0.68);
  const warningThreshold = Number(options.warningThreshold || 0.48);
  const currentText = textForCandidate(candidate);
  const matches = existing
    .filter((item) => item && item.opportunity_id !== candidate.opportunity_id)
    .map((item) => {
      const source = item.candidate || item;
      const similarity = round(jaccard(currentText, textForCandidate(source)));
      return {
        record_id: source.opportunity_id || source.episode_id || item.episode_id || 'unknown',
        title: source.title || source.working_title || item.title || 'Untitled',
        record_type: source.opportunity_id ? 'opportunity' : 'episode',
        similarity,
        lifecycle: source.lifecycle || item.lifecycle || item.status || null
      };
    })
    .filter((item) => item.similarity >= warningThreshold)
    .sort((a, b) => b.similarity - a.similarity);
  const blocking = matches.filter((item) => item.similarity >= threshold && !['retired', 'rejected'].includes(item.lifecycle));
  return {
    passed: blocking.length === 0,
    threshold,
    warning_threshold: warningThreshold,
    highest_similarity: matches[0]?.similarity || 0,
    blocking_matches: blocking,
    warnings: matches.filter((item) => item.similarity < threshold),
    checked_at: new Date().toISOString()
  };
}

function clusterLabel(items) {
  const counts = new Map();
  for (const item of items) {
    for (const token of topicTokens(textForCandidate(item))) counts.set(token, (counts.get(token) || 0) + 1);
  }
  const terms = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([token]) => token);
  return terms.length ? terms.map((term) => term[0].toUpperCase() + term.slice(1)).join(' / ') : 'Unclassified Opportunity';
}

function clusterOpportunities(opportunities, threshold = 0.28) {
  const clusters = [];
  const sorted = [...opportunities].sort((a, b) => Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0));
  for (const opportunity of sorted) {
    let best = null;
    for (const cluster of clusters) {
      const similarity = Math.max(...cluster.items.map((item) => jaccard(textForCandidate(opportunity), textForCandidate(item))));
      if (!best || similarity > best.similarity) best = { cluster, similarity };
    }
    if (best && best.similarity >= threshold) best.cluster.items.push(opportunity);
    else clusters.push({ cluster_id: stableId('cluster', `${opportunity.studio_id}|${opportunity.topic}`), items: [opportunity] });
  }
  return clusters.map((cluster) => ({
    cluster_id: cluster.cluster_id,
    name: clusterLabel(cluster.items),
    opportunity_count: cluster.items.length,
    mean_score: Math.round(cluster.items.reduce((sum, item) => sum + Number(item.opportunity_score || 0), 0) / cluster.items.length),
    opportunity_ids: cluster.items.map((item) => item.opportunity_id),
    lead_opportunity_id: [...cluster.items].sort((a, b) => Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0))[0]?.opportunity_id
  }));
}

function buildCompetitorMap(opportunities) {
  const entries = opportunities.map((item) => ({
    opportunity_id: item.opportunity_id,
    title: item.title,
    competitor_count: item.competitor_count,
    competitor_examples: item.competitor_examples || [],
    content_gap_score: item.normalized_signals?.content_gap ?? null,
    provenance: item.signal_provenance?.content_gap || "unknown",
    note: item.competitor_count == null && !(item.competitor_examples || []).length
      ? "No competitor evidence supplied; content-gap score is a labelled proxy."
      : "Competitor evidence was supplied by the operator or discovery provider."
  }));
  return {
    evidence_coverage: entries.length ? round(entries.filter((item) => item.competitor_count != null || item.competitor_examples.length).length / entries.length) : 0,
    entries
  };
}

function buildSignalCoverage(opportunities) {
  const signalNames = ["audience_demand", "content_gap", "series_potential", "visual_potential", "monetization_alignment", "evidence_availability", "production_burden", "policy_risk", "freshness_risk"];
  return {
    opportunity_count: opportunities.length,
    signals: signalNames.map((name) => {
      const grounded = opportunities.filter((item) => item.signal_provenance?.[name] === "operator_or_provider_signal").length;
      return { name, grounded_count: grounded, proxy_count: opportunities.length - grounded, grounded_share: opportunities.length ? round(grounded / opportunities.length) : 0 };
    })
  };
}

function buildPortfolioReport(opportunities) {
  const active = opportunities.filter((item) => !['retired', 'rejected'].includes(item.lifecycle));
  const counts = Object.fromEntries(Object.keys(ROLE_TARGETS).map((role) => [role, 0]));
  active.forEach((item) => { counts[item.content_role] = (counts[item.content_role] || 0) + 1; });
  const total = active.length || 1;
  const roles = Object.entries(ROLE_TARGETS).map(([role, target]) => {
    const actual = (counts[role] || 0) / total;
    return {
      role,
      target_share: target,
      actual_share: round(actual),
      count: counts[role] || 0,
      gap: round(target - actual),
      status: actual < target * 0.55 ? 'underrepresented' : actual > target * 1.65 ? 'overrepresented' : 'balanced'
    };
  });
  return { total_active: active.length, roles, target_model: ROLE_TARGETS };
}

function buildSeriesPlan(pack, opportunities, options = {}) {
  const eligible = opportunities.filter((item) => item.fit?.passed !== false && !['rejected', 'retired'].includes(item.lifecycle));
  const clusters = clusterOpportunities(eligible);
  const series = clusters.map((cluster, index) => {
    const items = cluster.opportunity_ids.map((id) => eligible.find((item) => item.opportunity_id === id)).filter(Boolean);
    const lead = items.find((item) => item.opportunity_id === cluster.lead_opportunity_id) || items[0];
    return {
      series_id: stableId('series', `${pack.studio.id}|${cluster.cluster_id}`),
      name: options.name && clusters.length === 1 ? options.name : cluster.name,
      studio_id: pack.studio.id,
      promise: `${pack.promise.statement} This series focuses on ${cluster.name.toLowerCase()}.`,
      lead_opportunity_id: lead?.opportunity_id || null,
      opportunity_ids: cluster.opportunity_ids,
      recommended_archetypes: (pack.content.archetypes || []).slice(0, Math.min(3, items.length || 1)).map((item) => item.id),
      mean_score: cluster.mean_score,
      series_order: index + 1
    };
  });
  return {
    schema: 'nichefoundry.series_plan.v1',
    studio_id: pack.studio.id,
    generated_at: new Date().toISOString(),
    portfolio: buildPortfolioReport(eligible),
    clusters,
    series
  };
}

function dateOnly(value) {
  const date = value ? new Date(`${value}T12:00:00Z`) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error('Invalid calendar start date.');
  return date;
}

function addDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function buildEditorialCalendar(pack, opportunities, options = {}) {
  const weeks = Math.max(1, Math.min(Number(options.weeks || 6), 26));
  const slotsPerWeek = Math.max(1, Math.min(Number(options.slots_per_week || 2), 7));
  const start = dateOnly(options.start_date);
  const candidates = opportunities
    .filter((item) => item.fit?.passed !== false && item.cannibalization?.passed !== false && ['screened', 'researched', 'approved', 'scheduled', 'discovered'].includes(item.lifecycle))
    .sort((a, b) => Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0));
  const maxSlots = weeks * slotsPerWeek;
  const selected = [];
  const usedClusters = new Map();
  while (selected.length < maxSlots && selected.length < candidates.length) {
    const remaining = candidates.filter((item) => !selected.includes(item));
    remaining.sort((a, b) => {
      const aCluster = usedClusters.get(a.cluster_id) || 0;
      const bCluster = usedClusters.get(b.cluster_id) || 0;
      return (Number(b.opportunity_score || 0) - bCluster * 12) - (Number(a.opportunity_score || 0) - aCluster * 12);
    });
    const picked = remaining[0];
    if (!picked) break;
    selected.push(picked);
    usedClusters.set(picked.cluster_id, (usedClusters.get(picked.cluster_id) || 0) + 1);
  }
  const weekdayOffsets = slotsPerWeek === 1 ? [2] : slotsPerWeek === 2 ? [2, 5] : Array.from({ length: slotsPerWeek }, (_, index) => Math.round(index * 6 / Math.max(1, slotsPerWeek - 1)));
  const entries = selected.map((item, index) => {
    const week = Math.floor(index / slotsPerWeek);
    const slot = index % slotsPerWeek;
    const publishDate = addDays(start, week * 7 + weekdayOffsets[slot]);
    return {
      calendar_entry_id: stableId('cal', `${pack.studio.id}|${item.opportunity_id}|${isoDate(publishDate)}`),
      studio_id: pack.studio.id,
      opportunity_id: item.opportunity_id,
      publish_date: isoDate(publishDate),
      title: item.title,
      content_role: item.content_role,
      cluster_id: item.cluster_id || null,
      opportunity_score: item.opportunity_score,
      status: item.lifecycle === 'scheduled' ? 'scheduled' : 'proposed',
      rationale: `Selected at score ${item.opportunity_score}; portfolio role ${item.content_role}; cluster repetition was penalised during sequencing.`
    };
  });
  return {
    schema: 'nichefoundry.editorial_calendar.v1',
    studio_id: pack.studio.id,
    generated_at: new Date().toISOString(),
    start_date: isoDate(start),
    weeks,
    slots_per_week: slotsPerWeek,
    entries,
    unscheduled_count: Math.max(0, candidates.length - entries.length)
  };
}

function discoverStudioSeeds(pack) {
  const candidates = [];
  for (const sample of pack.samples || []) {
    candidates.push(normalizeCandidate({
      title: sample.working_title,
      topic: sample.topic,
      angle: sample.story_premise,
      source_hints: sample.source_queries,
      series_hint: `${pack.studio.name} flagship cases`,
      discovery_source: 'studio_sample',
      signals: { evidence_availability: 0.78, visual_potential: 0.8, series_potential: 0.7 }
    }, pack, 'studio_sample'));
  }
  for (const topic of pack.fit?.topic_examples || []) {
    candidates.push(normalizeCandidate({
      title: topic.replace(/\b\w/g, (character) => character.toUpperCase()),
      topic,
      angle: `Apply ${pack.studio.name}'s specialist promise to ${topic}.`,
      source_hints: [topic],
      series_hint: `${pack.studio.name} core library`,
      discovery_source: 'studio_topic_example'
    }, pack, 'studio_topic_example'));
  }
  const unique = new Map(candidates.map((item) => [normalizedText(`${item.title}|${item.topic}`), item]));
  return [...unique.values()];
}

function stripHtml(value) {
  return normalizeWhitespace(String(value || '').replace(/<[^>]+>/g, ' '));
}

async function discoverMediaWiki(pack, query, options = {}) {
  const apiBase = options.apiBase || DEFAULT_WIKI_API;
  const url = new URL(apiBase);
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('list', 'search');
  url.searchParams.set('srsearch', query);
  url.searchParams.set('srlimit', String(Math.max(1, Math.min(Number(options.limit || 10), 25))));
  url.searchParams.set('srnamespace', '0');
  url.searchParams.set('srprop', 'snippet|titlesnippet|wordcount|timestamp');
  const data = await (options.fetcher || fetchJson)(url);
  return (data?.query?.search || []).map((result) => normalizeCandidate({
    title: result.title,
    topic: result.title,
    angle: stripHtml(result.snippet) || `Investigate ${result.title} for ${pack.studio.name}.`,
    source_hints: [result.title],
    source_reference: `mediawiki:${result.pageid}`,
    discovery_source: 'mediawiki_search',
    signals: {
      evidence_availability: clamp(0.5 + Math.min(Number(result.wordcount || 0), 8000) / 20000),
      freshness_risk: pack.research?.freshness_days ? 0.5 : 0.1
    }
  }, pack, 'mediawiki_search'));
}

function transitionLifecycle(current, next) {
  if (!LIFECYCLE.includes(next)) throw new Error(`Unknown opportunity lifecycle '${next}'.`);
  if (current === next) return true;
  const terminal = new Set(['retired', 'rejected']);
  if (terminal.has(current) && next !== 'discovered') throw new Error(`Cannot move a ${current} opportunity directly to ${next}. Restore it to discovered first.`);
  const forward = ['discovered', 'screened', 'researched', 'approved', 'scheduled', 'produced', 'published', 'measured', 'expanded'];
  const currentIndex = forward.indexOf(current);
  const nextIndex = forward.indexOf(next);
  if (next === 'retired' || next === 'rejected' || next === 'discovered') return true;
  if (currentIndex === -1 || nextIndex === -1 || nextIndex > currentIndex + 1) {
    throw new Error(`Invalid lifecycle jump from ${current} to ${next}.`);
  }
  return true;
}

function opportunityToBrief(pack, opportunity) {
  const sample = pack.samples?.[0] || {};
  return {
    opportunity_id: opportunity.opportunity_id,
    studio_id: pack.studio.id,
    archetype_id: pack.content.default_archetype,
    working_title: opportunity.title,
    topic: opportunity.topic,
    story_premise: opportunity.angle,
    age_band: sample.age_band || pack.audience.primary_age || '13+',
    difficulty: sample.difficulty || 'mixed',
    question_count: sample.question_count || 6,
    countdown_seconds: sample.countdown_seconds || 8,
    audience_mode: sample.audience_mode || 'general_family',
    contains_synthetic_media: Boolean(sample.contains_synthetic_media),
    source_mode: sample.source_mode || 'wikipedia',
    source_queries: opportunity.source_hints?.length ? opportunity.source_hints : [opportunity.topic],
    visual_direction: (pack.visuals?.language || []).slice(0, 4).join(', ')
  };
}

module.exports = {
  OPPORTUNITY_SCHEMA,
  LIFECYCLE,
  ROLE_TARGETS,
  normalizeCandidate,
  scoreOpportunity,
  buildCannibalizationReport,
  clusterOpportunities,
  buildPortfolioReport,
  buildCompetitorMap,
  buildSignalCoverage,
  buildSeriesPlan,
  buildEditorialCalendar,
  discoverStudioSeeds,
  discoverMediaWiki,
  transitionLifecycle,
  opportunityToBrief,
  jaccard,
  hashObject
};
