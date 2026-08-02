const { splitSentences, normalizeWhitespace, normalizedText, tokens, lexicalOverlap, stableId, clamp } = require('./text');

const BAD_SENTENCE_PATTERNS = [
  /this article/i,
  /citation needed/i,
  /may refer to/i,
  /^for other uses/i,
  /^see also/i,
  /^references$/i,
  /^known as /i,
  /^there (?:is|are)\b/i,
  /^including\b/i,
  /^while\b/i,
  /^besides\b/i,
  /^future of /i,
  /^history of /i,
  /^occurrence in /i,
  /source packet/i,
  /question writing/i,
  /youtube/i,
  /approval/i,
  /render/i,
  /caption/i,
  /thumbnail/i
];

const GENERIC_SUBJECT_PATTERNS = [
  /^(?:investigators?|researchers?|scientists?|historians?|engineers?|officials?|observers?)$/i,
  /^(?:bridge investigation|study|record|report|analysis|evidence|inscription)$/i,
  /^(?:it|they|them|these|those|this|there|here)$/i
];

function classifyClaim(sentence) {
  if (/\b(?:is|are|was|were)\b/i.test(sentence)) return 'description';
  if (/\b(?:first|earliest|oldest|began|appeared|founded|invented|discovered)\b/i.test(sentence)) return 'origin';
  if (/\b(?:located|found|lived|occurs|exists|native|region|country|continent)\b/i.test(sentence)) return 'location';
  if (/\b(?:because|caused|resulted|led to|due to)\b/i.test(sentence)) return 'causal';
  if (/\b\d{3,4}\b/.test(sentence) || /million years/i.test(sentence)) return 'date_or_quantity';
  return 'fact';
}

function cleanLeadNoise(value) {
  const cleaned = normalizeWhitespace(String(value || ''))
    .replace(/^(?:terminology|occurrence in the solar system|dynamic characteristics orbit|dimensions|philosophy of space)\s+/i, '')
    .replace(/^(?:in|while|because|although|besides|including|of|for)\b[^,;:]{0,80}[,;:]\s*/i, '')
    .trim();
  return cleaned.replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

function cleanClaimSentence(sentence, sourceTitle) {
  let cleaned = cleanLeadNoise(sentence);
  const repeatedPhrase = cleaned.match(/^([A-Z][A-Za-z0-9'-]*(?:\s+[A-Z][A-Za-z0-9'-]*){0,4})\s+\1\b/);
  if (repeatedPhrase) cleaned = cleaned.replace(repeatedPhrase[0], repeatedPhrase[1]);
  const sourcePrefix = normalizeWhitespace(sourceTitle || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (sourcePrefix) cleaned = cleaned.replace(new RegExp(`^${sourcePrefix}\\s+${sourcePrefix}\\b`, 'i'), sourceTitle);
  cleaned = cleaned.replace(/^(?:Future of [A-Za-z ]+|History of [A-Za-z ]+|Occurrence in [A-Za-z ]+)\s+/i, '');
  return cleaned.replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

function tidySubjectPhrase(value, fallback) {
  const cleaned = normalizeWhitespace(String(value || ''))
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/\b(?:after|before|during|near|in|on|at|from|with|for|through)\b.*$/i, '')
    .replace(/[?.!,;:]+$/, '')
    .trim();
  if (!cleaned) return normalizeWhitespace(fallback || '');
  return cleaned.replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

function extractObjectSubject(sentence, sourceTitle) {
  const clean = cleanLeadNoise(sentence);
  const patterns = [
    /\b(?:studied|examined|measured|observed|recorded|documented|tracked|analyzed|analysed|decoded|used|built|found|revealed)\s+the\s+([A-Za-z0-9' -]{3,60})/i,
    /\b(?:helped|allowed|enabled)\s+(?:scholars|researchers|scientists|engineers|historians)\s+(?:to\s+\w+\s+)?([A-Za-z0-9' -]{3,60})/i,
    /\bcontributed to\s+the\s+([A-Za-z0-9' -]{3,60})/i
  ];
  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match?.[1]) {
      const candidate = tidySubjectPhrase(match[1], sourceTitle);
      if (!isGenericSubject(candidate)) return candidate;
    }
  }
  return normalizeWhitespace(sourceTitle || '');
}

function isGenericSubject(candidate) {
  const clean = normalizeWhitespace(candidate);
  if (!clean) return true;
  if (clean.split(/\s+/).length > 6) return true;
  return GENERIC_SUBJECT_PATTERNS.some((pattern) => pattern.test(clean));
}

function extractSubject(sentence, sourceTitle) {
  const clean = cleanLeadNoise(sentence);
  const copula = clean.match(/^(.{2,80}?)\s+(?:is|are|was|were|has|have|can|lived|first appeared)\b/i);
  const candidate = copula ? normalizeWhitespace(copula[1]).replace(/^[“"']|[“"']$/g, '') : sourceTitle;
  if (isGenericSubject(candidate)) return extractObjectSubject(sentence, sourceTitle) || sourceTitle;
  if (/^(?:in|while|because|although|besides|including)\b/i.test(candidate)) return sourceTitle;
  return tidySubjectPhrase(candidate, sourceTitle) || sourceTitle;
}

function readableSubjectLabel(value, fallback) {
  const cleaned = normalizeWhitespace(String(value || ''))
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/[?.!,;:]+$/, '')
    .trim();
  const base = cleaned || normalizeWhitespace(String(fallback || 'this topic'));
  if (!base) return 'this topic';
  if (isGenericSubject(base)) return normalizeWhitespace(String(fallback || base));
  return base;
}

function questionSubjectLabel(subject, sourceTitle, brief) {
  const fallback = sourceTitle || brief?.topic || 'this topic';
  const readable = readableSubjectLabel(subject, fallback);
  if (readable.split(/\s+/).length <= 4) return readable;
  return readableSubjectLabel(sourceTitle, brief?.topic || readable);
}

function sentenceScore(sentence, source, brief, position) {
  const words = tokens(sentence, { keepStopWords: true });
  if (words.length < 8 || words.length > 55) return 0;
  if (BAD_SENTENCE_PATTERNS.some((pattern) => pattern.test(sentence))) return 0;
  const topicContext = `${brief.topic} ${(brief.source_queries || []).join(' ')} ${source.title}`;
  const overlap = lexicalOverlap(sentence, topicContext);
  const titleMention = normalizedText(sentence).includes(normalizedText(source.title)) ? 0.22 : 0;
  const earlyBonus = Math.max(0, 0.16 - position * 0.008);
  const concreteBonus = /\b\d{2,4}\b|million years|period|located|known|largest|smallest|first|only|includes|consists/i.test(sentence) ? 0.14 : 0;
  return clamp(0.35 + overlap * 0.3 + titleMention + earlyBonus + concreteBonus, 0, 1);
}

function atomizeClaims(sources, brief) {
  const claims = [];
  for (const source of sources) {
    const sentences = splitSentences(source.extract);
    sentences.forEach((sentence, position) => {
      const score = sentenceScore(sentence, source, brief, position);
      if (score < 0.45) return;
      const subject = extractSubject(sentence, source.title);
      const displaySubject = readableSubjectLabel(subject, source.title || brief?.topic);
      const promptSubject = questionSubjectLabel(subject, source.title, brief);
      const rawClaimText = cleanClaimSentence(sentence, source.title).replace(/[.;:]$/, '.');
      const claimText = /^(?:They|It|This|These|Those)\b/i.test(rawClaimText)
        ? rawClaimText.replace(/^(?:They|It|This|These|Those)\b/i, source.title)
        : rawClaimText;
      const claim = {
        claim_id: stableId('clm', `${source.source_id}|${claimText}`),
        source_id: source.source_id,
        source_title: source.title,
        source_url: source.source_url,
        subject,
        display_subject: displaySubject,
        prompt_subject: promptSubject,
        claim: claimText,
        supporting_passage: normalizeWhitespace(sentence),
        passage_start: source.extract.indexOf(sentence),
        passage_end: source.extract.indexOf(sentence) + sentence.length,
        claim_type: classifyClaim(claimText),
        confidence: Number(score.toFixed(3)),
        status: 'supported',
        source_revision_id: source.revision_id,
        content_hash: source.content_hash
      };
      claims.push(claim);
    });
  }

  const deduped = [];
  const seen = new Set();
  claims
    .sort((a, b) => b.confidence - a.confidence)
    .forEach((claim) => {
      const key = normalizedText(claim.claim);
      if (seen.has(key)) return;
      seen.add(key);
      deduped.push(claim);
    });
  return deduped;
}

function coverageReport(sources, claims, requestedCount) {
  const bySource = Object.fromEntries(sources.map((source) => [source.source_id, 0]));
  claims.forEach((claim) => { bySource[claim.source_id] = (bySource[claim.source_id] || 0) + 1; });
  const usableSources = sources.filter((source) => bySource[source.source_id] > 0).length;
  const sufficient = claims.length >= requestedCount;
  const passed = sufficient && sources.length >= 2 && usableSources >= 2;
  return {
    source_count: sources.length,
    usable_source_count: usableSources,
    claim_count: claims.length,
    requested_question_count: requestedCount,
    sufficient_claims: sufficient,
    passed,
    claims_per_source: bySource,
    issues: [
      ...(sources.length < 2 ? ['Fewer than two sources were retrieved.'] : []),
      ...(usableSources < 2 ? ['Fewer than two sources produced usable atomic claims.'] : []),
      ...(!sufficient ? [`Only ${claims.length} usable claims were found for ${requestedCount} requested questions.`] : [])
    ]
  };
}

module.exports = {
  atomizeClaims,
  coverageReport,
  classifyClaim,
  cleanClaimSentence,
  extractSubject,
  readableSubjectLabel,
  questionSubjectLabel
};
