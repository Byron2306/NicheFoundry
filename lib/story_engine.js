const {
  normalizeWhitespace,
  normalizedText,
  tokens,
  splitSentences,
  jaccard,
  stableId,
  clamp
} = require('./text');
const { readableSubjectLabel } = require('./claims');
const { callOllama, canUseOllama, ollamaClientConfig } = require('./generator');

const STORY_ENGINE_SCHEMA = '1.0';

const HYPE_PATTERNS = [
  /you won['’]?t believe/i,
  /shocking truth/i,
  /they don['’]?t want you to know/i,
  /changes everything/i,
  /terrifying secret/i,
  /insane/i,
  /mind[- ]?blowing/i,
  /guaranteed/i
];

const META_PATTERNS = [
  /source packet/i,
  /production workflow/i,
  /content workflow/i,
  /prompt/i,
  /approval bundle/i,
  /content generator/i,
  /youtube upload/i,
  /production pipeline/i
];

const BEAT_GUIDANCE = {
  normal_operation: ['Establish what the system was meant to do before failure.', 'First, reconstruct ordinary operation before examining the breakdown.'],
  hidden_vulnerability: ['Reveal the weakness or assumption that remained concealed during normal use.', 'With the baseline established, the next question is what the system could not safely absorb.'],
  initiating_event: ['Identify the event that disturbed the system without confusing trigger and cause.', 'The trigger matters, but it only becomes explanatory when connected to the conditions already present.'],
  cascading_failure: ['Trace how one disturbance propagated through connected components or decisions.', 'Now follow the sequence step by step, because the failure was a chain rather than a single dramatic instant.'],
  investigation_findings: ['Present what formal evidence and later analysis established.', 'After the event, investigators could compare physical evidence, records, and competing explanations.'],
  design_lesson: ['Convert the case into a transferable design or governance lesson.', 'The useful ending is not blame. It is the principle that can change a future decision.'],
  mystery_or_symptom: ['Open with the visible symptom before explaining the hidden mechanism.', 'Begin with the puzzling behaviour that demands an explanation.'],
  system_components: ['Name the components and relationships needed to understand the mechanism.', 'To explain the symptom, map the parts that carried force, information, or material.'],
  force_or_process_path: ['Trace the path followed by force, energy, data, or material.', 'The mechanism becomes clearer when the path through the system is made explicit.'],
  failure_mechanism: ['Explain the specific mechanism that converted stress into failure.', 'This is the point where the hidden process becomes the visible failure.'],
  evidence_demonstration: ['Show how observations or tests support the mechanism.', 'The explanation must now survive contact with the evidence.'],
  countermeasure: ['Close with the design change, control, or monitoring principle that addresses the mechanism.', 'A useful explanation ends by showing how the mechanism can be interrupted.'],
  original_requirement: ['State the original requirement or operating problem.', 'Start with the need the original design attempted to satisfy.'],
  original_design_choice: ['Describe the documented design choice used to satisfy that requirement.', 'The next step is to understand the choice in its original context, not with hindsight alone.'],
  constraint_or_tradeoff: ['Identify the constraint or trade-off shaping the original decision.', 'Every design lives inside constraints, and those constraints explain why alternatives were not obvious.'],
  observed_failure: ['Connect the design choice to the observed failure evidence.', 'Only after the context is clear should the failure be evaluated.'],
  redesign_options: ['Compare plausible alternatives without presenting speculation as certainty.', 'The redesign question is not what sounds clever, but what documented lessons can support.'],
  recommended_principle: ['End with a general principle rather than a fantasy retrofit.', 'The strongest conclusion is a principle that travels beyond this one case.'],
  baseline_conditions: ['Establish the conditions before the critical sequence began.', 'A timeline is only useful when the starting conditions are clear.'],
  early_warning: ['Identify the warning, anomaly, or precursor documented before failure.', 'The first change in the record may appear minor, but it marks the beginning of the critical sequence.'],
  decision_point: ['Explain the decision or non-decision that shaped the next stage.', 'At this point, the timeline branches around a consequential choice.'],
  critical_window: ['Compress the key interval while preserving sequence and uncertainty.', 'The critical window must be reconstructed carefully, moment by moment where the evidence allows.'],
  failure_event: ['Describe the event without sensationalising harm.', 'The event is the endpoint of the sequence already established, not an isolated spectacle.'],
  post_event_inquiry: ['Show what later inquiry clarified, disputed, or changed.', 'The final timeline continues after the event through investigation and reform.'],
  object_reveal: ['Introduce the object through one observable detail and a focused historical question.', 'Begin with the object itself, before assigning it a grand meaning.'],
  materials_and_making: ['Explain what the material and construction reveal.', 'Materials and workmanship establish what the object could do and who could make it.'],
  original_use: ['Reconstruct the most defensible original use.', 'The object becomes historical when placed back into use rather than displayed as a floating curiosity.'],
  human_context: ['Connect the object to the people, labour, status, or practice around it.', 'Now move from the thing to the people whose lives gave it meaning.'],
  survival_or_discovery: ['Explain how the object survived, moved, or was recovered.', 'Its survival is part of the evidence, not merely an epilogue.'],
  historical_meaning: ['State what the object can and cannot support about the past.', 'The conclusion must preserve the boundary between a useful interpretation and an attractive overclaim.'],
  historical_question: ['Frame the historical problem without pretending the answer is already settled.', 'Open with the question the surviving evidence can genuinely address.'],
  context_and_chronology: ['Build the minimum chronology and context needed to evaluate the case.', 'Before weighing exhibits, establish the world in which they were produced.'],
  evidence_exhibit_one: ['Present the first evidentiary exhibit and its limits.', 'The first exhibit narrows the field, but it does not close the case.'],
  evidence_exhibit_two: ['Introduce independent or contrasting evidence.', 'A second exhibit tests whether the first interpretation remains stable.'],
  competing_interpretations: ['Represent credible interpretations and their evidentiary basis.', 'The disagreement matters because each interpretation privileges different evidence.'],
  reasoned_conclusion: ['Reach a qualified conclusion proportional to the evidence.', 'The verdict should be clear enough to be useful and qualified enough to remain honest.'],
  point_of_origin: ['Locate the starting place and establish why it matters.', 'Every journey begins with a place, but also with conditions that made movement possible.'],
  route_and_barriers: ['Trace the route and the barriers encountered.', 'The map becomes explanatory when distance, terrain, politics, and technology are treated as forces.'],
  exchange_or_transformation: ['Show what changed through movement or exchange.', 'Movement rarely transports an object or idea unchanged.'],
  arrival_context: ['Explain the receiving context at the destination.', 'Arrival only has meaning inside the society, market, or landscape that received it.'],
  evidence_of_movement: ['Present the evidence used to infer movement.', 'The route must be supported by traces, not simply drawn because it looks plausible.'],
  historical_implication: ['State the broader implication without outrunning the evidence.', 'The map now becomes an argument about connection, scale, and historical change.'],
  popular_claim: ['State the popular claim precisely and fairly.', 'A myth audit begins by defining the claim rather than mocking the people who repeat it.'],
  claim_origin: ['Trace where the claim appears to have come from.', 'Understanding the origin explains how the claim acquired authority.'],
  supporting_evidence: ['Present the strongest evidence that appears to support the claim.', 'The claim deserves its best case before it is tested.'],
  counterevidence: ['Present evidence that complicates or contradicts the claim.', 'The audit turns when the counterevidence is placed beside the popular version.'],
  historian_interpretations: ['Compare credible interpretations and methods.', 'Different conclusions may arise because historians ask different questions of the same evidence.'],
  qualified_verdict: ['Give a proportionate verdict and explain why the myth persists.', 'The verdict should distinguish falsehood, simplification, uncertainty, and useful shorthand.'],
  outcome_preview: ['Show the verified end state before instructions begin.', 'Start by making the promised result visible and testable.'],
  environment_and_prerequisites: ['Declare versions, operating system, permissions, and required tools.', 'Before changing the system, capture the environment that makes the steps reproducible.'],
  installation_or_setup: ['Provide the minimal setup sequence and explain what each step changes.', 'Setup should be explicit enough to repeat and restrained enough to diagnose.'],
  core_workflow: ['Walk through the essential workflow in the order it must be performed.', 'With prerequisites satisfied, move through the task without hiding intermediate state.'],
  validation: ['Prove that the result works using an observable check.', 'A tutorial is incomplete until the viewer can verify the same outcome.'],
  common_failure_and_recovery: ['Show one likely failure, its diagnosis, and the smallest repair.', 'A trustworthy guide preserves the point where the happy path commonly breaks.'],
  next_level_extension: ['Offer one bounded extension without turning the ending into a second tutorial.', 'Once the core result is secure, one extension shows where the workflow can grow.'],
  user_problem: ['Define the user problem and the decision that must be made.', 'A useful comparison starts with a scenario, not a scoreboard.'],
  decision_criteria: ['Declare the criteria before evaluating tools.', 'The criteria must be visible before any winner is named.'],
  test_environment: ['Describe the environment and task used for comparison.', 'Without a shared test environment, differences cannot be interpreted fairly.'],
  tool_one_result: ['Report the first tool result with evidence and limitations.', 'The first result establishes a baseline rather than a verdict.'],
  tool_two_result: ['Report the second tool result under the same criteria.', 'The second result is meaningful only because the test remains comparable.'],
  tradeoff_matrix: ['Compare strengths, weaknesses, costs, and constraints.', 'The decision lives in the trade-offs, not in a universal ranking.'],
  recommendation_by_use_case: ['Recommend by scenario and state the boundary of the recommendation.', 'The conclusion should tell different users what to choose and why.'],
  observable_symptom: ['Show the exact symptom or error before changing anything.', 'Preserve the failure state first, because it contains diagnostic evidence.'],
  environment_capture: ['Capture versions, paths, permissions, and recent changes.', 'The environment narrows the possible causes before any fix is attempted.'],
  diagnostic_checks: ['Run checks that distinguish competing causes.', 'Diagnostics should eliminate hypotheses rather than generate random activity.'],
  root_cause: ['Identify the cause supported by the checks.', 'The root cause is the explanation that best accounts for the observed evidence.'],
  minimal_fix: ['Apply the smallest reversible correction.', 'A minimal repair reduces collateral changes and keeps the diagnosis testable.'],
  verification: ['Repeat the original check and prove the symptom is resolved.', 'The repair is not complete until the original failure no longer reproduces.'],
  prevention: ['Explain the configuration, monitoring, or practice that prevents recurrence.', 'The final step converts a fix into a more reliable workflow.'],
  change_summary: ['State the material change and the version in which it appears.', 'Open with what changed, not with release-note confetti.'],
  affected_users: ['Identify who is affected and who can ignore the change.', 'A change matters differently depending on environment and workflow.'],
  version_evidence: ['Anchor the explanation in official version evidence.', 'The version record separates current behaviour from remembered behaviour.'],
  behaviour_difference: ['Demonstrate the before-and-after difference.', 'The practical meaning of the update appears in changed behaviour.'],
  migration_or_action: ['Give the smallest safe action required.', 'The viewer now needs a bounded response rather than generic urgency.'],
  known_issues: ['Preserve documented limitations and unresolved problems.', 'A responsible briefing includes what still fails or remains uncertain.'],
  what_to_watch: ['Close with specific future signals or release conditions.', 'The final question is what evidence would justify another action.'],
  mission_setup: ['Define the mission, rules, and learning goal.', 'The adventure begins with a clear goal and a fair challenge.'],
  first_discovery: ['Deliver an early evidence-backed discovery.', 'The first discovery rewards attention and teaches how the mission works.'],
  rising_challenge: ['Increase difficulty while preserving clarity and safety.', 'The next challenge asks the viewer to use what has already been learned.'],
  midpoint_progress: ['Mark progress and explain the knowledge gained so far.', 'At the midpoint, pause long enough to make learning visible.'],
  final_challenge: ['Use the strongest supported evidence in the final challenge.', 'The last challenge should feel earned rather than arbitrary.'],
  mission_resolution: ['Resolve the mission, recap the evidence, and invite reflection.', 'The ending celebrates completion and returns to what was learned.'],
  character_and_goal: ['Introduce the character and a concrete goal.', 'A learning story begins with someone trying to accomplish something understandable.'],
  knowledge_problem: ['Reveal the concept the character must understand.', 'The obstacle is not random danger but a problem that knowledge can change.'],
  first_choice: ['Present a plausible first choice.', 'The first choice gives the viewer a chance to predict what happens next.'],
  consequence: ['Show the consequence without frightening or humiliating the learner.', 'The consequence makes the concept visible.'],
  better_choice: ['Apply the newly understood idea to a better choice.', 'The second choice demonstrates learning rather than merely announcing it.'],
  reflection_and_reward: ['Connect the resolution to the concept and a positive reward.', 'The story closes by naming what changed in the character’s understanding.']
};

const STUDIO_FRAMES = {
  failure_atlas: {
    mode: 'causal_reconstruction',
    opening: (topic) => `The visible failure in ${topic} was the end of a longer chain.`,
    closing: 'The value of the reconstruction is the design principle that can interrupt a similar chain elsewhere.',
    bridge: 'Keep trigger, contributing condition, and consequence separate as the sequence develops.'
  },
  history_under_glass: {
    mode: 'evidence_investigation',
    opening: (topic) => `${topic} becomes clearer when the evidence is handled one piece at a time.`,
    closing: 'The strongest historical conclusion is useful, qualified, and clear about what the evidence cannot settle.',
    bridge: 'Treat every source as an exhibit with a context, purpose, and limit.'
  },
  practical_open_source: {
    mode: 'reproducible_instruction',
    opening: (topic) => `The goal is not to make ${topic} look easy. The goal is to make the result reproducible.`,
    closing: 'A workflow is complete when the viewer can verify the result and recover from the common failure state.',
    bridge: 'Preserve versions, commands, and observable checks so every step remains testable.'
  },
  puzzle_planet: {
    mode: 'interactive_adventure',
    opening: (topic) => `The mission begins with a mystery about ${topic}.`,
    closing: 'Mission complete: the reward is not only the score, but the evidence the explorer can now explain.',
    bridge: 'Keep the challenge playful, the answer unambiguous, and the learning visible.'
  },
  generic: {
    mode: 'evidence_led_explainer',
    opening: (topic) => `${topic} becomes understandable when the evidence is organised into a clear sequence.`,
    closing: 'The conclusion should return to the opening question and state what the evidence supports.',
    bridge: 'Separate verified claims from narrative transitions and interpretation.'
  }
};

function titleCase(value) {
  return normalizeWhitespace(value).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function wordCount(value) {
  return normalizeWhitespace(value).split(' ').filter(Boolean).length;
}

function sentenceStats(value) {
  const sentences = splitSentences(value);
  const words = wordCount(value);
  return {
    sentence_count: sentences.length,
    word_count: words,
    average_sentence_words: sentences.length ? Number((words / sentences.length).toFixed(2)) : 0
  };
}

function storySettings(pack) {
  const frame = STUDIO_FRAMES[pack.studio.id] || STUDIO_FRAMES.generic;
  const configured = pack.story_engine || {};
  return {
    narrative_mode: configured.narrative_mode || frame.mode,
    default_target_minutes: Number(configured.default_target_minutes || (pack.studio.id === 'practical_open_source' ? 9 : 7)),
    spoken_words_per_minute: Number(configured.spoken_words_per_minute || (pack.studio.id === 'practical_open_source' ? 138 : 148)),
    opening_rules: configured.opening_rules || [frame.opening(pack.studio.domain)],
    retention_devices: configured.retention_devices || ['open question', 'evidence reveal', 'midpoint synthesis', 'final payoff'],
    closing_rules: configured.closing_rules || [frame.closing],
    forbidden_phrases: configured.forbidden_phrases || [],
    required_passes: configured.required_passes || ['evidence', 'structure', 'audience', 'spoken_language', 'timing', 'originality', 'sensationalism'],
    frame
  };
}

function requestedDurationMinutes(brief, pack, archetype, claimCount) {
  const settings = storySettings(pack);
  const output = normalizeWhitespace(brief.output_format || 'long_form');
  const formatDefault = output === 'short' ? 1 : (output === 'diagram_carousel' || output === 'printable_quiz' || output === 'activity_sheet') ? 3 : settings.default_target_minutes;
  const requested = Number(brief.target_duration_minutes || formatDefault);
  const safeRequested = clamp(Number.isFinite(requested) ? requested : settings.default_target_minutes, 1, 30);
  const evidenceCapacity = clamp(1.8 + Number(claimCount || 0) * 0.48, 2.5, 14);
  return {
    requested: Number(safeRequested.toFixed(2)),
    evidence_supported_max: Number(evidenceCapacity.toFixed(2)),
    resolved: Number(Math.min(safeRequested, evidenceCapacity).toFixed(2)),
    bounded_by_evidence: evidenceCapacity < safeRequested,
    output_format: output,
    archetype_id: archetype.id
  };
}

function firstSupportedClaim(claims) {
  return claims.find((claim) => ['supported', 'weakly_supported'].includes(claim.status || 'supported')) || claims[0] || null;
}

function claimSubjectLabel(claim, brief) {
  const label = readableSubjectLabel(
    claim?.display_subject || claim?.prompt_subject || claim?.subject || claim?.source_title,
    brief?.topic || claim?.source_title || 'this topic'
  );
  const briefTopic = normalizeWhitespace(brief?.topic || '');
  if (briefTopic && label && label.split(/\s+/).length <= 2 && normalizedText(briefTopic).includes(normalizedText(label))) {
    return briefTopic;
  }
  return label;
}

function claimLeadText(claim, brief) {
  const text = normalizeWhitespace(claim?.claim || '');
  const subject = claimSubjectLabel(claim, brief);
  if (!text) return '';
  if (/^(?:it|they|them|these|those|this)\b/i.test(text)) {
    return text.replace(/^(?:it|they|them|these|those|this)\b/i, subject);
  }
  return text;
}

function claimPriorityScore(claim, brief, pack, beat = null) {
  if (!claim) return -Infinity;
  const confidence = Number(claim.confidence || 0);
  const topicText = normalizedText(`${brief?.topic || ''} ${brief?.working_title || ''} ${claim?.source_title || ''}`);
  const claimText = normalizedText(`${claim?.claim || ''} ${claim?.display_subject || ''} ${claim?.prompt_subject || ''}`);
  const topicTokens = new Set(tokens(topicText));
  const claimTokens = new Set(tokens(claimText));
  let overlap = 0;
  for (const token of topicTokens) if (claimTokens.has(token)) overlap += 1;
  const overlapScore = topicTokens.size ? overlap / topicTokens.size : 0;
  const typeWeights = {
    failure_atlas: { causal: 0.35, date_or_quantity: 0.12, origin: 0.08, description: 0.04, fact: 0.02, location: 0.02 },
    history_under_glass: { origin: 0.22, date_or_quantity: 0.18, description: 0.1, fact: 0.08, location: 0.08, causal: 0.05 },
    practical_open_source: { description: 0.2, fact: 0.16, location: 0.1, causal: 0.06, origin: 0.03, date_or_quantity: 0.03 },
    puzzle_planet: { fact: 0.18, description: 0.14, date_or_quantity: 0.1, location: 0.1, origin: 0.06, causal: 0.04 },
    generic: { causal: 0.12, description: 0.1, fact: 0.1, origin: 0.08, location: 0.08, date_or_quantity: 0.08 }
  };
  const studioWeights = typeWeights[pack?.studio?.id] || typeWeights.generic;
  const claimTypeBonus = studioWeights[claim.claim_type] || 0;
  const beatName = normalizedText(beat?.name || '');
  const beatTypeBonus =
    (/initiating|failure|cause|mechanism/.test(beatName) && claim.claim_type === 'causal') ? 0.2 :
    (/timeline|origin|baseline|early|warning/.test(beatName) && ['origin', 'date_or_quantity'].includes(claim.claim_type)) ? 0.14 :
    (/map|route|location/.test(beatName) && claim.claim_type === 'location') ? 0.14 :
    (/components|description|object|system/.test(beatName) && ['description', 'fact'].includes(claim.claim_type)) ? 0.08 :
    0;
  const lowerClaim = normalizedText(claim?.claim || '');
  const historyUnderGlassBonus = pack?.studio?.id === 'history_under_glass'
    ? historyUnderGlassClaimBonus(lowerClaim, beatName)
    : 0;
  const historyUnderGlassPenalty = pack?.studio?.id === 'history_under_glass'
    ? historyUnderGlassClaimPenalty(lowerClaim, beatName)
    : 0;
  const investigationPenalty = /^(investigators?|researchers?|scientists?|historians?)\b/i.test(normalizeWhitespace(claim.claim || '')) ? 0.12 : 0;
  return confidence + overlapScore * 0.45 + claimTypeBonus + beatTypeBonus + historyUnderGlassBonus - investigationPenalty - historyUnderGlassPenalty;
}

function historyUnderGlassClaimBonus(claimText, beatName) {
  let score = 0;
  if (/(decree|inscribed|inscription|royal inscription|cuneiform|tablet|archive|seal|papyrus|manuscript|hieroglyph|hieroglyphic|demotic|greek|script|scripts|text|stele|stone|fragment|carved|carving|temple|priest|scribe|king|empire|decipher|decipherment|translation|administration|bureaucracy|ritual|proclamation|monument|palace)/.test(claimText)) score += 0.2;
  if (/object reveal|historical question/.test(beatName) && /(surface|inscribed|carved|fragment|stele|tablet|stone|shape|script|royal|inscription)/.test(claimText)) score += 0.22;
  if (/materials and making|context and chronology/.test(beatName) && /(stone|clay|tablet|stele|fragment|scripts?|inscribed|carved|text|dating|period|reign)/.test(claimText)) score += 0.22;
  if (/original use|evidence exhibit one/.test(beatName) && /(decree|issued|displayed|inscribed|commissioned|proclaimed|dedicated|administrative|ritual|archive|recorded)/.test(claimText)) score += 0.24;
  if (/human context|evidence exhibit two/.test(beatName) && /(priests|scholars|scribes|workers|court|subjects|translation|decipher|labour|empire|governance)/.test(claimText)) score += 0.2;
  if (/survival or discovery|competing interpretations/.test(beatName) && /(discovered|discovery|found|recovered|survived|preserved|copied|transported|rediscovered|excavated)/.test(claimText)) score += 0.18;
  if (/historical meaning|reasoned conclusion/.test(beatName) && /(power|authority|legitimacy|memory|identity|empire|administration|decipher|understanding|historical question)/.test(claimText)) score += 0.26;
  return score;
}

function historyUnderGlassClaimPenalty(claimText, beatName) {
  let score = 0;
  if (/(best selling postcard|merchandise|museum shops|most-visited single object|open the programme with a supported question|approval bundle|workflow|json|draft sourceplan)/.test(claimText)) score += 0.5;
  if (/(summary|references|footnotes|bibliography|external links|see also|further reading|list of inscriptions|designations)/.test(claimText)) score += 0.6;
  if (!/survival or discovery|human context|competing interpretations/.test(beatName) && /(transferred to|displayed alongside|conservation measures|moved to safety|wartime|gallery|museum shop)/.test(claimText)) score += 0.28;
  return score;
}

function prioritizedSupportedClaims(claims, brief, pack, beat = null) {
  return (claims || [])
    .filter((claim) => ['supported', 'weakly_supported'].includes(claim.status || 'supported'))
    .sort((left, right) => claimPriorityScore(right, brief, pack, beat) - claimPriorityScore(left, brief, pack, beat));
}

function hookText(type, brief, pack, claim) {
  const topic = claim ? claimSubjectLabel(claim, brief) : (brief.topic || brief.working_title);
  const claimText = claim ? claimLeadText(claim, brief) : null;
  const lower = normalizedText(type);
  let framing;
  if (pack?.studio?.id === 'history_under_glass' && /historical_case_file/.test(String(brief?.archetype_id || ''))) {
    if (/anomaly|contradiction|unanswered|missing piece/.test(lower)) framing = `The record around ${topic} looks tidy until one detail starts to pull against the rest.`;
    else if (/popular claim|source contradiction|why the myth survives/.test(lower)) framing = `The familiar summary of ${topic} is cleaner than the evidence itself.`;
    else framing = `${topic} was designed to project authority, but the wording reveals more than the monument intends.`;
  } else if (/anomaly|contradiction|mystery object|unanswered|missing piece/.test(lower)) framing = `One detail in ${topic} does not fit the simplest version of the story.`;
  else if (/imminent|countdown|critical|breaking change|migration risk|error message|failed setup/.test(lower)) framing = `The decisive moment in ${topic} becomes clearer when the sequence immediately before it is reconstructed.`;
  else if (/small decision|hidden tradeoff|what would you change|counterfactual/.test(lower)) framing = `A seemingly ordinary choice in ${topic} carries more explanatory weight than it first appears.`;
  else if (/working result|pain point|before-and-after|same task different tools|decision shortcut/.test(lower)) framing = `By the end, the result for ${topic} must be visible, repeatable, and testable.`;
  else if (/popular claim|source contradiction|why the myth survives/.test(lower)) framing = `The familiar claim about ${topic} is easy to repeat and harder to prove.`;
  else if (/journey|map|scale/.test(lower)) framing = `${topic} becomes a different story when movement, distance, and evidence are placed on the same map.`;
  else if (/mission|challenge|character|help choose/.test(lower)) framing = `A clear mission turns ${topic} into a challenge the viewer can solve with evidence.`;
  else framing = `The central question about ${topic} can be answered only by following the evidence in the right order.`;
  const payoff = claimText ? `The first verified clue is this: ${claimText}` : null;
  return normalizeWhitespace([framing, payoff].filter(Boolean).join(' '));
}

function buildHookCandidates(pack, archetype, brief, claims) {
  const primary = prioritizedSupportedClaims(claims, brief, pack)[0] || firstSupportedClaim(claims);
  const types = archetype.hook_types?.length ? archetype.hook_types : ['open question'];
  return types.slice(0, 4).map((type, index) => ({
    hook_id: stableId('hook', `${pack.studio.id}|${archetype.id}|${type}|${brief.topic}`),
    type,
    text: hookText(type, brief, pack, primary),
    claim_ids: primary ? [primary.claim_id] : [],
    source_ids: primary ? [primary.source_id] : [],
    rank: index + 1,
    rationale: index === 0 ? 'Native to the selected archetype and aligned with the opening promise.' : 'Alternative framing preserved for editorial choice.'
  }));
}

function claimLookup(claims) {
  return new Map((claims || []).map((claim) => [claim.claim_id, claim]));
}

function claimSegmentsForBeat(beat, claimsById, fallbackClaims, usedClaims) {
  const selected = [];
  for (const claimId of beat.claim_ids || []) {
    const claim = claimsById.get(claimId);
    if (!claim) continue;
    if (!['supported', 'weakly_supported'].includes(claim.status || 'supported')) continue;
    if (usedClaims.has(claim.claim_id)) continue;
    selected.push(claim);
  }
  if (!selected.length) {
    const fallback = fallbackClaims.find((claim) => !usedClaims.has(claim.claim_id)) || fallbackClaims[0] || null;
    if (fallback) selected.push(fallback);
  }
  const beatName = normalizedText(beat?.name || '');
  const filtered = selected.filter((claim) => {
    const text = normalizedText(claim?.claim || '');
    if (/history_under_glass|object_biography/.test('history_under_glass')) {
      if (/object reveal/.test(beatName) && /(lecture|published in 18|published in 19|society of antiquaries|announced it publicly|paris in 1822)/.test(text)) return false;
      if (/materials and making/.test(beatName) && /(most-visited|postcard|merchandise|museum shops|displayed alongside|transferred to the sculpture gallery)/.test(text)) return false;
      if (/original use/.test(beatName) && /(most-visited|postcard|merchandise|king's library|conservation measures|moved to safety)/.test(text)) return false;
      if (/historical meaning/.test(beatName) && /(postcard|merchandise|museum shops|most-visited|transferred to the sculpture gallery)/.test(text)) return false;
    }
    return true;
  });
  const finalSelected = filtered.length ? filtered : selected;
  finalSelected.forEach((claim) => usedClaims.add(claim.claim_id));
  return finalSelected.slice(0, 3);
}

function spokenBridgeForBeat(beatName, pack) {
  const name = normalizedText(beatName);
  if (/object reveal/.test(name)) return 'Look closely at the object itself first.';
  if (/materials and making/.test(name)) return 'Its material details reveal why it mattered.';
  if (/original use/.test(name)) return 'To understand it, place it back in its original use.';
  if (/human context/.test(name)) return 'The object mattered because of the people around it.';
  if (/survival or discovery/.test(name)) return 'Its journey through time is part of the evidence.';
  if (/historical meaning/.test(name)) return 'Now we can ask what this evidence really supports.';
  if (/normal operation/.test(name)) return 'First, establish how the system was supposed to work.';
  if (/initiating event/.test(name)) return 'Then the sequence turns on a specific event.';
  if (/cascading failure/.test(name)) return 'From there, one change spread through the rest of the system.';
  if (/investigation findings/.test(name)) return 'Later evidence helped explain what really happened.';
  if (/design lesson/.test(name)) return 'The lasting value is the lesson that follows from the evidence.';
  if (pack?.studio?.id === 'history_under_glass') {
    if (/historical question/.test(name)) return 'A royal inscription is never only a record; it is also a performance of authority.';
    if (/context and chronology/.test(name)) return 'Place the text in time, and the performance becomes easier to read.';
    if (/evidence exhibit one/.test(name)) return 'The first thing to test is the form of the inscription itself.';
    if (/evidence exhibit two/.test(name)) return 'The next clue is how later readers learned to hear those voices again.';
    if (/competing interpretations/.test(name)) return 'The evidence then splits into two questions: what the kings meant, and what later scholars could prove.';
    if (/reasoned conclusion/.test(name)) return 'The strongest answer is not grander than the evidence; it is more precise.';
    return 'The next exhibit sharpens what the evidence can really support.';
  }
  if (pack?.studio?.id === 'failure_atlas') return 'The next step is to connect the evidence into a clear sequence.';
  if (pack?.studio?.id === 'practical_open_source') return 'The next step is to show what the evidence proves in practice.';
  return 'The next piece of evidence clarifies the story.';
}

function retentionDevice(settings, index, total) {
  const devices = settings.retention_devices;
  if (index === 0) return devices[0] || 'open question';
  if (index === Math.floor(total / 2)) return devices.find((item) => /mid|synthesis|progress/i.test(item)) || 'midpoint synthesis';
  if (index === total - 1) return devices.find((item) => /payoff|resolution|verdict|validation/i.test(item)) || 'final payoff';
  return devices[index % devices.length] || 'evidence reveal';
}

function cleanSpokenClaimText(text, subject = '') {
  let cleaned = normalizeWhitespace(text || '');
  if (!cleaned) return '';
  cleaned = cleaned.replace(/^(?:reading the rosetta stone|greek text|demotic text|hieroglyphic text|summary|references|footnotes|bibliography|external links|see also|further reading|list of inscriptions|designations|overview)\s+/i, '');
  cleaned = cleaned.replace(/^the evidence records that\s+/i, '');
  cleaned = cleaned.replace(/^the current evidence provisionally indicates that\s+/i, '');
  cleaned = cleaned.replace(/^original stele\s+/i, '');
  cleaned = cleaned.replace(/^fragment\s+/i, '');
  cleaned = cleaned.replace(/\b(?:summary|references|footnotes|bibliography|external links|see also|further reading|designations|overview)\b/ig, '');
  cleaned = cleaned.replace(/\b[A-Za-z0-9.-]+\.(?:org|com|net|edu)\b/gi, '');
  cleaned = cleaned.replace(/\bThe\s+or abbreviations of\b/i, 'The standard abbreviations for');
  cleaned = cleaned.replace(/^rosetta stone is a fragment\b/i, 'The Rosetta Stone is a fragment');
  if (subject) {
    const escaped = subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(`^${escaped}\\s+${escaped}\\b`, 'i'), subject);
  }
  cleaned = cleaned.replace(/\bat\s*$/i, '');
  return cleaned.replace(/\s+([,.;:!?])/g, '$1').trim();
}

function beatSpecificNarrationEdits(text, beatName) {
  let output = normalizeWhitespace(text || '');
  const beat = normalizedText(beatName || '');
  if (/object reveal/.test(beat)) {
    output = output.replace(/\bthe original stele broke at some point, its largest piece becoming what we now know as the rosetta stone\.\s*the rosetta stone is a fragment of a larger stele\./i, 'The Rosetta Stone survives as the largest fragment of a much bigger stele.');
  }
  if (/materials and making/.test(beat)) {
    output = output.replace(/\bfrom this point, the stories of the rosetta stone and the decipherment of egyptian hieroglyphs diverge, /i, '');
  }
  if (/human context/.test(beat)) {
    output = output.replace(/\bit was already underway when the first complete translation of the greek text was published in 1803\./i, '');
  }
  output = output.replace(/\b(?:summary|references|footnotes|bibliography|external links|see also|further reading)\b\.?/ig, '');
  return normalizeWhitespace(output);
}

function historyUnderGlassTopicClass(brief = {}, claims = []) {
  const corpus = normalizedText([
    brief.topic,
    brief.working_title,
    brief.story_premise,
    ...claims.slice(0, 24).map((claim) => `${claim.claim || ''} ${claim.source_title || ''}`)
  ].join(' '));
  if (/(inscription|royal inscription|cuneiform|tablet|archive|decree|edict|manuscript|papyrus|text|script|scripts|translation|decipher)/.test(corpus)) return 'text_archive';
  if (/(route|trade|journey|voyage|migration|movement|provenance|exchange|road|sea lane|network)/.test(corpus)) return 'route_exchange';
  if (/(myth|legend|really|true|false|debunk|claim|did .* really)/.test(corpus)) return 'myth_claim';
  return 'object_material';
}

function historyUnderGlassBeatOrder(archetype, brief, claims) {
  if (String(archetype?.id || '') !== 'object_biography') return archetype?.required_story_beats || [];
  const topicClass = historyUnderGlassTopicClass(brief, claims);
  if (topicClass === 'text_archive') {
    return ['object_reveal', 'original_use', 'materials_and_making', 'human_context', 'historical_meaning', 'survival_or_discovery'];
  }
  return archetype?.required_story_beats || [];
}

function claimLeadIn(claim, claimIndex, totalClaims) {
  if ((claim.status || 'supported') === 'weakly_supported') return claimIndex === 0 ? 'Current evidence suggests' : 'The evidence also suggests';
  return '';
}

function rewriteClaimForFlow(text, subject, claimIndex) {
  if (!claimIndex || !subject) return text;
  const escaped = subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`^${escaped} is \\d`, 'i').test(text) && /\b(high|wide|thick|long|tall)\b/i.test(text)) {
    return text.replace(new RegExp(`^${escaped} is\\s+`, 'i'), 'It is ');
  }
  return text
    .replace(new RegExp(`^${escaped} is\\b`, 'i'), 'It is')
    .replace(new RegExp(`^${escaped} was\\b`, 'i'), 'It was')
    .replace(new RegExp(`^${escaped} has\\b`, 'i'), 'It has')
    .replace(new RegExp(`^${escaped} had\\b`, 'i'), 'It had');
}

function spokenClaimSentence(claim, brief, claimIndex, totalClaims) {
  const subject = claimSubjectLabel(claim, brief);
  const leadText = rewriteClaimForFlow(cleanSpokenClaimText(claimLeadText(claim, brief), subject), subject, claimIndex);
  if (!leadText) return '';
  if (claimIndex > 0 && /^it\s+(?:is|was|has|had)\b/i.test(leadText)) return leadText;
  if (claimIndex > 0 && /^according to\b/i.test(leadText)) return leadText;
  if (claimIndex > 0 && /^from this point\b/i.test(leadText)) return leadText;
  if (claimIndex > 0 && /^other than\b/i.test(leadText)) return leadText;
  if (claimIndex > 0 && /^the rosetta stone\b/i.test(leadText)) return leadText;
  const prefix = claimLeadIn(claim, claimIndex, totalClaims);
  if (!prefix) return leadText;
  return `${prefix} ${leadText.replace(/^./, (letter) => letter.toLowerCase())}`;
}

function dedupeNarrationSentences(text) {
  const seen = new Set();
  const result = [];
  for (const sentence of splitSentences(text)) {
    const normalized = normalizedText(sentence);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(sentence.trim());
  }
  return normalizeWhitespace(result.join(' '));
}

function sceneNarration(pack, beat, guidance, assignedClaims, index, total, settings, brief = {}) {
  const frame = settings.frame;
  const spokenIntro = spokenBridgeForBeat(beat.name, { ...pack, current_brief: brief });
  const segments = [
    { type: 'narrative_bridge', text: spokenIntro, claim_id: null, source_id: null },
    { type: 'editorial_guidance', text: guidance[1], claim_id: null, source_id: null },
    { type: 'editorial_guidance', text: guidance[0], claim_id: null, source_id: null }
  ];
  assignedClaims.forEach((claim, claimIndex) => {
    segments.push({
      type: 'claim',
      text: spokenClaimSentence(claim, brief, claimIndex, assignedClaims.length),
      claim_id: claim.claim_id,
      source_id: claim.source_id,
      citation: {
        passage: claim.supporting_passage,
        passage_start: claim.passage_start,
        passage_end: claim.passage_end,
        revision_id: claim.source_revision_id || null
      }
    });
  });
  segments.push({ type: 'editorial_boundary', text: frame.bridge, claim_id: null, source_id: null });
  if (index < total - 1) segments.push({ type: 'editorial_transition', text: `That establishes the ${titleCase(beat.name).toLowerCase()} stage and creates the next question in the sequence.`, claim_id: null, source_id: null });
  const spokenTypes = new Set(['narrative_bridge', 'claim', 'answer_reveal', 'explanation', 'hook', 'question_prompt', 'option', 'countdown', 'next_action']);
  const narration = dedupeNarrationSentences(segments.filter((segment) => spokenTypes.has(segment.type)).map((segment) => segment.text).join(' '));
  return { segments, narration: beatSpecificNarrationEdits(narration, beat.name) };
}

function shouldUseQuestionTurns(pack, brief = {}, questions = []) {
  if (!Array.isArray(questions) || !questions.length) return false;
  const output = normalizeWhitespace(brief.output_format || '');
  const viewerJob = normalizedText(brief.viewer_job || '');
  return storySettings(pack).frame.mode === 'interactive_adventure'
    || output === 'printable_quiz'
    || output === 'activity_sheet'
    || /test myself|challenge/.test(viewerJob);
}

function optionLetter(index) {
  return String.fromCharCode(65 + index);
}

function questionSceneNarration(question, brief) {
  const options = (question.options || []).map((option, index) => `Option ${optionLetter(index)}. ${normalizeWhitespace(option)}.`);
  return normalizeWhitespace([
    question.question,
    ...options,
    `You have ${Number(brief.countdown_seconds || 8)} seconds to decide.`,
    `The correct answer is option ${optionLetter(Number(question.correct_option_index || 0))}. ${normalizeWhitespace(question.answer || '')}.`,
    normalizeWhitespace(question.explanation || '')
  ].join(' '));
}

function buildQuestionDrivenScriptPackage(pack, archetype, brief, narrativeBlueprint, claims = [], questions = [], priorPackets = []) {
  const settings = storySettings(pack);
  const hook = narrativeBlueprint.selected_hook;
  const countdown = Math.max(3, Math.min(Number(brief.countdown_seconds) || 8, 30));
  const scenes = [{
    scene_id: 'hook',
    order: 1,
    beat_id: 'hook',
    beat_name: 'Hook',
    title: brief.working_title,
    objective: 'Open with the mission, rules, and the first challenge setup.',
    retention_device: 'open loop',
    claim_ids: hook.claim_ids,
    source_ids: hook.source_ids,
    scene_type: 'hook',
    script_segments: [{ type: 'hook', text: hook.text, claim_id: hook.claim_ids[0] || null, source_id: hook.source_ids[0] || null }],
    narration: hook.text,
    visual_requirements: ['Show the mission immediately.', 'Make the challenge structure visible.', ...pack.visuals.language.slice(0, 2)],
    editorial_note: `Hook type: ${hook.type}. Human editor may swap another supported hook before approval.`
  }];

  questions.forEach((question, index) => {
    const claimIds = question.claim_ids || [];
    const sourceIds = question.source_ids || [];
    const answerIndex = Number(question.correct_option_index || 0);
    scenes.push({
      scene_id: stableId('scene', `${brief.working_title}|question|${question.question_uid || question.question_id || index}`),
      order: scenes.length + 1,
      beat_id: `question_${index + 1}`,
      beat_name: 'Question Turn',
      title: `Question ${index + 1}`,
      objective: 'Present a fair question, visible options, a real countdown, and a supported answer reveal.',
      retention_device: index === questions.length - 1 ? 'final payoff' : 'countdown challenge',
      claim_ids: claimIds,
      source_ids: sourceIds,
      scene_type: 'question_turn',
      question_turn: {
        question_id: question.question_id || `Q${index + 1}`,
        prompt: question.question,
        options: question.options || [],
        correct_option_index: answerIndex,
        correct_option_letter: optionLetter(answerIndex),
        answer: question.answer,
        explanation: question.explanation,
        countdown_seconds: countdown,
        difficulty: question.difficulty || 'mixed'
      },
      script_segments: [
        { type: 'question_prompt', text: normalizeWhitespace(question.question), claim_id: claimIds[0] || null, source_id: sourceIds[0] || null },
        ...(question.options || []).map((option, optionIndex) => ({ type: 'option', text: `Option ${optionLetter(optionIndex)}. ${normalizeWhitespace(option)}`, claim_id: null, source_id: null })),
        { type: 'countdown', text: `You have ${countdown} seconds to decide.`, claim_id: null, source_id: null },
        {
          type: 'answer_reveal',
          text: `The correct answer is option ${optionLetter(answerIndex)}. ${normalizeWhitespace(question.answer || '')}.`,
          claim_id: claimIds[0] || null,
          source_id: sourceIds[0] || null,
          citation: question.citation_spans?.[0] || null
        },
        {
          type: 'explanation',
          text: normalizeWhitespace(question.explanation || ''),
          claim_id: claimIds[0] || null,
          source_id: sourceIds[0] || null,
          citation: question.citation_spans?.[0] || null
        }
      ],
      narration: questionSceneNarration(question, brief),
      visual_requirements: [
        'Show the prompt and all answer options on screen.',
        'Display a visible countdown, not just narration.',
        'Use a distinct answer reveal state after the countdown.'
      ],
      editorial_note: 'Question, answer, and explanation must remain aligned to the same claim.'
    });
  });

  const conclusionText = normalizeWhitespace(`${settings.frame.closing} ${audienceAssessmentClosing(brief, pack)}`);
  scenes.push({
    scene_id: 'conclusion',
    order: scenes.length + 1,
    beat_id: 'conclusion',
    beat_name: 'Conclusion',
    title: 'Mission Complete',
    objective: 'Celebrate the result, recap the evidence, and invite the next action.',
    retention_device: 'final payoff and next-video bridge',
    claim_ids: [],
    source_ids: [],
    scene_type: 'conclusion',
    script_segments: [
      { type: 'narrative_bridge', text: conclusionText, claim_id: null, source_id: null },
      { type: 'next_action', text: pack.audience.likely_next_action || 'Continue to a related programme.', claim_id: null, source_id: null }
    ],
    narration: normalizeWhitespace(`${conclusionText} ${pack.audience.likely_next_action || ''}`),
    visual_requirements: ['Show the solved mission state.', 'Recap score/evidence progress and point to the next action.'],
    editorial_note: 'The conclusion must not introduce a new unsupported fact.'
  });

  const wpm = settings.spoken_words_per_minute;
  scenes.forEach((scene) => {
    scene.word_count = wordCount(scene.narration);
    const baseSeconds = (scene.word_count / wpm) * 60;
    const countdownSeconds = scene.scene_type === 'question_turn' ? Number(scene.question_turn?.countdown_seconds || 0) : 0;
    scene.estimated_duration_seconds = Number((baseSeconds + countdownSeconds).toFixed(2));
  });
  const fullNarration = scenes.map((scene) => scene.narration).join('\n\n');
  const wordTotal = scenes.reduce((sum, scene) => sum + scene.word_count, 0);
  const durationSeconds = scenes.reduce((sum, scene) => sum + scene.estimated_duration_seconds, 0);
  const packageObject = {
    schema: `nichefoundry.script_package.v${STORY_ENGINE_SCHEMA}`,
    generated_at: new Date().toISOString(),
    generation_mode: 'deterministic_question_turn_story_engine_v1',
    studio_id: pack.studio.id,
    archetype_id: archetype.id,
    title: brief.working_title,
    hook,
    scenes,
    full_narration: fullNarration,
    word_count: wordTotal,
    estimated_duration_seconds: Number(durationSeconds.toFixed(2)),
    estimated_duration_minutes: Number((durationSeconds / 60).toFixed(2)),
    requested_duration_minutes: narrativeBlueprint.duration_plan.requested,
    evidence_supported_max_minutes: narrativeBlueprint.duration_plan.evidence_supported_max,
    source_ids: [...new Set(scenes.flatMap((scene) => scene.source_ids))],
    claim_ids: [...new Set(scenes.flatMap((scene) => scene.claim_ids))],
    script_hash_basis: stableId('script', fullNarration, 32)
  };
  packageObject.critic = critiqueScriptPackage(packageObject, { pack, archetype, brief, claims, priorPackets, narrativeBlueprint });
  packageObject.script_passes = buildScriptPasses(packageObject, { pack, brief, claims, narrativeBlueprint });
  packageObject.passed = packageObject.critic.passed && packageObject.script_passes.passed;
  return packageObject;
}

function buildNarrativeBlueprint(pack, archetype, brief, claims, studioBlueprint, audienceAssessment) {
  const settings = storySettings(pack);
  const hookCandidates = buildHookCandidates(pack, archetype, brief, claims);
  const duration = requestedDurationMinutes(brief, pack, archetype, claims.length);
  const persona = audienceAssessment?.audience_fit?.persona || null;
  return {
    schema: `nichefoundry.narrative_blueprint.v${STORY_ENGINE_SCHEMA}`,
    generated_at: new Date().toISOString(),
    studio: { id: pack.studio.id, name: pack.studio.name, version: pack.studio.version },
    archetype: { id: archetype.id, name: archetype.name, description: archetype.description },
    narrative_mode: settings.narrative_mode,
    episode_promise: `${brief.story_premise} The programme will serve ${audienceAssessment?.audience_fit?.viewer_job?.label || 'the selected viewer job'} for ${persona?.name || pack.audience.primary_age}.`,
    opening_question: `What does the verified evidence reveal about ${brief.topic}, and why does it matter?`,
    narrative_tension: `The programme must move from the viewer's opening uncertainty to a conclusion proportional to the evidence without collapsing disagreement or limitations.`,
    knowledge_prerequisites: `Assume ${persona?.knowledge_level || pack.audience.knowledge_level}; define specialised terms before relying on them.`,
    selected_hook: hookCandidates[0],
    hook_candidates: hookCandidates,
    required_story_beats: studioBlueprint.story_map.map((beat) => beat.name),
    duration_plan: duration,
    spoken_words_per_minute: settings.spoken_words_per_minute,
    retention_plan: studioBlueprint.story_map.map((beat, index) => ({
      beat_id: beat.beat_id,
      beat_name: beat.name,
      device: retentionDevice(settings, index, studioBlueprint.story_map.length),
      purpose: index === 0 ? 'Open a question the next beat must answer.' : index === studioBlueprint.story_map.length - 1 ? 'Resolve the opening promise.' : 'Create a specific evidence-led reason to continue.'
    })),
    closing_bridge: settings.frame.closing,
    output_format: brief.output_format || 'long_form',
    human_decisions_required: ['Select or edit the hook.', 'Review the claim selection for every beat.', 'Approve the conclusion and uncertainty language.', 'Confirm duration and spoken tone before narration.']
  };
}

function stripSourceJunk(value) {
  return normalizeWhitespace(String(value || '')
    .replace(/\b(?:Summary|References|Footnotes|Bibliography|External links|See also|Further reading|List of inscriptions|Designations)\b:?/gi, '')
    .replace(/\s{2,}/g, ' '));
}

function shouldUseSectionalOllamaReview(pack, scriptPackage) {
  if (!canUseOllama()) return false;
  const enabled = String(process.env.FOUNDRY_OLLAMA_SECTION_REVIEW || '1').toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(enabled)) return false;
  if (!scriptPackage?.scenes?.length) return false;
  return pack?.studio?.id === 'history_under_glass';
}

async function reviewSceneWithOllama({ pack, brief, scene, sceneIndex, totalScenes }) {
  const schema = {
    type: 'object',
    properties: {
      narration: { type: 'string' },
      title: { type: 'string' }
    },
    required: ['narration', 'title']
  };
  const claimSentences = (scene.script_segments || [])
    .filter((segment) => segment.type === 'claim')
    .map((segment) => stripSourceJunk(segment.text))
    .filter(Boolean);
  const prompt = [
    'You are revising one documentary script section.',
    `Studio: ${pack?.studio?.name || 'Unknown'}`,
    `Topic: ${brief?.topic || ''}`,
    `Scene ${sceneIndex + 1} of ${totalScenes}`,
    `Current title: ${scene.title}`,
    `Current narration: ${scene.narration}`,
    `Grounded claim sentences: ${claimSentences.join(' | ') || 'None'}`,
    'Rules:',
    '- Keep every factual claim inside the grounded claim sentences.',
    '- Improve spoken flow and remove source-heading junk.',
    '- Make this section sound different from a generic museum template.',
    '- Do not mention workflow, sources, JSON, approval, scripts, or production.',
    '- Keep it concise and natural for narration.',
    'Return JSON only.'
  ].join('\n');
  const result = await callOllama({ schema, prompt, temperature: 0.2 });
  return {
    title: normalizeWhitespace(result?.title || scene.title),
    narration: stripSourceJunk(result?.narration || scene.narration)
  };
}

async function applySectionalOllamaReview(pack, brief, scriptPackage) {
  if (!shouldUseSectionalOllamaReview(pack, scriptPackage)) return scriptPackage;
  const limit = Math.max(1, Math.min(Number(process.env.FOUNDRY_OLLAMA_SECTION_REVIEW_LIMIT || 2), 4));
  const flagged = scriptPackage.scenes
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) =>
      scene.scene_id !== 'hook'
      && (/(summary|references|footnotes|bibliography|external links|see also|further reading|open the programme with a supported question)/i.test(scene.narration)
      || jaccard(scene.narration, scriptPackage.hook?.text || '') > 0.45))
    .slice(0, limit);
  if (!flagged.length) return scriptPackage;
  const reviewed = new Map();
  for (const { scene, index } of flagged) {
    try {
      reviewed.set(scene.scene_id, await reviewSceneWithOllama({ pack, brief, scene, sceneIndex: index, totalScenes: scriptPackage.scenes.length }));
    } catch (_error) {
      // Keep deterministic scene when Ollama is unavailable.
    }
  }
  if (!reviewed.size) return scriptPackage;
  const settings = storySettings(pack);
  const scenes = scriptPackage.scenes.map((scene) => {
    const rewrite = reviewed.get(scene.scene_id);
    if (!rewrite) return scene;
    const narration = dedupeNarrationSentences(beatSpecificNarrationEdits(stripSourceJunk(rewrite.narration), scene.beat_name));
    return {
      ...scene,
      title: rewrite.title || scene.title,
      narration,
      word_count: wordCount(narration),
      estimated_duration_seconds: Number(((wordCount(narration) / settings.spoken_words_per_minute) * 60).toFixed(2))
    };
  });
  const fullNarration = scenes.map((scene) => scene.narration).join('\n\n');
  const durationSeconds = scenes.reduce((sum, scene) => sum + scene.estimated_duration_seconds, 0);
  return {
    ...scriptPackage,
    scenes,
    full_narration: fullNarration,
    word_count: scenes.reduce((sum, scene) => sum + scene.word_count, 0),
    estimated_duration_seconds: Number(durationSeconds.toFixed(2)),
    estimated_duration_minutes: Number((durationSeconds / 60).toFixed(2)),
    generation_mode: `${scriptPackage.generation_mode}+section_review:${ollamaClientConfig().model}`
  };
}

function buildScriptPackage(pack, archetype, brief, claims, sources, studioBlueprint, narrativeBlueprint, priorPackets = [], questions = []) {
  if (shouldUseQuestionTurns(pack, brief, questions)) {
    return buildQuestionDrivenScriptPackage(pack, archetype, brief, narrativeBlueprint, claims, questions, priorPackets);
  }
  const settings = storySettings(pack);
  const byId = claimLookup(claims);
  const supported = prioritizedSupportedClaims(claims, brief, pack);
  const usedClaims = new Set();
  const scenes = [];
  const hook = narrativeBlueprint.selected_hook;
  scenes.push({
    scene_id: 'hook',
    order: 1,
    beat_id: 'hook',
    beat_name: 'Hook',
    title: brief.working_title,
    objective: 'Open the programme with a supported question, contradiction, result, or mission.',
    retention_device: 'open loop',
    claim_ids: hook.claim_ids,
    source_ids: hook.source_ids,
    script_segments: [{ type: 'hook', text: hook.text, claim_id: hook.claim_ids[0] || null, source_id: hook.source_ids[0] || null }],
    narration: hook.text,
    visual_requirements: ['Show the central subject immediately.', 'Avoid unverified reconstruction or generic stock imagery.', ...pack.visuals.language.slice(0, 2)],
    editorial_note: `Hook type: ${hook.type}. Human editor may select another candidate before approval.`
  });
  hook.claim_ids.forEach((claimId) => usedClaims.add(claimId));

  const beatOrder = pack?.studio?.id === 'history_under_glass'
    ? historyUnderGlassBeatOrder(archetype, brief, claims)
    : studioBlueprint.story_map.map((beat) => beat.name);
  const orderedStoryMap = beatOrder
    .map((beatName) => studioBlueprint.story_map.find((beat) => beat.name === beatName))
    .filter(Boolean);
  const totalBeats = orderedStoryMap.length;
  orderedStoryMap.forEach((beat, index) => {
    const guidance = BEAT_GUIDANCE[beat.name] || [`Advance the ${titleCase(beat.name).toLowerCase()} stage using verified evidence.`, `The next stage is ${titleCase(beat.name).toLowerCase()}.`];
    const beatSupported = prioritizedSupportedClaims(claims, brief, pack, beat);
    const assignedClaims = claimSegmentsForBeat(beat, byId, beatSupported, usedClaims);
    const scripted = sceneNarration(pack, beat, guidance, assignedClaims, index, totalBeats, settings, brief);
    scenes.push({
      scene_id: stableId('scene', `${brief.working_title}|${beat.name}|${index}`),
      order: index + 2,
      beat_id: beat.beat_id,
      beat_name: beat.name,
      title: titleCase(beat.name),
      objective: guidance[0],
      retention_device: retentionDevice(settings, index, totalBeats),
      claim_ids: assignedClaims.map((claim) => claim.claim_id),
      source_ids: [...new Set(assignedClaims.map((claim) => claim.source_id))],
      script_segments: scripted.segments,
      narration: scripted.narration,
      visual_requirements: [
        `Visualise ${titleCase(beat.name).toLowerCase()} rather than displaying a generic title card.`,
        ...(pack.visuals.language || []).slice(index % Math.max(1, (pack.visuals.language || []).length), index % Math.max(1, (pack.visuals.language || []).length) + 2)
      ],
      editorial_note: assignedClaims.length ? 'All factual statements are bound to listed claims.' : 'No supported claim was available; this scene must remain blocked.'
    });
  });

  const conclusionText = normalizeWhitespace(`${settings.frame.closing} ${audienceAssessmentClosing(brief, pack)}`);
  scenes.push({
    scene_id: 'conclusion',
    order: scenes.length + 1,
    beat_id: 'conclusion',
    beat_name: 'Conclusion',
    title: 'Conclusion and Next Step',
    objective: 'Resolve the opening promise and state the likely next action.',
    retention_device: 'final payoff and next-video bridge',
    claim_ids: [],
    source_ids: [],
    script_segments: [
      { type: 'narrative_bridge', text: conclusionText, claim_id: null, source_id: null },
      { type: 'next_action', text: pack.audience.likely_next_action || 'Continue to a related programme.', claim_id: null, source_id: null }
    ],
    narration: normalizeWhitespace(`${conclusionText} ${pack.audience.likely_next_action || ''}`),
    visual_requirements: ['Return to the opening subject.', 'Show a concise evidence summary and the next programme bridge.'],
    editorial_note: 'The conclusion must not introduce new factual claims.'
  });

  const wpm = settings.spoken_words_per_minute;
  scenes.forEach((scene) => {
    scene.word_count = wordCount(scene.narration);
    scene.estimated_duration_seconds = Number(((scene.word_count / wpm) * 60).toFixed(2));
  });
  const fullNarration = scenes.map((scene) => scene.narration).join('\n\n');
  const wordTotal = scenes.reduce((sum, scene) => sum + scene.word_count, 0);
  const durationSeconds = scenes.reduce((sum, scene) => sum + scene.estimated_duration_seconds, 0);
  const packageObject = {
    schema: `nichefoundry.script_package.v${STORY_ENGINE_SCHEMA}`,
    generated_at: new Date().toISOString(),
    generation_mode: 'deterministic_claim_bound_story_engine_v1',
    studio_id: pack.studio.id,
    archetype_id: archetype.id,
    title: brief.working_title,
    hook: hook,
    scenes,
    full_narration: fullNarration,
    word_count: wordTotal,
    estimated_duration_seconds: Number(durationSeconds.toFixed(2)),
    estimated_duration_minutes: Number((durationSeconds / 60).toFixed(2)),
    requested_duration_minutes: narrativeBlueprint.duration_plan.requested,
    evidence_supported_max_minutes: narrativeBlueprint.duration_plan.evidence_supported_max,
    source_ids: [...new Set(scenes.flatMap((scene) => scene.source_ids))],
    claim_ids: [...new Set(scenes.flatMap((scene) => scene.claim_ids))],
    script_hash_basis: stableId('script', fullNarration, 32)
  };
  packageObject.full_narration = stripSourceJunk(packageObject.full_narration);
  packageObject.critic = critiqueScriptPackage(packageObject, { pack, archetype, brief, claims, priorPackets, narrativeBlueprint });
  packageObject.script_passes = buildScriptPasses(packageObject, { pack, brief, claims, narrativeBlueprint });
  packageObject.passed = packageObject.critic.passed && packageObject.script_passes.passed;
  return packageObject;
}

function audienceAssessmentClosing(brief, pack) {
  if (pack.studio.id === 'practical_open_source') return 'The viewer should now be able to reproduce the result, verify it, and recognise the common failure state.';
  if (pack.studio.id === 'history_under_glass') return 'The conclusion returns to the historical question while preserving uncertainty and source limits.';
  if (pack.studio.id === 'failure_atlas') return 'The chain is complete only when the transferable lesson is separated from hindsight and blame.';
  if (pack.studio.id === 'puzzle_planet') return 'The mission resolves by naming the evidence the explorer used, not only the final score.';
  return `The ending should fulfil the channel promise: ${pack.promise.statement}`;
}

function buildScriptPasses(scriptPackage, { pack, brief, claims, narrativeBlueprint }) {
  const claimIds = new Set(claims.map((claim) => claim.claim_id));
  const claimSegments = scriptPackage.scenes.flatMap((scene) => scene.script_segments.filter((segment) => ['claim', 'answer_reveal', 'explanation'].includes(segment.type)));
  const evidenceIssues = claimSegments.filter((segment) => !segment.claim_id || !claimIds.has(segment.claim_id) || !segment.citation?.passage);
  const requiredBeats = new Set(narrativeBlueprint.required_story_beats);
  const presentBeats = new Set(scriptPackage.scenes.map((scene) => scene.beat_name));
  const questionDriven = scriptPackage.generation_mode === 'deterministic_question_turn_story_engine_v1';
  const missingBeats = questionDriven ? [] : [...requiredBeats].filter((beat) => !presentBeats.has(beat));
  const stats = sentenceStats(scriptPackage.full_narration);
  const age = String(brief.age_band || pack.audience.primary_age || '13+');
  const sentenceLimit = /5-7/.test(age) ? 14 : /8-13/.test(age) ? 20 : 27;
  const spokenIssues = [];
  if (/https?:\/\//i.test(scriptPackage.full_narration)) spokenIssues.push('spoken_script_contains_url');
  if (/\[[^\]]+\]|```|^#+\s/m.test(scriptPackage.full_narration)) spokenIssues.push('spoken_script_contains_markup');
  const timingMinimum = brief.output_format === 'short' ? 20 : 75;
  const timingMaximum = narrativeBlueprint.duration_plan.requested * 60 * 1.2;
  const passes = {
    evidence: { passed: evidenceIssues.length === 0 && claimSegments.length > 0, issue_count: evidenceIssues.length, grounded_claim_segment_count: claimSegments.length },
    structure: { passed: missingBeats.length === 0, missing_beats: missingBeats, scene_count: scriptPackage.scenes.length },
    audience: { passed: stats.average_sentence_words <= sentenceLimit * 1.25, average_sentence_words: stats.average_sentence_words, target_maximum: sentenceLimit },
    spoken_language: { passed: spokenIssues.length === 0, issues: spokenIssues },
    timing: { passed: scriptPackage.estimated_duration_seconds >= timingMinimum && scriptPackage.estimated_duration_seconds <= timingMaximum, requested_minutes: narrativeBlueprint.duration_plan.requested, estimated_minutes: scriptPackage.estimated_duration_minutes, evidence_bounded: narrativeBlueprint.duration_plan.bounded_by_evidence },
    originality: { passed: true, note: 'Cross-library similarity is evaluated by the narrative critic.' },
    sensationalism: { passed: !HYPE_PATTERNS.some((pattern) => pattern.test(scriptPackage.full_narration)), matched_patterns: HYPE_PATTERNS.filter((pattern) => pattern.test(scriptPackage.full_narration)).map(String) }
  };
  return {
    schema: `nichefoundry.script_passes.v${STORY_ENGINE_SCHEMA}`,
    required_passes: storySettings(pack).required_passes,
    passes,
    passed: Object.values(passes).every((pass) => pass.passed),
    checked_at: new Date().toISOString()
  };
}

function critiqueScriptPackage(scriptPackage, { pack, archetype, brief, claims, priorPackets = [], narrativeBlueprint }) {
  const issues = [];
  const warnings = [];
  const claimMap = claimLookup(claims);
  const requiredBeats = archetype.required_story_beats || [];
  const present = new Set(scriptPackage.scenes.map((scene) => scene.beat_name));
  const questionDriven = scriptPackage.generation_mode === 'deterministic_question_turn_story_engine_v1';
  if (!questionDriven) requiredBeats.forEach((beat) => { if (!present.has(beat)) issues.push(`missing_story_beat:${beat}`); });
  for (const scene of scriptPackage.scenes) {
    if (!scene.narration || wordCount(scene.narration) < 6) issues.push(`underspecified_scene:${scene.scene_id}`);
    for (const segment of scene.script_segments || []) {
      if (['claim', 'answer_reveal', 'explanation'].includes(segment.type)) {
        const claim = claimMap.get(segment.claim_id);
        if (!claim) issues.push(`unknown_claim:${scene.scene_id}:${segment.claim_id}`);
        if (!segment.citation?.passage) issues.push(`missing_citation:${scene.scene_id}:${segment.claim_id}`);
      }
    }
    if (META_PATTERNS.some((pattern) => pattern.test(scene.narration))) issues.push(`meta_or_workflow_content:${scene.scene_id}`);
    if (HYPE_PATTERNS.some((pattern) => pattern.test(scene.narration))) issues.push(`sensationalism:${scene.scene_id}`);
    const prohibited = [...(pack.promise.prohibited || []), ...(pack.story_engine?.forbidden_phrases || [])];
    prohibited.forEach((phrase) => {
      if (normalizedText(phrase).length > 4 && normalizedText(scene.narration).includes(normalizedText(phrase))) issues.push(`prohibited_language:${scene.scene_id}:${phrase}`);
    });
  }
  for (let left = 0; left < scriptPackage.scenes.length; left += 1) {
    for (let right = left + 1; right < scriptPackage.scenes.length; right += 1) {
      const similarity = jaccard(scriptPackage.scenes[left].narration, scriptPackage.scenes[right].narration);
      if (similarity >= 0.72) warnings.push(`scene_similarity:${scriptPackage.scenes[left].scene_id}:${scriptPackage.scenes[right].scene_id}:${similarity.toFixed(3)}`);
    }
  }
  const libraryFindings = [];
  for (const prior of priorPackets) {
    const priorScript = prior?.script_package?.full_narration || prior?.story_package?.full_narration;
    if (!priorScript || prior?.episode?.episode_id === brief.episode_id) continue;
    const similarity = jaccard(scriptPackage.full_narration, priorScript);
    if (similarity >= 0.78) libraryFindings.push({ episode_id: prior.episode?.episode_id || null, similarity: Number(similarity.toFixed(3)) });
  }
  if (libraryFindings.length) issues.push('library_script_near_duplicate');
  if (narrativeBlueprint.duration_plan.bounded_by_evidence) warnings.push(`duration_bounded_by_evidence:${narrativeBlueprint.duration_plan.evidence_supported_max}m`);
  if (scriptPackage.estimated_duration_minutes < narrativeBlueprint.duration_plan.resolved * 0.55) warnings.push('script_shorter_than_evidence_supported_target');
  return {
    schema: `nichefoundry.narrative_critic.v${STORY_ENGINE_SCHEMA}`,
    passed: issues.length === 0,
    issues,
    warnings,
    library_similarity_findings: libraryFindings,
    checks: ['required story beats', 'claim and citation integrity', 'meta-content ban', 'sensationalism ban', 'Studio Pack prohibited language', 'scene repetition', 'cross-library script similarity', 'duration honesty'],
    editor_summary: issues.length
      ? `The narrative critic blocked ${issues.length} issue${issues.length === 1 ? '' : 's'} before human approval.`
      : `The script contains ${scriptPackage.scenes.length} scenes, ${scriptPackage.claim_ids.length} grounded claims, and a complete ${archetype.name} sequence ready for human editorial review.`,
    checked_at: new Date().toISOString()
  };
}

async function buildNarrativePackage({ pack, archetype, brief, claims, questions = [], sources, studioBlueprint, audienceAssessment, priorPackets = [] }) {
  const narrativeBlueprint = buildNarrativeBlueprint(pack, archetype, brief, claims, studioBlueprint, audienceAssessment);
  const initialScriptPackage = buildScriptPackage(pack, archetype, brief, claims, sources, studioBlueprint, narrativeBlueprint, priorPackets, questions);
  const scriptPackage = await applySectionalOllamaReview(pack, brief, initialScriptPackage);
  scriptPackage.critic = critiqueScriptPackage(scriptPackage, { pack, archetype, brief, claims, priorPackets, narrativeBlueprint });
  scriptPackage.script_passes = buildScriptPasses(scriptPackage, { pack, brief, claims, narrativeBlueprint });
  scriptPackage.passed = scriptPackage.critic.passed && scriptPackage.script_passes.passed;
  const timingPlan = {
    schema: `nichefoundry.timing_plan.v${STORY_ENGINE_SCHEMA}`,
    requested_duration_minutes: narrativeBlueprint.duration_plan.requested,
    evidence_supported_max_minutes: narrativeBlueprint.duration_plan.evidence_supported_max,
    estimated_duration_minutes: scriptPackage.estimated_duration_minutes,
    spoken_words_per_minute: narrativeBlueprint.spoken_words_per_minute,
    total_words: scriptPackage.word_count,
    scenes: scriptPackage.scenes.map((scene) => ({ scene_id: scene.scene_id, beat_name: scene.beat_name, word_count: scene.word_count, estimated_duration_seconds: scene.estimated_duration_seconds })),
    warnings: scriptPackage.script_passes.passes.timing.passed ? [] : ['Estimated narration is outside the accepted timing range.'],
    checked_at: new Date().toISOString()
  };
  const storyReport = {
    schema: `nichefoundry.story_report.v${STORY_ENGINE_SCHEMA}`,
    passed: scriptPackage.passed,
    studio_id: pack.studio.id,
    archetype_id: archetype.id,
    selected_hook_id: narrativeBlueprint.selected_hook.hook_id,
    scene_count: scriptPackage.scenes.length,
    grounded_claim_count: scriptPackage.claim_ids.length,
    grounded_source_count: scriptPackage.source_ids.length,
    estimated_duration_minutes: scriptPackage.estimated_duration_minutes,
    issues: [...scriptPackage.critic.issues, ...Object.entries(scriptPackage.script_passes.passes).filter(([, value]) => !value.passed).map(([key]) => `script_pass_failed:${key}`)],
    warnings: scriptPackage.critic.warnings,
    checked_at: new Date().toISOString()
  };
  return { narrative_blueprint: narrativeBlueprint, script_package: scriptPackage, timing_plan: timingPlan, story_report: storyReport };
}

function scriptPackageToMarkdown(scriptPackage) {
  const lines = [
    `# ${scriptPackage.title}`,
    '',
    `Studio: ${scriptPackage.studio_id}`,
    `Archetype: ${scriptPackage.archetype_id}`,
    `Estimated narration: ${scriptPackage.estimated_duration_minutes} minutes`,
    `Grounded claims: ${scriptPackage.claim_ids.length}`,
    '',
    '## Hook',
    '',
    scriptPackage.hook.text,
    ''
  ];
  for (const scene of scriptPackage.scenes.filter((scene) => scene.scene_id !== 'hook')) {
    lines.push(`## ${scene.title}`, '', scene.narration, '', `Evidence: ${scene.claim_ids.length ? scene.claim_ids.join(', ') : 'Narrative bridge only'}`, '');
  }
  return `${lines.join('\n').trim()}\n`;
}

module.exports = {
  STORY_ENGINE_SCHEMA,
  BEAT_GUIDANCE,
  storySettings,
  buildHookCandidates,
  buildNarrativeBlueprint,
  buildScriptPackage,
  buildNarrativePackage,
  critiqueScriptPackage,
  buildScriptPasses,
  scriptPackageToMarkdown,
  requestedDurationMinutes
};
