const { normalizedText, tokens, tokenSet, jaccard, lexicalOverlap } = require('./text');

const META_PATTERNS = [
  /source packet/i,
  /question writing/i,
  /workflow/i,
  /human approval/i,
  /youtube/i,
  /video upload/i,
  /render(?:ing)?/i,
  /caption/i,
  /thumbnail/i,
  /prompt/i,
  /gamma/i,
  /elevenlabs/i,
  /correct answer especially important/i
];

function wordStats(value) {
  const words = tokens(value, { keepStopWords: true, minLength: 1 });
  const longWords = words.filter((word) => word.length >= 9).length;
  return { words: words.length, long_words: longWords, long_word_ratio: words.length ? longWords / words.length : 0 };
}

function validateStructure(episode, brief, claimMap, sourceMap) {
  const issues = [];
  const checks = [];
  const expected = Number(brief.question_count) || 6;
  if (!Array.isArray(episode.questions) || episode.questions.length !== expected) issues.push(`Expected ${expected} questions.`);
  for (const [index, question] of (episode.questions || []).entries()) {
    const label = `Question ${index + 1}`;
    if (!question.question || question.question.length < 12) issues.push(`${label} has an empty or underspecified stem.`);
    if (!Array.isArray(question.options) || question.options.length !== 4) issues.push(`${label} must have exactly four options.`);
    const normalizedOptions = (question.options || []).map(normalizedText);
    if (new Set(normalizedOptions).size !== 4) issues.push(`${label} options must be unique after normalization.`);
    if (!Number.isInteger(question.correct_option_index) || question.correct_option_index < 0 || question.correct_option_index > 3) issues.push(`${label} has an invalid correct option index.`);
    if ((question.options || [])[question.correct_option_index] !== question.answer) issues.push(`${label} answer does not match the selected correct option.`);
    if (!Array.isArray(question.claim_ids) || question.claim_ids.length !== 1) issues.push(`${label} must bind to exactly one atomic claim.`);
    if (!Array.isArray(question.source_ids) || question.source_ids.length < 1) issues.push(`${label} must bind to a source ID.`);
    const claim = claimMap.get(question.claim_ids?.[0]);
    if (!claim) issues.push(`${label} references an unknown claim.`);
    else if (!question.source_ids.includes(claim.source_id)) issues.push(`${label} source binding does not match its claim.`);
    if (question.source_ids?.some((sourceId) => !sourceMap.has(sourceId))) issues.push(`${label} references an unknown source.`);
    if (!question.citation_spans?.[0]?.passage) issues.push(`${label} lacks a supporting citation span.`);
  }
  checks.push('Question count', 'Four unique options', 'Correct-index alignment', 'Atomic claim binding', 'Source binding', 'Citation-span presence');
  return { passed: issues.length === 0, issues, checks };
}

function questionAudit(question, brief, claim) {
  const issues = [];
  const warnings = [];
  const text = `${question.question} ${question.options.join(' ')} ${question.explanation}`;
  if (META_PATTERNS.some((pattern) => pattern.test(text))) issues.push('meta_or_workflow_content');
  const topicContext = `${brief.topic} ${(brief.source_queries || []).join(' ')} ${claim?.source_title || ''} ${claim?.subject || ''}`;
  const relevance = lexicalOverlap(`${question.question} ${question.explanation}`, topicContext);
  if (relevance < 0.12) issues.push('low_topic_relevance');
  const claimAnswerOverlap = claim ? lexicalOverlap(`${question.answer} ${question.explanation}`, claim.claim) : 0;
  if (claimAnswerOverlap < 0.35) issues.push('answer_not_well_supported_by_claim');

  const optionSets = question.options.map((option) => tokenSet(option));
  const correctSet = optionSets[question.correct_option_index] || new Set();
  const similarities = optionSets.map((set, index) => index === question.correct_option_index ? 1 : jaccard(correctSet, set));
  if (similarities.some((score, index) => index !== question.correct_option_index && score > 0.78)) issues.push('ambiguous_near_duplicate_option');

  const stemStats = wordStats(question.question);
  const optionStats = question.options.map(wordStats);
  const maxOptionWords = Math.max(...optionStats.map((item) => item.words));
  const age = String(brief.age_band || '8-13');
  const stemLimit = age === '5-7' ? 16 : age === '8-13' ? 24 : 32;
  const optionLimit = age === '5-7' ? 12 : age === '8-13' ? 24 : 36;
  if (stemStats.words > stemLimit) warnings.push('stem_may_be_too_long_for_age_band');
  if (maxOptionWords > optionLimit) warnings.push('option_may_be_too_long_for_age_band');
  if (stemStats.long_word_ratio > 0.35) warnings.push('stem_vocabulary_may_be_advanced');

  const lengths = question.options.map((option) => option.length);
  const correctLength = lengths[question.correct_option_index] || 0;
  const medianLength = [...lengths].sort((a, b) => a - b)[Math.floor(lengths.length / 2)] || 1;
  if (correctLength > medianLength * 2.1) warnings.push('correct_answer_length_gives_clue');

  return {
    question_id: question.question_id,
    passed: issues.length === 0,
    issues,
    warnings,
    metrics: {
      topic_relevance: Number(relevance.toFixed(3)),
      claim_support_overlap: Number(claimAnswerOverlap.toFixed(3)),
      max_distractor_similarity: Number(Math.max(...similarities.filter((_, index) => index !== question.correct_option_index), 0).toFixed(3)),
      stem_words: stemStats.words,
      max_option_words: maxOptionWords
    }
  };
}

function findDuplicateQuestions(episode, priorEpisodes = []) {
  const current = episode.questions || [];
  const findings = [];
  for (let left = 0; left < current.length; left += 1) {
    for (let right = left + 1; right < current.length; right += 1) {
      const similarity = jaccard(`${current[left].question} ${current[left].answer} ${current[left].explanation}`, `${current[right].question} ${current[right].answer} ${current[right].explanation}`);
      if (similarity >= 0.72) findings.push({ scope: 'within_episode', question_id: current[left].question_id, duplicate_of: current[right].question_id, similarity: Number(similarity.toFixed(3)) });
    }
  }
  for (const prior of priorEpisodes) {
    if (prior?.episode?.episode_id === episode.episode_id) continue;
    for (const question of current) {
      for (const oldQuestion of prior?.episode?.questions || []) {
        const similarity = jaccard(`${question.question} ${question.answer} ${question.explanation}`, `${oldQuestion.question} ${oldQuestion.answer} ${oldQuestion.explanation}`);
        if (similarity >= 0.78) {
          findings.push({ scope: 'library', question_id: question.question_id, duplicate_of: `${prior.episode.episode_id}:${oldQuestion.question_id}`, similarity: Number(similarity.toFixed(3)) });
        }
      }
    }
  }
  return {
    passed: findings.length === 0,
    findings,
    thresholds: { within_episode: 0.72, library: 0.78 }
  };
}

function runEditorialAudit(episode, brief, claims, sources, priorEpisodes = []) {
  const claimMap = new Map(claims.map((claim) => [claim.claim_id, claim]));
  const sourceMap = new Map(sources.map((source) => [source.source_id, source]));
  const structural = validateStructure(episode, brief, claimMap, sourceMap);
  const questionResults = (episode.questions || []).map((question) => questionAudit(question, brief, claimMap.get(question.claim_ids?.[0])));
  const duplicateReport = findDuplicateQuestions(episode, priorEpisodes);
  const issues = [
    ...structural.issues,
    ...questionResults.flatMap((result) => result.issues.map((issue) => `${result.question_id}: ${issue}`)),
    ...duplicateReport.findings.map((finding) => `${finding.question_id}: duplicate similarity ${finding.similarity} with ${finding.duplicate_of}`)
  ];
  const warnings = questionResults.flatMap((result) => result.warnings.map((warning) => `${result.question_id}: ${warning}`));
  const passed = structural.passed && questionResults.every((result) => result.passed) && duplicateReport.passed;
  return {
    passed,
    issues,
    warnings,
    editor_summary: passed
      ? `All ${questionResults.length} questions are claim-bound, topic-relevant, non-meta, and clear enough for human review.`
      : `The independent critic blocked ${issues.length} issue${issues.length === 1 ? '' : 's'} before human approval.`,
    question_results: questionResults,
    duplicate_report: duplicateReport,
    checks: [
      ...structural.checks,
      'Meta/workflow-question ban',
      'Topic relevance',
      'Claim support overlap',
      'Ambiguity and option similarity',
      'Age-band readability warnings',
      'Within-episode and library duplicate detection'
    ]
  };
}

module.exports = { validateStructure, runEditorialAudit, findDuplicateQuestions, META_PATTERNS };
