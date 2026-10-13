// In-browser, gitingest-style repository ingestion.
// Uses the public GitHub REST API (metadata, tree, commits) and
// raw.githubusercontent.com (file contents). Both are CORS-enabled, so the
// whole pipeline runs client-side and works on GitHub Pages.

const GH = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

const TEXT_EXT = new Set((
  'md markdown rst txt adoc org py pyi pyx ipynb js mjs cjs ts tsx jsx java kt kts go rs c h cc cpp cxx hpp hh hxx ' +
  'cs fs rb php swift m mm scala sh bash zsh fish ps1 psm1 bat cmd pl pm r jl lua dart ex exs erl hrl hs ml mli ' +
  'clj cljs elm vue svelte astro html htm css scss sass less json jsonc json5 yaml yml toml ini cfg conf cnf ' +
  'properties xml xsd xsl yang p4 proto thrift graphql gql sql tf tfvars hcl nix cmake mk make gradle groovy csv ' +
  'tsv tex bib sol v sv vh vhd vhdl s asm ned msg tcl awk sed service socket timer j2 jinja jinja2 tpl tmpl ' +
  'mustache hbs ejs rego cue zone bpf env example sample http rest lock2 dot gv mermaid mmd plantuml puml'
).split(/\s+/));

const NAME_RX = /^(dockerfile|containerfile|makefile|gnumakefile|vagrantfile|procfile|jenkinsfile|license|licence|copying|notice|readme|changelog|contributing|authors|codeowners|gemfile|pipfile|rakefile|brewfile|justfile|\.gitignore|\.dockerignore|\.gitattributes|\.editorconfig|\.env\.example|\.env\.sample)(\..*)?$/i;

export const SKIP_DIR = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', '__pycache__', '.venv', 'venv',
  '.idea', '.vscode', '.next', '.nuxt', '.svelte-kit', 'coverage', 'site-packages', '.gradle', 'obj',
  '.mypy_cache', '.pytest_cache', '.tox', 'bower_components', 'Pods', 'DerivedData', '.terraform',
  '.cache', '.parcel-cache', '.ipynb_checkpoints', '.eggs',
]);

const LOCK_RX = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|go\.sum|composer\.lock|Gemfile\.lock|Pipfile\.lock|uv\.lock|bun\.lockb)$/i;
const MIN_RX = /\.(min\.js|min\.css|map|bundle\.js|chunk\.js)$/i;
const DATA_EXT = new Set(['csv', 'tsv', 'json', 'xml', 'sql']);

export function parseRepoUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Please enter a GitHub repository URL.');
  s = s.replace(/^git\+/, '').replace(/^git@github\.com:/i, 'https://github.com/').replace(/\.git$/, '').replace(/\/+$/, '');
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) s = `https://github.com/${s}`;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch { throw new Error('That does not look like a valid URL.'); }
  if (!/(^|\.)github\.com$/i.test(u.hostname)) throw new Error('Only public github.com repositories are supported.');
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2) throw new Error('URL must point to a repository, e.g. https://github.com/owner/repo');
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, '');
  let ref = null;
  let subpath = '';
  if ((parts[2] === 'tree' || parts[2] === 'blob') && parts[3]) {
    ref = decodeURIComponent(parts[3]);
    subpath = parts.slice(4).map(decodeURIComponent).join('/');
  }
  return { owner, repo, ref, subpath, url: `https://github.com/${owner}/${repo}` };
}

class GitHubError extends Error {}

async function gh(path, token, { raw = false } = {}) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(GH + path, { headers });
  } catch {
    throw new GitHubError('Network error while contacting the GitHub API. Check your connection.');
  }
  if (res.status === 404) throw new GitHubError('Repository not found, or it is not public.');
  if (res.status === 401) throw new GitHubError('The GitHub token in Settings was rejected (401). Remove or replace it.');
  if (res.status === 403 || res.status === 429) {
    if (res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
      const when = reset ? new Date(reset).toLocaleTimeString() : 'later';
      throw new GitHubError(`GitHub API rate limit reached${token ? '' : ' (60 requests/hour without a token)'}. ` +
        `Add a GitHub token in Settings, or retry after ${when}.`);
    }
    throw new GitHubError(`GitHub API refused the request (${res.status}).`);
  }
  if (res.status === 409) throw new GitHubError('Repository is empty (no commits yet).');
  if (!res.ok) throw new GitHubError(`GitHub API error ${res.status}.`);
  if (raw) return res;
  if (res.status === 204) return [];
  return res.json();
}

async function countCommits(owner, repo, branch, token) {
  const res = await gh(`/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=1`, token, { raw: true });
  const link = res.headers.get('link') || '';
  const m = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
  if (m) return Number(m[1]);
  const arr = await res.json();
  return Array.isArray(arr) ? arr.length : 0;
}

export function classify(path, size, maxFileBytes) {
  const segs = path.split('/');
  const name = segs[segs.length - 1];
  for (const s of segs.slice(0, -1)) if (SKIP_DIR.has(s)) return { include: false, reason: 'excluded directory' };
  if (LOCK_RX.test(path)) return { include: false, reason: 'lock file' };
  if (MIN_RX.test(name)) return { include: false, reason: 'minified / bundled' };
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  const isText = TEXT_EXT.has(ext) || NAME_RX.test(name);
  if (!isText) return { include: false, reason: 'binary / non-text' };
  if (ext === 'ipynb') {
    if (size > 8e6) return { include: false, reason: 'notebook too large' };
    return { include: true, kind: 'notebook' };
  }
  if (DATA_EXT.has(ext) && (ext === 'csv' || ext === 'tsv' || size > 20000)) {
    if (size > 2e6) return { include: false, reason: 'large data file (listed only)' };
    return { include: true, kind: 'data' };
  }
  if (size > maxFileBytes) return { include: false, reason: `too large (${Math.round(size / 1024)} KB)` };
  if (/\.(md|markdown|rst|adoc|txt|org|tex)$/i.test(name) || /^readme/i.test(name)) return { include: true, kind: 'doc' };
  if (/\.(json|ya?ml|toml|ini|cfg|conf|xml|properties|env|example)$/i.test(name) || NAME_RX.test(name)) return { include: true, kind: 'config' };
  return { include: true, kind: 'source' };
}

// Lower value = more important for an evaluator (and for the LLM context).
export function filePriority(path) {
  const p = path.toLowerCase();
  const name = p.split('/').pop();
  const depth = p.split('/').length - 1;
  let tier;
  if (/^readme(\.|$)/.test(name)) tier = depth === 0 ? 0 : 1;
  else if (/^(license|licence|copying)/.test(name)) tier = 7;
  else if (/\.(md|rst|adoc|txt|tex)$/.test(name) && (/(^|\/)docs?\//.test(p) || depth === 0)) tier = 1;
  else if (/^(requirements.*\.txt|pyproject\.toml|setup\.py|setup\.cfg|package\.json|go\.mod|cargo\.toml|pom\.xml|build\.gradle(\.kts)?|cmakelists\.txt|makefile|dockerfile|containerfile|docker-compose.*\.ya?ml|compose\.ya?ml|environment\.ya?ml|.*\.clab\.ya?ml|vagrantfile)$/.test(name)
    || p.startsWith('.github/workflows/')) tier = 2;
  else if (/^(main|app|index|server|run|cli|__main__|manage|controller|simulate|simulation|train|evaluate|agent|gateway)\.[a-z0-9]+$/.test(name)) tier = 3;
  else if (/(^|\/)(tests?|spec|__tests__)\//.test(p) || /(^test_|_test\.|\.test\.|\.spec\.)/.test(name)) tier = 5;
  else if (/\.(csv|tsv)$/.test(name)) tier = 8;
  else if (/\.(json|xml|ya?ml|toml|ini|cfg|conf)$/.test(name)) tier = 6;
  else tier = 4;
  return tier * 100 + Math.min(depth, 9) * 10;
}

function notebookToText(json) {
  try {
    const nb = JSON.parse(json);
    const cells = nb.cells || nb.worksheets?.[0]?.cells || [];
    const out = [];
    for (const c of cells) {
      const src = Array.isArray(c.source) ? c.source.join('') : (c.source || (Array.isArray(c.input) ? c.input.join('') : c.input) || '');
      out.push(`# %% [${c.cell_type}]\n${src}`);
      if (c.cell_type === 'code' && Array.isArray(c.outputs)) {
        let o = '';
        for (const op of c.outputs) {
          const t = op.text || op.data?.['text/plain'];
          if (t) o += Array.isArray(t) ? t.join('') : t;
          if (op.data && (op.data['image/png'] || op.data['image/svg+xml'])) o += '[figure output]\n';
        }
        if (o.trim()) out.push(`# [output]\n${o.slice(0, 1500)}${o.length > 1500 ? '\n... [output truncated]' : ''}`);
      }
    }
    return out.join('\n\n');
  } catch {
    return '[notebook could not be parsed]';
  }
}

function truncateData(text) {
  const lines = text.split('\n');
  if (lines.length <= 40) return { text, truncated: false };
  return { text: `${lines.slice(0, 40).join('\n')}\n... [${lines.length - 40} more lines truncated]`, truncated: true };
}

async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  });
  await Promise.all(workers);
}

export function buildTree(rootName, entries) {
  const root = { name: rootName, children: new Map(), dir: true };
  for (const e of entries) {
    const parts = e.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const last = i === parts.length - 1;
      if (!node.children.has(p)) node.children.set(p, { name: p, children: new Map(), dir: !last || e.type === 'dir' });
      const ch = node.children.get(p);
      if (!last) ch.dir = true;
      if (SKIP_DIR.has(p) && (!last || e.type === 'dir')) { ch.dir = true; ch.omitted = true; break; }
      node = ch;
    }
  }
  const lines = [`└── ${rootName}/`];
  const walk = (node, prefix) => {
    const kids = [...node.children.values()].sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
    kids.forEach((k, i) => {
      const last = i === kids.length - 1;
      lines.push(`${prefix}${last ? '└── ' : '├── '}${k.name}${k.dir ? '/' : ''}${k.omitted ? '  [contents omitted]' : ''}`);
      if (k.dir && !k.omitted) walk(k, prefix + (last ? '    ' : '│   '));
    });
  };
  walk(root, '    ');
  return lines.join('\n');
}

/**
 * Ingest a public GitHub repository into a gitingest-compatible digest.
 * @returns {Promise<object>} ingestion result
 */
export async function ingestRepo(input, opts = {}) {
  const {
    token = '', onProgress = () => {},
    maxFileBytes = 300_000, maxTotalChars = 4_000_000, maxFiles = 1500, concurrency = 8,
  } = opts;
  const ref = parseRepoUrl(input);
  const { owner, repo } = ref;
  const base = `/repos/${owner}/${repo}`;

  onProgress('meta', 'Fetching repository metadata');
  const meta = await gh(base, token);
  if (meta.private) throw new GitHubError('This repository is private; only public repositories can be analysed.');
  const branch = ref.ref || meta.default_branch;

  onProgress('tree', 'Reading file tree, commit history and contributors');
  const [languages, commitsRaw, totalCommits, contributorsRaw, treeRes] = await Promise.all([
    gh(`${base}/languages`, token).catch(() => ({})),
    gh(`${base}/commits?sha=${encodeURIComponent(branch)}&per_page=100`, token).catch(() => []),
    countCommits(owner, repo, branch, token).catch(() => null),
    gh(`${base}/contributors?per_page=100&anon=1`, token).catch(() => []),
    gh(`${base}/git/trees/${encodeURIComponent(branch)}?recursive=1`, token),
  ]);

  const commits = (Array.isArray(commitsRaw) ? commitsRaw : []).map((c) => ({
    sha: c.sha,
    date: c.commit?.author?.date || c.commit?.committer?.date,
    author: c.author?.login || c.commit?.author?.name || 'unknown',
    message: (c.commit?.message || '').split('\n')[0],
  }));
  const contributors = (Array.isArray(contributorsRaw) ? contributorsRaw : []).map((c) => ({
    login: c.login || c.name || c.email || 'anonymous', contributions: c.contributions || 0, type: c.type,
  }));
  const commitSha = commits[0]?.sha || branch;

  const prefix = ref.subpath ? `${ref.subpath.replace(/\/+$/, '')}/` : '';
  const entries = (treeRes.tree || [])
    .filter((t) => !prefix || t.path.startsWith(prefix))
    .map((t) => ({
      path: prefix ? t.path.slice(prefix.length) : t.path,
      fullPath: t.path,
      type: t.type === 'tree' ? 'dir' : t.type === 'commit' ? 'submodule' : 'file',
      size: t.size || 0,
    }))
    .filter((e) => e.path);

  const candidates = [];
  const skipped = [];
  for (const e of entries) {
    if (e.type !== 'file') continue;
    const c = classify(e.path, e.size, maxFileBytes);
    if (c.include) candidates.push({ ...e, kind: c.kind });
    else skipped.push({ path: e.path, size: e.size, reason: c.reason });
  }
  candidates.sort((a, b) => filePriority(a.path) - filePriority(b.path) || a.path.localeCompare(b.path));

  const toFetch = candidates.slice(0, maxFiles);
  for (const c of candidates.slice(maxFiles)) skipped.push({ path: c.path, size: c.size, reason: 'file-count limit' });

  const files = [];
  let totalChars = 0;
  let done = 0;
  onProgress('files', `Fetching ${toFetch.length} text files`, 0);
  await pool(toFetch, concurrency, async (f) => {
    if (totalChars > maxTotalChars) {
      skipped.push({ path: f.path, size: f.size, reason: 'digest size budget' });
    } else {
      const url = `${RAW}/${owner}/${repo}/${commitSha}/${f.fullPath.split('/').map(encodeURIComponent).join('/')}`;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        let text = await res.text();
        if (text.startsWith('version https://git-lfs')) {
          skipped.push({ path: f.path, size: f.size, reason: 'Git LFS pointer' });
        } else if (text.includes('\u0000')) {
          skipped.push({ path: f.path, size: f.size, reason: 'binary content' });
        } else {
          let truncated = false;
          if (f.kind === 'notebook') text = notebookToText(text);
          if (f.kind === 'data') ({ text, truncated } = truncateData(text));
          if (text.length > 120_000) { text = `${text.slice(0, 120_000)}\n... [file truncated]`; truncated = true; }
          totalChars += text.length;
          files.push({ path: f.path, size: f.size, kind: f.kind, content: text, truncated,
            lines: text.split('\n').length, priority: filePriority(f.path) });
        }
      } catch {
        skipped.push({ path: f.path, size: f.size, reason: 'fetch failed' });
      }
    }
    done++;
    if (done % 4 === 0 || done === toFetch.length) onProgress('files', `Fetched ${done} / ${toFetch.length} files`, done / toFetch.length);
  });
  files.sort((a, b) => a.priority - b.priority || a.path.localeCompare(b.path));

  const rootName = `${owner}-${repo}${prefix ? `-${prefix.replace(/\//g, '-').replace(/-$/, '')}` : ''}`.toLowerCase();
  const tree = buildTree(rootName, entries);

  const stats = {
    fileCount: entries.filter((e) => e.type === 'file').length,
    dirCount: entries.filter((e) => e.type === 'dir').length,
    submodules: entries.filter((e) => e.type === 'submodule').length,
    textCandidates: candidates.length,
    fetchedFiles: files.length,
    totalBytes: entries.reduce((s, e) => s + (e.type === 'file' ? e.size : 0), 0),
    digestChars: 0,
    estTokens: 0,
  };

  const header = [
    `Repository: ${owner}/${repo}`,
    `Branch: ${branch}`,
    `Commit: ${commitSha}`,
    ref.subpath ? `Subpath: ${ref.subpath}` : null,
    `Files analyzed: ${files.length}`,
  ].filter(Boolean).join('\n');
  const body = files.map((f) => `================================================\nFILE: ${f.path}\n================================================\n${f.content}\n`).join('\n');
  const approxTokens = Math.round((header.length + tree.length + body.length) / 4);
  const digest = `${header}\nEstimated tokens: ${approxTokens.toLocaleString('en-US')}\n\nDirectory structure:\n${tree}\n\n${body}`;
  stats.digestChars = digest.length;
  stats.estTokens = approxTokens;

  return {
    ref, branch, commitSha,
    repo: {
      owner, name: repo, fullName: meta.full_name, url: meta.html_url, description: meta.description || '',
      homepage: meta.homepage || '', topics: meta.topics || [], stars: meta.stargazers_count, forks: meta.forks_count,
      watchers: meta.subscribers_count, openIssues: meta.open_issues_count, license: meta.license?.spdx_id || meta.license?.name || null,
      defaultBranch: meta.default_branch, createdAt: meta.created_at, pushedAt: meta.pushed_at, updatedAt: meta.updated_at,
      sizeKB: meta.size, isFork: meta.fork, parent: meta.parent?.full_name || null, archived: meta.archived,
      primaryLanguage: meta.language, ownerType: meta.owner?.type, avatar: meta.owner?.avatar_url,
    },
    languages: languages || {},
    commits, totalCommits: totalCommits ?? commits.length,
    contributors, entries, files, skipped, tree, digest, stats,
    treeTruncated: !!treeRes.truncated,
    fetchedAt: new Date().toISOString(),
  };
}
