const { normalizedText, tokens, tokenSet, jaccard, lexicalOverlap, stableId, clamp } = require('./text');

function nowIso() {
  return new Date().toISOString();
}

function safeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sourceAuthorityDate(source) {
  return safeDate(source.published_at || source.revision_timestamp || source.updated_at || source.retrieved_at);
}

function sourceHost(source) {
  try {
    const url = new URL(source.source_url || source.canonical_url);
    return url.hostname || url.protocol.replace(':', '');
  } catch (_error) {
    return normalizedText(source.publisher || source.provider || 'unknown');
  }
}

function independenceKey(source) {
  const publisher = normalizedText(source.publisher || '');
  const host = normalizedText(sourceHost(source));
  if (publisher && publisher !== 'unknown publisher') return publisher;
  return host || normalizedText(source.provider || source.connector_id || 'unknown');
}

function buildIndependenceReport(sources, requiredCount = 2, mode = "publisher_domain") {
  const groups = new Map();
  for (const source of sources) {
    const key = mode === "distinct_records" ? source.source_id : independenceKey(source);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(source.source_id);
  }
  const entries = [...groups.entries()].map(([key, sourceIds]) => ({ independence_key: key, source_ids: sourceIds, source_count: sourceIds.length }));
  return {
    mode,
    required_independent_sources: Number(requiredCount || 2),
    independent_source_count: entries.length,
    passed: entries.length >= Number(requiredCount || 2),
    groups: entries,
    issues: entries.length >= Number(requiredCount || 2) ? [] : [`Only ${entries.length} independent publisher/domain group${entries.length === 1 ? '' : 's'} were found; ${requiredCount} are required.`]
  };
}

function buildSourceHierarchyReport(pack, sources) {
  const policy = pack.research || {};
  const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const typeCounts = {};
  const primarySources = [];
  const claimEligible = [];
  const invalid = [];
  for (const source of sources) {
    const tier = Number(source.source_tier || 4);
    if (![1, 2, 3, 4].includes(tier)) invalid.push({ source_id: source.source_id, issue: 'invalid_source_tier' });
    else tierCounts[tier] += 1;
    typeCounts[source.source_type || 'unspecified'] = (typeCounts[source.source_type || 'unspecified'] || 0) + 1;
    if (source.primary_source === true) primarySources.push(source.source_id);
    if (source.eligible_for_claims !== false) claimEligible.push(source.source_id);
  }
  const independence = buildIndependenceReport(sources, policy.minimum_independent_sources || 2, policy.independence_mode || "publisher_domain");
  const primarySatisfied = !policy.primary_source_required || primarySources.length > 0;
  const sourceCountSatisfied = sources.length >= Number(policy.minimum_independent_sources || 2);
  const passed = invalid.length === 0 && claimEligible.length > 0 && sourceCountSatisfied && independence.passed && primarySatisfied;
  return {
    passed,
    minimum_independent_sources: Number(policy.minimum_independent_sources || 2),
    total_source_count: sources.length,
    claim_eligible_source_count: claimEligible.length,
    primary_source_required: Boolean(policy.primary_source_required),
    primary_source_count: primarySources.length,
    primary_source_ids: primarySources,
    tier_counts: tierCounts,
    type_counts: typeCounts,
    independence,
    preferred_source_tiers: policy.preferred_source_tiers || {},
    issues: [
      ...invalid.map((entry) => `${entry.source_id}: invalid source tier.`),
      ...(!sourceCountSatisfied ? [`Only ${sources.length} sources were retrieved; ${policy.minimum_independent_sources || 2} are required.`] : []),
      ...(!independence.passed ? independence.issues : []),
      ...(!primarySatisfied ? ['The Studio Pack requires at least one source explicitly classified as primary.'] : []),
      ...(claimEligible.length === 0 ? ['No source is eligible for claim extraction.'] : [])
    ],
    warnings: [
      ...(tierCounts[3] + tierCounts[4] === sources.length ? ['All sources are orientation or low-authority records; add stronger specialist evidence.'] : []),
      ...(sources.some((source) => source.licence === 'Review required') ? ['One or more source licences require operator review.'] : [])
    ]
  };
}

function sourceNeedsFreshness(source) {
  const type = String(source.source_type || '').toLowerCase();
  return /release|documentation|repository|software|feed|platform|news|analytics|web_document|official_project/.test(type);
}

function buildFreshnessReport(pack, sources, options = {}) {
  const threshold = pack.research?.freshness_days == null ? null : Number(pack.research.freshness_days);
  const now = safeDate(options.now) || new Date();
  const entries = sources.map((source) => {
    const date = sourceAuthorityDate(source);
    const ageDays = date ? Math.max(0, (now.getTime() - date.getTime()) / 86400000) : null;
    const freshnessRequired = threshold != null && sourceNeedsFreshness(source);
    const status = !date ? 'undated' : freshnessRequired && ageDays > threshold ? 'stale' : freshnessRequired ? 'current' : 'not_time_sensitive';
    return {
      source_id: source.source_id,
      title: source.title,
      authority_date: date ? date.toISOString() : null,
      age_days: ageDays == null ? null : Number(ageDays.toFixed(1)),
      freshness_required: freshnessRequired,
      threshold_days: freshnessRequired ? threshold : null,
      status
    };
  });
  const required = entries.filter((entry) => entry.freshness_required);
  const stale = required.filter((entry) => entry.status === 'stale');
  const undated = required.filter((entry) => entry.status === 'undated');
  const current = required.filter((entry) => entry.status === 'current');
  const passed = threshold == null || (current.length > 0 && stale.length === 0 && undated.length === 0);
  return {
    passed,
    policy_freshness_days: threshold,
    time_sensitive_source_count: required.length,
    current_source_count: current.length,
    stale_source_count: stale.length,
    undated_source_count: undated.length,
    entries,
    issues: [
      ...stale.map((entry) => `${entry.source_id} is ${entry.age_days} days old and exceeds the ${threshold}-day policy.`),
      ...undated.map((entry) => `${entry.source_id} requires freshness evidence but has no usable authority date.`),
      ...(threshold != null && required.length > 0 && current.length === 0 ? ['No current source satisfies the Studio Pack freshness policy.'] : [])
    ],
    warnings: threshold == null ? ['This Studio Pack has no numeric freshness window; recency remains an editorial judgement.'] : []
  };
}

function numericTokens(value) {
  return [...String(value || '').matchAll(/\b\d+(?:\.\d+)?\b/g)].map((match) => Number(match[0]));
}

function hasNegation(value) {
  return /\b(?:not|never|no|without|didn'?t|doesn'?t|isn'?t|wasn'?t|cannot|can'?t|unlikely)\b/i.test(String(value || ''));
}

const OPPOSITIONS = [
  ['increase', 'decrease'], ['increased', 'decreased'], ['higher', 'lower'], ['before', 'after'],
  ['safe', 'unsafe'], ['supported', 'unsupported'], ['opened', 'closed'], ['cause', 'prevent'],
  ['caused', 'prevented'], ['confirmed', 'rejected'], ['present', 'absent']
];

function opposingLanguage(left, right) {
  const a = normalizedText(left);
  const b = normalizedText(right);
  return OPPOSITIONS.some(([first, second]) => (a.includes(first) && b.includes(second)) || (a.includes(second) && b.includes(first)));
}

function claimRelation(left, right) {
  if (left.source_id === right.source_id) return null;
  const subjectSimilarity = lexicalOverlap(left.subject || left.source_title, right.subject || right.source_title);
  if (subjectSimilarity < 0.22) return null;
  const statementSimilarity = jaccard(left.claim, right.claim);
  const leftNumbers = numericTokens(left.claim);
  const rightNumbers = numericTokens(right.claim);
  const numericConflict = leftNumbers.length && rightNumbers.length && statementSimilarity >= 0.28 && !leftNumbers.some((number) => rightNumbers.includes(number));
  const polarityConflict = hasNegation(left.claim) !== hasNegation(right.claim) && statementSimilarity >= 0.38;
  const languageConflict = opposingLanguage(left.claim, right.claim) && statementSimilarity >= 0.25;
  if (numericConflict || polarityConflict || languageConflict) {
    return {
      relation: 'conflicts_with',
      confidence: Number(clamp(Math.max(statementSimilarity, subjectSimilarity) + (numericConflict ? 0.15 : 0), 0, 1).toFixed(3)),
      reasons: [
        ...(numericConflict ? ['different_numeric_assertions'] : []),
        ...(polarityConflict ? ['opposite_negation_or_polarity'] : []),
        ...(languageConflict ? ['opposing_language'] : [])
      ]
    };
  }
  if (statementSimilarity >= 0.62 || (statementSimilarity >= 0.48 && subjectSimilarity >= 0.55)) {
    return { relation: 'supports', confidence: Number(Math.max(statementSimilarity, subjectSimilarity).toFixed(3)), reasons: ['cross_source_semantic_agreement'] };
  }
  return null;
}

function unionFind(items) {
  const parent = new Map(items.map((item) => [item, item]));
  function find(item) {
    const current = parent.get(item);
    if (current !== item) parent.set(item, find(current));
    return parent.get(item);
  }
  function union(left, right) {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent.set(b, a);
  }
  return { find, union };
}

function buildConflictGraph(claims, sources, freshnessReport = null) {
  const sourceMap = new Map(sources.map((source) => [source.source_id, source]));
  const supportEdges = [];
  const conflictEdges = [];
  const uf = unionFind(claims.map((claim) => claim.claim_id));
  for (let left = 0; left < claims.length; left += 1) {
    for (let right = left + 1; right < claims.length; right += 1) {
      const relation = claimRelation(claims[left], claims[right]);
      if (!relation) continue;
      const edge = {
        edge_id: stableId('edge', `${claims[left].claim_id}|${relation.relation}|${claims[right].claim_id}`),
        from_claim_id: claims[left].claim_id,
        to_claim_id: claims[right].claim_id,
        relation: relation.relation,
        confidence: relation.confidence,
        reasons: relation.reasons
      };
      if (relation.relation === 'supports') {
        supportEdges.push(edge);
        uf.union(claims[left].claim_id, claims[right].claim_id);
      } else {
        conflictEdges.push(edge);
      }
    }
  }
  const staleSet = new Set((freshnessReport?.entries || []).filter((entry) => entry.status === 'stale').map((entry) => entry.source_id));
  const conflictSet = new Set(conflictEdges.flatMap((edge) => [edge.from_claim_id, edge.to_claim_id]));
  const supportCount = new Map();
  supportEdges.forEach((edge) => {
    supportCount.set(edge.from_claim_id, (supportCount.get(edge.from_claim_id) || 0) + 1);
    supportCount.set(edge.to_claim_id, (supportCount.get(edge.to_claim_id) || 0) + 1);
  });
  const governedClaims = claims.map((claim) => {
    let status = claim.status || 'supported';
    if (conflictSet.has(claim.claim_id)) status = 'disputed';
    else if (staleSet.has(claim.source_id) && !(supportCount.get(claim.claim_id) > 0)) status = 'outdated';
    else if (Number(claim.confidence || 0) < 0.5) status = 'weakly_supported';
    return {
      ...claim,
      status,
      corroborating_claim_count: supportCount.get(claim.claim_id) || 0,
      source_tier: sourceMap.get(claim.source_id)?.source_tier || null,
      primary_source: Boolean(sourceMap.get(claim.source_id)?.primary_source),
      governance_notes: [
        ...(status === 'disputed' ? ['Conflicting cross-source claim detected; human resolution required.'] : []),
        ...(status === 'outdated' ? ['The only supporting source is stale under the Studio Pack policy.'] : []),
        ...((supportCount.get(claim.claim_id) || 0) > 0 ? ['Corroborated by at least one independent source claim.'] : [])
      ]
    };
  });
  const clusterMap = new Map();
  governedClaims.forEach((claim) => {
    const root = uf.find(claim.claim_id);
    if (!clusterMap.has(root)) clusterMap.set(root, []);
    clusterMap.get(root).push(claim.claim_id);
  });
  const clusters = [...clusterMap.entries()].map(([root, claimIds]) => ({
    cluster_id: stableId('claim_cluster', root),
    claim_ids: claimIds,
    claim_count: claimIds.length,
    corroborated: claimIds.length > 1
  }));
  return {
    schema: 'nichefoundry.claim_conflict_graph.v1',
    generated_at: nowIso(),
    passed: conflictEdges.length === 0,
    requires_human_resolution: conflictEdges.length > 0,
    nodes: governedClaims.map((claim) => ({
      claim_id: claim.claim_id,
      source_id: claim.source_id,
      claim: claim.claim,
      subject: claim.subject,
      claim_type: claim.claim_type,
      status: claim.status,
      confidence: claim.confidence,
      source_tier: claim.source_tier,
      primary_source: claim.primary_source,
      corroborating_claim_count: claim.corroborating_claim_count
    })),
    support_edges: supportEdges,
    conflict_edges: conflictEdges,
    clusters,
    issues: conflictEdges.map((edge) => `${edge.from_claim_id} conflicts with ${edge.to_claim_id}: ${edge.reasons.join(', ')}.`),
    checks: ['cross-source semantic support', 'numeric disagreement', 'negation disagreement', 'opposing-language disagreement']
  };
}

function applyGraphStatuses(claims, graph) {
  const nodeMap = new Map(graph.nodes.map((node) => [node.claim_id, node]));
  return claims.map((claim) => {
    const node = nodeMap.get(claim.claim_id);
    if (!node) return claim;
    return {
      ...claim,
      status: node.status,
      corroborating_claim_count: node.corroborating_claim_count,
      source_tier: node.source_tier,
      primary_source: node.primary_source,
      governance_checked_at: graph.generated_at
    };
  });
}

function buildResearchGovernance(pack, sources, claims, options = {}) {
  const hierarchy = buildSourceHierarchyReport(pack, sources);
  const freshness = buildFreshnessReport(pack, sources, options);
  const conflicts = buildConflictGraph(claims, sources, freshness);
  const governedClaims = applyGraphStatuses(claims, conflicts);
  const statusCounts = governedClaims.reduce((output, claim) => {
    output[claim.status] = (output[claim.status] || 0) + 1;
    return output;
  }, {});
  return {
    schema: 'nichefoundry.research_governance.v1',
    generated_at: nowIso(),
    passed: hierarchy.passed && freshness.passed && conflicts.passed,
    source_hierarchy: hierarchy,
    freshness,
    conflict_graph: conflicts,
    claim_status_counts: statusCounts,
    claims: governedClaims,
    issues: [...hierarchy.issues, ...freshness.issues, ...conflicts.issues],
    warnings: [...hierarchy.warnings, ...freshness.warnings],
    human_review_required: !conflicts.passed || !hierarchy.passed || !freshness.passed
  };
}

module.exports = {
  buildIndependenceReport,
  buildSourceHierarchyReport,
  buildFreshnessReport,
  buildConflictGraph,
  buildResearchGovernance,
  applyGraphStatuses,
  sourceAuthorityDate,
  independenceKey
};
