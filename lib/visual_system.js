const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { normalizedText, tokens, jaccard, stableId, clamp, normalizeWhitespace } = require('./text');
const { readableSubjectLabel } = require('./claims');

const VISUAL_SCHEMA_VERSION = '1.0';
const WIDTH = 1920;
const HEIGHT = 1080;

const STUDIO_PRESETS = {
  failure_atlas: {
    colors: { background: '#071016', surface: '#111f29', panel: '#172a35', primary: '#dce8ee', muted: '#8fa4af', accent: '#45d5ff', secondary: '#f2a93b', danger: '#ed5a5a', grid: '#223846' },
    typography: { display: 'Rajdhani, Oxanium, sans-serif', body: 'Inter, Arial, sans-serif', mono: 'IBM Plex Mono, monospace' },
    motif: 'technical_cutaway', compositions: ['cutaway_left', 'load_path', 'causal_stack', 'investigation_board'], thumbnail_compositions: ['fracture_focus', 'system_vs_failure'],
    texture: 'engineering_grid', icon_style: 'outlined_technical', diagram_style: 'force_path', map_style: 'infrastructure_schematic'
  },
  history_under_glass: {
    colors: { background: '#120f0d', surface: '#211a16', panel: '#eee2c9', primary: '#fff8e8', muted: '#bfae91', accent: '#b8894f', secondary: '#7a2439', danger: '#9f4438', grid: '#4a3b2f' },
    typography: { display: 'Cormorant Garamond, Georgia, serif', body: 'Source Sans 3, Arial, sans-serif', mono: 'IBM Plex Mono, monospace' },
    motif: 'museum_vitrine', compositions: ['object_vitrine', 'document_exhibit', 'route_map', 'chronology_ribbon'], thumbnail_compositions: ['object_macro', 'artifact_question'],
    texture: 'archival_paper', icon_style: 'engraved_museum', diagram_style: 'material_exhibit', map_style: 'period_atlas'
  },
  practical_open_source: {
    colors: { background: '#05090b', surface: '#0b1418', panel: '#111d22', primary: '#effff6', muted: '#8ea6a0', accent: '#59ef9a', secondary: '#4fd7ff', danger: '#ffb24c', grid: '#18302c' },
    typography: { display: 'Space Grotesk, Inter, sans-serif', body: 'Inter, Arial, sans-serif', mono: 'JetBrains Mono, IBM Plex Mono, monospace' },
    motif: 'verified_terminal', compositions: ['terminal_proof', 'workflow_map', 'before_after', 'decision_matrix'], thumbnail_compositions: ['result_proof', 'tool_faceoff'],
    texture: 'terminal_grid', icon_style: 'monoline_system', diagram_style: 'architecture_flow', map_style: 'dependency_graph'
  },
  puzzle_planet: {
    colors: { background: '#071629', surface: '#102b46', panel: '#f4fbff', primary: '#ffffff', muted: '#9ec7d8', accent: '#62e88a', secondary: '#ffc64a', danger: '#ff6b66', grid: '#1e4b68' },
    typography: { display: 'Fredoka, Nunito, sans-serif', body: 'Nunito, Arial, sans-serif', mono: 'IBM Plex Mono, monospace' },
    motif: 'mission_map', compositions: ['mission_map', 'challenge_portal', 'evidence_fieldbook', 'victory_path'], thumbnail_compositions: ['mission_emergency', 'discovery_reveal'],
    texture: 'star_chart', icon_style: 'friendly_adventure', diagram_style: 'illustrated_learning', map_style: 'expedition_map'
  }
};

function hashText(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function hashObject(value) {
  return hashText(canonicalJson(value));
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function wrap(text, maxChars = 44, maxLines = 5) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    } else current = next;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (words.length && lines.join(' ').split(/\s+/).length < words.length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[. ]+$/, '')}…`;
  }
  return lines;
}

function textLines(lines, x, y, size, lineHeight, fill, weight = 500, family = 'Arial', anchor = 'start') {
  return lines.map((line, index) => `<text x="${x}" y="${y + index * lineHeight}" fill="${fill}" font-size="${size}" font-weight="${weight}" font-family="${esc(family)}" text-anchor="${anchor}">${esc(line)}</text>`).join('\n');
}

function relativeLuminance(hex) {
  const normalized = String(hex).replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return 0;
  const channels = [0, 2, 4].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16) / 255).map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(a, b) {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

function validateVisualSystem(pack) {
  const preset = STUDIO_PRESETS[pack?.studio?.id];
  const custom = pack?.visual_system || {};
  const identity = custom.identity || {};
  const colors = identity.colors || preset?.colors || {};
  const issues = [];
  const warnings = [];
  if (!preset && !Object.keys(colors).length) issues.push('No visual-system preset or custom colour tokens are defined.');
  for (const key of ['background', 'surface', 'primary', 'accent']) {
    if (!/^#[0-9a-f]{6}$/i.test(colors[key] || '')) issues.push(`Missing or invalid six-digit colour token: ${key}.`);
  }
  const compositions = custom.compositions || preset?.compositions || [];
  if (compositions.length < 3) issues.push('At least three scene compositions are required to prevent template repetition.');
  const thumbnailCompositions = custom.thumbnail_compositions || preset?.thumbnail_compositions || [];
  if (thumbnailCompositions.length < 2) warnings.push('Provide at least two thumbnail composition families.');
  const ratio = colors.background && colors.primary ? contrastRatio(colors.background, colors.primary) : 0;
  if (ratio && ratio < 4.5) issues.push(`Primary text/background contrast is ${ratio}:1; at least 4.5:1 is required.`);
  return { passed: issues.length === 0, issues, warnings, contrast_ratio: ratio, checked_at: new Date().toISOString() };
}

function buildVisualIdentity(pack) {
  const preset = STUDIO_PRESETS[pack.studio.id] || {};
  const custom = pack.visual_system || {};
  const identity = custom.identity || {};
  const colors = { ...(preset.colors || {}), ...(identity.colors || {}) };
  const typography = { ...(preset.typography || {}), ...(identity.typography || {}) };
  const safeArea = { title: 0.08, action: 0.05, captions_bottom: 0.16, ...(custom.safe_area || {}) };
  const result = {
    schema: `nichefoundry.visual_identity.v${VISUAL_SCHEMA_VERSION}`,
    studio_id: pack.studio.id,
    studio_name: pack.studio.name,
    studio_version: pack.studio.version,
    identity_name: custom.name || `${pack.studio.name} Visual Constitution`,
    colors,
    typography,
    grid: { columns: 12, gutter_px: 28, margin_px: 96, baseline_px: 8, ...(custom.grid || {}) },
    safe_area: safeArea,
    motif: custom.motif || preset.motif || 'specialist_editorial',
    texture: custom.texture || preset.texture || 'restrained_texture',
    icon_style: custom.icon_style || preset.icon_style || 'specialist_monoline',
    diagram_style: custom.diagram_style || preset.diagram_style || 'evidence_diagram',
    map_style: custom.map_style || preset.map_style || 'evidence_map',
    compositions: custom.compositions || preset.compositions || ['evidence_left', 'evidence_right', 'timeline'],
    thumbnail_compositions: custom.thumbnail_compositions || preset.thumbnail_compositions || ['single_focal', 'contrast_pair'],
    motion_rules: pack.visuals.motion_rules || [],
    visual_language: pack.visuals.language || [],
    forbidden_visuals: pack.visuals.forbidden || [],
    accessibility: {
      minimum_body_contrast: 4.5,
      minimum_large_text_contrast: 3,
      minimum_body_px_1080p: Number(custom.accessibility?.minimum_body_px_1080p || 34),
      minimum_caption_px_1080p: Number(custom.accessibility?.minimum_caption_px_1080p || 42),
      colour_only_encoding_forbidden: true
    },
    rights_defaults: {
      generated_preview_license: 'project_owned_generated_asset',
      external_asset_policy: 'explicit_source_and_licence_required',
      unknown_rights_allowed: false
    },
    generated_at: new Date().toISOString()
  };
  result.identity_hash = `visual_identity_${hashObject(result).slice(0, 32)}`;
  return result;
}

function sceneKind(scene, index, total) {
  if (scene.scene_type === 'question_turn') return 'question_turn';
  if (index === 0) return 'opening_hook';
  if (index === total - 1) return 'closing_payoff';
  if (/timeline|chronolog|sequence|window/i.test(`${scene.beat_name} ${scene.title}`)) return 'timeline';
  if (/map|route|origin|arrival/i.test(`${scene.beat_name} ${scene.title}`)) return 'map';
  if (/compare|option|redesign|decision/i.test(`${scene.beat_name} ${scene.title}`)) return 'comparison';
  if (/validation|evidence|investigation|exhibit|proof/i.test(`${scene.beat_name} ${scene.title}`)) return 'evidence';
  if (/mechanism|component|force|process|workflow|setup/i.test(`${scene.beat_name} ${scene.title}`)) return 'mechanism';
  return 'narrative_evidence';
}

function chooseComposition(identity, scene, index, total) {
  const kind = sceneKind(scene, index, total);
  const beatName = normalizedText(`${scene.beat_name || ''} ${scene.title || ''}`);
  const studioSpecific = {
    failure_atlas: { opening_hook: 'fracture_focus', mechanism: 'cutaway_left', timeline: 'causal_stack', evidence: 'investigation_board', comparison: 'system_vs_failure', question_turn: 'decision_matrix', closing_payoff: 'design_principle' },
    history_under_glass: { opening_hook: 'object_vitrine', mechanism: 'material_exhibit', timeline: 'chronology_ribbon', evidence: 'document_exhibit', map: 'route_map', comparison: 'competing_exhibits', question_turn: 'artifact_question', closing_payoff: 'museum_label_verdict' },
    practical_open_source: { opening_hook: 'result_proof', mechanism: 'workflow_map', timeline: 'step_sequence', evidence: 'terminal_proof', comparison: 'decision_matrix', question_turn: 'decision_matrix', closing_payoff: 'validated_result' },
    puzzle_planet: { opening_hook: 'mission_emergency', mechanism: 'evidence_fieldbook', timeline: 'mission_path', evidence: 'challenge_portal', map: 'mission_map', comparison: 'choice_gate', question_turn: 'challenge_portal', closing_payoff: 'victory_path' }
  };
  if (identity.studio_id === 'history_under_glass') {
    if (/materials and making/.test(beatName)) return 'material_exhibit';
    if (/original use/.test(beatName)) return 'document_exhibit';
    if (/human context/.test(beatName)) return 'competing_exhibits';
    if (/survival|discovery/.test(beatName)) return 'chronology_ribbon';
    if (/historical meaning/.test(beatName)) return 'object_vitrine';
    if (/conclusion/.test(beatName)) return 'museum_label_verdict';
  }
  const mapped = studioSpecific[identity.studio_id]?.[kind];
  return mapped || identity.compositions[index % identity.compositions.length];
}

function visualRequirements(scene, identity, composition) {
  const requested = scene.visual_requirements || [];
  return [...new Set([
    ...requested,
    `Use ${composition.replaceAll('_', ' ')} composition`,
    `Use ${identity.diagram_style.replaceAll('_', ' ')} diagram grammar where evidence permits`,
    `Respect ${Math.round(identity.safe_area.captions_bottom * 100)}% caption-safe lower area`,
    'No unlicensed external media in generated preview'
  ])];
}

function focalSubjectForScene(scene, claimsById = new Map(), brief = {}) {
  const claim = (scene.claim_ids || []).map((id) => claimsById.get(id)).find(Boolean) || null;
  if (scene.scene_type === 'question_turn' && scene.question_turn?.prompt) {
    return normalizeWhitespace(scene.question_turn.prompt);
  }
  if (claim) {
    const label = readableSubjectLabel(
      claim.display_subject || claim.prompt_subject || claim.subject || claim.source_title,
      claim.source_title || scene.title || scene.beat_name
    );
    const topic = normalizeWhitespace(brief.topic || '');
    if (/^(though|because|according|from|other than|when)\b/i.test(label)) return topic || label;
    const genericLabels = new Set(['museum', 'artifact', 'object', 'stone', 'fragment', 'decree', 'exhibit']);
    if (genericLabels.has(normalizedText(label))) return topic || label;
    if (topic && label && label.split(/\s+/).length <= 2 && normalizedText(topic).includes(normalizedText(label))) return topic;
    return label;
  }
  return normalizeWhitespace(scene.title || scene.beat_name || 'Scene');
}

function viewerFacingOverlay(scene, claim, subject) {
  const beatName = normalizedText(`${scene.beat_name || ''} ${scene.title || ''}`);
  if (/opening|hook/.test(beatName)) return 'Object and key question';
  if (/object reveal/.test(beatName)) return 'Artifact details and visible evidence';
  if (/materials and making/.test(beatName)) return 'Material clues and construction';
  if (/original use/.test(beatName)) return 'Likely original role and setting';
  if (/human context/.test(beatName)) return 'People, institutions, and meaning';
  if (/survival|discovery/.test(beatName)) return 'Discovery and movement timeline';
  if (/historical meaning/.test(beatName)) return 'What the evidence supports';
  if (/conclusion/.test(beatName)) return 'Final takeaway';
  if (claim?.claim_type === 'date_or_quantity') return 'Dates, scale, and chronology';
  if (claim?.claim_type === 'origin') return 'Origin and context';
  if (claim?.claim_type === 'description') return `${subject} details`;
  return subject || 'Evidence focus';
}

function evidenceOverlayForScene(scene, claimsById = new Map(), brief = {}) {
  const claim = (scene.claim_ids || []).map((id) => claimsById.get(id)).find(Boolean) || null;
  if (scene.scene_type === 'question_turn') return 'Supported question and answer reveal';
  if (claim) {
    const subject = focalSubjectForScene(scene, claimsById, brief);
    return viewerFacingOverlay(scene, claim, subject);
  }
  const claimIds = scene.claim_ids || [];
  const sourceIds = scene.source_ids || [];
  return claimIds.length ? 'Evidence summary' : 'Narrative bridge';
}

function buildScenePlan(scene, index, scenes, identity, episodeId, claimsById = new Map(), brief = {}) {
  const kind = sceneKind(scene, index, scenes.length);
  const composition = chooseComposition(identity, scene, index, scenes.length);
  const assetId = stableId('asset', `${episodeId}|${scene.scene_id}|${composition}`);
  const claimIds = scene.claim_ids || [];
  const sourceIds = scene.source_ids || [];
  const focalSubject = focalSubjectForScene(scene, claimsById, brief);
  const featureTokens = [identity.studio_id, identity.motif, identity.diagram_style, composition, kind, scene.beat_name, ...tokens(focalSubject).slice(0, 6)];
  return {
    scene_id: scene.scene_id,
    scene_index: index,
    beat_name: scene.beat_name,
    title: scene.title,
    objective: scene.objective,
    scene_type: scene.scene_type || 'narrative_scene',
    kind,
    composition,
    focal_subject: focalSubject,
    topic: normalizeWhitespace(brief.topic || focalSubject),
    evidence_overlay: evidenceOverlayForScene(scene, claimsById, brief),
    claim_ids: claimIds,
    source_ids: sourceIds,
    visual_requirements: visualRequirements(scene, identity, composition),
    motion_cue: identity.motion_rules[index % Math.max(1, identity.motion_rules.length)] || 'restrained evidence-led reveal',
    text_budget: { headline_words: 9, supporting_words: 24, body_lines: 5 },
    question_turn: scene.question_turn || null,
    safe_area: identity.safe_area,
    preview_asset_id: assetId,
    preview_path: `visuals/scenes/${String(index + 1).padStart(2, '0')}_${scene.scene_id}.svg`,
    feature_tokens: [...new Set(featureTokens.filter(Boolean))]
  };
}

function thumbnailCandidates({ title, brief, identity }) {
  const sourceTitle = String(title || brief?.topic || 'Untitled programme').trim() || 'Untitled programme';
  const words = sourceTitle.split(/\s+/).filter(Boolean);
  const compactTitle = words.length <= 7 ? sourceTitle : words.slice(0, 6).join(' ');
  const topicWords = String(brief?.topic || sourceTitle).split(/\s+/).filter(Boolean).slice(0, 4).join(' ');
  const candidateText = [compactTitle, topicWords, identity.studio_id === 'practical_open_source' ? 'PROVEN WORKFLOW' : identity.studio_id === 'failure_atlas' ? 'THE HIDDEN FAILURE' : identity.studio_id === 'history_under_glass' ? 'WHAT THIS OBJECT REVEALS' : 'MISSION UNLOCKED'];
  return identity.thumbnail_compositions.slice(0, 3).map((composition, index) => ({
    candidate_id: `thumb_${index + 1}`,
    composition,
    text: candidateText[index] || compactTitle,
    text_word_count: (candidateText[index] || compactTitle).split(/\s+/).length,
    focal_subject: brief.topic,
    emotional_promise: identity.studio_id === 'failure_atlas' ? 'causal revelation' : identity.studio_id === 'history_under_glass' ? 'material mystery' : identity.studio_id === 'practical_open_source' ? 'verified useful result' : 'adventure and discovery',
    background: identity.colors.background,
    foreground: identity.colors.primary,
    accent: index % 2 ? identity.colors.secondary : identity.colors.accent,
    contrast_ratio: contrastRatio(identity.colors.background, identity.colors.primary),
    selected: index === 0
  }));
}

function packageFingerprint(identity, scenePlans, thumbnailPlan, brief) {
  const tokensSet = new Set([
    identity.studio_id, identity.motif, identity.texture, identity.diagram_style, identity.map_style,
    ...scenePlans.map((item) => item.composition), ...scenePlans.map((item) => item.kind),
    ...thumbnailPlan.candidates.map((item) => item.composition), ...tokens(brief.topic || ''), ...tokens(brief.archetype_id || '')
  ].filter(Boolean));
  return [...tokensSet].sort();
}

function priorVisualFingerprint(packet) {
  return packet?.visual_package?.fingerprint_tokens || packet?.visual_fingerprint?.tokens || packet?.visual_plan?.fingerprint_tokens || [];
}

function buildSimilarityReport(currentTokens, scenePlans, priorPackets = [], episodeId = null) {
  const comparisons = [];
  for (const prior of priorPackets || []) {
    const priorId = prior?.episode?.episode_id || prior?.episode_id;
    if (!priorId || priorId === episodeId) continue;
    const priorTokens = priorVisualFingerprint(prior);
    if (!priorTokens.length) continue;
    comparisons.push({ episode_id: priorId, title: prior?.episode?.title || prior?.title || priorId, similarity: Number(jaccard(new Set(currentTokens), new Set(priorTokens)).toFixed(3)) });
  }
  comparisons.sort((a, b) => b.similarity - a.similarity);
  const compositionCounts = scenePlans.reduce((result, scene) => {
    result[scene.composition] = (result[scene.composition] || 0) + 1;
    return result;
  }, {});
  const largestCompositionShare = scenePlans.length ? Math.max(...Object.values(compositionCounts)) / scenePlans.length : 1;
  const maximumLibrarySimilarity = comparisons[0]?.similarity || 0;
  const issues = [];
  const warnings = [];
  if (largestCompositionShare > 0.5) issues.push(`One composition occupies ${(largestCompositionShare * 100).toFixed(0)}% of scenes; vary the episode grammar.`);
  if (maximumLibrarySimilarity >= 0.84) issues.push(`Visual package is ${Math.round(maximumLibrarySimilarity * 100)}% similar to ${comparisons[0].title}.`);
  else if (maximumLibrarySimilarity >= 0.7) warnings.push(`Visual package has ${Math.round(maximumLibrarySimilarity * 100)}% feature overlap with ${comparisons[0].title}.`);
  return {
    schema: `nichefoundry.visual_similarity_report.v${VISUAL_SCHEMA_VERSION}`,
    passed: issues.length === 0,
    threshold: 0.84,
    warning_threshold: 0.7,
    maximum_library_similarity: maximumLibrarySimilarity,
    closest_library_matches: comparisons.slice(0, 5),
    composition_counts: compositionCounts,
    largest_composition_share: Number(largestCompositionShare.toFixed(3)),
    unique_compositions: Object.keys(compositionCounts).length,
    issues,
    warnings,
    checked_at: new Date().toISOString()
  };
}

function buildAssetRecords({ episodeId, scenePlans, thumbnailPlan, identity }) {
  const generatedAt = new Date().toISOString();
  const assets = scenePlans.map((scene) => ({
    asset_id: scene.preview_asset_id,
    episode_id: episodeId,
    scene_id: scene.scene_id,
    asset_type: 'storyboard_preview',
    media_type: 'image/svg+xml',
    relative_path: scene.preview_path,
    role: scene.kind,
    status: 'planned',
    generated_by: 'nichefoundry_deterministic_svg_renderer',
    generation_input_hash: hashObject({ identity_hash: identity.identity_hash, scene }),
    source_ids: scene.source_ids,
    claim_ids: scene.claim_ids,
    licence: 'project_owned_generated_asset',
    rights_status: 'cleared',
    synthetic: true,
    disclosure_required: false,
    width: WIDTH,
    height: HEIGHT,
    created_at: generatedAt
  }));
  assets.push({
    asset_id: stableId('asset', `${episodeId}|thumbnail_preview`), episode_id: episodeId, scene_id: null,
    asset_type: 'thumbnail_preview', media_type: 'image/svg+xml', relative_path: 'visuals/thumbnail.svg', role: 'thumbnail', status: 'planned',
    generated_by: 'nichefoundry_deterministic_svg_renderer', generation_input_hash: hashObject({ identity_hash: identity.identity_hash, selected: thumbnailPlan.selected_candidate }),
    source_ids: [], claim_ids: [], licence: 'project_owned_generated_asset', rights_status: 'cleared', synthetic: true, disclosure_required: false,
    width: 1280, height: 720, created_at: generatedAt
  });
  return assets;
}

function buildVisualPackage({ pack, brief, scriptPackage, episodeId, priorPackets = [], claims = [] }) {
  const identityValidation = validateVisualSystem(pack);
  const identity = buildVisualIdentity(pack);
  const scenes = scriptPackage?.scenes || [];
  const claimsById = new Map((claims || []).map((claim) => [claim.claim_id, claim]));
  const scenePlans = scenes.map((scene, index) => buildScenePlan(scene, index, scenes, identity, episodeId, claimsById, brief));
  const thumbnailPlan = {
    schema: `nichefoundry.thumbnail_plan.v${VISUAL_SCHEMA_VERSION}`,
    episode_id: episodeId,
    studio_id: pack.studio.id,
    candidates: thumbnailCandidates({ title: brief.working_title, brief, identity }),
    selected_candidate: 'thumb_1',
    selection_reason: 'Default candidate maximises single-focal clarity, studio identity, and title legibility before audience testing.',
    prohibited: ['more than seven visible headline words', 'false event imagery', 'unlicensed likeness', 'visual promise not delivered by the episode'],
    generated_at: new Date().toISOString()
  };
  const fingerprintTokens = packageFingerprint(identity, scenePlans, thumbnailPlan, brief);
  const similarity = buildSimilarityReport(fingerprintTokens, scenePlans, priorPackets, episodeId);
  const assets = buildAssetRecords({ episodeId, scenePlans, thumbnailPlan, identity });
  const rightsIssues = assets.filter((asset) => asset.rights_status !== 'cleared');
  const sceneCoverage = scenes.length ? scenePlans.length / scenes.length : 0;
  const thumbnailIssues = thumbnailPlan.candidates.flatMap((candidate) => {
    const findings = [];
    if (candidate.text_word_count > 7) findings.push(`${candidate.candidate_id}: thumbnail text exceeds seven words.`);
    if (candidate.contrast_ratio < 4.5) findings.push(`${candidate.candidate_id}: contrast ratio ${candidate.contrast_ratio}:1 is insufficient.`);
    return findings;
  });
  const issues = [...identityValidation.issues, ...similarity.issues, ...thumbnailIssues];
  if (sceneCoverage !== 1) issues.push(`Visual plan covers ${scenePlans.length}/${scenes.length} scenes.`);
  if (rightsIssues.length) issues.push(`${rightsIssues.length} planned asset(s) have unresolved rights.`);
  const visualReport = {
    schema: `nichefoundry.visual_report.v${VISUAL_SCHEMA_VERSION}`,
    passed: issues.length === 0,
    studio_id: pack.studio.id,
    episode_id: episodeId,
    scene_count: scenes.length,
    planned_scene_count: scenePlans.length,
    scene_coverage: Number(sceneCoverage.toFixed(3)),
    asset_count: assets.length,
    cleared_rights_count: assets.length - rightsIssues.length,
    unresolved_rights_count: rightsIssues.length,
    unique_compositions: similarity.unique_compositions,
    maximum_library_similarity: similarity.maximum_library_similarity,
    identity_contrast_ratio: identityValidation.contrast_ratio,
    issues,
    warnings: [...identityValidation.warnings, ...similarity.warnings],
    gates: {
      visual_identity: identityValidation.passed,
      scene_coverage: sceneCoverage === 1,
      rights_and_provenance: rightsIssues.length === 0,
      anti_template_similarity: similarity.passed,
      thumbnail_legibility: thumbnailIssues.length === 0
    },
    checked_at: new Date().toISOString()
  };
  const visualPlan = {
    schema: `nichefoundry.visual_plan.v${VISUAL_SCHEMA_VERSION}`,
    episode_id: episodeId,
    studio_id: pack.studio.id,
    archetype_id: brief.archetype_id,
    output_format: brief.output_format || 'long_form',
    dimensions: { width: WIDTH, height: HEIGHT, aspect_ratio: '16:9' },
    scene_plans: scenePlans,
    fingerprint_tokens: fingerprintTokens,
    generated_at: new Date().toISOString()
  };
  return {
    schema: `nichefoundry.visual_package.v${VISUAL_SCHEMA_VERSION}`,
    passed: visualReport.passed,
    visual_identity: identity,
    visual_plan: visualPlan,
    asset_manifest: { schema: `nichefoundry.asset_manifest.v${VISUAL_SCHEMA_VERSION}`, episode_id: episodeId, assets, generated_at: new Date().toISOString() },
    asset_provenance: {
      schema: `nichefoundry.asset_provenance.v${VISUAL_SCHEMA_VERSION}`, episode_id: episodeId,
      policy: identity.rights_defaults,
      records: assets.map((asset) => ({ asset_id: asset.asset_id, relative_path: asset.relative_path, generated_by: asset.generated_by, generation_input_hash: asset.generation_input_hash, source_ids: asset.source_ids, claim_ids: asset.claim_ids, licence: asset.licence, rights_status: asset.rights_status, synthetic: asset.synthetic, disclosure_required: asset.disclosure_required, created_at: asset.created_at })),
      generated_at: new Date().toISOString()
    },
    thumbnail_plan: thumbnailPlan,
    visual_similarity_report: similarity,
    visual_report: visualReport,
    fingerprint_tokens: fingerprintTokens
  };
}

function studioBackdrop(identity) {
  const c = identity.colors;
  if (identity.studio_id === 'failure_atlas') return `<pattern id="grid" width="54" height="54" patternUnits="userSpaceOnUse"><path d="M54 0H0V54" fill="none" stroke="${c.grid}" stroke-width="1"/></pattern><rect width="100%" height="100%" fill="url(#grid)"/><path d="M80 860 C420 720 630 920 980 770 S1470 620 1840 760" fill="none" stroke="${c.accent}" stroke-width="3" opacity=".22"/>`;
  if (identity.studio_id === 'history_under_glass') return `<filter id="paper"><feTurbulence baseFrequency=".8" numOctaves="2" stitchTiles="stitch" type="fractalNoise"/><feColorMatrix values="1 0 0 0 .4 0 1 0 0 .3 0 0 1 0 .18 0 0 0 .08 0"/></filter><rect width="100%" height="100%" filter="url(#paper)" opacity=".22"/><path d="M140 910H1780" stroke="${c.accent}" stroke-width="2"/><circle cx="340" cy="910" r="9" fill="${c.accent}"/><circle cx="960" cy="910" r="9" fill="${c.accent}"/><circle cx="1580" cy="910" r="9" fill="${c.accent}"/>`;
  if (identity.studio_id === 'practical_open_source') return `<pattern id="grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" fill="none" stroke="${c.grid}" stroke-width="1"/></pattern><rect width="100%" height="100%" fill="url(#grid)"/><path d="M120 935H1800" stroke="${c.accent}" stroke-width="2" opacity=".25"/><path d="M120 965H1320" stroke="${c.secondary}" stroke-width="2" opacity=".18"/>`;
  return `<pattern id="stars" width="160" height="110" patternUnits="userSpaceOnUse"><circle cx="18" cy="24" r="2" fill="${c.primary}" opacity=".32"/><circle cx="95" cy="70" r="3" fill="${c.secondary}" opacity=".28"/></pattern><rect width="100%" height="100%" fill="url(#stars)"/><path d="M120 870 C380 700 590 900 830 690 S1330 550 1740 690" fill="none" stroke="${c.accent}" stroke-width="10" stroke-linecap="round" stroke-dasharray="8 28" opacity=".35"/>`;
}

function subjectKeywords(scenePlan) {
  return new Set(tokens(normalizedText(`${scenePlan.focal_subject || ''} ${scenePlan.topic || ''} ${scenePlan.title || ''}`)));
}

function effectiveHistoryComposition(scenePlan) {
  const beatName = normalizedText(`${scenePlan.beat_name || ''} ${scenePlan.title || ''}`);
  if (/materials and making/.test(beatName)) return 'material_exhibit';
  if (/original use/.test(beatName)) return 'document_exhibit';
  if (/human context/.test(beatName)) return 'competing_exhibits';
  if (/survival|discovery/.test(beatName)) return 'chronology_ribbon';
  if (/historical meaning/.test(beatName)) return 'object_vitrine';
  if (/conclusion/.test(beatName)) return 'museum_label_verdict';
  return scenePlan.composition;
}

function effectiveFocalSubject(scenePlan) {
  const topic = normalizeWhitespace(scenePlan.topic || '');
  const focal = normalizeWhitespace(scenePlan.focal_subject || '');
  const title = normalizeWhitespace(scenePlan.title || '');
  const genericSceneTitles = new Set([
    'conclusion and next step',
    'conclusion',
    'next step',
    'original use',
    'historical meaning',
    'human context',
    'materials and making',
    'object reveal',
    'opening hook'
  ]);
  if (genericSceneTitles.has(normalizedText(focal)) || genericSceneTitles.has(normalizedText(title))) return topic || focal || title || 'Scene';
  if (!focal) return topic || scenePlan.title || 'Scene';
  if (/^(though|because|according|from|other than|when)\b/i.test(focal)) return topic || scenePlan.title || focal;
  return focal;
}

function effectiveOverlay(scenePlan) {
  const beatName = normalizedText(`${scenePlan.beat_name || ''} ${scenePlan.title || ''}`);
  if (/opening|hook/.test(beatName)) return 'Object and key question';
  if (/object reveal/.test(beatName)) return 'Artifact details and visible evidence';
  if (/materials and making/.test(beatName)) return 'Material clues and construction';
  if (/original use/.test(beatName)) return 'Likely original role and setting';
  if (/human context/.test(beatName)) return 'People, institutions, and meaning';
  if (/survival|discovery/.test(beatName)) return 'Discovery and movement timeline';
  if (/historical meaning/.test(beatName)) return 'What the evidence supports';
  if (/conclusion/.test(beatName)) return 'Final takeaway';
  return normalizeWhitespace(scenePlan.evidence_overlay || 'Evidence focus');
}

function viewerFacingSupportText(scenePlan) {
  const beatName = normalizedText(`${scenePlan.beat_name || ''} ${scenePlan.title || ''}`);
  const subject = effectiveFocalSubject(scenePlan);
  if (/opening|hook/.test(beatName)) return `A first look at what makes ${subject} matter.`;
  if (/object reveal/.test(beatName)) return `A close read of the object before the bigger story begins.`;
  if (/materials and making/.test(beatName)) return `What the material itself reveals about the artifact.`;
  if (/original use/.test(beatName)) return `How the object likely functioned in its original world.`;
  if (/human context/.test(beatName)) return `The people and institutions that gave the object meaning.`;
  if (/survival|discovery/.test(beatName)) return `How the object was found, moved, and preserved over time.`;
  if (/historical meaning/.test(beatName)) return `What the strongest evidence can really support about the past.`;
  if (/conclusion/.test(beatName)) return `The clearest takeaway from the evidence gathered so far.`;
  if (subject) return `A grounded read of ${subject} using the strongest available evidence.`;
  return 'A grounded read of the scene using the strongest available evidence.';
}

function viewerFacingDetailText(scenePlan) {
  const beatName = normalizedText(`${scenePlan.beat_name || ''} ${scenePlan.title || ''}`);
  const subject = effectiveFocalSubject(scenePlan);
  if (/opening|hook/.test(beatName)) return `The opening frame centers ${subject} and the question that makes it worth examining.`;
  if (/object reveal/.test(beatName)) return `Visible features establish what the object is before interpretation expands outward.`;
  if (/materials and making/.test(beatName)) return `Material and construction clues narrow down how the artifact was made and used.`;
  if (/original use/.test(beatName)) return `Context clues point to the setting, audience, and purpose behind the object.`;
  if (/human context/.test(beatName)) return `Institutions and people around the object explain why it carried authority.`;
  if (/survival|discovery/.test(beatName)) return `The timeline matters because discovery and preservation shaped how the object was understood.`;
  if (/historical meaning/.test(beatName)) return `The strongest interpretation comes from what multiple clues support at once.`;
  if (/conclusion/.test(beatName)) return `The closing frame brings the evidence back to why ${subject} still matters.`;
  return viewerFacingSupportText(scenePlan);
}

function historyObjectMotif(identity, scenePlan) {
  const c = identity.colors;
  const effectiveScene = { ...scenePlan, composition: effectiveHistoryComposition(scenePlan), focal_subject: effectiveFocalSubject(scenePlan) };
  const keywords = subjectKeywords(effectiveScene);
  const isEgyptian = keywords.has('rosetta') || keywords.has('egypt') || keywords.has('hieroglyphs') || keywords.has('hieroglyphic');
  const isMap = /map|route/.test(effectiveScene.composition);
  const isDocument = /document|exhibit/.test(effectiveScene.composition);
  const isChronology = /chronology|ribbon|timeline|verdict/.test(effectiveScene.composition);
  const isMaterial = /material/.test(effectiveScene.composition);
  const isCompare = /competing/.test(effectiveScene.composition);
  const isReveal = /object|artifact/.test(effectiveScene.composition) || /reveal/i.test(effectiveScene.title || '');
  const label = wrap(effectiveScene.focal_subject || effectiveScene.topic || 'Artifact', 18, 3);
  if (isMaterial) {
    return `<g transform="translate(1080 170)"><rect x="0" y="20" width="560" height="620" rx="14" fill="${c.panel}" stroke="${c.accent}" stroke-width="4"/><path d="M174 120 C140 190 132 286 154 384 C171 462 204 530 262 572 C314 540 348 474 366 390 C388 290 382 188 348 118 Z" fill="${c.accent}" opacity=".92"/><path d="M196 164 H326 M186 214 H336 M196 264 H326 M188 314 H334 M202 364 H320" stroke="${c.panel}" stroke-width="10" opacity=".72"/><rect x="70" y="84" width="150" height="36" rx="18" fill="${c.secondary}" opacity=".92"/><text x="145" y="108" text-anchor="middle" fill="${c.primary}" font-size="18" font-family="${esc(identity.typography.body)}">MATERIAL CLUES</text><rect x="388" y="430" width="108" height="108" rx="54" fill="${c.background}" opacity=".22"/><text x="104" y="548" fill="${c.primary}" font-size="28" font-family="${esc(identity.typography.body)}">Granodiorite</text>${textLines(label, 82, 590, 24, 30, c.primary, 700, identity.typography.body)}</g>`;
  }
  if (isMap) {
    return `<g transform="translate(1060 180)"><rect x="0" y="0" width="620" height="590" rx="20" fill="${c.panel}" stroke="${c.accent}" stroke-width="4"/><path d="M90 450 C180 320 250 390 320 260 S470 180 540 110" fill="none" stroke="${c.secondary}" stroke-width="10" stroke-linecap="round" stroke-dasharray="10 18"/><circle cx="90" cy="450" r="20" fill="${c.accent}"/><circle cx="540" cy="110" r="26" fill="${c.secondary}"/><rect x="88" y="84" width="160" height="34" rx="17" fill="${c.background}" opacity=".2"/><text x="108" y="108" fill="${c.primary}" font-size="18" font-family="${esc(identity.typography.mono)}">ROUTE TRACE</text>${textLines(label, 92, 520, 28, 34, c.primary, 700, identity.typography.body)}</g>`;
  }
  if (isChronology) {
    return `<g transform="translate(1070 180)"><rect x="0" y="0" width="600" height="590" rx="18" fill="${c.panel}" stroke="${c.accent}" stroke-width="4"/><path d="M90 470 H510" stroke="${c.accent}" stroke-width="5"/><circle cx="120" cy="470" r="18" fill="${c.secondary}"/><circle cx="300" cy="470" r="18" fill="${c.secondary}"/><circle cx="480" cy="470" r="18" fill="${c.secondary}"/><rect x="80" y="120" width="130" height="84" rx="12" fill="${c.background}" opacity=".18"/><rect x="240" y="240" width="130" height="84" rx="12" fill="${c.background}" opacity=".18"/><rect x="400" y="110" width="130" height="84" rx="12" fill="${c.background}" opacity=".18"/><text x="106" y="172" fill="${c.primary}" font-size="22" font-family="${esc(identity.typography.body)}">1799</text><text x="266" y="292" fill="${c.primary}" font-size="22" font-family="${esc(identity.typography.body)}">1801</text><text x="426" y="162" fill="${c.primary}" font-size="22" font-family="${esc(identity.typography.body)}">1917</text>${textLines(label, 88, 542, 26, 32, c.primary, 700, identity.typography.body)}</g>`;
  }
  if (isCompare) {
    return `<g transform="translate(1070 180)"><rect x="0" y="0" width="600" height="590" rx="18" fill="${c.panel}" stroke="${c.accent}" stroke-width="4"/><rect x="76" y="120" width="190" height="310" rx="14" fill="${c.background}" opacity=".18"/><rect x="334" y="120" width="190" height="310" rx="14" fill="${c.background}" opacity=".18"/><text x="108" y="164" fill="${c.primary}" font-size="22" font-family="${esc(identity.typography.body)}">Object</text><text x="370" y="164" fill="${c.primary}" font-size="22" font-family="${esc(identity.typography.body)}">People</text><path d="M132 228 H210 M132 276 H222 M132 324 H196" stroke="${c.muted}" stroke-width="10" opacity=".5"/><circle cx="428" cy="244" r="34" fill="${c.secondary}" opacity=".85"/><circle cx="394" cy="304" r="26" fill="${c.accent}" opacity=".65"/><circle cx="458" cy="314" r="24" fill="${c.accent}" opacity=".65"/><text x="90" y="514" fill="${c.primary}" font-size="28" font-family="${esc(identity.typography.body)}">Context in use</text>${textLines(label, 88, 548, 24, 30, c.primary, 700, identity.typography.body)}</g>`;
  }
  if (isDocument) {
    return `<g transform="translate(1080 170)"><rect x="0" y="20" width="560" height="620" rx="14" fill="${c.panel}" stroke="${c.accent}" stroke-width="4"/><rect x="58" y="76" width="444" height="70" rx="12" fill="${c.background}" opacity=".18"/>${textLines(label, 84, 122, 28, 34, c.primary, 700, identity.typography.body)}<path d="M86 200 H470 M86 254 H486 M86 308 H452 M86 362 H492" stroke="${c.muted}" stroke-width="10" opacity=".45"/><rect x="366" y="420" width="120" height="140" rx="10" fill="${c.secondary}" opacity=".26"/><path d="M392 452 H458 M392 490 H450 M392 528 H438" stroke="${c.primary}" stroke-width="8" opacity=".7"/></g>`;
  }
  if (isEgyptian || isReveal) {
    return `<g transform="translate(1100 160)"><rect x="0" y="0" width="520" height="640" rx="18" fill="${c.panel}" stroke="${c.accent}" stroke-width="4"/><path d="M176 74 C138 150 126 282 154 410 C170 488 210 558 258 586 C306 558 348 486 366 408 C395 280 385 154 340 76 Z" fill="${c.accent}" opacity=".9"/><path d="M202 124 H314 M194 172 H322 M204 220 H312 M192 270 H324 M206 320 H310 M196 370 H320 M208 420 H308" stroke="${c.panel}" stroke-width="11" opacity=".72"/><path d="M198 144 v18 M238 144 v18 M278 144 v18 M218 192 v18 M258 192 v18 M298 192 v18 M228 242 v18 M268 242 v18 M308 242 v18" stroke="${c.panel}" stroke-width="7" opacity=".72"/><ellipse cx="258" cy="610" rx="164" ry="22" fill="${c.background}" opacity=".22"/><rect x="52" y="34" width="164" height="34" rx="17" fill="${c.secondary}" opacity=".92"/><text x="134" y="58" text-anchor="middle" fill="${c.primary}" font-size="18" font-family="${esc(identity.typography.body)}">STONE FRAGMENT</text></g>`;
  }
  return `<g transform="translate(1120 210)"><rect x="0" y="0" width="560" height="560" rx="16" fill="${c.panel}" stroke="${c.accent}" stroke-width="5"/><ellipse cx="280" cy="470" rx="190" ry="28" fill="${c.background}" opacity=".22"/><path d="M245 120 C180 210 185 355 250 430 C285 470 345 430 370 365 C405 270 360 160 315 110 Z" fill="${c.accent}" opacity=".85"/><path d="M270 145 C230 240 250 335 300 390" fill="none" stroke="${c.panel}" stroke-width="12" opacity=".7"/><rect x="72" y="34" width="120" height="34" fill="${c.secondary}" opacity=".9"/><text x="132" y="58" text-anchor="middle" fill="${c.primary}" font-size="18" font-family="${esc(identity.typography.body)}">EXHIBIT</text></g>`;
}

function studioMotif(identity, scenePlan) {
  const c = identity.colors;
  if (identity.studio_id === 'failure_atlas') {
    return `<g transform="translate(1110 250)"><rect x="0" y="0" width="590" height="460" rx="24" fill="${c.panel}" stroke="${c.grid}" stroke-width="3"/><path d="M75 330 L190 200 L300 280 L430 115" fill="none" stroke="${c.accent}" stroke-width="12"/><path d="M420 105 l45 12 -30 36" fill="none" stroke="${c.accent}" stroke-width="8"/><circle cx="190" cy="200" r="24" fill="${c.secondary}"/><path d="M80 380H510M80 410H390" stroke="${c.muted}" stroke-width="8" opacity=".45"/></g>`;
  }
  if (identity.studio_id === 'history_under_glass') {
    return historyObjectMotif(identity, scenePlan);
  }
  if (identity.studio_id === 'practical_open_source') {
    return `<g transform="translate(1010 210)"><rect x="0" y="0" width="700" height="520" rx="22" fill="${c.surface}" stroke="${c.grid}" stroke-width="3"/><rect x="0" y="0" width="700" height="54" rx="22" fill="${c.panel}"/><circle cx="30" cy="27" r="8" fill="${c.danger}"/><circle cx="56" cy="27" r="8" fill="${c.secondary}"/><circle cx="82" cy="27" r="8" fill="${c.accent}"/>${textLines(['$ nichefoundry verify', '✓ environment detected', '✓ reproducible result', '> evidence hash accepted'], 54, 130, 30, 66, c.primary, 600, identity.typography.mono)}<rect x="50" y="407" width="545" height="56" rx="10" fill="${c.accent}" opacity=".12"/><text x="74" y="444" fill="${c.accent}" font-size="26" font-family="${esc(identity.typography.mono)}">RESULT: VERIFIED</text></g>`;
  }
  return `<g transform="translate(1080 210)"><circle cx="300" cy="280" r="250" fill="${c.surface}" stroke="${c.secondary}" stroke-width="8"/><path d="M120 360 C200 210 310 380 470 150" fill="none" stroke="${c.accent}" stroke-width="16" stroke-linecap="round" stroke-dasharray="5 24"/><circle cx="120" cy="360" r="28" fill="${c.secondary}"/><circle cx="470" cy="150" r="38" fill="${c.accent}"/><path d="M470 100 l16 34 36 5 -26 25 6 36 -32 -17 -32 17 6 -36 -26 -25 36 -5Z" fill="${c.primary}"/><rect x="88" y="450" width="420" height="50" rx="25" fill="${c.panel}"/><rect x="88" y="450" width="${120 + (scenePlan.scene_index % 4) * 70}" height="50" rx="25" fill="${c.accent}"/></g>`;
}

function renderSceneSvg(identity, scenePlan, episodeTitle, sceneCount) {
  const c = identity.colors;
  const effectiveComposition = identity.studio_id === 'history_under_glass' ? effectiveHistoryComposition(scenePlan) : scenePlan.composition;
  const effectiveSubject = effectiveFocalSubject(scenePlan);
  const effectiveEvidenceOverlay = effectiveOverlay(scenePlan);
  if (scenePlan.scene_type === 'question_turn' && scenePlan.question_turn) {
    const prompt = wrap(scenePlan.question_turn.prompt, 34, 4);
    const options = (scenePlan.question_turn.options || []).slice(0, 4).map((option, index) => ({
      label: optionLetter(index),
      lines: wrap(option, 28, 2),
      correct: index === Number(scenePlan.question_turn.correct_option_index || 0)
    }));
    const reveal = wrap(`Answer: ${scenePlan.question_turn.correct_option_letter}. ${scenePlan.question_turn.answer}`, 28, 3);
    const explanation = wrap(scenePlan.question_turn.explanation || '', 34, 4);
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.background}"/><stop offset="1" stop-color="${c.surface}"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#bg)"/>${studioBackdrop(identity)}
<rect x="92" y="80" width="1736" height="920" rx="34" fill="none" stroke="${c.grid}" stroke-width="2"/>
<rect x="120" y="110" width="520" height="56" rx="28" fill="${c.secondary}" opacity=".16"/>
<text x="150" y="148" fill="${c.secondary}" font-size="22" font-weight="800" font-family="${esc(identity.typography.mono)}">${esc(identity.studio_name.toUpperCase())}  •  QUIZ TURN</text>
<text x="1760" y="148" text-anchor="end" fill="${c.muted}" font-size="22" font-weight="700" font-family="${esc(identity.typography.mono)}">${String(scenePlan.scene_index + 1).padStart(2, '0')} / ${String(sceneCount).padStart(2, '0')}</text>
<text x="140" y="250" fill="${c.accent}" font-size="26" font-weight="800" font-family="${esc(identity.typography.mono)}">${esc(scenePlan.title.toUpperCase())}</text>
${textLines(prompt, 140, 330, 54, 62, c.primary, 800, identity.typography.display)}
<rect x="1260" y="190" width="360" height="140" rx="28" fill="${c.panel}" opacity=".96"/>
<text x="1440" y="245" text-anchor="middle" fill="${c.secondary}" font-size="24" font-weight="800" font-family="${esc(identity.typography.mono)}">COUNTDOWN</text>
<text x="1440" y="302" text-anchor="middle" fill="${c.primary}" font-size="58" font-weight="900" font-family="${esc(identity.typography.display)}">${Number(scenePlan.question_turn.countdown_seconds || 8)}s</text>
${options.map((option, index) => {
  const y = 460 + index * 122;
  return `<rect x="140" y="${y}" width="760" height="96" rx="22" fill="${c.panel}" opacity=".96"/>
<circle cx="192" cy="${y + 48}" r="28" fill="${c.secondary}"/><text x="192" y="${y + 58}" text-anchor="middle" fill="${c.background}" font-size="30" font-weight="900" font-family="${esc(identity.typography.mono)}">${option.label}</text>
${textLines(option.lines, 240, y + 44, 30, 34, c.primary, 700, identity.typography.body)}</rect>`;
}).join('\n')}
<rect x="980" y="420" width="690" height="360" rx="28" fill="${c.panel}" opacity=".96"/>
<text x="1020" y="470" fill="${c.accent}" font-size="24" font-weight="800" font-family="${esc(identity.typography.mono)}">REVEAL</text>
${textLines(reveal, 1020, 535, 38, 44, c.primary, 800, identity.typography.display)}
<rect x="1020" y="575" width="580" height="8" rx="4" fill="${c.accent}"/>
${textLines(explanation, 1020, 635, 28, 36, c.muted, 600, identity.typography.body)}
<text x="140" y="970" fill="${c.muted}" font-size="18" font-family="${esc(identity.typography.mono)}">${esc(episodeTitle)}  •  question reveal frame</text>
</svg>`;
  }
  const title = wrap(scenePlan.title, scenePlan.title.length > 24 ? 18 : 24, 3);
  const subject = wrap(effectiveSubject || scenePlan.topic || scenePlan.title, 24, 3);
  const supportText = wrap(viewerFacingSupportText(scenePlan), 50, 4);
  const detailText = wrap(viewerFacingDetailText(scenePlan), 52, 3);
  const label = `${String(scenePlan.scene_index + 1).padStart(2, '0')} / ${String(sceneCount).padStart(2, '0')}`;
  const accent = scenePlan.scene_index % 2 ? c.secondary : c.accent;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.background}"/><stop offset="1" stop-color="${c.surface}"/></linearGradient><filter id="shadow"><feDropShadow dx="0" dy="18" stdDeviation="28" flood-color="#000" flood-opacity=".35"/></filter></defs>
<rect width="100%" height="100%" fill="url(#bg)"/>${studioBackdrop(identity)}
<rect x="92" y="80" width="1736" height="920" rx="34" fill="none" stroke="${c.grid}" stroke-width="2"/>
<rect x="120" y="110" width="760" height="56" rx="28" fill="${accent}" opacity=".14"/>
<text x="150" y="148" fill="${accent}" font-size="22" font-weight="800" font-family="${esc(identity.typography.mono)}">${esc(identity.studio_name.toUpperCase())}  •  ${esc(scenePlan.kind.replaceAll('_', ' ').toUpperCase())}</text>
<text x="1760" y="148" text-anchor="end" fill="${c.muted}" font-size="22" font-weight="700" font-family="${esc(identity.typography.mono)}">${label}</text>
${textLines(title, 140, 245, title.length > 2 ? 56 : 66, title.length > 2 ? 62 : 74, c.primary, 800, identity.typography.display)}
<rect x="140" y="${300 + title.length * 62}" width="90" height="8" rx="4" fill="${accent}"/>
<text x="140" y="${372 + title.length * 50}" fill="${accent}" font-size="20" font-weight="800" font-family="${esc(identity.typography.mono)}">FOCUS</text>
${textLines(subject, 140, 416 + title.length * 50, 38, 42, c.primary, 700, identity.typography.display)}
${textLines(supportText, 140, 552 + title.length * 50, 32, 44, c.muted, 500, identity.typography.body)}
<rect x="140" y="818" width="770" height="118" rx="18" fill="${c.panel}" opacity=".92"/>
<text x="170" y="854" fill="${accent}" font-size="19" font-weight="800" font-family="${esc(identity.typography.mono)}">${esc(effectiveEvidenceOverlay.toUpperCase())}</text>
${textLines(detailText, 170, 892, 20, 26, c.primary, 600, identity.typography.body)}
${studioMotif(identity, { ...scenePlan, composition: effectiveComposition, focal_subject: effectiveSubject })}
<text x="140" y="970" fill="${c.muted}" font-size="18" font-family="${esc(identity.typography.mono)}">${esc(episodeTitle)}  •  visual story frame</text>
</svg>`;
}

function optionLetter(index) {
  return String.fromCharCode(65 + index);
}

function renderThumbnailSvg(identity, thumbnailPlan, title, topic) {
  const c = identity.colors;
  const selected = thumbnailPlan.candidates.find((item) => item.candidate_id === thumbnailPlan.selected_candidate) || thumbnailPlan.candidates[0];
  const headline = wrap(selected.text, 18, 3);
  const thumbnailScene = { scene_index: 1, focal_subject: topic || title, topic: topic || title, title };
  const motif =
    identity.studio_id === 'history_under_glass'
      ? `<g transform="translate(310 90) scale(.52)">${studioMotif(identity, thumbnailScene)}</g>`
      : `<g transform="translate(720 80) scale(.7)">${studioMotif(identity, thumbnailScene)}</g>`;
  const subhead = identity.studio_id === 'history_under_glass' ? 'WHAT THIS OBJECT REVEALS' : selected.emotional_promise.toUpperCase();
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.background}"/><stop offset="1" stop-color="${c.surface}"/></linearGradient><filter id="shadow"><feDropShadow dx="0" dy="16" stdDeviation="22" flood-color="#000" flood-opacity=".5"/></filter></defs>
<rect width="1280" height="720" fill="url(#bg)"/>${studioBackdrop(identity)}
<rect x="48" y="48" width="1184" height="624" rx="32" fill="none" stroke="${c.grid}" stroke-width="3"/>
<rect x="76" y="78" width="360" height="46" rx="23" fill="${c.accent}" opacity=".16"/><text x="98" y="109" fill="${c.accent}" font-size="19" font-weight="800" font-family="${esc(identity.typography.mono)}">${esc(identity.studio_name.toUpperCase())}</text>
${textLines(headline, 86, 238, 62, 68, c.primary, 900, identity.typography.display)}
<rect x="88" y="${288 + headline.length * 82}" width="120" height="12" rx="6" fill="${c.secondary}"/>
<text x="90" y="526" fill="${c.secondary}" font-size="22" font-weight="800" font-family="${esc(identity.typography.mono)}">${esc(subhead)}</text>
<text x="90" y="600" fill="${c.muted}" font-size="24" font-family="${esc(identity.typography.body)}">${esc(topic)}</text>
${motif}
</svg>`;
}

function renderVisualPreviewAssets(episodeDir, visualPackage, episodeTitle, topic) {
  const visualsDir = path.join(episodeDir, 'visuals');
  const scenesDir = path.join(visualsDir, 'scenes');
  fs.mkdirSync(scenesDir, { recursive: true });
  const identity = visualPackage.visual_identity;
  const scenePlans = visualPackage.visual_plan.scene_plans;
  for (const scene of scenePlans) {
    const absolute = path.join(episodeDir, scene.preview_path);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, renderSceneSvg(identity, scene, episodeTitle, scenePlans.length));
  }
  fs.writeFileSync(path.join(visualsDir, 'thumbnail.svg'), renderThumbnailSvg(identity, visualPackage.thumbnail_plan, episodeTitle, topic));
  const hashes = visualPackage.asset_manifest.assets.map((asset) => {
    const absolute = path.join(episodeDir, asset.relative_path);
    const exists = fs.existsSync(absolute);
    const size = exists ? fs.statSync(absolute).size : 0;
    const sha256 = exists ? hashText(fs.readFileSync(absolute)) : null;
    asset.status = exists && size > 0 ? 'generated_preview' : 'failed';
    asset.size_bytes = size;
    asset.sha256 = sha256;
    const provenance = visualPackage.asset_provenance.records.find((record) => record.asset_id === asset.asset_id);
    if (provenance) {
      provenance.file_sha256 = sha256;
      provenance.size_bytes = size;
      provenance.status = asset.status;
    }
    return { asset_id: asset.asset_id, relative_path: asset.relative_path, exists, size_bytes: size, sha256 };
  });
  const assetHashes = {
    schema: `nichefoundry.visual_asset_hashes.v${VISUAL_SCHEMA_VERSION}`,
    episode_id: visualPackage.visual_plan.episode_id,
    complete: hashes.every((item) => item.exists && item.size_bytes > 0 && item.sha256),
    assets: hashes,
    generated_at: new Date().toISOString()
  };
  visualPackage.visual_report.preview_assets_generated = assetHashes.complete;
  visualPackage.visual_report.preview_asset_count = hashes.filter((item) => item.exists).length;
  if (!assetHashes.complete) {
    visualPackage.visual_report.passed = false;
    visualPackage.visual_report.issues.push('One or more deterministic visual preview assets were not generated.');
  }
  visualPackage.asset_hashes = assetHashes;
  return assetHashes;
}

function validateExternalAssetRecord(record) {
  const issues = [];
  if (!record || typeof record !== 'object') return { passed: false, issues: ['Asset record must be an object.'] };
  if (!record.asset_id) issues.push('asset_id is required.');
  if (!record.relative_path && !record.source_url) issues.push('relative_path or source_url is required.');
  if (!record.licence) issues.push('licence is required.');
  if (!record.rights_status) issues.push('rights_status is required.');
  if (record.rights_status === 'cleared' && !record.licence) issues.push('Cleared assets require an explicit licence.');
  if (record.source_url && !record.creator && record.generated_by !== 'nichefoundry_deterministic_svg_renderer') issues.push('External assets require creator or publisher attribution.');
  return { passed: issues.length === 0, issues };
}

module.exports = {
  VISUAL_SCHEMA_VERSION,
  STUDIO_PRESETS,
  buildVisualIdentity,
  buildVisualPackage,
  buildSimilarityReport,
  renderVisualPreviewAssets,
  renderSceneSvg,
  renderThumbnailSvg,
  validateVisualSystem,
  validateExternalAssetRecord,
  contrastRatio,
  hashObject
};
