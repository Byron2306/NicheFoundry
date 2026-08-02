const { deterministicShuffle, normalizeWhitespace, normalizedText, tokens, stableId } = require('./text');
const { questionSubjectLabel } = require('./claims');

function ollamaClientConfig() {
  return {
    baseUrl: (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, ''),
    model: process.env.OLLAMA_MODEL || process.env.FOUNDRY_OLLAMA_DEFAULT_MODEL || 'qwen2.5:3b'
  };
}

function canUseOllama() {
  const { model } = ollamaClientConfig();
  return Boolean(normalizeWhitespace(model));
}

function semanticPolishEnabled() {
  const mode = String(process.env.FOUNDRY_GENERATOR_MODE || 'rules').toLowerCase();
  if (mode === 'ollama') return false;
  if (!canUseOllama()) return false;
  const setting = String(process.env.FOUNDRY_OLLAMA_POLISH || '1').toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(setting);
}

function semanticPolishLimit() {
  const parsed = Number(process.env.FOUNDRY_OLLAMA_POLISH_LIMIT || 1);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(Math.floor(parsed), 3);
}

function predicateFromClaim(claim) {
  const text = normalizeWhitespace(claim.claim).replace(/[.!?]$/, '');
  const subject = normalizeWhitespace(claim.subject || claim.source_title);
  const escaped = subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}\\s+`, 'i');
  const predicate = text.replace(pattern, '').trim().replace(/^(?:is|are|was|were)\s+/i, '');
  return predicate && predicate.length < text.length ? predicate : text;
}

function readableSubject(primary, brief) {
  const raw = normalizeWhitespace(primary.prompt_subject || primary.display_subject || primary.subject || primary.source_title || brief.topic || '');
  const cleaned = raw
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/[?.!,;:]+$/, '')
    .trim();
  if (!cleaned) return normalizeWhitespace(brief.topic || 'this topic');
  if (/^(it|they|them|these|those|this|there|here)$/i.test(cleaned)) return normalizeWhitespace(brief.topic || primary.source_title || 'this topic');
  if (cleaned.split(/\s+/).length > 5) return normalizeWhitespace(primary.source_title || brief.topic || cleaned);
  if (/^(in|while|because|although|besides|dynamic|occurrence)\b/i.test(cleaned)) return normalizeWhitespace(primary.source_title || brief.topic || cleaned);
  if (/\b([A-Z][A-Za-z0-9'-]+(?:\s+[A-Z][A-Za-z0-9'-]+){1,3})\s+\1\b/.test(cleaned)) return normalizeWhitespace(primary.source_title || brief.topic || cleaned);
  return cleaned;
}

function cleanOptionText(value) {
  const cleaned = normalizeWhitespace(String(value || ''))
    .replace(/^[a-z]/, (letter) => letter.toUpperCase())
    .replace(/[.;:]+$/, '');
  return cleaned;
}

function scoreQuestionText(question) {
  const text = normalizeWhitespace(question?.question || '');
  let score = 0;
  if (!text) score += 3;
  if (/\bsource-backed statement|retrieved evidence|appears in the research|matches the evidence concerning\b/i.test(text)) score += 2;
  if (/\b(?:In|While|Because|Besides)\b[^?]{12,}\?$/i.test(text)) score += 2;
  if (text.split(/\s+/).length > 14) score += 1;
  if (!/\?$/.test(text)) score += 1;
  if (/^Which\b/i.test(text)) score += 1;
  return score;
}

function scoreOptionText(option) {
  const text = normalizeWhitespace(option);
  let score = 0;
  if (!text) score += 3;
  if (text.split(/\s+/).length > 20) score += 1;
  if (/^(?:in|while|because|although|besides|including)\b/i.test(text)) score += 2;
  if (/[;:]\s*$/.test(text)) score += 1;
  if (!/[A-Za-z]/.test(text)) score += 2;
  return score;
}

function conciseSubject(primary, brief) {
  const subject = questionSubjectLabel(primary.prompt_subject || primary.display_subject || primary.subject, primary.source_title, brief) || readableSubject(primary, brief);
  const words = subject.split(/\s+/).filter(Boolean);
  if (words.length <= 3) return subject;
  return normalizeWhitespace(primary.source_title || brief.topic || subject);
}

function studioQuestionVoice(brief) {
  const studioId = String(brief?.studio_id || '');
  const archetypeId = String(brief?.archetype_id || '');
  if (studioId === 'puzzle_planet' || archetypeId === 'adventure_quiz') return 'playful';
  if (studioId === 'failure_atlas' || archetypeId === 'failure_chain') return 'causal';
  if (studioId === 'history_under_glass' || archetypeId === 'artifact_story') return 'historical';
  if (studioId === 'practical_open_source' || archetypeId === 'deep_dive') return 'practical';
  return 'neutral';
}

function subjectNounPhrase(subject) {
  const clean = normalizeWhitespace(subject);
  if (!clean) return 'this topic';
  if (/^(the|a|an)\b/i.test(clean)) return clean;
  return clean;
}

function prefersWhatForm(subject) {
  const clean = normalizeWhitespace(subject);
  if (!clean) return false;
  if (clean.split(/\s+/).length > 3) return false;
  if (/s$/i.test(clean) && !/ss$/i.test(clean)) return false;
  return /^[A-Z]/.test(clean);
}

function descriptiveStem(subject, voice, index, { allowWhatForm = true } = {}) {
  const noun = subjectNounPhrase(subject);
  if (allowWhatForm && prefersWhatForm(noun)) {
    const whatVariants = {
      playful: [`What is ${noun}?`, `Which answer best describes ${noun}?`],
      causal: [`What is ${noun}?`, `Which statement correctly describes ${noun}?`],
      historical: [`What is ${noun}?`, `Which statement best describes ${noun}?`],
      practical: [`What is ${noun}?`, `Which statement correctly describes ${noun}?`],
      neutral: [`What is ${noun}?`, `Which statement about ${noun} is correct?`]
    };
    const variants = whatVariants[voice] || whatVariants.neutral;
    return variants[index % variants.length];
  }
  const variantsByVoice = {
    playful: [
      `Mission clue: which statement about ${noun} is true?`,
      `Which fact helps explain ${noun}?`,
      `Which answer about ${noun} is correct?`
    ],
    causal: [
      `Which statement correctly describes ${noun}?`,
      `Which fact best explains ${noun}?`,
      `Which description of ${noun} is accurate?`
    ],
    historical: [
      `Which statement best describes ${noun}?`,
      `Which description of ${noun} fits the record?`,
      `Which fact about ${noun} is correct?`
    ],
    practical: [
      `Which statement correctly describes ${noun}?`,
      `Which fact about ${noun} is accurate?`,
      `Which explanation of ${noun} is right?`
    ],
    neutral: [
      `Which statement about ${noun} is correct?`,
      `Which fact about ${noun} is true?`,
      `What is true about ${noun}?`
    ]
  };
  const variants = variantsByVoice[voice] || variantsByVoice.neutral;
  return variants[index % variants.length];
}

function locationStem(subject, voice, index) {
  const noun = subjectNounPhrase(subject);
  const variantsByVoice = {
    playful: [
      `Where would the mission find ${noun}?`,
      `Which statement correctly tells where ${noun} is found?`,
      `Where does ${noun} belong?`
    ],
    causal: [
      `Which statement correctly identifies where ${noun} is found?`,
      `Where is ${noun} located according to the evidence?`,
      `Which location description of ${noun} is accurate?`
    ],
    historical: [
      `Which statement correctly places ${noun}?`,
      `Where does the record place ${noun}?`,
      `Which location for ${noun} is correct?`
    ],
    practical: [
      `Which statement correctly identifies where ${noun} is found?`,
      `Where would you expect to find ${noun}?`,
      `Which location statement about ${noun} is right?`
    ],
    neutral: [
      `Where is ${noun} found?`,
      `Which statement correctly identifies where ${noun} is found?`,
      `Which location for ${noun} is correct?`
    ]
  };
  const variants = variantsByVoice[voice] || variantsByVoice.neutral;
  return variants[index % variants.length];
}

function causalStem(subject, voice, index) {
  const noun = subjectNounPhrase(subject);
  const variantsByVoice = {
    playful: [
      `What caused ${noun}?`,
      `Which statement explains what led to ${noun}?`,
      `Which clue best explains why ${noun} happened?`
    ],
    causal: [
      `Which statement best explains what caused ${noun}?`,
      `What led to ${noun}?`,
      `Which explanation of ${noun} is accurate?`
    ],
    historical: [
      `Which statement best explains why ${noun} happened?`,
      `What does the record suggest led to ${noun}?`,
      `Which explanation for ${noun} is best supported?`
    ],
    practical: [
      `Which statement best explains what caused ${noun}?`,
      `What led to ${noun}?`,
      `Which explanation of ${noun} is correct?`
    ],
    neutral: [
      `What caused ${noun}?`,
      `Which statement best explains why ${noun} happened?`,
      `What led to ${noun}?`
    ]
  };
  const variants = variantsByVoice[voice] || variantsByVoice.neutral;
  return variants[index % variants.length];
}

function originStem(subject, voice, index) {
  const noun = subjectNounPhrase(subject);
  const variantsByVoice = {
    playful: [
      `How did ${noun} first begin?`,
      `Which statement tells how ${noun} started?`,
      `What is the best answer about how ${noun} began?`
    ],
    causal: [
      `Which statement correctly explains how ${noun} began?`,
      `How did ${noun} first appear?`,
      `Which origin statement about ${noun} is accurate?`
    ],
    historical: [
      `Which statement best explains how ${noun} began?`,
      `How did ${noun} first appear in the record?`,
      `Which origin for ${noun} is best supported?`
    ],
    practical: [
      `Which statement correctly explains how ${noun} began?`,
      `How did ${noun} first appear?`,
      `Which origin statement about ${noun} is correct?`
    ],
    neutral: [
      `How did ${noun} begin?`,
      `Which statement correctly explains how ${noun} began?`,
      `Which origin for ${noun} is correct?`
    ]
  };
  const variants = variantsByVoice[voice] || variantsByVoice.neutral;
  return variants[index % variants.length];
}

function quantityStem(subject, voice, index) {
  const noun = subjectNounPhrase(subject);
  if (prefersWhatForm(noun)) {
    const whatVariants = {
      playful: [`How many or when is ${noun}?`, `What is the right number or date for ${noun}?`],
      causal: [`What is the correct date or quantity for ${noun}?`, `What figure is correct for ${noun}?`],
      historical: [`What is the correct date or quantity for ${noun}?`, `What date or figure is best supported for ${noun}?`],
      practical: [`What is the correct date or quantity for ${noun}?`, `What figure is correct for ${noun}?`],
      neutral: [`What is the correct date or quantity for ${noun}?`, `What figure for ${noun} is correct?`]
    };
    const variants = whatVariants[voice] || whatVariants.neutral;
    return variants[index % variants.length];
  }
  const variantsByVoice = {
    playful: [
      `What is the correct number or date for ${noun}?`,
      `Which answer gives the right count or date for ${noun}?`,
      `Which fact gives the right figure for ${noun}?`
    ],
    causal: [
      `Which statement gives the correct date or quantity for ${noun}?`,
      `What is the correct figure for ${noun}?`,
      `Which number or date for ${noun} is accurate?`
    ],
    historical: [
      `Which statement gives the correct date or quantity for ${noun}?`,
      `What is the correct date or figure for ${noun}?`,
      `Which record about ${noun} has the right number or date?`
    ],
    practical: [
      `Which statement gives the correct date or quantity for ${noun}?`,
      `What is the correct figure for ${noun}?`,
      `Which number or date for ${noun} is correct?`
    ],
    neutral: [
      `What is the correct date or quantity for ${noun}?`,
      `Which statement gives the correct date or quantity for ${noun}?`,
      `Which figure for ${noun} is correct?`
    ]
  };
  const variants = variantsByVoice[voice] || variantsByVoice.neutral;
  return variants[index % variants.length];
}

function buildQuestionStem(primary, brief, index) {
  const subject = conciseSubject(primary, brief);
  const voice = studioQuestionVoice(brief);
  switch (primary.claim_type) {
    case 'location':
      return locationStem(subject, voice, index);
    case 'causal':
      return causalStem(subject, voice, index);
    case 'origin':
      return originStem(subject, voice, index);
    case 'date_or_quantity':
      return quantityStem(subject, voice, index);
    case 'description':
      return descriptiveStem(subject, voice, index);
    case 'fact':
      return descriptiveStem(subject, voice, index, { allowWhatForm: false });
    default:
      return descriptiveStem(subject, voice, index, { allowWhatForm: false });
  }
}

function genericReserveOptions(subject, claimType, voice) {
  const noun = subjectNounPhrase(subject);
  const common = [
    `${noun} is mainly a modern electronic device.`,
    `${noun} is a weather pattern found only over oceans.`,
    `${noun} is a contemporary traffic-management system.`
  ];
  const byType = {
    location: [
      `${noun} is found only in deep ocean trenches.`,
      `${noun} exists only in artificial satellites.`,
      `${noun} is located only at Earth's equator.`
    ],
    causal: [
      `${noun} happened for no identifiable reason.`,
      `${noun} was caused only by a change in weather.`,
      `${noun} occurred instantly without any contributing factors.`
    ],
    origin: [
      `${noun} began as a smartphone app.`,
      `${noun} first appeared in the twenty-first century.`,
      `${noun} started as a traffic rule.`
    ],
    date_or_quantity: [
      `${noun} is always measured as exactly one unit.`,
      `${noun} has no known date or measurable quantity.`,
      `${noun} is counted only in colors instead of numbers.`
    ],
    description: [
      `${noun} is a kind of atmospheric pressure system.`,
      `${noun} is used only as a musical instrument.`,
      `${noun} is a modern sports league.`
    ],
    fact: [
      `${noun} is a kind of atmospheric pressure system.`,
      `${noun} is used only as a musical instrument.`,
      `${noun} is a modern sports league.`
    ]
  };
  const voiceExtras = voice === 'playful'
    ? [`${noun} is a secret code used only by treasure hunters.`]
    : voice === 'historical'
      ? [`${noun} was invented by modern tourists for entertainment.`]
      : voice === 'practical'
        ? [`${noun} works only when connected to a phone app.`]
        : voice === 'causal'
          ? [`${noun} can be explained only by luck.`]
          : [];
  return [...(byType[claimType] || byType.fact), ...voiceExtras, ...common];
}

function needsSemanticPolish(question) {
  if (scoreQuestionText(question) > 0) return true;
  if ((question.options || []).some((option) => scoreOptionText(option) > 0)) return true;
  return false;
}

function usefulDistractorClaims(primary, claims) {
  const primaryTokens = new Set(tokens(primary.claim));
  return claims
    .filter((candidate) => candidate.claim_id !== primary.claim_id)
    .map((candidate) => {
      const candidateTokens = new Set(tokens(candidate.claim));
      let overlap = 0;
      for (const token of primaryTokens) if (candidateTokens.has(token)) overlap += 1;
      const sameType = candidate.claim_type === primary.claim_type ? 1 : 0;
      const differentSource = candidate.source_id !== primary.source_id ? 1 : 0;
      return { candidate, score: sameType * 2 + differentSource + Math.min(overlap, 3) * 0.25 };
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.candidate);
}

function buildQuestion(primary, claims, index, brief) {
  const distractorClaims = usefulDistractorClaims(primary, claims).slice(0, 12);
  const subject = conciseSubject(primary, brief);
  const stem = buildQuestionStem(primary, brief, index);
  const correct = cleanOptionText(primary.claim);
  const distractors = distractorClaims
    .map((claim) => cleanOptionText(claim.claim))
    .filter((value) => value && normalizedText(value) !== normalizedText(correct));

  const genericReserve = genericReserveOptions(subject, primary.claim_type, studioQuestionVoice(brief));
  const unique = [];
  for (const option of [...distractors, ...genericReserve]) {
    const clean = normalizeWhitespace(option);
    if (!clean || normalizedText(clean) === normalizedText(correct)) continue;
    if (unique.some((existing) => normalizedText(existing) === normalizedText(clean))) continue;
    unique.push(clean);
    if (unique.length === 3) break;
  }

  const optionObjects = [
    { text: correct, correct: true },
    ...unique.map((text) => ({ text, correct: false }))
  ];
  const shuffled = deterministicShuffle(optionObjects, `${brief.working_title}|${primary.claim_id}|${index}`);
  const correctIndex = shuffled.findIndex((item) => item.correct);
  return {
    question_id: `Q${index + 1}`,
    question_uid: stableId('qst', `${brief.working_title}|${primary.claim_id}|${stem}`),
    question: stem,
    options: shuffled.map((item) => item.text),
    correct_option_index: correctIndex,
    answer: shuffled[correctIndex].text,
    explanation: cleanOptionText(primary.claim),
    source_ids: [primary.source_id],
    source_urls: [primary.source_url],
    claim_ids: [primary.claim_id],
    citation_spans: [{
      source_id: primary.source_id,
      claim_id: primary.claim_id,
      passage: primary.supporting_passage,
      passage_start: primary.passage_start,
      passage_end: primary.passage_end,
      revision_id: primary.source_revision_id
    }],
    difficulty: index < Math.ceil(Number(brief.question_count || 6) / 3) ? 'easy' : index < Math.ceil(Number(brief.question_count || 6) * 2 / 3) ? 'medium' : 'hard',
    generation_method: 'claim_bound_rules_v1'
  };
}

function generateRuleQuestions(brief, claims) {
  const count = Number(brief.question_count) || 6;
  const selected = [];
  const sourceCounts = new Map();
  const sorted = [...claims].sort((a, b) => b.confidence - a.confidence);
  while (selected.length < count && sorted.length) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    sorted.forEach((claim, index) => {
      const used = sourceCounts.get(claim.source_id) || 0;
      const diversityBonus = used === 0 ? 0.25 : -used * 0.08;
      const typeBonus = selected.some((item) => item.claim_type === claim.claim_type) ? 0 : 0.08;
      const score = claim.confidence + diversityBonus + typeBonus;
      if (score > bestScore) { bestScore = score; bestIndex = index; }
    });
    const [claim] = sorted.splice(bestIndex, 1);
    selected.push(claim);
    sourceCounts.set(claim.source_id, (sourceCounts.get(claim.source_id) || 0) + 1);
  }
  return selected.map((claim, index) => buildQuestion(claim, claims, index, brief));
}

function ollamaSchema(count) {
  return {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        minItems: count,
        maxItems: count,
        items: {
          type: 'object',
          properties: {
            claim_id: { type: 'string' },
            question: { type: 'string' },
            options: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string' } },
            correct_option_index: { type: 'integer', minimum: 0, maximum: 3 },
            explanation: { type: 'string' }
          },
          required: ['claim_id', 'question', 'options', 'correct_option_index', 'explanation']
        }
      }
    },
    required: ['questions']
  };
}

function ollamaPolishSchema(count) {
  return {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        minItems: count,
        maxItems: count,
        items: {
          type: 'object',
          properties: {
            question_id: { type: 'string' },
            question: { type: 'string' },
            options: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string' } },
            correct_option_index: { type: 'integer', minimum: 0, maximum: 3 },
            explanation: { type: 'string' }
          },
          required: ['question_id', 'question', 'options', 'correct_option_index', 'explanation']
        }
      }
    },
    required: ['questions']
  };
}

async function callOllama({ schema, prompt, temperature = 0 }) {
  const { baseUrl, model } = ollamaClientConfig();
  if (!model) throw new Error('OLLAMA_MODEL is required for Ollama generation.');
  const timeoutMs = Math.max(5000, Number(process.env.FOUNDRY_OLLAMA_TIMEOUT_MS || 12000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Ollama request timed out after ${timeoutMs}ms.`)), timeoutMs);
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
    body: JSON.stringify({
      model,
      stream: false,
      format: schema,
      options: { temperature },
      messages: [{ role: 'user', content: prompt }]
    })
  }).finally(() => clearTimeout(timer));
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
  const data = await response.json();
  return JSON.parse(data?.message?.content || '{}');
}

async function callOllamaGenerate({ prompt, temperature = 0.2 }) {
  const { baseUrl, model } = ollamaClientConfig();
  if (!model) throw new Error('OLLAMA_MODEL is required for Ollama generation.');
  const timeoutMs = Math.max(5000, Number(process.env.FOUNDRY_OLLAMA_TIMEOUT_MS || 12000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Ollama request timed out after ${timeoutMs}ms.`)), timeoutMs);
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature }
    })
  }).finally(() => clearTimeout(timer));
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
  const data = await response.json();
  return normalizeWhitespace(data?.response || '');
}

function sanitizePolishedLine(value, fallback) {
  const cleaned = normalizeWhitespace(String(value || ''))
    .replace(/^["'`\s]+|["'`\s]+$/g, '')
    .replace(/^[A-Za-z ]+:\s*/, '')
    .trim();
  return cleaned || fallback;
}

function normalizedTokenString(value) {
  return normalizedText(value).split(' ').filter(Boolean);
}

function overlapRatio(left, right) {
  const a = normalizedTokenString(left);
  const b = new Set(normalizedTokenString(right));
  if (!a.length || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / a.length;
}

function isUsablePolishedQuestion(question, rewritten) {
  const text = normalizeWhitespace(rewritten);
  if (!text) return false;
  if (!text.endsWith('?')) return false;
  if (text.split(/\s+/).length < 4) return false;
  if (/research|evidence|source|workflow|youtube/i.test(text)) return false;
  if (overlapRatio(text, question.answer) > 0.45) return false;
  if (overlapRatio(text, question.explanation) > 0.45) return false;
  return true;
}

async function polishQuestionLineWithOllama(question, claim, brief) {
  const prompt = [
    'Rewrite this kids quiz question in simpler natural English.',
    `Topic: ${brief.topic}`,
    `Fact behind the correct answer: ${claim?.claim || question.answer}`,
    `Current question: ${question.question}`,
    'Rules: ask a real question, do not reveal the answer words inside the question, one sentence only, keep the meaning, do not mention research, evidence, sources, workflow, or YouTube.',
    'Return only the rewritten question.'
  ].join('\n');
  const rewritten = sanitizePolishedLine(
    await callOllamaGenerate({ prompt, temperature: 0.1 }),
    question.question
  );
  return isUsablePolishedQuestion(question, rewritten) ? rewritten : question.question;
}

async function generateOllamaQuestions(brief, claims) {
  const { model } = ollamaClientConfig();
  if (!model) throw new Error('OLLAMA_MODEL is required for Ollama question generation.');
  const count = Number(brief.question_count) || 6;
  const compactClaims = claims.slice(0, Math.max(count * 3, 18)).map((claim) => ({
    claim_id: claim.claim_id,
    source_title: claim.source_title,
    subject: claim.subject,
    claim: claim.claim
  }));
  const schema = ollamaSchema(count);
  const prompt = [
    `Create exactly ${count} age-appropriate multiple-choice questions for ages ${brief.age_band} about ${brief.topic}.`,
    'Every question must be answerable from exactly one supplied claim. Never ask about sources, production, approval, videos, prompts, citations, or workflow.',
    'Use four distinct options and one unambiguous correct answer. Return only data matching the supplied JSON schema.',
    `Claims: ${JSON.stringify(compactClaims)}`,
    `Schema: ${JSON.stringify(schema)}`
  ].join('\n\n');
  const parsed = await callOllama({ schema, prompt, temperature: 0 });
  const claimMap = new Map(claims.map((claim) => [claim.claim_id, claim]));
  if (!Array.isArray(parsed.questions) || parsed.questions.length !== count) throw new Error('Ollama returned an invalid question count.');
  return parsed.questions.map((question, index) => {
    const claim = claimMap.get(question.claim_id);
    if (!claim) throw new Error(`Ollama referenced unknown claim ${question.claim_id}.`);
    const options = question.options.map(normalizeWhitespace);
    const correctIndex = Number(question.correct_option_index);
    return {
      question_id: `Q${index + 1}`,
      question_uid: stableId('qst', `${brief.working_title}|${claim.claim_id}|${question.question}`),
      question: normalizeWhitespace(question.question),
      options,
      correct_option_index: correctIndex,
      answer: options[correctIndex],
      explanation: normalizeWhitespace(question.explanation || claim.claim),
      source_ids: [claim.source_id],
      source_urls: [claim.source_url],
      claim_ids: [claim.claim_id],
      citation_spans: [{ source_id: claim.source_id, claim_id: claim.claim_id, passage: claim.supporting_passage, passage_start: claim.passage_start, passage_end: claim.passage_end, revision_id: claim.source_revision_id }],
      difficulty: index < Math.ceil(count / 3) ? 'easy' : index < Math.ceil(count * 2 / 3) ? 'medium' : 'hard',
      generation_method: `ollama:${model}`
    };
  });
}

async function polishQuestionsWithOllama(brief, claims, questions) {
  const candidates = questions.filter((question) => needsSemanticPolish(question)).slice(0, semanticPolishLimit());
  if (!candidates.length) {
    return { questions, polished: 0, skipped: questions.length };
  }

  const claimMap = new Map(claims.map((claim) => [claim.claim_id, claim]));
  const replacements = new Map();
  for (const question of candidates) {
    const claim = claimMap.get(question.claim_ids?.[0]);
    const rewritten = await polishQuestionLineWithOllama(question, claim, brief);
    replacements.set(question.question_id, rewritten);
  }
  const polished = questions.map((question) => {
    const rewritten = replacements.get(question.question_id);
    if (!rewritten) return question;
    return {
      ...question,
      question: rewritten,
      generation_method: `${question.generation_method}+semantic_polish:${ollamaClientConfig().model}`
    };
  });

  return { questions: polished, polished: candidates.length, skipped: questions.length - candidates.length };
}

async function generateQuestions(brief, claims) {
  const requestedMode = String(process.env.FOUNDRY_GENERATOR_MODE || 'rules').toLowerCase();
  if (requestedMode === 'ollama') {
    try {
      return { questions: await generateOllamaQuestions(brief, claims), mode: `ollama:${process.env.OLLAMA_MODEL}` };
    } catch (error) {
      if (process.env.FOUNDRY_OLLAMA_STRICT === '1') throw error;
      return { questions: generateRuleQuestions(brief, claims), mode: 'claim_bound_rules_v1', fallback_error: error.message };
    }
  }
  const ruleQuestions = generateRuleQuestions(brief, claims);
  if (!semanticPolishEnabled()) return { questions: ruleQuestions, mode: 'claim_bound_rules_v1' };
  try {
    const polished = await polishQuestionsWithOllama(brief, claims, ruleQuestions);
    return {
      questions: polished.questions,
      mode: `claim_bound_rules_v1+semantic_polish:${ollamaClientConfig().model}`,
      polish_report: { polished: polished.polished, skipped: polished.skipped }
    };
  } catch (error) {
    if (process.env.FOUNDRY_OLLAMA_STRICT === '1') throw error;
    return {
      questions: ruleQuestions,
      mode: 'claim_bound_rules_v1',
      fallback_error: error.message
    };
  }
}

module.exports = {
  generateQuestions,
  generateRuleQuestions,
  generateOllamaQuestions,
  predicateFromClaim,
  callOllama,
  callOllamaGenerate,
  canUseOllama,
  ollamaClientConfig
};
