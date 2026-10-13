// Official-style PDF evaluation report (jsPDF + AutoTable, loaded from cdnjs).
import { RUBRIC, psById } from './ps.js';

const NAVY = [29, 53, 87];
const INK = [27, 35, 48];
const MUTED = [91, 101, 117];
const RULE = [205, 201, 190];
const GOLD = [160, 128, 52];
const STATUS_COL = { pass: [46, 125, 79], warn: [183, 121, 31], fail: [180, 35, 24], info: [58, 90, 140],
  present: [46, 125, 79], partial: [183, 121, 31], missing: [180, 35, 24], yes: [46, 125, 79], no: [180, 35, 24] };

// Standard PDF fonts are Latin-1 only: normalise typography and box-drawing glyphs.
function clean(s) {
  return String(s ?? '')
    .replace(/└── /g, '`-- ').replace(/├── /g, '|-- ').replace(/│   /g, '|   ').replace(/[└├]/g, '|').replace(/[─│]/g, '-')
    .replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"').replace(/[–—−]/g, '-').replace(/…/g, '...')
    .replace(/[•·●▪]/g, '-').replace(/→/g, '->').replace(/←/g, '<-').replace(/↔/g, '<->').replace(/≥/g, '>=').replace(/≤/g, '<=')
    .replace(/×/g, 'x').replace(/✓|✔/g, 'v').replace(/✗|✘/g, 'x').replace(/ /g, ' ').replace(/\t/g, '  ')
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, '?');
}

export function buildPdf(state) {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) throw new Error('PDF library failed to load (check your connection / content blockers).');
  const { ing, heur, ai, meta } = state;
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 50;
  const CW = W - 2 * M;
  let y = M;
  let sec = 0;

  const ensure = (h) => { if (y + h > H - 60) { doc.addPage(); y = M; } };
  const setFont = (style = 'normal', size = 10, color = INK, family = 'helvetica') => {
    doc.setFont(family, style); doc.setFontSize(size); doc.setTextColor(...color);
  };
  const heading = (title) => {
    ensure(48);
    sec++;
    y += 8;
    setFont('bold', 12.5, NAVY, 'times');
    doc.text(`${sec}.  ${clean(title).toUpperCase()}`, M, y);
    y += 6;
    doc.setDrawColor(...NAVY); doc.setLineWidth(0.8); doc.line(M, y, M + CW, y);
    y += 15;
  };
  const sub = (title) => { ensure(26); setFont('bold', 10.5, NAVY); doc.text(clean(title), M, y); y += 14; };
  const para = (text, { size = 9.8, color = INK, style = 'normal', indent = 0, gap = 8, lh = 1.38 } = {}) => {
    if (!text) return;
    setFont(style, size, color);
    const lines = doc.splitTextToSize(clean(text), CW - indent);
    const step = size * lh;
    for (const ln of lines) { ensure(step); doc.text(ln, M + indent, y); y += step; }
    y += gap;
  };
  const bullets = (items, { color = INK, marker = '-' } = {}) => {
    if (!items?.length) { para('None recorded.', { color: MUTED, style: 'italic' }); return; }
    setFont('normal', 9.8, color);
    items.forEach((it, i) => {
      const lines = doc.splitTextToSize(clean(it), CW - 16);
      ensure(lines.length * 13.5 + 2);
      setFont('bold', 9.8, NAVY);
      doc.text(marker === '#' ? `${i + 1}.` : '-', M + 2, y);
      setFont('normal', 9.8, color);
      lines.forEach((ln, j) => doc.text(ln, M + 16, y + j * 13.5));
      y += lines.length * 13.5 + 3;
    });
    y += 6;
  };
  const table = (opts) => {
    doc.autoTable({
      startY: y, margin: { left: M, right: M, bottom: 60 }, theme: 'plain',
      styles: { font: 'helvetica', fontSize: 8.6, textColor: INK, cellPadding: { top: 4, bottom: 4, left: 5, right: 5 }, overflow: 'linebreak', lineColor: RULE, lineWidth: 0 },
      headStyles: { fontStyle: 'bold', textColor: NAVY, fillColor: [238, 236, 229], lineWidth: { bottom: 0.8 }, lineColor: NAVY },
      bodyStyles: { lineWidth: { bottom: 0.3 }, lineColor: RULE },
      ...opts,
      body: (opts.body || []).map((r) => r.map((c) => (typeof c === 'object' && c !== null ? { ...c, content: clean(c.content) } : clean(c)))),
      head: opts.head ? opts.head.map((r) => r.map(clean)) : undefined,
    });
    y = doc.lastAutoTable.finalY + 14;
  };
  const statusCell = (col) => ({
    didParseCell: (d) => {
      if (d.section === 'body' && d.column.index === col) {
        const k = String(d.cell.raw?.content ?? d.cell.raw ?? '').toLowerCase().split(/\s/)[0];
        if (STATUS_COL[k]) { d.cell.styles.textColor = STATUS_COL[k]; d.cell.styles.fontStyle = 'bold'; }
      }
    },
  });

  const now = new Date();
  const psSel = meta.psId && meta.psId !== 'auto' ? psById(meta.psId) : null;
  const psDet = ai?.detectedPS?.id ? psById(ai.detectedPS.id) : null;
  const psFinal = psSel || psDet;

  // ---------------- Title block
  doc.setFillColor(...NAVY); doc.rect(0, 0, W, 6, 'F');
  doc.setFillColor(...GOLD); doc.rect(0, 6, W, 1.6, 'F');
  y = 44;
  setFont('bold', 8.5, GOLD); doc.text('AIORI-3 HACKATHON  |  TECHNICAL EVALUATION RECORD', M, y);
  setFont('normal', 8.5, MUTED); doc.text(`Ref. ${clean(ing.repo.fullName)} @ ${String(ing.commitSha).slice(0, 7)}`, W - M, y, { align: 'right' });
  y += 26;
  setFont('bold', 21, INK, 'times'); doc.text('Repository Evaluation Report', M, y);
  y += 20;
  setFont('normal', 11, MUTED, 'times');
  doc.text(doc.splitTextToSize(clean(psFinal ? `${psFinal.id} - ${psFinal.title}` : 'Problem statement: not determined'), CW), M, y);
  y += psFinal && clean(`${psFinal.id} - ${psFinal.title}`).length > 85 ? 28 : 16;
  doc.setDrawColor(...RULE); doc.setLineWidth(0.5); doc.line(M, y, M + CW, y); y += 14;

  table({
    body: [
      ['Repository', ing.repo.url],
      ['Branch / commit', `${ing.branch} @ ${ing.commitSha}`],
      ['Team / Submission ID', meta.team || '-'],
      ['Problem statement (selected)', psSel ? `${psSel.id} - ${psSel.title}` : 'Auto-detect'],
      ['Problem statement (AI-detected)', ai?.detectedPS?.id ? `${ai.detectedPS.id}${psDet ? ` - ${psDet.title}` : ''} (confidence ${ai.detectedPS.confidence}%)` : '-'],
      ['Evaluator', meta.evaluator || '-'],
      ['Report generated', now.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })],
      ['Analysis engine', ai ? `${ai.engine.provider} / ${ai.engine.model}  +  deterministic static analysis` : 'Deterministic static analysis only (no AI engine)'],
    ],
    columnStyles: { 0: { cellWidth: 150, fontStyle: 'bold', textColor: MUTED } },
  });

  // ---------------- Score panel
  ensure(96);
  const boxH = 80;
  doc.setDrawColor(...NAVY); doc.setLineWidth(0.8); doc.rect(M, y, CW, boxH);
  const colW = CW / 3;
  const panel = (i, label, value, note) => {
    const x = M + i * colW;
    if (i) { doc.setDrawColor(...RULE); doc.setLineWidth(0.4); doc.line(x, y + 10, x, y + boxH - 10); }
    setFont('bold', 7.5, MUTED); doc.text(label.toUpperCase(), x + 14, y + 18);
    setFont('bold', 24, NAVY, 'times'); doc.text(clean(value), x + 14, y + 48);
    setFont('normal', 8, MUTED); doc.text(doc.splitTextToSize(clean(note), colW - 24).slice(0, 2), x + 14, y + 63);
  };
  panel(0, 'Overall score (AI rubric)', ai ? `${ai.overall.toFixed(1)} / 100` : 'n/a', ai ? `Grade ${ai.grade}` : 'AI engine not configured');
  panel(1, 'PS alignment', ai ? ai.alignmentVerdict.toUpperCase() : 'n/a', ai ? `Detected ${ai.detectedPS.id || '-'}` : 'Keyword hint: ' + (heur.psRanking[0]?.id || '-'));
  panel(2, 'Engineering hygiene', `${heur.hygieneScore} / 100`, `${heur.checks.filter((c) => c.status === 'pass').length} of ${heur.checks.filter((c) => c.status !== 'info').length} checks passed`);
  y += boxH + 14;
  if (ai?.verdict) para(`Verdict: ${ai.verdict}`, { style: 'bolditalic', color: NAVY, size: 10.2 });

  // ---------------- Submission materials
  const md = ing.media;
  if (md) {
    heading('Submission materials');
    table({
      head: [['Item', 'Status', 'Location / link']],
      body: [
        ...(md.pdfs.length ? md.pdfs.slice(0, 6).map((p, i) => [i ? 'Additional PDF' : 'Presentation PDF', 'PRESENT', `${p.path}${p.pages ? ` (${p.pages} pages)` : ''}`])
          : [['Presentation PDF', md.decks.length ? 'PARTIAL' : 'MISSING', md.decks.length ? `Only ${md.decks.map((d) => d.path).join(', ')}` : 'Not found in repository']]),
        ...(md.videos.length ? md.videos.slice(0, 5).map((v, i) => [i ? 'Additional video' : 'Demo video', v.provider === 'youtube' ? 'PRESENT' : 'PARTIAL',
          `${v.url}\nFound in: ${v.sources.map((x) => (x.page ? `${x.file} p.${x.page}` : x.file)).join(', ')}`])
          : [['Demo video', 'MISSING', 'No video link in README, documentation or slides']]),
      ],
      columnStyles: { 0: { cellWidth: 110, fontStyle: 'bold' }, 1: { cellWidth: 58 } }, ...statusCell(1),
    });
  }

  // ---------------- AI sections
  if (ai) {
    heading('Executive summary');
    para(ai.summary);
    if (ai.detectedPS.rationale) para(`Problem-statement match: ${ai.detectedPS.rationale}`, { color: MUTED, size: 9.2 });

    heading('Rubric assessment');
    table({
      head: [['Criterion', 'Weight', 'Score', '', 'Justification']],
      body: RUBRIC.map((c) => [c.label, `${c.weight}%`, `${ai.scores[c.key].score}/10`, '', ai.scores[c.key].justification || '-']).concat([
        [{ content: 'Weighted total', styles: { fontStyle: 'bold' } }, '100%', { content: `${ai.overall.toFixed(1)}`, styles: { fontStyle: 'bold' } }, '', `Grade ${ai.grade}`],
      ]),
      columnStyles: { 0: { cellWidth: 118, fontStyle: 'bold' }, 1: { cellWidth: 40, halign: 'center' }, 2: { cellWidth: 40, halign: 'center' }, 3: { cellWidth: 52 }, 4: { cellWidth: 'auto' } },
      didDrawCell: (d) => {
        if (d.section === 'body' && d.column.index === 3 && d.row.index < RUBRIC.length) {
          const v = ai.scores[RUBRIC[d.row.index].key].score / 10;
          const bx = d.cell.x + 5; const by = d.cell.y + 7; const bw = d.cell.width - 10;
          doc.setFillColor(232, 229, 220); doc.rect(bx, by, bw, 5, 'F');
          doc.setFillColor(...(v >= 0.7 ? STATUS_COL.pass : v >= 0.5 ? STATUS_COL.warn : STATUS_COL.fail)); doc.rect(bx, by, bw * v, 5, 'F');
        }
      },
    });

    heading('Technical overview');
    sub('What the implementation does'); para(ai.whatItDoes);
    sub('Architecture'); para(ai.architecture);
    if (ai.techStack.length) { sub('Technology stack'); para(ai.techStack.join(', ')); }
    sub('Reproducibility'); para(`${(ai.reproducibility.rating || 'n/a').toUpperCase()} - ${ai.reproducibility.notes}`);

    heading('Deliverables against problem statement');
    table({ head: [['Expected deliverable', 'Status', 'Evidence']],
      body: ai.deliverables.map((d) => [d.item, d.status.toUpperCase(), d.evidence]),
      columnStyles: { 0: { cellWidth: 170 }, 1: { cellWidth: 60 } }, ...statusCell(1) });

    heading('Findings');
    sub('Strengths'); bullets(ai.strengths);
    sub('Weaknesses'); bullets(ai.weaknesses);
    sub('Red flags / integrity concerns'); bullets([...ai.redFlags, ...heur.flags], { color: [140, 30, 20] });

    if (ai.claims.length) {
      heading('Claims versus evidence');
      table({ head: [['Claim', 'Verified', 'Evidence']], body: ai.claims.map((c) => [c.claim, c.verified.toUpperCase(), c.evidence]),
        columnStyles: { 0: { cellWidth: 190 }, 1: { cellWidth: 58 } }, ...statusCell(1) });
    }
  } else {
    heading('Findings (static analysis)');
    para('No AI engine was configured for this evaluation. The report contains deterministic checks only; rubric scores, deliverable mapping and viva questions require an AI engine (see Settings in the tool).', { color: MUTED, style: 'italic' });
    sub('Automated flags'); bullets(heur.flags, { color: [140, 30, 20] });
  }

  // ---------------- Static checks
  heading('Engineering and hygiene checks');
  table({ head: [['Check', 'Result', 'Detail']], body: heur.checks.map((c) => [c.label, c.status.toUpperCase(), c.detail]),
    columnStyles: { 0: { cellWidth: 140, fontStyle: 'bold' }, 1: { cellWidth: 48 } }, ...statusCell(1) });

  // ---------------- Repo stats
  heading('Repository statistics');
  const cm = heur.commits;
  table({
    head: [['Metric', 'Value', 'Metric', 'Value']],
    body: [
      ['Total files', ing.stats.fileCount, 'Text files analysed', ing.stats.fetchedFiles],
      ['Directories', ing.stats.dirCount, 'Source lines (non-blank)', heur.loc.toLocaleString()],
      ['Total commits', cm.total, 'Active days', cm.activeDays],
      ['First commit (sampled)', cm.first ? cm.first.toISOString().slice(0, 10) : '-', 'Latest commit', cm.last ? cm.last.toISOString().slice(0, 10) : '-'],
      ['Contributors', ing.contributors.length, 'Stars / forks', `${ing.repo.stars} / ${ing.repo.forks}`],
      ['Created', String(ing.repo.createdAt).slice(0, 10), 'Licence', ing.repo.license || '-'],
    ],
    columnStyles: { 0: { textColor: MUTED }, 2: { textColor: MUTED } },
  });
  if (heur.languages.length) {
    sub('Language composition');
    table({ head: [['Language', 'Bytes', 'Share']], body: heur.languages.slice(0, 10).map((l) => [l.name, l.bytes.toLocaleString(), `${l.pct.toFixed(1)}%`]),
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } } });
  }
  if (Object.keys(cm.authors).length) {
    sub('Commit authorship (latest 100 commits)');
    table({ head: [['Author', 'Commits']], body: Object.entries(cm.authors).sort((a, b) => b[1] - a[1]).map(([a, n]) => [a, n]), columnStyles: { 1: { halign: 'right' } } });
  }
  sub('Problem-statement keyword affinity (heuristic)');
  table({ head: [['PS', 'Title', 'Affinity', 'Matched terms']],
    body: heur.psRanking.slice(0, 5).map((r) => [r.id, r.title, r.score, r.hits.slice(0, 6).map((h) => h.kw).join(', ')]),
    columnStyles: { 0: { cellWidth: 48, fontStyle: 'bold' }, 1: { cellWidth: 190 }, 2: { cellWidth: 48, halign: 'center' } } });

  if (ai) {
    heading('Questions for the team (viva)');
    bullets(ai.questions, { marker: '#' });
    heading('Recommendations');
    bullets(ai.recommendations, { marker: '#' });
  }

  heading("Evaluator's remarks");
  if (meta.notes?.trim()) para(meta.notes);
  else {
    para('(No remarks entered.)', { color: MUTED, style: 'italic' });
  }
  ensure(70);
  y += 26;
  doc.setDrawColor(...INK); doc.setLineWidth(0.4);
  doc.line(M, y, M + 180, y); doc.line(M + CW - 180, y, M + CW, y);
  setFont('normal', 8.5, MUTED);
  doc.text(`Evaluator${meta.evaluator ? `: ${clean(meta.evaluator)}` : ''}`, M, y + 12);
  doc.text('Date', M + CW - 180, y + 12);
  y += 30;

  // ---------------- Appendix: tree
  doc.addPage(); y = M; sec = 0;
  setFont('bold', 12.5, NAVY, 'times'); doc.text('APPENDIX A.  DIRECTORY STRUCTURE', M, y); y += 6;
  doc.setDrawColor(...NAVY); doc.line(M, y, M + CW, y); y += 14;
  const treeLines = clean(ing.tree).split('\n');
  const maxLines = 420;
  setFont('normal', 6.8, INK, 'courier');
  for (const ln of treeLines.slice(0, maxLines)) {
    ensure(8.6);
    if (y === M) setFont('normal', 6.8, INK, 'courier');
    doc.text(ln.length > 120 ? `${ln.slice(0, 117)}...` : ln, M, y); y += 8.6;
  }
  if (treeLines.length > maxLines) { setFont('italic', 8, MUTED); doc.text(`... ${treeLines.length - maxLines} further lines omitted. Full tree available in the digest export.`, M, y + 6); }

  // ---------------- Footers
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...RULE); doc.setLineWidth(0.4); doc.line(M, H - 40, W - M, H - 40);
    setFont('normal', 7.2, MUTED);
    doc.text('AIORI-3 Repository Analyser - AI-assisted assessment; final judgement rests with the evaluation committee.', M, H - 28);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 28, { align: 'right' });
  }
  return doc;
}

export function downloadPdf(state) {
  const doc = buildPdf(state);
  const name = `AIORI3_Evaluation_${state.ing.repo.owner}_${state.ing.repo.name}_${new Date().toISOString().slice(0, 10)}.pdf`.replace(/[^\w.-]/g, '_');
  doc.save(name);
}
