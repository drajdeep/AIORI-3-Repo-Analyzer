// Deterministic static analysis — runs without any AI and feeds the AI as evidence.
import { PROBLEM_STATEMENTS } from './ps.js';

const SOURCE_EXT = /\.(py|pyx|js|mjs|cjs|ts|tsx|jsx|java|kt|go|rs|c|h|cc|cpp|cxx|hpp|cs|rb|php|swift|scala|sh|bash|r|jl|lua|dart|ex|exs|erl|hs|ml|clj|vue|svelte|sol|v|sv|vhd|vhdl|p4|yang|tcl|ned|bpf|ipynb|tf|rego|sql)$/i;

const SECRET_PATTERNS = [
  { name: 'AWS access key', rx: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Private key block', rx: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'GitHub token', rx: /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{30,}\b/ },
  { name: 'Google API key', rx: /\bAIza[0-9A-Za-z_-]{35}/ },
  { name: 'OpenAI-style secret key', rx: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { name: 'Groq API key', rx: /\bgsk_[A-Za-z0-9]{40,}\b/ },
  { name: 'Slack token', rx: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Hard-coded password', rx: /\b(?:password|passwd|pwd|secret)\s*[:=]\s*["'][^"'\s]{6,}["']/i },
];

const GENERIC_MSG = /^(update|updated|add files via upload|initial commit|first commit|commit|changes|fix|wip|test|upload|\.|minor|final|done|create [\w.\- ]+|update [\w.\- ]+|delete [\w.\- ]+|added|add)$/i;

function countOcc(hay, needle) {
  if (needle.length <= 3) {
    const rx = new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'g');
    return (hay.match(rx) || []).length;
  }
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1 && n < 500) { n++; i = hay.indexOf(needle, i + needle.length); }
  return n;
}

export function rankProblemStatements(ing) {
  const readme = (ing.files.find((f) => /^readme/i.test(f.path))?.content || '').toLowerCase();
  let corpus = `${ing.repo.description} ${ing.repo.topics.join(' ')} ${ing.entries.map((e) => e.path).join(' ')} `.toLowerCase();
  for (const f of ing.files) {
    if (corpus.length > 2_500_000) break;
    corpus += `\n${f.content.toLowerCase()}`;
  }
  const head = `${ing.repo.name} ${ing.repo.description} ${readme.slice(0, 4000)}`.toLowerCase();
  const out = PROBLEM_STATEMENTS.map((ps) => {
    let score = 0;
    const hits = [];
    for (const kw of ps.keywords) {
      const k = kw.toLowerCase();
      const c = countOcc(corpus, k);
      if (c > 0) {
        const boost = countOcc(head, k) > 0 ? 1.8 : 1;
        score += Math.log2(1 + Math.min(c, 60)) * boost;
        hits.push({ kw, count: c });
      }
    }
    const idMention = countOcc(head, ps.id.toLowerCase()) + countOcc(head, ps.id.toLowerCase().replace('-', ''));
    if (idMention) score += 25;
    score *= 0.6 + 0.4 * (hits.length / ps.keywords.length);
    return { id: ps.id, title: ps.title, domain: ps.domain, raw: score, hits: hits.sort((a, b) => b.count - a.count) };
  });
  const max = Math.max(...out.map((o) => o.raw), 1e-9);
  return out.map((o) => ({ ...o, score: Math.round((o.raw / max) * 100) })).sort((a, b) => b.raw - a.raw);
}

export function analyseCommits(ing) {
  const commits = ing.commits.filter((c) => c.date);
  const dates = commits.map((c) => new Date(c.date)).sort((a, b) => a - b);
  const byDay = {};
  for (const d of dates) { const k = d.toISOString().slice(0, 10); byDay[k] = (byDay[k] || 0) + 1; }
  const authors = {};
  for (const c of commits) authors[c.author] = (authors[c.author] || 0) + 1;
  const generic = commits.filter((c) => GENERIC_MSG.test(c.message.trim())).length;
  const uploads = commits.filter((c) => /add files via upload/i.test(c.message)).length;
  const first = dates[0] || null;
  const last = dates[dates.length - 1] || null;
  return {
    sampled: commits.length, total: ing.totalCommits, first, last,
    spanDays: first && last ? Math.max(1, Math.round((last - first) / 86400000) + 1) : 0,
    activeDays: Object.keys(byDay).length, byDay, authors,
    genericRatio: commits.length ? generic / commits.length : 0, uploads,
  };
}

export function runHeuristics(ing) {
  const paths = ing.entries.map((e) => e.path);
  const lower = paths.map((p) => p.toLowerCase());
  const has = (rx) => lower.some((p) => rx.test(p));
  const find = (rx) => paths.filter((p, i) => rx.test(lower[i]));
  const checks = [];
  const add = (id, label, status, detail, weight = 1) => checks.push({ id, label, status, detail, weight });

  // README
  const readmeFile = ing.files.find((f) => /^readme(\.|$)/i.test(f.path));
  if (!readmeFile) add('readme', 'README', 'fail', 'No root README found.', 2);
  else {
    const t = readmeFile.content;
    const secs = {
      setup: /(install|setup|set up|getting started|prerequisite|requirement)/i.test(t),
      usage: /(usage|how to run|running|run the|quick ?start|execute|demo)/i.test(t),
      results: /(result|evaluation|benchmark|experiment|metric|performance|finding)/i.test(t),
      design: /(architecture|design|overview|approach|methodology|system model|workflow)/i.test(t),
      team: /(team|contributor|member|author)/i.test(t),
    };
    const n = Object.values(secs).filter(Boolean).length;
    const words = t.split(/\s+/).length;
    const status = words > 300 && n >= 4 ? 'pass' : words > 80 && n >= 2 ? 'warn' : 'fail';
    const covered = Object.entries(secs).filter(([, v]) => v).map(([k]) => k);
    add('readme', 'README quality', status, `${words.toLocaleString()} words; covers ${covered.join(', ') || 'no standard sections'}.`, 2);
    const cmd = /```(bash|sh|shell|console|zsh|powershell|cmd)?[\s\S]*?(pip |python|npm |node |docker|make |go run|cargo|java |\.\/|sudo |bash |sh |mvn |gradle|ns3|waf|uvicorn|flask|streamlit)/i.test(t)
      || /^\s*\$\s+\S+/m.test(t);
    add('runinstr', 'Run instructions', cmd ? 'pass' : 'warn', cmd ? 'README contains executable commands.' : 'No command blocks found in README.', 1.5);
  }

  const lic = find(/^(license|licence|copying)(\.|$)/);
  add('license', 'Licence', lic.length || ing.repo.license ? 'pass' : 'warn',
    lic.length || ing.repo.license ? `${ing.repo.license || lic[0]}` : 'No licence file.', 0.5);

  const deps = find(/(^|\/)(requirements.*\.txt|pyproject\.toml|setup\.py|pipfile|environment\.ya?ml|package\.json|go\.mod|cargo\.toml|pom\.xml|build\.gradle(\.kts)?|cmakelists\.txt|makefile|gemfile|composer\.json|conanfile\.(txt|py)|wscript)$/);
  add('deps', 'Dependency manifest', deps.length ? 'pass' : 'warn', deps.length ? deps.slice(0, 5).join(', ') : 'No dependency/build manifest found.', 1);

  const tests = find(/(^|\/)(tests?|spec|__tests__)\/|(^|\/)(test_[^/]+|[^/]+_test\.[a-z]+|[^/]+\.(test|spec)\.[a-z]+)$/);
  add('tests', 'Automated tests', tests.length >= 3 ? 'pass' : tests.length ? 'warn' : 'fail',
    tests.length ? `${tests.length} test-related files.` : 'No tests detected.', 1.5);

  const ci = find(/^\.github\/workflows\/.+\.ya?ml$|(^|\/)\.gitlab-ci\.yml$|(^|\/)jenkinsfile$|(^|\/)\.circleci\//);
  add('ci', 'Continuous integration', ci.length ? 'pass' : 'warn', ci.length ? ci.slice(0, 3).join(', ') : 'No CI workflow.', 0.5);

  const cont = find(/(^|\/)(dockerfile|containerfile|docker-compose[^/]*\.ya?ml|compose\.ya?ml|vagrantfile|[^/]+\.clab\.ya?ml)$|(^|\/)topology\.ya?ml$/);
  add('container', 'Reproducible environment', cont.length ? 'pass' : 'warn',
    cont.length ? cont.slice(0, 4).join(', ') : 'No Dockerfile / compose / Vagrant / containerlab topology.', 1);

  const docsMd = find(/\.(md|rst|adoc|pdf)$/).filter((p) => !/^readme/i.test(p.split('/').pop()));
  const docsDir = has(/^docs?\//);
  add('docs', 'Supplementary documentation', docsDir || docsMd.length >= 2 ? 'pass' : docsMd.length ? 'warn' : 'warn',
    docsDir ? 'docs/ directory present.' : docsMd.length ? `${docsMd.length} additional document(s).` : 'Only README (or nothing).', 1);

  const evidence = find(/(^|\/)(results?|outputs?|plots?|figures?|figs|graphs|reports?|logs|evaluation|benchmarks?|measurements?|experiments?)\//)
    .concat(find(/\.(png|svg|jpg|jpeg|pdf|csv|pcap|pcapng|log)$/).filter((p) => !/(logo|icon|favicon|badge|screenshot|banner)/i.test(p)));
  const nbOut = ing.files.some((f) => f.kind === 'notebook' && f.content.includes('# [output]'));
  const evCount = new Set(evidence).size;
  add('evidence', 'Results / experimental evidence', evCount >= 3 || nbOut ? 'pass' : evCount ? 'warn' : 'fail',
    evCount ? `${evCount} result/figure/data artefacts${nbOut ? '; notebooks contain outputs' : ''}.` : nbOut ? 'Notebook outputs present.' : 'No results, plots, logs or measurement data committed.', 1.5);

  add('gitignore', '.gitignore', has(/(^|\/)\.gitignore$/) ? 'pass' : 'warn', has(/(^|\/)\.gitignore$/) ? 'Present.' : 'Missing.', 0.3);

  // Secrets
  const secretHits = [];
  for (const f of ing.files) {
    if (/\.(md|rst|txt)$/i.test(f.path)) continue;
    for (const s of SECRET_PATTERNS) {
      if (s.rx.test(f.content)) {
        if (s.name === 'Hard-coded password' && /(example|sample|changeme|your[_-]?password|<|\$\{|os\.environ|getenv|process\.env|xxxx|\*\*\*)/i.test(f.content.match(s.rx)[0])) continue;
        secretHits.push({ file: f.path, type: s.name });
      }
    }
  }
  const envFiles = find(/(^|\/)\.env$|(^|\/)\.env\.(local|prod|production|dev)$/);
  for (const e of envFiles) secretHits.push({ file: e, type: 'Committed .env file' });
  add('secrets', 'Secret leakage scan', secretHits.length ? 'fail' : 'pass',
    secretHits.length ? secretHits.slice(0, 6).map((h) => `${h.type} in ${h.file}`).join('; ') : 'No credential patterns detected.', 1.5);

  // Repo hygiene
  const junk = find(/(^|\/)(node_modules|venv|\.venv|__pycache__|\.ipynb_checkpoints)\/|\.pyc$|(^|\/)\.ds_store$|\.(exe|dll|so|o|class|jar)$/);
  const bigBins = ing.entries.filter((e) => e.type === 'file' && e.size > 5e6);
  add('hygiene', 'Repository hygiene', junk.length || bigBins.length ? 'warn' : 'pass',
    junk.length || bigBins.length
      ? [junk.length ? `${junk.length} generated/vendored artefacts committed` : '', bigBins.length ? `${bigBins.length} files > 5 MB` : ''].filter(Boolean).join('; ')
      : 'No vendored or generated artefacts committed.', 0.5);

  // Code volume
  let loc = 0;
  let srcFiles = 0;
  for (const f of ing.files) {
    if (!SOURCE_EXT.test(f.path)) continue;
    srcFiles++;
    loc += f.content.split('\n').filter((l) => l.trim()).length;
  }
  add('volume', 'Implementation volume', loc >= 800 ? 'pass' : loc >= 200 ? 'warn' : 'fail',
    `${loc.toLocaleString()} non-blank source lines across ${srcFiles} source files.`, 1.5);

  // Commits
  const cm = analyseCommits(ing);
  const histStatus = cm.total >= 15 && cm.activeDays >= 3 ? 'pass' : cm.total >= 5 ? 'warn' : 'fail';
  add('history', 'Commit history', histStatus,
    `${cm.total} commits over ${cm.spanDays} day(s), ${cm.activeDays} active day(s)` +
    (cm.uploads ? `; ${cm.uploads} web "upload" commit(s)` : '') +
    (cm.genericRatio > 0.5 ? `; ${Math.round(cm.genericRatio * 100)}% generic messages` : '') + '.', 1);

  const humans = ing.contributors.filter((c) => c.type !== 'Bot');
  add('collab', 'Contributors', humans.length >= 2 ? 'pass' : 'info', `${humans.length} contributor(s).`, 0.5);

  if (ing.repo.isFork) add('fork', 'Fork status', 'warn', `Fork of ${ing.repo.parent || 'another repository'} — verify original contribution.`, 1);

  // Submission materials (presentation PDF + demo video), see media.js
  const media = ing.media;
  if (media) {
    const pres = media.pdfs.filter((p) => p.isPresentation);
    if (media.pdfs.length) {
      add('slides', 'Presentation PDF', 'pass',
        `${pres.length ? pres.map((p) => p.path).slice(0, 2).join(', ') : media.pdfs[0].path}${media.pdfs.length > 1 ? ` (+${media.pdfs.length - 1} more PDF)` : ''}.`, 1);
    } else if (media.decks.length) {
      add('slides', 'Presentation PDF', 'warn', `Slides committed only as ${media.decks.map((d) => d.path).join(', ')} — PDF expected.`, 1);
    } else {
      add('slides', 'Presentation PDF', 'fail', 'No presentation PDF found in the repository.', 1);
    }
    const yt = media.videos.filter((v) => v.provider === 'youtube');
    if (yt.length) add('video', 'Demo video link', 'pass', `${yt.length} YouTube link(s) — found in ${[...new Set(yt.flatMap((v) => v.sources.map((s) => s.file)))].slice(0, 3).join(', ')}.`, 1);
    else if (media.videos.length) add('video', 'Demo video link', 'warn', `Video link on ${media.videos[0].provider} (not YouTube): ${media.videos[0].url}`, 1);
    else add('video', 'Demo video link', 'fail', 'No video link found in README, documentation or slides.', 1);
  }

  // Score
  let got = 0;
  let tot = 0;
  for (const c of checks) {
    if (c.status === 'info') continue;
    tot += c.weight;
    got += c.weight * (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0);
  }
  const hygieneScore = tot ? Math.round((got / tot) * 100) : 0;

  const flags = [];
  if (secretHits.length) flags.push('Possible credentials committed to the repository.');
  if (cm.total <= 3) flags.push(`Very short history (${cm.total} commit${cm.total === 1 ? '' : 's'}) — possible bulk upload; verify development timeline.`);
  if (cm.uploads >= 3) flags.push('Multiple files added via GitHub web upload rather than version-controlled development.');
  if (loc < 200) flags.push('Very little source code relative to a full prototype.');
  if (ing.repo.isFork) flags.push('Repository is a fork — distinguish team work from upstream code.');
  if (media && !media.pdfs.length) flags.push('Mandatory presentation PDF is missing from the repository.');
  if (media && !media.videos.length) flags.push('No demo video link found (README / documentation / slides).');
  if (ing.treeTruncated) flags.push('GitHub truncated the file tree (very large repository); analysis is partial.');

  const languages = Object.entries(ing.languages).sort((a, b) => b[1] - a[1]);
  const langTotal = languages.reduce((s, [, v]) => s + v, 0) || 1;

  return {
    checks, hygieneScore, flags, secretHits, loc, srcFiles,
    commits: cm,
    languages: languages.map(([name, bytes]) => ({ name, bytes, pct: (bytes / langTotal) * 100 })),
    psRanking: rankProblemStatements(ing),
  };
}
