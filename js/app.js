import { PROBLEM_STATEMENTS, DOMAINS, RUBRIC, psById, gradeFor } from './ps.js';
import { ingestRepo, parseRepoUrl } from './ingest.js';
import { runHeuristics } from './heuristics.js';
import { PROVIDERS, loadSettings, saveSettings, activeEngine, evaluateRepo, askRepo, callLLM, buildContext, listModels } from './llm.js';
import { downloadPdf } from './report.js';
import { scanMedia, sourceLabel } from './media.js';
import { initViewer, openPdf, openVideo, setViewerLists, closeViewer } from './viewer.js';
import { esc, md, fmtNum, fmtBytes, fmtDate, fmtTokens, download, slug } from './util.js';

const $ = (s, r = document) => r.querySelector(s);
const HKEY = 'aiori3.history.v1';

let settings = loadSettings();
let state = null;          // { ing, heur, ai, aiError, meta, chat, ctxText }
let busy = false;

// ------------------------------------------------------------------ init

function initPsSelect() {
  const sel = $('#psSelect');
  const opts = ['<option value="auto">Auto-detect from repository</option>'];
  for (const d of DOMAINS) {
    opts.push(`<optgroup label="${esc(d)}">`);
    for (const p of PROBLEM_STATEMENTS.filter((x) => x.domain === d).sort((a, b) => a.id.localeCompare(b.id))) {
      opts.push(`<option value="${p.id}">${p.id} — ${esc(p.title)}</option>`);
    }
    opts.push('</optgroup>');
  }
  sel.innerHTML = opts.join('');
}

function renderEngineBadge() {
  const eng = activeEngine(settings);
  const b = $('#engineBadge');
  if (eng) {
    b.className = 'engine on';
    b.innerHTML = `<span class="dot"></span>AI engine: <strong>${esc(eng.id)}</strong> · ${esc(eng.model)}`;
  } else {
    b.className = 'engine off';
    b.innerHTML = '<span class="dot"></span>AI engine not configured — static analysis only. <button type="button" class="linkbtn" id="cfgNow">Configure</button>';
    $('#cfgNow').onclick = openSettings;
  }
}

// ------------------------------------------------------------------ settings dialog

function openSettings() {
  const dlg = $('#settingsDlg');
  const prov = $('#setProvider');
  prov.innerHTML = Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  prov.value = settings.provider;
  const sync = () => {
    const p = PROVIDERS[prov.value];
    $('#keyField').hidden = !p.needsKey;
    $('#setKey').value = settings.keys[prov.value] || '';
    $('#setModel').value = settings.models[prov.value] || p.defaultModel || '';
    $('#setModel').disabled = prov.value === 'none';
    $('#setBudget').value = settings.budget || p.budget || '';
    $('#setBudget').placeholder = p.budget || '';
    $('#keyLink').href = p.keyUrl || '#';
    $('#keyLink').hidden = !p.keyUrl;
    $('#testResult').textContent = '';
    $('#setModelSel').hidden = true;
    $('#btnListModels').hidden = !['gemini', 'groq', 'openrouter'].includes(prov.value);
  };
  $('#btnListModels').onclick = async () => {
    const p = prov.value;
    const key = $('#setKey').value.trim();
    const sel = $('#setModelSel');
    if (PROVIDERS[p].needsKey && !key && p !== 'openrouter') { $('#testResult').textContent = 'Enter the API key first.'; $('#testResult').className = 'hint bad'; return; }
    $('#testResult').textContent = 'Fetching models…'; $('#testResult').className = 'hint';
    try {
      const list = await listModels(p, key);
      sel.innerHTML = `<option value="auto">auto — best available (recommended)</option>${list.map((m) => `<option value="${esc(m.id)}">${esc(m.id)}${m.ctx ? ` · ${Math.round(m.ctx / 1000)}k ctx` : ''}</option>`).join('')}`;
      sel.value = list.some((m) => m.id === $('#setModel').value) ? $('#setModel').value : 'auto';
      sel.hidden = false;
      sel.onchange = () => { $('#setModel').value = sel.value; };
      $('#testResult').textContent = `${list.length} models available to this key.`; $('#testResult').className = 'hint ok';
    } catch (e) {
      $('#testResult').textContent = `✗ ${e.message}`; $('#testResult').className = 'hint bad';
    }
  };
  prov.onchange = () => { settings.budget = null; sync(); };
  sync();
  $('#setGhToken').value = settings.githubToken || '';
  $('#setTemp').value = settings.temperature;
  $('#tempVal').textContent = Number(settings.temperature).toFixed(2);
  $('#setTemp').oninput = () => { $('#tempVal').textContent = Number($('#setTemp').value).toFixed(2); };
  $('#btnTestAI').onclick = async () => {
    const tmp = collectSettings();
    $('#testResult').textContent = 'Testing…';
    try {
      tmp.persist = false;
      const before = tmp.models[tmp.provider];
      const out = await callLLM(tmp, [{ role: 'user', content: 'Reply with exactly: OK' }], { maxTokens: 20, onNote: (m) => { $('#testResult').textContent = `${m}…`; } });
      if (tmp.models[tmp.provider] !== before) $('#setModel').value = tmp.models[tmp.provider];
      $('#testResult').textContent = `✓ Connected via ${tmp.lastModel} — replied “${out.trim().slice(0, 20)}”${tmp.lastModel !== before && before !== 'auto' ? ` (replaced ${before})` : ''}`;
      $('#testResult').className = 'hint ok';
    } catch (e) {
      $('#testResult').textContent = `✗ ${e.message}`;
      $('#testResult').className = 'hint bad';
    }
  };
  dlg.showModal();
}

function collectSettings() {
  const prov = $('#setProvider').value;
  const s = structuredClone(settings);
  s.provider = prov;
  if (PROVIDERS[prov].needsKey) s.keys[prov] = $('#setKey').value.trim();
  if (prov !== 'none') s.models[prov] = $('#setModel').value.trim() || PROVIDERS[prov].defaultModel;
  const b = Number($('#setBudget').value);
  s.budget = b && b !== PROVIDERS[prov].budget ? Math.max(8000, b) : null;
  s.githubToken = $('#setGhToken').value.trim();
  s.temperature = Number($('#setTemp').value);
  return s;
}

$('#settingsForm')?.addEventListener('submit', (e) => {
  if (e.submitter?.value === 'save') {
    settings = collectSettings();
    saveSettings(settings);
    renderEngineBadge();
  }
});

// ------------------------------------------------------------------ progress

const STEPS = [
  ['meta', 'Repository metadata'],
  ['tree', 'File tree & commit history'],
  ['files', 'Text digest (gitingest format)'],
  ['media', 'Presentation PDF & demo video'],
  ['static', 'Deterministic checks'],
  ['ai', 'AI evaluation'],
  ['done', 'Evaluation record'],
];

function setProgress(stage, msg, frac) {
  const idx = STEPS.findIndex((s) => s[0] === stage);
  $('#steps').innerHTML = STEPS.map(([k, label], i) => {
    const cls = i < idx ? 'done' : i === idx ? 'active' : '';
    const skip = k === 'ai' && !activeEngine(settings) ? ' <span class="opt">(skipped — no engine)</span>' : '';
    return `<li class="${cls}"><span class="mark"></span>${esc(label)}${skip}</li>`;
  }).join('');
  let pct = (idx / (STEPS.length - 1)) * 100;
  if (frac != null && idx < STEPS.length - 1) pct += (frac / (STEPS.length - 1)) * 100;
  $('#barFill').style.width = `${Math.min(100, pct)}%`;
  $('#progressMsg').textContent = msg || '';
}

function showError(msg) {
  const b = $('#errorBox');
  b.innerHTML = `<strong>Analysis could not be completed.</strong> ${esc(msg)}`;
  b.hidden = false;
}

// ------------------------------------------------------------------ main flow

async function analyse() {
  if (busy) return;
  const url = $('#repoUrl').value;
  try { parseRepoUrl(url); } catch (e) { showError(e.message); return; }
  busy = true;
  $('#btnAnalyse').disabled = true;
  $('#btnAnalyse').textContent = 'Analysing…';
  $('#errorBox').hidden = true;
  $('#report').hidden = true;
  $('#intro').hidden = true;
  $('#progress').hidden = false;
  const meta = { psId: $('#psSelect').value, team: $('#teamId').value.trim(), evaluator: $('#evaluator').value.trim(), notes: '' };
  try {
    closeViewer();
    const ing = await ingestRepo(url, { token: settings.githubToken, onProgress: setProgress });
    setProgress('media', 'Looking for presentation PDF and video links');
    await scanMedia(ing, { onProgress: setProgress });
    setViewerLists(ing.media);
    setProgress('static', 'Running deterministic checks');
    const heur = runHeuristics(ing);
    state = { ing, heur, ai: null, aiError: null, meta, chat: [], ctxText: null };
    if (activeEngine(settings)) {
      await runAI();
    }
    setProgress('done', 'Complete');
    renderReport();
    saveHistory();
    const u = new URL(location.href);
    u.searchParams.set('repo', ing.repo.fullName);
    if (meta.psId !== 'auto') u.searchParams.set('ps', meta.psId); else u.searchParams.delete('ps');
    history.replaceState(null, '', u);
  } catch (e) {
    console.error(e);
    showError(e.message || String(e));
    $('#intro').hidden = false;
  } finally {
    busy = false;
    $('#progress').hidden = true;
    $('#btnAnalyse').disabled = false;
    $('#btnAnalyse').textContent = 'Analyse repository';
  }
}

async function runAI() {
  setProgress('ai', `Evaluating with ${activeEngine(settings).model} — this can take 20–90 seconds`);
  try {
    state.ai = await evaluateRepo({
      ing: state.ing, heur: state.heur, psId: state.meta.psId, settings,
      onStage: (m) => setProgress('ai', m),
    });
    state.ctxText = state.ai.contextText;
    renderEngineBadge();
    state.aiError = null;
  } catch (e) {
    console.error(e);
    state.ai = null;
    state.aiError = e.message || String(e);
  }
}

async function rerunAI() {
  if (!state || busy) return;
  if (!activeEngine(settings)) { openSettings(); return; }
  busy = true;
  $('#report').hidden = true;
  $('#progress').hidden = false;
  await runAI();
  setProgress('done', 'Complete');
  $('#progress').hidden = true;
  busy = false;
  renderReport();
  saveHistory();
}

// ------------------------------------------------------------------ rendering helpers

const statusPill = (s) => `<span class="pill ${esc(s)}">${esc(String(s || '—').toUpperCase())}</span>`;
const list = (items, cls = '') => (items?.length ? `<ul class="${cls}">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="muted">None recorded.</p>');
const scoreClass = (v10) => (v10 >= 7 ? 'good' : v10 >= 5 ? 'mid' : 'low');

function langBar(langs) {
  if (!langs.length) return '<p class="muted">No language data.</p>';
  const palette = ['#1d3557', '#457b9d', '#a08034', '#6b8f71', '#8d5a97', '#c06c4c', '#5c6b7a', '#9aa7b4'];
  const top = langs.slice(0, 7);
  const rest = langs.slice(7).reduce((s, l) => s + l.pct, 0);
  if (rest > 0) top.push({ name: 'Other', pct: rest });
  return `<div class="langbar">${top.map((l, i) => `<span style="width:${l.pct}%;background:${palette[i % palette.length]}" title="${esc(l.name)} ${l.pct.toFixed(1)}%"></span>`).join('')}</div>
  <ul class="legend">${top.map((l, i) => `<li><i style="background:${palette[i % palette.length]}"></i>${esc(l.name)} <span>${l.pct.toFixed(1)}%</span></li>`).join('')}</ul>`;
}

function commitChart(cm) {
  const days = Object.keys(cm.byDay).sort();
  if (!days.length) return '<p class="muted">No commit dates available.</p>';
  const start = new Date(days[0]);
  const end = new Date(days[days.length - 1]);
  const span = Math.round((end - start) / 86400000) + 1;
  const weekly = span > 75;
  const bins = new Map();
  for (const [d, n] of Object.entries(cm.byDay)) {
    const dt = new Date(d);
    const idx = Math.floor((dt - start) / 86400000 / (weekly ? 7 : 1));
    bins.set(idx, (bins.get(idx) || 0) + n);
  }
  const nb = Math.floor((span - 1) / (weekly ? 7 : 1)) + 1;
  const max = Math.max(...bins.values());
  const Wd = 760; const Ht = 150; const pad = 26;
  const bw = (Wd - pad * 2) / nb;
  let bars = '';
  for (let i = 0; i < nb; i++) {
    const v = bins.get(i) || 0;
    if (!v) continue;
    const h = (v / max) * (Ht - 44);
    const d = new Date(+start + i * 86400000 * (weekly ? 7 : 1)).toISOString().slice(0, 10);
    bars += `<rect x="${pad + i * bw + (bw - Math.min(30, Math.max(1.5, bw * 0.76))) / 2}" y="${Ht - 22 - h}" width="${Math.min(30, Math.max(1.5, bw * 0.76))}" height="${h}" fill="#1d3557"><title>${weekly ? 'Week of ' : ''}${d}: ${v} commit${v > 1 ? 's' : ''}</title></rect>`;
  }
  return `<svg class="chart" viewBox="0 0 ${Wd} ${Ht}" role="img" aria-label="Commit activity">
    <line x1="${pad}" y1="${Ht - 22}" x2="${Wd - pad}" y2="${Ht - 22}" stroke="#cfcabd"/>
    <text x="${pad}" y="${Ht - 6}" class="axis">${days[0]}</text>
    <text x="${Wd - pad}" y="${Ht - 6}" class="axis" text-anchor="end">${days[days.length - 1]}</text>
    <text x="${pad}" y="12" class="axis">max ${max} / ${weekly ? 'week' : 'day'}</text>
    ${bars}</svg>
    <p class="caption">Commit activity (${cm.sampled < cm.total ? `latest ${cm.sampled} of ${cm.total}` : `all ${cm.total}`} commits), ${weekly ? 'weekly' : 'daily'} bins.</p>`;
}

// ------------------------------------------------------------------ report

function renderReport() {
  const { ing, heur, ai, aiError, meta } = state;
  const r = ing.repo;
  const psSel = meta.psId !== 'auto' ? psById(meta.psId) : null;
  const psDet = ai?.detectedPS?.id ? psById(ai.detectedPS.id) : null;
  const psShown = psSel || psDet;
  let n = 0;
  const sec = (title, body, id = '') => `<section class="rsec" ${id ? `id="${id}"` : ''}><h3 class="sec-title"><span class="sec-no">${++n}.</span> ${esc(title)}</h3>${body}</section>`;
  const mismatch = psSel && ai?.detectedPS?.id && ai.detectedPS.id !== psSel.id;

  const html = [];
  html.push(`
  <div class="panel report-head">
    <div class="rh-top">
      <div>
        <div class="kicker">Evaluation record · ${esc(fmtDate(ing.fetchedAt, true))}</div>
        <h2 class="repo-title"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.fullName)}</a></h2>
        <p class="repo-desc">${esc(r.description || 'No description provided.')}</p>
        <div class="chips">
          <span class="chip mono">${esc(ing.branch)} @ ${esc(String(ing.commitSha).slice(0, 7))}</span>
          ${psShown ? `<span class="chip ps">${esc(psShown.id)} · ${esc(psShown.domain)}</span>` : ''}
          ${meta.team ? `<span class="chip">Team: ${esc(meta.team)}</span>` : ''}
          <span class="chip">★ ${fmtNum(r.stars)}</span><span class="chip">Forks ${fmtNum(r.forks)}</span>
          <span class="chip">Licence: ${esc(r.license || 'none')}</span>
          <span class="chip">Created ${esc(fmtDate(r.createdAt))}</span>
          <span class="chip">Last push ${esc(fmtDate(r.pushedAt))}</span>
          ${r.isFork ? `<span class="chip warn">Fork of ${esc(r.parent || '?')}</span>` : ''}
        </div>
      </div>
      <div class="toolbar">
        <button class="btn primary" id="btnPdf" type="button">Download PDF report</button>
        ${ing.media.pdfs.length || ing.media.videos.length ? `<div class="btn-row">
          ${ing.media.pdfs.length ? '<button class="btn small" id="qSlides" type="button">View slides</button>' : ''}
          ${ing.media.videos.length ? '<button class="btn small" id="qVideo" type="button">Watch demo</button>' : ''}
        </div>` : ''}
        <div class="btn-row">
          <button class="btn ghost small" id="btnDigest" type="button">Digest .txt</button>
          <button class="btn ghost small" id="btnCopyDigest" type="button">Copy digest</button>
          <button class="btn ghost small" id="btnJson" type="button">JSON</button>
        </div>
        <div class="btn-row">
          <a class="btn ghost small" href="${esc(r.url.replace('github.com', 'gitingest.com'))}" target="_blank" rel="noopener">Open in gitingest ↗</a>
          <button class="btn ghost small" id="btnRerun" type="button">${ai ? 'Re-run AI' : 'Run AI evaluation'}</button>
        </div>
      </div>
    </div>
    ${psShown ? `<p class="ps-line"><strong>${esc(psShown.id)} — ${esc(psShown.title)}</strong><br><span class="muted">${esc(psShown.scope)}</span></p>` : ''}
  </div>`);

  if (aiError) html.push(`<div class="alert error"><strong>AI evaluation failed:</strong> ${esc(aiError)} <br><span class="muted">Static analysis below is complete. Fix the engine in Settings and choose “Run AI evaluation”.</span></div>`);
  else if (!ai) html.push('<div class="alert info">No AI engine configured: this record contains deterministic analysis only. Add a free Gemini / Groq / OpenRouter key in <button class="linkbtn" id="cfgInline" type="button">Settings</button> to obtain rubric scores, deliverable mapping and viva questions.</div>');
  if (mismatch) html.push(`<div class="alert warn"><strong>Problem-statement mismatch.</strong> Selected ${esc(psSel.id)}, but the AI judges the work closest to ${esc(ai.detectedPS.id)}${psDet ? ` (${esc(psDet.title)})` : ''} with ${ai.detectedPS.confidence}% confidence.</div>`);

  // Score strip
  html.push(`<div class="scorestrip">
    <div class="score-card primary">
      <div class="lbl">Overall score <span>(weighted rubric)</span></div>
      <div class="big">${ai ? ai.overall.toFixed(1) : '—'}<small>/100</small></div>
      <div class="grade">${ai ? `Grade ${esc(ai.grade)}` : 'Requires AI engine'}</div>
    </div>
    <div class="score-card">
      <div class="lbl">Problem-statement alignment</div>
      <div class="big word ${ai ? esc(ai.alignmentVerdict) : ''}">${ai ? esc(ai.alignmentVerdict) : '—'}</div>
      <div class="grade">${ai ? `Detected ${esc(ai.detectedPS.id || '—')} · ${ai.detectedPS.confidence}%` : `Keyword hint: ${esc(heur.psRanking[0]?.id || '—')}`}</div>
    </div>
    <div class="score-card">
      <div class="lbl">Engineering hygiene <span>(deterministic)</span></div>
      <div class="big">${heur.hygieneScore}<small>/100</small></div>
      <div class="grade">${heur.checks.filter((c) => c.status === 'pass').length} of ${heur.checks.filter((c) => c.status !== 'info').length} checks passed</div>
    </div>
    <div class="score-card">
      <div class="lbl">Scale</div>
      <div class="big">${fmtNum(heur.loc)}<small> LOC</small></div>
      <div class="grade">${fmtNum(ing.stats.fileCount)} files · ${fmtNum(heur.commits.total)} commits · ${fmtNum(ing.contributors.length)} contributors</div>
    </div>
  </div>
  ${ai?.verdict ? `<blockquote class="verdict">${esc(ai.verdict)}</blockquote>` : ''}`);

  const allFlags = [...(ai?.redFlags || []), ...heur.flags];

  html.push(sec('Submission materials', materialsHtml(ing.media), 'materials'));

  if (ai) {
    html.push(sec('Executive summary', `<p class="lead">${esc(ai.summary)}</p>${ai.detectedPS.rationale ? `<p class="muted small"><strong>Problem-statement match:</strong> ${esc(ai.detectedPS.rationale)}</p>` : ''}`));

    html.push(sec('Rubric assessment', `<div class="tbl-wrap"><table class="tbl rubric">
      <thead><tr><th>Criterion</th><th class="num">Weight</th><th>Score</th><th>Justification</th></tr></thead>
      <tbody>${RUBRIC.map((c) => {
        const s = ai.scores[c.key];
        return `<tr><td><strong>${esc(c.label)}</strong><div class="muted small">${esc(c.desc)}</div></td><td class="num">${c.weight}%</td>
          <td class="scorecell"><div class="meter ${scoreClass(s.score)}"><span style="width:${s.score * 10}%"></span></div><b>${s.score}</b>/10</td>
          <td>${esc(s.justification)}</td></tr>`;
      }).join('')}
      <tr class="total"><td>Weighted total</td><td class="num">100%</td><td><b>${ai.overall.toFixed(1)}</b></td><td>Grade ${esc(ai.grade)} · A+ ≥ 90, A ≥ 80, B ≥ 70, C ≥ 60, D ≥ 50</td></tr>
      </tbody></table></div>`));

    html.push(sec('Technical overview', `<div class="two">
      <div><h4>What the implementation does</h4><p>${esc(ai.whatItDoes)}</p>
        <h4>Technology stack</h4><div class="chips">${ai.techStack.map((t) => `<span class="chip">${esc(t)}</span>`).join('') || '<span class="muted">—</span>'}</div></div>
      <div><h4>Architecture</h4><p>${esc(ai.architecture)}</p>
        <h4>Reproducibility <span class="pill ${ai.reproducibility.rating === 'high' ? 'pass' : ai.reproducibility.rating === 'medium' ? 'warn' : 'fail'}">${esc((ai.reproducibility.rating || 'n/a').toUpperCase())}</span></h4><p>${esc(ai.reproducibility.notes)}</p></div>
    </div>`));

    html.push(sec('Deliverables against the problem statement', `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Expected deliverable</th><th>Status</th><th>Evidence</th></tr></thead>
      <tbody>${ai.deliverables.map((d) => `<tr><td>${esc(d.item)}</td><td>${statusPill(d.status)}</td><td class="evidence">${esc(d.evidence)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No deliverables returned.</td></tr>'}</tbody></table></div>`));

    html.push(sec('Findings', `<div class="three">
      <div class="findcol good"><h4>Strengths</h4>${list(ai.strengths)}</div>
      <div class="findcol mid"><h4>Weaknesses</h4>${list(ai.weaknesses)}</div>
      <div class="findcol low"><h4>Red flags</h4>${list(allFlags)}</div></div>`));

    if (ai.claims.length) {
      html.push(sec('Claims versus evidence', `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Claim (README / docs)</th><th>Verified</th><th>Evidence</th></tr></thead>
        <tbody>${ai.claims.map((c) => `<tr><td>${esc(c.claim)}</td><td>${statusPill(c.verified)}</td><td class="evidence">${esc(c.evidence)}</td></tr>`).join('')}</tbody></table></div>`));
    }
  } else if (allFlags.length) {
    html.push(sec('Automated flags', list(allFlags, 'flags')));
  }

  html.push(sec('Engineering & hygiene checks', `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead>
    <tbody>${heur.checks.map((c) => `<tr><td><strong>${esc(c.label)}</strong></td><td>${statusPill(c.status)}</td><td>${esc(c.detail)}</td></tr>`).join('')}</tbody></table></div>`));

  const cm = heur.commits;
  html.push(sec('Repository statistics', `
    <div class="statgrid">
      <div><span>Total files</span><b>${fmtNum(ing.stats.fileCount)}</b></div>
      <div><span>Text files read</span><b>${fmtNum(ing.stats.fetchedFiles)}</b></div>
      <div><span>Repository size</span><b>${fmtBytes(ing.stats.totalBytes)}</b></div>
      <div><span>Digest tokens (est.)</span><b>${fmtTokens(ing.stats.estTokens)}</b></div>
      <div><span>Commits</span><b>${fmtNum(cm.total)}</b></div>
      <div><span>Active days</span><b>${fmtNum(cm.activeDays)}</b></div>
      <div><span>First → latest</span><b class="smallb">${cm.first ? cm.first.toISOString().slice(0, 10) : '—'} → ${cm.last ? cm.last.toISOString().slice(0, 10) : '—'}</b></div>
      <div><span>Generic commit msgs</span><b>${Math.round(cm.genericRatio * 100)}%</b></div>
    </div>
    <h4>Language composition</h4>${langBar(heur.languages)}
    <h4>Commit activity</h4>${commitChart(cm)}
    <div class="two">
      <div><h4>Authorship</h4><table class="tbl compact"><thead><tr><th>Author</th><th class="num">Commits</th></tr></thead><tbody>
        ${Object.entries(cm.authors).sort((a, b) => b[1] - a[1]).map(([a, c]) => `<tr><td>${esc(a)}</td><td class="num">${c}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">—</td></tr>'}</tbody></table></div>
      <div><h4>Problem-statement keyword affinity <span class="opt">heuristic</span></h4><table class="tbl compact"><thead><tr><th>PS</th><th>Affinity</th><th>Matched terms</th></tr></thead><tbody>
        ${heur.psRanking.slice(0, 5).map((p) => `<tr><td title="${esc(p.title)}"><strong>${esc(p.id)}</strong></td><td><div class="meter thin"><span style="width:${p.score}%"></span></div></td><td class="small">${esc(p.hits.slice(0, 5).map((h) => h.kw).join(', ') || '—')}</td></tr>`).join('')}</tbody></table></div>
    </div>`));

  if (ai) {
    html.push(sec('Viva questions & recommendations', `<div class="two">
      <div><h4>Questions for the team</h4><ol class="qlist">${ai.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ol></div>
      <div><h4>Recommendations</h4><ol class="qlist">${ai.recommendations.map((q) => `<li>${esc(q)}</li>`).join('')}</ol></div></div>`));
  }

  html.push(sec("Evaluator's remarks", `<textarea id="notes" class="notes" rows="5" placeholder="Remarks entered here are included in the PDF report (e.g. demo observations, final score adjustments, mentor feedback).">${esc(meta.notes)}</textarea>`));

  html.push(sec('Ask the repository', activeEngine(settings) ? `
    <p class="muted small">Interrogate the codebase in natural language. Answers are grounded in the same digest used for evaluation and cite file paths.</p>
    <div class="chat" id="chatLog">${state.chat.map(chatBubble).join('')}</div>
    <div class="suggest">${['Where is the core algorithm implemented?', 'How are results measured and what baselines are used?', 'Which parts look incomplete or mocked?', 'How would I run this locally?'].map((q) => `<button class="chipbtn" type="button">${esc(q)}</button>`).join('')}</div>
    <form id="chatForm" class="chatform"><input id="chatInput" type="text" placeholder="e.g. Does the handover logic use time-to-trigger, and where?"><button class="btn primary small" type="submit">Ask</button></form>`
    : '<p class="muted">Configure an AI engine in Settings to enable repository Q&amp;A.</p>'));

  const skipped = ing.skipped.filter((s) => s.reason !== 'excluded directory');
  html.push(sec('Repository digest', `
    <p class="muted small">gitingest-compatible text representation · ${fmtNum(ing.stats.fetchedFiles)} files · ${fmtNum(ing.stats.digestChars)} characters · ≈${fmtTokens(ing.stats.estTokens)} tokens${ai ? ` · AI context: ${ai.contextStats.included} files${ai.contextStats.omitted ? `, ${ai.contextStats.omitted} omitted for budget` : ''}` : ''}</p>
    <details open><summary>Directory structure</summary><pre class="tree">${esc(ing.tree)}</pre></details>
    <details><summary>Files read (${ing.files.length})</summary><div class="filelist">${ing.files.map((f) => `<button type="button" class="fileitem" data-path="${esc(f.path)}"><span>${esc(f.path)}</span><em>${fmtNum(f.lines)} lines${f.truncated ? ' · truncated' : ''}</em></button>`).join('')}</div>
      <pre class="tree" id="fileView" hidden></pre></details>
    ${skipped.length ? `<details><summary>Skipped / binary files (${skipped.length})</summary><table class="tbl compact"><tbody>${skipped.slice(0, 400).map((s) => `<tr><td class="mono small">${esc(s.path)}</td><td class="small muted">${esc(s.reason)}</td><td class="num small">${fmtBytes(s.size)}</td></tr>`).join('')}</tbody></table></details>` : ''}
    <details><summary>Full digest preview</summary><pre class="tree digest">${esc(ing.digest.slice(0, 250_000))}${ing.digest.length > 250_000 ? '\n\n… preview truncated — download the full digest.' : ''}</pre></details>`));

  const rep = $('#report');
  rep.innerHTML = html.join('\n');
  rep.hidden = false;
  bindReport();
  rep.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function materialsHtml(m) {
  const pdfItems = m.pdfs.map((p, i) => `
    <div class="mat-item">
      <div class="mat-icon">PDF</div>
      <div class="mat-info"><span class="mp" title="${esc(p.path)}">${esc(p.path)}</span>
        <span class="mm">${p.pages ? `${p.pages} page${p.pages > 1 ? 's' : ''} · ` : ''}${fmtBytes(p.size)}${p.isPresentation ? ' · <strong>presentation</strong>' : ''}${p.error ? ` · <span class="bad">${esc(p.error)}</span>` : p.note ? ` · ${esc(p.note)}` : ''}</span></div>
      <div class="mat-actions"><button class="btn small primary" data-pdf="${i}" type="button">View</button><a class="btn small ghost" href="${esc(p.ghUrl)}" target="_blank" rel="noopener">GitHub ↗</a></div>
    </div>`).join('');
  const deckItems = m.decks.map((d) => `
    <div class="mat-item">
      <div class="mat-icon" style="color:var(--warn)">${esc(d.ext.toUpperCase())}</div>
      <div class="mat-info"><span class="mp">${esc(d.path)}</span><span class="mm">${fmtBytes(d.size)} · cannot be previewed in-browser</span></div>
      <div class="mat-actions"><a class="btn small ghost" href="${esc(d.url)}" download>Download</a><a class="btn small ghost" href="${esc(d.ghUrl)}" target="_blank" rel="noopener">GitHub ↗</a></div>
    </div>`).join('');
  const vidItems = m.videos.map((v, i) => `
    <div class="mat-item">
      <button class="vthumb ${v.thumb ? '' : 'noimg'}" data-video="${i}" type="button" aria-label="Play video" ${v.thumb ? `style="background-image:url('${esc(v.thumb)}')"` : ''}>${v.thumb ? '' : esc(v.provider)}</button>
      <div class="mat-info"><span class="mp" title="${esc(v.url)}">${esc(v.url.replace(/^https?:\/\/(www\.)?/, ''))}</span>
        <span class="mm">${esc(v.provider)} · found in ${v.sources.map((s) => esc(sourceLabel(s))).slice(0, 3).join(', ')}</span></div>
      <div class="mat-actions">${v.embed ? `<button class="btn small primary" data-video="${i}" type="button">Play here</button>` : ''}<a class="btn small ghost" href="${esc(v.url)}" target="_blank" rel="noopener">${v.provider === 'youtube' ? 'YouTube' : 'Open'} ↗</a></div>
    </div>`).join('');
  return `<div class="materials">
    <div class="mat-col"><h4>Presentation ${statusPill(m.pdfs.length ? 'present' : m.decks.length ? 'partial' : 'missing')}</h4>
      ${pdfItems}${deckItems}${!m.pdfs.length && !m.decks.length ? '<div class="empty-mat">No PDF (or PowerPoint) file found in the repository.</div>' : ''}
      ${m.libError ? `<p class="small bad">${esc(m.libError)}</p>` : ''}</div>
    <div class="mat-col"><h4>Demo video ${statusPill(m.videos.some((v) => v.provider === 'youtube') ? 'present' : m.videos.length ? 'partial' : 'missing')}</h4>
      ${vidItems || '<div class="empty-mat">No video link found in the README, other documentation or the slides (including slide hyperlinks).</div>'}</div>
  </div>`;
}

function chatBubble(m) {
  return `<div class="msg ${m.role}">${m.role === 'assistant' ? md(m.content) : esc(m.content)}</div>`;
}

function bindReport() {
  const { ing } = state;
  $('#btnPdf').onclick = () => {
    try { downloadPdf(state); } catch (e) { alert(e.message); }
  };
  $('#btnDigest').onclick = () => download(`${slug(ing.repo.fullName)}-digest.txt`, ing.digest);
  $('#btnCopyDigest').onclick = async (e) => {
    try { await navigator.clipboard.writeText(ing.digest); e.target.textContent = 'Copied ✓'; } catch { e.target.textContent = 'Copy failed'; }
    setTimeout(() => { e.target.textContent = 'Copy digest'; }, 1800);
  };
  $('#btnJson').onclick = () => {
    const out = {
      tool: 'AIORI-3 Repository Analyser', generatedAt: new Date().toISOString(), meta: state.meta,
      repository: ing.repo, branch: ing.branch, commit: ing.commitSha, stats: ing.stats, materials: ing.media,
      heuristics: { ...state.heur, psRanking: state.heur.psRanking.slice(0, 10) },
      ai: state.ai ? { ...state.ai, contextText: undefined } : null, aiError: state.aiError,
    };
    download(`${slug(ing.repo.fullName)}-evaluation.json`, JSON.stringify(out, null, 2), 'application/json');
  };
  $('#btnRerun').onclick = rerunAI;
  document.querySelectorAll('[data-pdf]').forEach((b) => { b.onclick = () => openPdf(ing.media.pdfs[+b.dataset.pdf]); });
  document.querySelectorAll('[data-video]').forEach((b) => { b.onclick = () => { const v = ing.media.videos[+b.dataset.video]; if (v.embed) openVideo(v); else window.open(v.url, '_blank', 'noopener'); }; });
  $('#qSlides')?.addEventListener('click', () => openPdf(ing.media.pdfs[0]));
  $('#qVideo')?.addEventListener('click', () => { const v = ing.media.videos[0]; if (v.embed) openVideo(v); else window.open(v.url, '_blank', 'noopener'); });
  $('#cfgInline')?.addEventListener('click', openSettings);
  $('#notes').oninput = (e) => { state.meta.notes = e.target.value; };

  const fv = $('#fileView');
  document.querySelectorAll('.fileitem').forEach((b) => {
    b.onclick = () => {
      const f = ing.files.find((x) => x.path === b.dataset.path);
      fv.hidden = false;
      fv.textContent = `── ${f.path} ──\n\n${f.content}`;
      fv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
  });

  const form = $('#chatForm');
  if (form) {
    document.querySelectorAll('.suggest .chipbtn').forEach((b) => { b.onclick = () => { $('#chatInput').value = b.textContent; form.requestSubmit(); }; });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const q = $('#chatInput').value.trim();
      if (!q) return;
      $('#chatInput').value = '';
      const log = $('#chatLog');
      state.chat.push({ role: 'user', content: q });
      log.insertAdjacentHTML('beforeend', chatBubble({ role: 'user', content: q }) + '<div class="msg assistant pending">Reading the repository…</div>');
      log.scrollTop = log.scrollHeight;
      try {
        if (!state.ctxText) state.ctxText = buildContext(state.ing, state.heur, activeEngine(settings).budget).text;
        const ps = psById(state.meta.psId) || psById(state.ai?.detectedPS?.id);
        const ans = await askRepo({ settings, contextText: state.ctxText, history: state.chat.slice(0, -1), question: q, psLabel: ps ? `${ps.id} (${ps.title})` : '' });
        state.chat.push({ role: 'assistant', content: ans });
        log.querySelector('.pending').outerHTML = chatBubble({ role: 'assistant', content: ans });
      } catch (err) {
        state.chat.pop();
        log.querySelector('.pending').outerHTML = `<div class="msg assistant err">${esc(err.message)}</div>`;
      }
      log.scrollTop = log.scrollHeight;
    };
  }
}

// ------------------------------------------------------------------ history / register

function getHistory() { try { return JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch { return []; } }

function saveHistory() {
  const { ing, heur, ai, meta } = state;
  const row = {
    date: new Date().toISOString(), repo: ing.repo.fullName, url: ing.repo.url, commit: String(ing.commitSha).slice(0, 7),
    team: meta.team, evaluator: meta.evaluator, psSelected: meta.psId, psDetected: ai?.detectedPS?.id || '',
    slides: ing.media?.pdfs[0]?.path || '', video: ing.media?.videos[0]?.url || '',
    overall: ai ? ai.overall : null, grade: ai ? ai.grade : '', alignment: ai?.alignmentVerdict || '', hygiene: heur.hygieneScore,
    scores: ai ? Object.fromEntries(RUBRIC.map((c) => [c.key, ai.scores[c.key].score])) : null,
  };
  const h = getHistory().filter((x) => !(x.repo === row.repo && x.commit === row.commit && x.psSelected === row.psSelected));
  h.unshift(row);
  try { localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 300))); } catch { /* ignore */ }
}

function openHistory() {
  const h = getHistory();
  $('#historyTable').innerHTML = h.length ? `<div class="tbl-wrap"><table class="tbl compact">
    <thead><tr><th>Date</th><th>Repository</th><th>Team</th><th>PS</th><th class="num">Score</th><th>Grade</th><th class="num">Hygiene</th><th>Materials</th><th></th></tr></thead>
    <tbody>${h.map((r, i) => `<tr><td class="small">${esc(fmtDate(r.date, true))}</td><td><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.repo)}</a> <span class="mono small muted">${esc(r.commit)}</span></td>
      <td>${esc(r.team || '—')}</td><td>${esc(r.psSelected !== 'auto' ? r.psSelected : (r.psDetected || 'auto'))}</td>
      <td class="num">${r.overall != null ? r.overall.toFixed(1) : '—'}</td><td>${esc(r.grade || '—')}</td><td class="num">${r.hygiene}</td>
      <td class="small">${r.slides ? '<span class="pill pass">PDF</span>' : '<span class="pill fail">PDF</span>'} ${r.video ? `<a class="pill pass" href="${esc(r.video)}" target="_blank" rel="noopener">VIDEO ↗</a>` : '<span class="pill fail">VIDEO</span>'}</td>
      <td><button class="linkbtn" data-reopen="${i}" type="button">Re-analyse</button></td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">No analyses yet.</p>';
  document.querySelectorAll('[data-reopen]').forEach((b) => {
    b.onclick = () => {
      const r = h[+b.dataset.reopen];
      $('#repoUrl').value = r.url;
      $('#psSelect').value = r.psSelected || 'auto';
      $('#teamId').value = r.team || '';
      $('#historyDlg').close();
      analyse();
    };
  });
  $('#historyDlg').showModal();
}

function exportCsv() {
  const h = getHistory();
  const cols = ['date', 'repo', 'url', 'commit', 'team', 'evaluator', 'psSelected', 'psDetected', 'overall', 'grade', 'alignment', 'hygiene', 'slides', 'video', ...RUBRIC.map((c) => c.key)];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [cols.join(',')].concat(h.map((r) => cols.map((c) => q(r.scores && c in r.scores ? r.scores[c] : r[c])).join(',')));
  download(`aiori3-evaluation-register-${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'), 'text/csv');
}

// ------------------------------------------------------------------ wire up

initPsSelect();
renderEngineBadge();
initViewer();
$('#intakeForm').addEventListener('submit', (e) => { e.preventDefault(); analyse(); });
$('#btnSettings').onclick = openSettings;
$('#btnHistory').onclick = openHistory;
$('#btnCloseHistory').onclick = () => $('#historyDlg').close();
$('#btnExportCsv').onclick = exportCsv;
$('#btnClearHistory').onclick = () => { if (confirm('Clear the local evaluation register?')) { localStorage.removeItem(HKEY); openHistory(); } };

const params = new URLSearchParams(location.search);
if (params.get('ps') && psById(params.get('ps'))) $('#psSelect').value = params.get('ps');
if (params.get('team')) $('#teamId').value = params.get('team');
if (params.get('repo')) {
  $('#repoUrl').value = params.get('repo');
  if (params.get('run') !== '0') analyse();
}
void gradeFor;
