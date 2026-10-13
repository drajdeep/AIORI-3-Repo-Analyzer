// AI evaluation layer. Calls free-tier LLM APIs directly from the browser.
// API keys live only in the evaluator's own browser (localStorage) and are sent
// only to the chosen provider. Nothing is stored in the repository.
import { PROBLEM_STATEMENTS, RUBRIC, psById, gradeFor } from './ps.js';

export const PROVIDERS = {
  gemini: {
    label: 'Google Gemini — free tier (recommended, 1M-token context)',
    needsKey: true, defaultModel: 'auto', budget: 400_000,
    keyUrl: 'https://aistudio.google.com/app/apikey',
  },
  groq: {
    label: 'Groq — free tier (very fast, small context)',
    needsKey: true, defaultModel: 'auto', budget: 16_000,
    keyUrl: 'https://console.groq.com/keys',
  },
  openrouter: {
    label: 'OpenRouter — free models',
    needsKey: true, defaultModel: 'auto', budget: 90_000,
    keyUrl: 'https://openrouter.ai/keys',
  },
  pollinations: {
    label: 'Pollinations — no key (best-effort, experimental)',
    needsKey: false, defaultModel: 'openai', budget: 28_000,
  },
  none: { label: 'None — static analysis only', needsKey: false },
};

const SKEY = 'aiori3.settings.v1';

export function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SKEY) || '{}'); } catch { /* ignore */ }
  return {
    provider: s.provider || 'gemini',
    keys: s.keys || {},
    models: s.models || {},
    budget: s.budget || null,
    githubToken: s.githubToken || '',
    temperature: s.temperature ?? 0.2,
  };
}

export function saveSettings(s) {
  try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function activeEngine(s) {
  const p = PROVIDERS[s.provider];
  if (!p || s.provider === 'none') return null;
  if (p.needsKey && !s.keys[s.provider]) return null;
  return { id: s.provider, model: s.models[s.provider] || p.defaultModel, budget: s.budget || p.budget, label: p.label };
}

// ------------------------------------------------------------------ transport

async function readError(res) {
  let msg = `${res.status} ${res.statusText}`;
  try {
    const j = await res.json();
    msg = j.error?.message || j.error?.metadata?.raw || j.message || msg;
  } catch { /* ignore */ }
  if (res.status === 429) msg = `Rate limit / quota reached at the provider: ${msg}`;
  if (res.status === 401 || res.status === 403) msg = `API key rejected: ${msg}`;
  if (res.status === 413) msg = `Request too large for this provider/model. Lower the context budget in Settings. (${msg})`;
  return msg;
}

// ------------------------------------------------------------------ model discovery
// Free model line-ups change often, so the tool asks each provider which models
// the key can use instead of relying on hard-coded names.

const modelCache = new Map();

const paramsB = (id) => {
  const m = String(id).toLowerCase().match(/(\d+(?:\.\d+)?)x?(\d+)?b\b/);
  if (!m) return 0;
  return m[2] ? Number(m[1]) * Number(m[2]) : Number(m[1]);
};

function rankModel(provider, m) {
  const id = m.id.toLowerCase();
  if (provider === 'gemini') {
    const v = Number((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
    let tier = /-flash$|-flash-\d{3}$|^gemini-flash-latest$/.test(id) ? 3 : /-flash-lite/.test(id) ? 2 : /-pro/.test(id) ? 1 : 0;
    if (/preview|exp|thinking/.test(id)) tier -= 1.5;
    return tier * 100 + v;
  }
  let score = Math.min(paramsB(id), 700) / 10;
  if (/gpt-oss-120b|llama-4|maverick|qwen3|deepseek|kimi|glm|mistral-large|nemotron|70b|120b|235b/.test(id)) score += 20;
  if (/instant|mini|nano|small|1b|3b|8b|guard|vision|coder/.test(id)) score -= 15;
  score += Math.min((m.ctx || 0) / 32000, 8);
  return score;
}

export async function listModels(provider, key) {
  const ck = `${provider}:${key || ''}`;
  if (modelCache.has(ck)) return modelCache.get(ck);
  let out = [];
  if (provider === 'gemini') {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error(`Gemini: ${await readError(res)}`);
    const j = await res.json();
    out = (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), ctx: m.inputTokenLimit || 0, label: m.displayName }))
      .filter((m) => /^gemini/.test(m.id) && !/(embedding|aqa|image|imagen|veo|tts|audio|live|native|robotics|computer-use|learnlm|gemma)/.test(m.id));
  } else if (provider === 'groq') {
    const res = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`groq: ${await readError(res)}`);
    const j = await res.json();
    out = (j.data || [])
      .filter((m) => m.active !== false && !/(whisper|tts|guard|playai|orpheus|distil|safeguard|compound|allam)/i.test(m.id))
      .map((m) => ({ id: m.id, ctx: m.context_window || 0 }));
  } else if (provider === 'openrouter') {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    if (!res.ok) throw new Error(`openrouter: ${await readError(res)}`);
    const j = await res.json();
    out = (j.data || [])
      .filter((m) => /:free$/.test(m.id) || (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0))
      .filter((m) => !/(vision|image|audio|tts|guard)/i.test(m.id) && (m.architecture?.output_modalities || ['text']).includes('text'))
      .map((m) => ({ id: m.id, ctx: m.context_length || 0 }));
  } else {
    return [];
  }
  out.sort((a, b) => rankModel(provider, b) - rankModel(provider, a));
  modelCache.set(ck, out);
  return out;
}

async function pickModel(provider, key, { errMsg = '', exclude = new Set() } = {}) {
  if (provider === 'gemini') {
    const named = String(errMsg).match(/use\s+(?:models\/)?(gemini-[\w.-]+?)[.,;]?(?:\s|$)/i);
    if (named && !exclude.has(named[1])) return named[1];
  }
  try {
    const list = await listModels(provider, key);
    const m = list.find((x) => !exclude.has(x.id));
    return m ? m.id : null;
  } catch { return null; }
}

// ------------------------------------------------------------------ transport

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Cancelled.')); }, { once: true });
});

function classify(status, msg) {
  const m = String(msg).toLowerCase();
  if (status === 413 || /too large|context length|context_length|maximum context|reduce the length|tokens per minute|\btpm\b|request_too_large/.test(m)) return 'size';
  if (status === 404 || /does not exist|no longer available|not found|decommissioned|deprecated|retired|is not supported|not a valid model|invalid model|model_not_found|no endpoints found|do not have access to it/.test(m)) return 'retired';
  if ([500, 502, 503, 504, 529].includes(status) || /overloaded|high demand|unavailable|try again later|temporarily|capacity/.test(m)) return 'busy';
  if (status === 429) return 'rate';
  if (status === 401 || status === 403) return 'auth';
  return 'other';
}

function retryDelaySec(msg, res) {
  const h = Number(res?.headers?.get?.('retry-after'));
  if (h) return h;
  const m = String(msg).match(/(?:retry in|try again in|retrydelay["']?:\s*["']?)\s*(\d+(?:\.\d+)?)\s*(ms|s)?/i);
  if (!m) return null;
  return m[2] === 'ms' ? Number(m[1]) / 1000 : Number(m[1]);
}

async function sendOnce(provider, model, key, messages, { json, maxTokens, temperature, signal }) {
  if (provider === 'gemini') {
    const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const contents = messages.filter((m) => m.role !== 'system').map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }],
    }));
    const body = {
      contents,
      generationConfig: { temperature, maxOutputTokens: Math.max(maxTokens, 16384), ...(json ? { responseMimeType: 'application/json' } : {}) },
    };
    if (sys) body.systemInstruction = { parts: [{ text: sys }] };
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
    });
    if (!res.ok) return { res, error: await readError(res) };
    const j = await res.json();
    const cand = j.candidates?.[0];
    const text = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
    if (!text) return { res, error: `returned no content (${cand?.finishReason || j.promptFeedback?.blockReason || 'unknown reason'})`, empty: true };
    return { text };
  }
  const endpoints = {
    groq: 'https://api.groq.com/openai/v1/chat/completions',
    openrouter: 'https://openrouter.ai/api/v1/chat/completions',
    pollinations: 'https://text.pollinations.ai/openai',
  };
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = location.origin;
    headers['X-Title'] = 'AIORI-3 Repository Analyser';
  }
  const body = { model, messages, temperature, max_tokens: provider === 'groq' ? Math.min(maxTokens, 4096) : maxTokens };
  if (json && provider === 'groq') body.response_format = { type: 'json_object' };
  const res = await fetch(endpoints[provider], { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok) return { res, error: await readError(res) };
  const j = await res.json();
  if (j.error) return { res: { status: j.error.code || 500 }, error: j.error.message || 'provider error' };
  const text = j.choices?.[0]?.message?.content;
  if (!text) return { res, error: 'returned an empty response', empty: true };
  return { text };
}

const NAMES = { gemini: 'Gemini', groq: 'Groq', openrouter: 'OpenRouter', pollinations: 'Pollinations' };

/**
 * messages: [{role:'system'|'user'|'assistant', content}]
 * Resilient call: resolves "auto" models, retries busy providers with back-off,
 * swaps retired models for a current one (and remembers it), and falls back to
 * another model when one is overloaded or rate-limited.
 */
export async function callLLM(settings, messages, { json = false, maxTokens = 8192, signal, onNote = () => {} } = {}) {
  const eng = activeEngine(settings);
  if (!eng) throw new Error('No AI engine configured. Open Settings and add a free API key.');
  const provider = eng.id;
  const key = settings.keys[provider];
  const temperature = Number(settings.temperature ?? 0.2);
  const name = NAMES[provider] || provider;
  const remember = (m) => {
    settings.models = { ...settings.models, [provider]: m };
    if (settings.persist !== false) saveSettings(settings);
  };

  let model = eng.model;
  if (!model || model === 'auto') {
    onNote(`Finding the best available ${name} model`);
    model = await pickModel(provider, key);
    if (!model) throw new Error(`${name}: could not list available models — check the API key.`);
    remember(model);
  }

  const tried = new Set();
  const log = [];
  let busyRetries = 0;
  let rateRetries = 0;
  for (let attempt = 0; attempt < 7; attempt++) {
    const r = await sendOnce(provider, model, key, messages, { json, maxTokens, temperature, signal });
    if (r.text) {
      settings.lastModel = model;
      if (log.length) console.info(`[${name}] ${log.join(' → ')} → OK with ${model}`);
      return r.text;
    }
    const kind = r.empty ? 'busy' : classify(r.res?.status, r.error);
    log.push(`${model}: ${kind}`);

    if (kind === 'retired') {
      tried.add(model);
      const next = await pickModel(provider, key, { errMsg: r.error, exclude: tried });
      if (!next) throw new Error(`${name}: model "${model}" is unavailable and no replacement was found. (${r.error})`);
      onNote(`${model} is no longer available — switching to ${next}`);
      model = next;
      remember(next);
      continue;
    }
    if (kind === 'busy' || kind === 'rate') {
      const wait = kind === 'rate' ? retryDelaySec(r.error, r.res) : (busyRetries + 1) * 4;
      const canWait = kind === 'busy' ? busyRetries < 2 : rateRetries < 1 && wait != null && wait <= 25;
      if (canWait) {
        if (kind === 'busy') busyRetries++; else rateRetries++;
        onNote(`${name} ${kind === 'busy' ? 'is busy' : 'rate limit'} — retrying ${model} in ${Math.ceil(wait)}s`);
        await sleep(Math.ceil(wait) * 1000, signal);
        continue;
      }
      tried.add(model);
      const next = await pickModel(provider, key, { exclude: tried });
      if (next) {
        onNote(`${model} ${kind === 'busy' ? 'is overloaded' : 'is rate-limited'} — trying ${next}`);
        model = next;
        busyRetries = 0;
        rateRetries = 0;
        continue;
      }
      throw new Error(`${name}: ${kind === 'busy' ? 'all available models are currently overloaded' : 'free-tier rate limit reached'} — wait a minute and retry, or switch provider in Settings. (${r.error})`);
    }
    const err = new Error(`${name}: ${r.error}`);
    err.kind = kind;
    throw err;
  }
  throw new Error(`${name}: gave up after several attempts (${log.join('; ')}).`);
}

export function parseJsonLoose(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a === -1 || b === -1) throw new Error('No JSON object in model output.');
  t = t.slice(a, b + 1);
  try { return JSON.parse(t); } catch {
    return JSON.parse(t.replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' '));
  }
}

// ------------------------------------------------------------------ context

export function buildContext(ing, heur, budget) {
  const r = ing.repo;
  const cm = heur.commits;
  const parts = [];
  parts.push([
    '# Repository metadata',
    `- Repository: ${r.fullName} (${r.url})`,
    `- Branch / commit analysed: ${ing.branch} @ ${String(ing.commitSha).slice(0, 10)}`,
    `- Description: ${r.description || '(none)'}`,
    `- Topics: ${r.topics.join(', ') || '(none)'}`,
    `- Created: ${r.createdAt}; last push: ${r.pushedAt}; fork: ${r.isFork ? `yes (${r.parent})` : 'no'}`,
    `- Languages (bytes): ${heur.languages.map((l) => `${l.name} ${l.pct.toFixed(1)}%`).join(', ') || 'n/a'}`,
    `- Files: ${ing.stats.fileCount} total, ${ing.stats.fetchedFiles} text files read; ${heur.loc} non-blank source lines`,
    `- Commits: ${cm.total} total; ${cm.activeDays} active days between ${cm.first ? cm.first.toISOString().slice(0, 10) : '?'} and ${cm.last ? cm.last.toISOString().slice(0, 10) : '?'}; authors: ${Object.entries(cm.authors).map(([a, n]) => `${a} (${n})`).join(', ') || 'n/a'}`,
    `- Contributors: ${ing.contributors.map((c) => `${c.login} (${c.contributions})`).join(', ') || 'n/a'}`,
    `- Presentation PDFs (teams must commit their slides as PDF): ${ing.media?.pdfs.length ? ing.media.pdfs.map((p) => `${p.path}${p.pages ? ` (${p.pages} pages)` : ''}`).join(', ') : 'NONE FOUND'}${ing.media?.decks.length ? `; non-PDF decks: ${ing.media.decks.map((d) => d.path).join(', ')}` : ''}`,
    `- Demo video links (teams must share a YouTube demo; you cannot watch it): ${ing.media?.videos.length ? ing.media.videos.map((v) => `${v.url} [in ${v.sources.map((x) => (x.page ? `${x.file} p.${x.page}` : x.file)).join(', ')}]`).join('; ') : 'NONE FOUND'}`,
  ].join('\n'));
  parts.push(`# Automated static checks (deterministic)\n${heur.checks.map((c) => `- [${c.status.toUpperCase()}] ${c.label}: ${c.detail}`).join('\n')}`);
  parts.push(`# Recent commit messages (newest first)\n${ing.commits.slice(0, 40).map((c) => `- ${String(c.date).slice(0, 10)} ${c.author}: ${c.message}`).join('\n') || '(none)'}`);

  let tree = ing.tree;
  const treeCap = Math.floor(budget * 0.12);
  if (tree.length > treeCap) tree = `${tree.slice(0, treeCap)}\n... [directory tree truncated]`;
  parts.push(`# Directory structure\n${tree}`);

  let used = parts.join('\n\n').length + 200;
  const perFile = Math.max(2500, Math.min(16000, Math.floor(budget / 8)));
  const blocks = [];
  const included = [];
  const omitted = [];
  for (const f of ing.files) {
    const isRootReadme = /^readme(\.|$)/i.test(f.path);
    const cap = isRootReadme ? Math.max(perFile, Math.floor(budget * 0.2)) : perFile;
    let c = f.content;
    let note = '';
    if (c.length > cap) { note = `\n... [truncated: ${(c.length - cap).toLocaleString()} more characters]`; c = c.slice(0, cap); }
    const block = `================================================\nFILE: ${f.path}\n================================================\n${c}${note}\n`;
    if (used + block.length > budget) { omitted.push(f.path); continue; }
    blocks.push(block);
    included.push(f.path);
    used += block.length;
  }
  parts.push(`# File contents (priority order: docs → manifests → entry points → source → tests → data)\n${blocks.join('\n')}`);
  if (omitted.length) parts.push(`# Files NOT shown due to context budget (${omitted.length})\n${omitted.slice(0, 250).join('\n')}${omitted.length > 250 ? '\n...' : ''}`);
  const skippedNote = ing.skipped.filter((s) => !/excluded directory/.test(s.reason));
  if (skippedNote.length) parts.push(`# Non-text or skipped files (${skippedNote.length}, names only)\n${skippedNote.slice(0, 150).map((s) => `${s.path} — ${s.reason}`).join('\n')}`);
  return { text: parts.join('\n\n'), included, omitted };
}

// ------------------------------------------------------------------ evaluation

const SYSTEM_PROMPT = `You are a senior technical evaluator on the jury of AIORI-3, a research-oriented Internet / networking / cybersecurity hackathon in India (Advanced Internet Operations Research in India). Your audience is mentors and evaluators who need a rigorous, fair, evidence-based assessment of a participant's GitHub repository.

Principles:
- Judge what is IMPLEMENTED in code, not what the README claims. Explicitly distinguish claims from evidence.
- Cite concrete file paths (and function/class names where useful) for every important judgement.
- Respect hackathon scale: a focused, working, well-measured prototype beats a sprawling unfinished one.
- Research rigour matters: baselines, metrics, datasets, methodology, measured results and reproducibility.
- For security/measurement problems, check that work stays within authorised scope / controlled lab conditions and handles personal data responsibly.
- Flag signs of boilerplate, tutorial copies, placeholder/mock implementations, hard-coded results, or unrelated projects re-labelled for this problem.
- Be calibrated: 0–2 absent, 3–4 weak, 5–6 adequate, 7–8 strong, 9–10 exceptional. Do not inflate.
- Slide text extracted from the team's presentation PDF is included as a FILE block; use it to understand claims and results, but verify them against the code.
- Treat a missing presentation PDF or missing demo-video link as a documentation gap (the hackathon requires both).
- If part of the repository was not visible to you (context budget), say so instead of assuming.
- Output ONLY a single valid JSON object exactly matching the requested schema. No markdown fences, no commentary.`;

function schemaText() {
  const scores = RUBRIC.map((c) => `    "${c.key}": {"score": <0-10 number>, "justification": "<2-4 sentences citing files>"}`).join(',\n');
  return `{
  "detected_problem_statement": {"id": "<PS-0XX or NONE>", "title": "<title>", "confidence": <0-100>, "rationale": "<why>"},
  "alignment_verdict": "<strong | partial | weak | mismatch>",
  "executive_summary": "<5-7 sentence assessment for the jury>",
  "what_it_does": "<plain description of what the code actually implements>",
  "architecture": "<components, data flow, key modules with file paths>",
  "tech_stack": ["<language/framework/tool>", "..."],
  "scores": {
${scores}
  },
  "deliverables": [{"item": "<expected deliverable derived from the problem statement>", "status": "<present | partial | missing>", "evidence": "<file paths or reason>"}],
  "strengths": ["<specific strength>", "..."],
  "weaknesses": ["<specific weakness>", "..."],
  "red_flags": ["<integrity / plagiarism / safety / mock-implementation concerns; empty array if none>"],
  "claims_vs_evidence": [{"claim": "<claim from README/docs>", "verified": "<yes | partial | no>", "evidence": "<file paths or reason>"}],
  "reproducibility": {"rating": "<high | medium | low>", "notes": "<can an evaluator run it? what is missing?>"},
  "questions_for_team": ["<probing viva question for the demo/presentation>", "..."],
  "recommendations": ["<concrete improvement>", "..."],
  "one_line_verdict": "<single sentence>"
}`;
}

function rubricText() {
  return RUBRIC.map((c) => `- ${c.key} — ${c.label} (weight ${c.weight}%): ${c.desc}`).join('\n');
}

export async function evaluateRepo({ ing, heur, psId, settings, signal, onStage = () => {} }) {
  const eng = activeEngine(settings);
  const ps = psId && psId !== 'auto' ? psById(psId) : null;

  let psSection;
  if (ps) {
    psSection = `# Problem statement selected by the evaluator\n${ps.id} — ${ps.title} [${ps.domain}]\nScope: ${ps.scope}\n\n` +
      'Evaluate the repository against THIS problem statement. Still report in detected_problem_statement which statement the work actually matches best (it may differ), and set alignment_verdict accordingly.';
  } else {
    const top = heur.psRanking.slice(0, 6).map((r) => `${r.id} (keyword score ${r.score}; hits: ${r.hits.slice(0, 6).map((h) => h.kw).join(', ')})`).join('; ');
    psSection = `# Problem statement: NOT specified — detect it\nIdentify which AIORI-3 problem statement this repository addresses and evaluate against it. If none fits, use "NONE" and score alignment low.\nKeyword pre-ranking (heuristic hint only): ${top}\n\nAll problem statements:\n${PROBLEM_STATEMENTS.map((p) => `- ${p.id} [${p.domain}] ${p.title}: ${p.scope}`).join('\n')}`;
  }

  const build = (budget) => {
    const ctx = buildContext(ing, heur, budget);
    const user = `${psSection}

# Evaluation rubric (score every criterion 0–10)
${rubricText()}

# Required output — one JSON object with exactly this shape
${schemaText()}

Guidance: list 5–8 deliverables derived from the problem statement scope; 4–8 strengths and weaknesses; 5–8 viva questions; 4–8 recommendations; up to 6 claims_vs_evidence rows.

# REPOSITORY CONTEXT (gitingest-style digest; ${ctx.included.length} files shown, ${ctx.omitted.length} omitted for budget)
${ctx.text}`;
    return { ctx, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: user }] };
  };

  let budget = eng.budget;
  let built = build(budget);
  let raw;
  for (let shrink = 0; ; shrink++) {
    onStage(`Sending ~${Math.round(built.messages[1].content.length / 4 / 1000)}k tokens to ${settings.models[eng.id] && settings.models[eng.id] !== 'auto' ? settings.models[eng.id] : eng.id}`);
    try {
      raw = await callLLM(settings, built.messages, { json: true, signal, onNote: onStage });
      break;
    } catch (e) {
      if (e.kind !== 'size' || shrink >= 2 || budget < 8000) throw e;
      budget = Math.floor(budget * 0.5);
      onStage(`Request too large for this model — retrying with a smaller context (${Math.round(budget / 1000)}k chars)`);
      built = build(budget);
    }
  }
  let data;
  try {
    data = parseJsonLoose(raw);
  } catch {
    onStage('Repairing malformed AI output');
    raw = await callLLM(settings, [
      { role: 'system', content: 'You convert text into strictly valid JSON. Output only the JSON object.' },
      { role: 'user', content: `Fix this into valid JSON matching the intended schema, preserving content:\n\n${raw.slice(0, 60000)}` },
    ], { json: true, signal, onNote: onStage });
    data = parseJsonLoose(raw);
  }
  const ctx = built.ctx;
  return { ...normaliseEvaluation(data), engine: { provider: eng.id, model: settings.lastModel || eng.model }, contextStats: { included: ctx.included.length, omitted: ctx.omitted.length, chars: ctx.text.length }, contextText: ctx.text };
}

const arr = (x) => (Array.isArray(x) ? x.filter((v) => v != null && v !== '') : x ? [x] : []);
const str = (x) => (x == null ? '' : typeof x === 'string' ? x : JSON.stringify(x));

export function normaliseEvaluation(d) {
  const scores = {};
  let overall = 0;
  for (const c of RUBRIC) {
    const s = d.scores?.[c.key] ?? (Array.isArray(d.scores) ? d.scores.find((x) => x.key === c.key || x.criterion === c.label) : null);
    let v = Number(typeof s === 'object' ? s?.score : s);
    if (isNaN(v)) v = 0;
    v = Math.max(0, Math.min(10, v));
    scores[c.key] = { score: v, justification: str(s?.justification) };
    overall += (v / 10) * c.weight;
  }
  overall = Math.round(overall * 10) / 10;
  const dps = d.detected_problem_statement || {};
  return {
    detectedPS: { id: str(dps.id).toUpperCase().replace(/^PS(\d)/, 'PS-$1'), title: str(dps.title), confidence: Number(dps.confidence) || 0, rationale: str(dps.rationale) },
    alignmentVerdict: str(d.alignment_verdict).toLowerCase() || 'unknown',
    summary: str(d.executive_summary),
    whatItDoes: str(d.what_it_does),
    architecture: str(d.architecture),
    techStack: arr(d.tech_stack).map(str),
    scores, overall, grade: gradeFor(overall),
    deliverables: arr(d.deliverables).map((x) => ({ item: str(x.item), status: str(x.status).toLowerCase(), evidence: str(x.evidence) })),
    strengths: arr(d.strengths).map(str),
    weaknesses: arr(d.weaknesses).map(str),
    redFlags: arr(d.red_flags).map(str),
    claims: arr(d.claims_vs_evidence).map((x) => ({ claim: str(x.claim), verified: str(x.verified).toLowerCase(), evidence: str(x.evidence) })),
    reproducibility: { rating: str(d.reproducibility?.rating).toLowerCase(), notes: str(d.reproducibility?.notes) },
    questions: arr(d.questions_for_team).map(str),
    recommendations: arr(d.recommendations).map(str),
    verdict: str(d.one_line_verdict),
  };
}

// ------------------------------------------------------------------ Q&A

export async function askRepo({ settings, contextText, history, question, psLabel, signal }) {
  const sys = `You are assisting an AIORI-3 hackathon evaluator who is reviewing a participant repository${psLabel ? ` submitted for ${psLabel}` : ''}. Answer precisely using ONLY the repository context below; cite file paths. If something is not visible in the context, say so plainly. Use concise Markdown.\n\n${contextText}`;
  const messages = [{ role: 'system', content: sys }, ...history.slice(-10), { role: 'user', content: question }];
  return callLLM(settings, messages, { maxTokens: 2048, signal });
}
