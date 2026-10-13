// Submission materials: presentation PDFs and demo-video links.
// PDFs are fetched from raw.githubusercontent.com and parsed in-browser with
// PDF.js (text + hyperlink annotations). Video links are collected from the
// README / documentation and from the slides themselves.

const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const RAW = 'https://raw.githubusercontent.com';
const MAX_PDF_BYTES = 40 * 1024 * 1024;
const MAX_TEXT_PAGES = 80;

const docCache = new Map(); // raw url -> Promise<PDFDocumentProxy>
let pdfjsPromise = null;

export function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfjsPromise) {
    pdfjsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS_URL;
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        resolve(window.pdfjsLib);
      };
      s.onerror = () => { pdfjsPromise = null; reject(new Error('PDF.js failed to load (network / content blocker).')); };
      document.head.appendChild(s);
    });
  }
  return pdfjsPromise;
}

export function getPdfDoc(url) {
  if (!docCache.has(url)) {
    const p = (async () => {
      const lib = await loadPdfJs();
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not download PDF (${res.status}).`);
      const data = new Uint8Array(await res.arrayBuffer());
      return lib.getDocument({ data, isEvalSupported: false }).promise;
    })();
    p.catch(() => docCache.delete(url));
    docCache.set(url, p);
  }
  return docCache.get(url);
}

export async function pdfBlobUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  const blob = new Blob([await res.arrayBuffer()], { type: 'application/pdf' });
  return URL.createObjectURL(blob);
}

// ------------------------------------------------------------------ links

const URL_RX = /\b(?:https?:\/\/|www\.)[^\s<>"'`)\]}|]+|\b(?:youtu\.be|(?:m\.)?youtube\.com)\/[^\s<>"'`)\]}|]+/gi;

export function youtubeId(u) {
  const m = String(u).match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#\s]*&)?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{11})/i);
  return m ? m[1] : null;
}

function startSeconds(u) {
  const m = String(u).match(/[?&#](?:t|start)=(?:(\d+)h)?(?:(\d+)m)?(\d+)?s?/);
  if (!m) return 0;
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}

export function classifyVideo(rawUrl) {
  let url = rawUrl.replace(/[.,;:!?*_]+$/, '');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const yt = youtubeId(url);
  if (yt) {
    const t = startSeconds(url);
    return { provider: 'youtube', id: yt, key: `yt:${yt}`, url: `https://www.youtube.com/watch?v=${yt}${t ? `&t=${t}s` : ''}`,
      embed: `https://www.youtube-nocookie.com/embed/${yt}?rel=0${t ? `&start=${t}` : ''}`, thumb: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` };
  }
  let m;
  if ((m = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#\s]*&)?id=)([\w-]{20,})/i))) {
    return { provider: 'google-drive', id: m[1], key: `gd:${m[1]}`, url, embed: `https://drive.google.com/file/d/${m[1]}/preview` };
  }
  if ((m = url.match(/vimeo\.com\/(?:video\/)?(\d{6,})/i))) {
    return { provider: 'vimeo', id: m[1], key: `vm:${m[1]}`, url, embed: `https://player.vimeo.com/video/${m[1]}` };
  }
  if ((m = url.match(/loom\.com\/(?:share|embed)\/([0-9a-f]{20,})/i))) {
    return { provider: 'loom', id: m[1], key: `lm:${m[1]}`, url, embed: `https://www.loom.com/embed/${m[1]}` };
  }
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url) || /(onedrive\.live\.com|1drv\.ms|dropbox\.com\/.*\.(mp4|mov))/i.test(url)) {
    return { provider: 'video file', id: url, key: `u:${url}`, url, embed: null };
  }
  return null;
}

function collectVideos(text, source, into) {
  const found = String(text || '').match(URL_RX) || [];
  for (const raw of found) {
    const v = classifyVideo(raw);
    if (!v) continue;
    const existing = into.get(v.key);
    if (existing) {
      if (!existing.sources.some((s) => s.file === source.file && s.page === source.page)) existing.sources.push(source);
    } else {
      into.set(v.key, { ...v, sources: [source] });
    }
  }
}

// ------------------------------------------------------------------ scan

function presentationScore(path, size) {
  const p = path.toLowerCase();
  const name = p.split('/').pop();
  let s = 0;
  if (/(ppt|presentation|slides?|deck|pitch|pptx|aiori|hackathon|demo|final|submission)/.test(name)) s += 3;
  if (/(^|\/)(docs?|presentation|slides|ppt|submission|deliverables?)\//.test(p) || !p.includes('/')) s += 1;
  if (/(paper|rfc|draft-|datasheet|manual|spec|thesis|reference|standard|ieee|arxiv|\d{4}\.\d{4,5})/.test(name)) s -= 3;
  if (size > 0 && size < 25 * 1024 * 1024) s += 0.5;
  return s;
}

async function extractPdf(doc, path, videos) {
  const pages = doc.numPages;
  const n = Math.min(pages, MAX_TEXT_PAGES);
  const parts = [];
  let landscape = 0;
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    if (vp.width > vp.height) landscape++;
    const tc = await page.getTextContent();
    let spaced = '';
    let glued = '';
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      spaced += it.str + (it.hasEOL ? '\n' : ' ');
      glued += it.str + (it.hasEOL ? '\n' : '');
    }
    const src = { file: path, page: i };
    collectVideos(spaced, src, videos);
    collectVideos(glued, src, videos);
    try {
      const ann = await page.getAnnotations();
      for (const a of ann) if (a.url) collectVideos(a.url, src, videos);
    } catch { /* ignore */ }
    const clean = spaced.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
    if (clean) parts.push(`--- Slide / page ${i} ---\n${clean}`);
    page.cleanup();
  }
  return { pages, landscape: landscape / Math.max(1, n) > 0.5, text: parts.join('\n\n'), textPagesRead: n };
}

/**
 * Finds presentation PDFs and video links; mutates `ing` by attaching
 * `ing.media` and adding the extracted slide text to the digest/files.
 */
export async function scanMedia(ing, { onProgress = () => {} } = {}) {
  const { owner, name } = ing.repo;
  const raw = (fullPath) => `${RAW}/${owner}/${name}/${ing.commitSha}/${fullPath.split('/').map(encodeURIComponent).join('/')}`;
  const blob = (fullPath) => `https://github.com/${owner}/${name}/blob/${ing.commitSha}/${fullPath.split('/').map(encodeURIComponent).join('/')}`;
  const skipDir = /(^|\/)(node_modules|\.git|venv|\.venv|site-packages|vendor)\//;

  const pdfs = ing.entries
    .filter((e) => e.type === 'file' && /\.pdf$/i.test(e.path) && !skipDir.test(e.path))
    .map((e) => ({ path: e.path, size: e.size, url: raw(e.fullPath), ghUrl: blob(e.fullPath), score: presentationScore(e.path, e.size) }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const decks = ing.entries
    .filter((e) => e.type === 'file' && /\.(pptx?|key|odp)$/i.test(e.path) && !skipDir.test(e.path))
    .map((e) => ({ path: e.path, size: e.size, url: raw(e.fullPath), ghUrl: blob(e.fullPath), ext: e.path.split('.').pop().toLowerCase() }));

  const videos = new Map();
  collectVideos(`${ing.repo.description} ${ing.repo.homepage}`, { file: 'Repository description' }, videos);
  const docFiles = ing.files.filter((f) => f.kind === 'doc' || /\.(md|markdown|rst|txt|html?)$/i.test(f.path))
    .sort((a, b) => (/^readme/i.test(a.path) ? -1 : 0) - (/^readme/i.test(b.path) ? -1 : 0));
  for (const f of docFiles) collectVideos(f.content, { file: f.path }, videos);

  // Parse the most presentation-like PDFs (up to 4) for text and links.
  const toParse = pdfs.slice(0, 4);
  let libError = null;
  for (let i = 0; i < toParse.length; i++) {
    const p = toParse[i];
    onProgress('media', `Reading ${p.path} (${i + 1}/${toParse.length})`, i / toParse.length);
    if (p.size > MAX_PDF_BYTES) { p.error = 'Too large to parse in-browser (> 40 MB); viewable on GitHub.'; continue; }
    try {
      const doc = await getPdfDoc(p.url);
      const r = await extractPdf(doc, p.path, videos);
      p.pages = r.pages;
      p.landscape = r.landscape;
      p.textPagesRead = r.textPagesRead;
      p.chars = r.text.length;
      if (r.text) {
        const body = `[Text extracted from PDF: ${r.pages} page(s)${r.pages > r.textPagesRead ? `, first ${r.textPagesRead} read` : ''}]\n\n${r.text.slice(0, 60000)}`;
        ing.files.push({ path: p.path, size: p.size, kind: 'slides', content: body, truncated: r.text.length > 60000,
          lines: body.split('\n').length, priority: 50 });
        ing.digest += `\n================================================\nFILE: ${p.path} (extracted text)\n================================================\n${body}\n`;
      } else {
        p.note = 'No extractable text (image-only slides).';
      }
    } catch (e) {
      p.error = e.message || 'Could not parse PDF.';
      if (/PDF\.js failed/.test(p.error)) libError = p.error;
    }
  }
  for (const p of pdfs) p.isPresentation = p.score >= 2 || !!p.landscape;
  if (pdfs.length && !pdfs.some((p) => p.isPresentation)) pdfs[0].isPresentation = true;
  pdfs.sort((a, b) => (b.isPresentation - a.isPresentation) || b.score - a.score);
  ing.files.sort((a, b) => a.priority - b.priority || a.path.localeCompare(b.path));
  ing.stats.digestChars = ing.digest.length;
  ing.stats.estTokens = Math.round(ing.digest.length / 4);

  const vids = [...videos.values()].sort((a, b) => {
    const rank = (v) => (v.provider === 'youtube' ? 0 : 1) + (v.sources.some((s) => /^readme/i.test(s.file)) ? 0 : 0.5) + (v.sources.some((s) => s.page) ? 0.2 : 0);
    return rank(a) - rank(b);
  });
  ing.media = { pdfs, decks, videos: vids, libError };
  onProgress('media', 'Submission materials indexed', 1);
  return ing.media;
}

export const sourceLabel = (s) => (s.page ? `${s.file} · p.${s.page}` : s.file);
