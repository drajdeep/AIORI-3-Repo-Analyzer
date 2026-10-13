# AIORI-3 Repository Analyser

AI-assisted technical evaluation of public GitHub repositories submitted to the **AIORI-3 Hackathon**.
Evaluators and mentors paste a repository link; the tool reads the repository in the browser, builds a
[gitingest](https://gitingest.com)-style text digest, runs deterministic checks, asks an LLM to assess the
work against the selected problem statement, and produces an on-screen evaluation record plus a
downloadable PDF report. No cloning, no downloads, no server.

## What it produces

| Output | Description |
|---|---|
| Evaluation record | Overall weighted score, grade, PS-alignment verdict, engineering-hygiene score |
| Rubric assessment | 8 weighted criteria (alignment, technical depth, completeness, experimental rigour, code quality, documentation, innovation, security/ethics) with file-cited justifications |
| Deliverables map | Expected deliverables derived from the problem statement — present / partial / missing |
| Claims vs evidence | README claims checked against what is actually in the code |
| Static checks | README quality, run instructions, tests, CI, containers, results evidence, secret leakage, commit timeline, contributors, code volume, fork status |
| Repository statistics | Languages, commit activity chart, authorship, PS keyword affinity |
| Viva questions | Probing questions for the demo / presentation round |
| Submission materials | Finds the team's presentation PDF and demo-video links (README, other docs, slide text and slide hyperlinks); slides open in a side-panel PDF viewer, videos play in the panel or open on YouTube in a new tab |
| Ask the repository | Chat grounded in the repository digest, answers cite file paths |
| PDF report | Official-style report with evaluator remarks, signature block and directory-tree appendix |
| Digest / JSON / CSV | Full gitingest-format digest, machine-readable evaluation, and a local evaluation register exportable to CSV |

## Deploy on GitHub Pages

1. Create a repository (e.g. `aiori3-repo-analyser`) and push these files to the `main` branch.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Open `https://<user-or-org>.github.io/aiori3-repo-analyser/`.

The site is fully static (HTML/CSS/ES modules). `.nojekyll` is included so Pages serves files as-is.
To test locally: `python3 -m http.server 8000` in this folder, then open `http://localhost:8000`
(ES modules do not load from `file://`).

## Configure the AI engine (free)

Open **Settings** in the tool and choose a provider. Keys are stored only in the evaluator's browser
(`localStorage`) and are sent only to that provider — **never commit keys to this repository.**

| Provider | Free key | Notes |
|---|---|---|
| Google Gemini *(recommended)* | <https://aistudio.google.com/app/apikey> | Large context, so the model can read most repositories in full |
| Groq | <https://console.groq.com/keys> | Very fast; free-tier token-per-minute limits are small, so the context budget defaults to 16k characters |
| OpenRouter | <https://openrouter.ai/keys> | Any free (`:free`) model |
| Pollinations | none | Keyless, best-effort, experimental |

**Models are chosen automatically.** The default model is `auto`: the tool asks the provider which models your key
can use and picks the strongest suitable one. Free model line-ups change often, so the tool also recovers on its own:
a retired or renamed model is replaced with a current one (and remembered); an overloaded model ("high demand") is
retried with back-off and then substituted for that request; short rate-limit waits are honoured; and if a request is
too large for the model, the context is halved and resent. **List models for this key** in Settings shows what is available
if you prefer to pin a specific model.

Model names are editable, so a newer free model can be used without code changes. Use **Test connection**
before an evaluation session. Without an engine the tool still runs all deterministic checks and produces a PDF.

**GitHub token (optional).** Unauthenticated, GitHub allows 60 API requests/hour per IP (~10 analyses).
A fine-grained personal access token with public-repository read access raises this to 5,000/hour.
File contents come from `raw.githubusercontent.com` and do not count against the limit.

## Usage tips

- Accepts `https://github.com/owner/repo`, `owner/repo`, and `/tree/<branch>/<subfolder>` links.
- Shareable deep links: `?repo=owner/name&ps=PS-016&team=T042` (auto-runs; add `&run=0` to only prefill).
- Choose the problem statement the team registered for; with **Auto-detect** the AI identifies it.
  A mismatch between the selected and detected statement is flagged.
- **View slides / Watch demo** open a resizable side panel (drag its left edge; Esc closes). Slide hyperlinks are clickable.
  Text extracted from the slides is added to the digest so the AI evaluates the presentation alongside the code.
  If YouTube refuses to embed a video (owner setting), use *Open on YouTube*.
- Remarks typed in **Evaluator's remarks** are included in the PDF.
- **Evaluation register** keeps a local list of analyses; export to CSV to consolidate across evaluators.

## How it works

```
GitHub REST API ──► metadata, languages, commits, contributors, recursive tree
raw.githubusercontent ──► text files (priority: docs → manifests → entry points → source → tests → data)
        │
        ▼
gitingest-format digest (tree + FILE blocks; notebooks flattened with outputs; data files truncated)
        │
        ├──► deterministic checks (js/heuristics.js) ──► hygiene score, flags, PS keyword affinity
        └──► LLM with rubric + PS scope (js/llm.js) ──► strict JSON ──► weighted score computed client-side
                                                                 │
                                         UI record (js/app.js) + PDF (js/report.js, jsPDF)
```

The weighted total is computed in the browser from per-criterion scores, so the model's arithmetic is never trusted.
Context is budgeted per provider; files that do not fit are listed to the model as omitted, and it is instructed
not to assume their contents.

## Files

```
index.html          page shell
css/style.css       light research-report theme
js/ps.js            problem statements, scopes, keywords, rubric weights  ← edit here
js/ingest.js        GitHub ingestion + gitingest-format digest
js/heuristics.js    deterministic checks and scoring
js/llm.js           providers, prompt, JSON parsing, repository Q&A
js/report.js        PDF report
js/media.js         presentation PDF discovery, slide text + video-link extraction (PDF.js)
js/viewer.js        side panel: PDF viewer and video player
js/app.js           UI and flow
js/util.js          helpers
```

### Customising

- **Problem statements:** `js/ps.js` contains a concise working scope for each PS, written from its title.
  Replace the `scope` text with the official problem descriptions to sharpen alignment and deliverable checks.
- **Rubric:** edit `RUBRIC` in `js/ps.js` (weights must sum to 100). The prompt, UI, PDF and CSV follow automatically.

## Limitations

- Public repositories only. Very large repositories are digested up to a budget (4M characters, 1,500 files);
  the AI sees a prioritised subset that fits the chosen provider's context.
- Branch names containing `/` in `/tree/` URLs are not supported; use the default branch link instead.
- Scores are advisory and must be confirmed by the evaluation committee.

## Licence

MIT
