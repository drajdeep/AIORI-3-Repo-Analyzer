// Side panel for viewing presentation PDFs (PDF.js) and playing demo videos.
import { getPdfDoc, pdfBlobUrl, sourceLabel } from './media.js';
import { esc, fmtBytes } from './util.js';

const $ = (s) => document.querySelector(s);
const WKEY = 'aiori3.viewerWidth';
let session = 0;          // invalidates in-flight renders when content changes
let pdfState = null;      // { doc, zoom, observer, pageObserver, entry }
let lists = { pdfs: [], videos: [] };

export function setViewerLists(media) {
  lists = { pdfs: media?.pdfs || [], videos: media?.videos || [] };
}

function panel() { return $('#viewer'); }

function openPanel(kind, title) {
  const v = panel();
  v.hidden = false;
  document.body.classList.add('viewer-open');
  $('#vKind').textContent = kind;
  $('#vTitle').textContent = title;
  requestAnimationFrame(() => v.classList.add('show'));
}

export function closeViewer() {
  session++;
  teardownPdf();
  const v = panel();
  v.classList.remove('show');
  document.body.classList.remove('viewer-open');
  $('#vBody').innerHTML = '';
  setTimeout(() => { if (!v.classList.contains('show')) v.hidden = true; }, 220);
}

function teardownPdf() {
  if (pdfState) {
    pdfState.observer?.disconnect();
    pdfState.pageObserver?.disconnect();
    pdfState = null;
  }
}

// ------------------------------------------------------------------ PDF

export async function openPdf(entry) {
  const my = ++session;
  teardownPdf();
  openPanel('Presentation PDF', entry.path);
  const others = lists.pdfs.length > 1
    ? `<select id="vPdfSel" class="vsel" aria-label="Choose PDF">${lists.pdfs.map((p, i) => `<option value="${i}" ${p.path === entry.path ? 'selected' : ''}>${esc(p.path)}</option>`).join('')}</select>` : '';
  $('#vTools').innerHTML = `
    ${others}
    <div class="vgroup">
      <button class="vbtn" id="vPrev" title="Previous page" type="button">‹</button>
      <input id="vPage" class="vpage" type="number" min="1" value="1" aria-label="Page number"><span class="vof" id="vOf">/ …</span>
      <button class="vbtn" id="vNext" title="Next page" type="button">›</button>
    </div>
    <div class="vgroup">
      <button class="vbtn" id="vZoomOut" title="Zoom out" type="button">−</button>
      <span class="vof" id="vZoom">Fit</span>
      <button class="vbtn" id="vZoomIn" title="Zoom in" type="button">+</button>
      <button class="vbtn wide" id="vFit" title="Fit width" type="button">Fit</button>
    </div>
    <div class="vgroup end">
      <button class="vbtn wide" id="vPop" type="button" title="Open in the browser's own PDF viewer">New tab ↗</button>
      <a class="vbtn wide" href="${esc(entry.ghUrl)}" target="_blank" rel="noopener">GitHub ↗</a>
    </div>`;
  $('#vPdfSel')?.addEventListener('change', (e) => openPdf(lists.pdfs[+e.target.value]));
  $('#vPop').onclick = async () => {
    const w = window.open('', '_blank');
    try { const u = await pdfBlobUrl(entry.url); if (w) w.location = u; else window.open(u, '_blank'); } catch (err) { w?.close(); alert(err.message); }
  };
  $('#vBody').innerHTML = `<div class="vloading">Loading ${esc(entry.path)} (${fmtBytes(entry.size)})…</div>`;

  let doc;
  try {
    doc = await getPdfDoc(entry.url);
  } catch (e) {
    if (my !== session) return;
    $('#vBody').innerHTML = `<div class="vloading err">${esc(e.message)}<br><a href="${esc(entry.ghUrl)}" target="_blank" rel="noopener">Open on GitHub ↗</a></div>`;
    return;
  }
  if (my !== session) return;
  const first = await doc.getPage(1);
  const base = first.getViewport({ scale: 1 });
  pdfState = { doc, zoom: 1, entry, ratio: base.height / base.width, rendered: new Map() };
  $('#vOf').textContent = `/ ${doc.numPages}`;
  $('#vPage').max = doc.numPages;
  layoutPages(my);

  const go = (n) => {
    n = Math.max(1, Math.min(doc.numPages, n));
    $('#vBody').querySelector(`[data-page="${n}"]`)?.scrollIntoView({ block: 'start' });
  };
  $('#vPrev').onclick = () => go(currentPage() - 1);
  $('#vNext').onclick = () => go(currentPage() + 1);
  $('#vPage').onchange = (e) => go(+e.target.value);
  const zoom = (z) => { pdfState.zoom = Math.max(0.5, Math.min(3, z)); $('#vZoom').textContent = pdfState.zoom === 1 ? 'Fit' : `${Math.round(pdfState.zoom * 100)}%`; const p = currentPage(); layoutPages(session); go(p); };
  $('#vZoomIn').onclick = () => zoom(pdfState.zoom + 0.25);
  $('#vZoomOut').onclick = () => zoom(pdfState.zoom - 0.25);
  $('#vFit').onclick = () => zoom(1);
}

function currentPage() { return Number($('#vPage')?.value) || 1; }

function layoutPages(my) {
  if (!pdfState) return;
  pdfState.observer?.disconnect();
  pdfState.pageObserver?.disconnect();
  const body = $('#vBody');
  const width = Math.floor((body.clientWidth - 32) * pdfState.zoom);
  const n = pdfState.doc.numPages;
  body.innerHTML = `<div class="vpages">${Array.from({ length: n }, (_, i) => `<div class="vpagebox" data-page="${i + 1}" style="width:${width}px;height:${Math.round(width * pdfState.ratio)}px"><span class="vpno">${i + 1}</span></div>`).join('')}</div>`;
  pdfState.observer = new IntersectionObserver((ents) => {
    for (const e of ents) if (e.isIntersecting) renderPage(e.target, width, my);
  }, { root: body, rootMargin: '800px 0px' });
  const vis = new Map();
  pdfState.pageObserver = new IntersectionObserver((ents) => {
    for (const e of ents) vis.set(+e.target.dataset.page, e.isIntersecting ? e.intersectionRect.height : 0);
    let best = 1; let bestH = -1;
    for (const [p, h] of vis) if (h > bestH || (h === bestH && p < best)) { best = p; bestH = h; }
    const inp = $('#vPage'); if (inp && document.activeElement !== inp) inp.value = best;
  }, { root: body, threshold: [0, 0.25, 0.5, 0.75, 1] });
  body.querySelectorAll('.vpagebox').forEach((el) => { pdfState.observer.observe(el); pdfState.pageObserver.observe(el); });
}

async function renderPage(box, width, my) {
  if (box.dataset.done || !pdfState) return;
  box.dataset.done = '1';
  const page = await pdfState.doc.getPage(+box.dataset.page);
  if (my !== session) return;
  const vp1 = page.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vp = page.getViewport({ scale: (width / vp1.width) * dpr });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${Math.round(width * (vp1.height / vp1.width))}px`;
  box.style.height = canvas.style.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise.catch(() => {});
  if (my !== session) return;
  box.appendChild(canvas);
  // Make hyperlinks in slides clickable (open in new tab).
  try {
    const ann = await page.getAnnotations();
    const scale = width / vp1.width;
    for (const a of ann) {
      if (!a.url || !a.rect) continue;
      const [x1, y1, x2, y2] = a.rect;
      const link = document.createElement('a');
      link.href = a.url; link.target = '_blank'; link.rel = 'noopener'; link.className = 'vlink'; link.title = a.url;
      Object.assign(link.style, { left: `${x1 * scale}px`, top: `${(vp1.height - y2) * scale}px`, width: `${(x2 - x1) * scale}px`, height: `${(y2 - y1) * scale}px` });
      box.appendChild(link);
    }
  } catch { /* ignore */ }
}

// ------------------------------------------------------------------ video

export function openVideo(v) {
  session++;
  teardownPdf();
  const label = v.provider === 'youtube' ? 'Demo video · YouTube' : `Demo video · ${v.provider}`;
  openPanel(label, v.url);
  const others = lists.videos.length > 1
    ? `<select id="vVidSel" class="vsel" aria-label="Choose video">${lists.videos.map((x, i) => `<option value="${i}" ${x.key === v.key ? 'selected' : ''}>${esc(x.provider)} · ${esc(x.id.slice(0, 24))} — ${esc(sourceLabel(x.sources[0]))}</option>`).join('')}</select>` : '';
  $('#vTools').innerHTML = `${others}<div class="vgroup end"><a class="vbtn wide primary" href="${esc(v.url)}" target="_blank" rel="noopener">Open on ${v.provider === 'youtube' ? 'YouTube' : 'site'} ↗</a></div>`;
  $('#vVidSel')?.addEventListener('change', (e) => openVideo(lists.videos[+e.target.value]));
  $('#vBody').innerHTML = `
    <div class="vvideo">
      ${v.embed ? `<div class="vframe"><iframe src="${esc(v.embed)}" title="Demo video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>`
        : `<div class="vloading">This link cannot be embedded. <a href="${esc(v.url)}" target="_blank" rel="noopener">Open it in a new tab ↗</a></div>`}
      <dl class="vmeta">
        <dt>Link</dt><dd><a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.url)}</a></dd>
        <dt>Found in</dt><dd>${v.sources.map((s) => esc(sourceLabel(s))).join('<br>')}</dd>
      </dl>
      <p class="vnote">If the player shows “Video unavailable” or “Playback on other websites has been disabled”, the owner has blocked embedding or the video is private — use “Open on YouTube”.</p>
    </div>`;
}

// ------------------------------------------------------------------ wiring

export function initViewer() {
  $('#vClose').onclick = closeViewer;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel().hidden && !document.querySelector('dialog[open]')) closeViewer();
  });
  try { const w = Number(localStorage.getItem(WKEY)); if (w) document.documentElement.style.setProperty('--viewer-w', `${w}px`); } catch { /* ignore */ }
  const handle = $('#vResize');
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const w = Math.max(360, Math.min(window.innerWidth - 120, window.innerWidth - ev.clientX));
      document.documentElement.style.setProperty('--viewer-w', `${w}px`);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      try { localStorage.setItem(WKEY, String(parseInt(getComputedStyle(document.documentElement).getPropertyValue('--viewer-w'), 10))); } catch { /* ignore */ }
      if (pdfState) { const p = currentPage(); layoutPages(session); $('#vBody').querySelector(`[data-page="${p}"]`)?.scrollIntoView({ block: 'start' }); }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}
