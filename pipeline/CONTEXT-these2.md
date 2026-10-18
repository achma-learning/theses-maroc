# These2.0 (FMPM theses) — AI Context File
_Last synced: 2026-10-17 @ a2472c9 (branch `claude/sweet-wozniak-31fpwg`: final FMPM classification as pass 0, `reclassify.py`). §2-§3 and part of §4/§6 still use the old `github-page/` / `vercel-page/` paths — now `these2/` and `pipeline/scripts/`._

## 1. What This Is (Plain English)
- **In one sentence:** a search engine and a stats dashboard for the ~4,000 medical theses defended at the Marrakech faculty of medicine (FMPM). It checks the faculty's own website every day and updates itself when something changed.
- **Why it exists:** the official catalogue (wd.fmpm.uca.ma) is one plain HTML page per year with no search and no stats. These2.0 (by Akram Ammour) added search, but its data froze in June 2024. This repo makes it current again, adds charts like the Fès faculty dashboard, and sorts every thesis into the faculty's official specialty list.
- **Who uses it:** public (med students, residents, faculty). Be careful with data accuracy; never invent thesis metadata, and always label guesses as guesses.
- **Vibe:** polished personal tool, two deliverables in one repo.

## 2. How To Run It
Two sub-projects, deliberately separate:
- **`github-page/`** = OUR site, plain HTML/JS, deployed on GitHub Pages. No build. Preview: `python -m http.server` at repo root → `http://localhost:8000/github-page/`.
- **`vercel-page/`** = the original Next.js app, upgraded, **to send back to its author** so he updates his site. `cd vercel-page && npm install && npm run dev` → `http://localhost:3000`.
- **Refresh the data by hand:** `pip install -r vercel-page/scripts/requirements.txt`, then `python vercel-page/scripts/update_theses.py` (about 1 min; prints "no change" if nothing moved), then `python vercel-page/scripts/build_charts.py`, then copy into github-page (exact commands in `README.md`).
- **Deploy:** automatic.
  - Every day at 04:17 UTC, `.github/workflows/update-data.yml` checks the sources. When the data changed it commits the data + redrawn charts the same day; on quiet days it commits nothing, except `status.json` on Mondays and on manual runs.
  - `.github/workflows/pages.yml` publishes `github-page/` (Pages source must be "GitHub Actions").
  - Vercel: project Root Directory = `vercel-page`, redeploys on push. Live: <https://thesefmpm3.vercel.app/search> (ours), <https://thesefmpm.vercel.app/> (Akram's original), <https://achma-learning.github.io/these2.0/github-page/> (Pages).
  - Manual run: Actions → Update data → Run workflow. Tick "redraw_charts" after editing `build_charts.py`.
- **Required env vars:** none.

## 3. Tech Stack
- **Pipeline:** Python 3.12 (CI), `requests`, `beautifulsoup4`, `matplotlib` (`vercel-page/scripts/requirements.txt`). The classifier is pure Python, with no ML library.
- **github-page:** vanilla HTML/CSS/JS, zero dependencies, zero build.
- **vercel-page:** Next.js 14.1.0 App Router, React 18, TypeScript 5, Tailwind 3, shadcn/ui (Radix), react-pdf 7, cheerio, iconv-lite (`vercel-page/package.json`).
- **External sources (read-only, public):**
  - `https://wd.fmpm.uca.ma/biblio/theses/annee-htm/<YEAR>.htm`: official list (year, n°, author, title, PDF). Source of truth for *which* theses exist. **It sends no CORS header**, so browsers on github.io can't read it: updates must happen server-side (GitHub Actions) or through the userscript.
  - `https://lib.fmpm.uca.ma/lib/opac_css/`: PMB library OPAC, used for president / rapporteur / jury / library category / keywords.
- **Official specialty list:** `vercel-page/docs/liste-des-specialites-fmpm.pdf` (42 specialties in 3 groups: médecine 23, chirurgie 14, biologie 5). Transcribed in `specialites.py: GROUPS`.
- **Userscript (companion):** greasyfork #600588 "FMPM thèses — recherche en ligne + export CSV" (namespace github.com/achma-learning/these). It runs ON wd.fmpm.uca.ma (no CORS issue). Its "Exporter CSV brut" output is the fallback data source (§6).
- **Inspiration (Fès faculty, FMPDF):** `cdim.fmp-usmba.ac.ma/stats/dashboard_theses.php` and `.../cartographie_2025/cartographie-theses.html`. Linked in every footer.

## 4. Code Map
- `vercel-page/scripts/update_theses.py`: **the data pipeline, start here.**
  - Steps: seed (existing JSON) → official year pages (or the userscript CSV for years that fail) → OPAC enrichment for new or incomplete years → `classify_all` → compare with the file on disk.
  - Writes `json/file.json` only if the data changed, `json/status.json` always, and `changed=true|false` to `$GITHUB_OUTPUT`.
- `pipeline/scripts/specialites.py`: official list (`GROUPS`), library-category → official mapping with title-keyword splits (`split_catalogue`), the `OBVIOUS` keyword list, Naive Bayes (`NaiveBayes`), `classify_all`, and `cross_validate` (accuracy check). `classify_all` passes:
  - **pass 0** (`load_facts`, `CLASSEMENT`): `archive/fmpm/theses-fmpm-specialites.csv`, keyed by the PDF name `theseNN-YY` → year + N°. Built in `achma-learning/these` by `archive/specialites/classer_fmpm.py` (one weighted vote: rapporteur's cover label 3, president's 2, library category 2, title 0.5-2). Its `Statut` becomes `specialiteSource` (`FACT_STATUS`). It wins for every thesis it covers.
  - **pass 1** library category: **always** stored in `specialiteCatalogue` (even when pass 0 won — `classer_fmpm.py` reads it back from `theses.json` as its library vote); sets `specialite` only if pass 0 didn't.
  - passes 2-3 (rapporteur history ≥ 3 theses / ≥ 60 %, then title words + Naive Bayes) only for theses neither pass 0 nor 1 covers (new theses not yet in the file).
- `pipeline/scripts/reclassify.py`: reruns `classify_all` on `these2/data/theses.json` **without re-reading the sites** (keeps `lastFetched`; prints "no change" if identical). Use after the classification CSV changed, then `build_charts.py`.
- `pipeline/scripts/build_charts.py`: 10 matplotlib charts, written as `<id>.png` + `<id>-dark.png`, plus `stats.json` (chart list with tables, KPIs, specialty→group map, `version` hash). Specialty/group charts are stacked in 3 columns (`SOURCES` + `BUCKET`): **Confirmée** (confirmée, vérifiée, catalogue) / **Probable** (probable, rapporteur) / **À vérifier ou titre seul** (à vérifier, titre); same legend in `charts.js`.
- `these2/index.html` + `these2/assets/app.js`: search (client-side over `data/theses.json`, URL-synced filters, "?" chips for guessed specialties: `isGuess` = rapporteur, titre, probable, à vérifier, with a tooltip saying why). `these2/assets/dashboard.js` marks the same guesses with « ? » in the table.
- `github-page/assets/charts.js`: **interactive SVG charts**, drawn in the browser from the `table` of each chart in `stats.json` (no library). One renderer per chart id in `RENDER` (bars, stacked bars, heatmap, top-N lists); an id with no renderer falls back to its PNG. Hover tooltip, keyboard focus, click → `onPick`.
- `github-page/dashboard.html` + `assets/dashboard.js`: fetches `stats.json`/`theses.json`/`status.json` with `cache: "no-cache"` on every visit, so charts update as soon as the Action commits new data (no PNG needed). A click on a mark (`applyPick`) filters the "Filtrage dynamique" table: year, group, specialty, city (title search), keyword (library tags), professor/rapporteur (same `prof_key` rule as `build_charts.py`). Bottom-right "⬇ PNG" button on each chart downloads the matplotlib PNG (dark one if the page is dark). Also CSV export and the "vérifié le" line.
- `vercel-page/app/(routes)/stats/page.tsx` (route `/stats`, was `/dashboard` — permanent redirect in `next.config.mjs`, query string kept): live charts (`components/dashboard/`, `lib/dashboard.ts`), prerendered at build; each chart has a « ⬇ PNG » button (bottom right) for its matplotlib image `public/stats/<id>.png` (mapping in `page.tsx`: `SHOWN`, `PNG_LABEL`); images with no live twin (`top-keywords`, `top-professors`) listed at the bottom.
- `vercel-page/types.d.ts`: the `These` type. New fields: `specialite`, `groupe`, `specialiteSource`, `specialiteConfiance`.
- `vercel-page/lib/renew-lib.ts` + `actions/renew-data.ts` + `app/api/renew-data`: the ORIGINAL TS scraper. Superseded; kept for the author.
- `these2.0-v1-original.zip`: read-only backup of the original code (git archive of `29a96f5`).

## 5. Rules For Editing This Code
- `CONTEXT.md` is the single context file. Update §7 after every change.
- **Never edit or delete `these2.0-v1-original.zip`.**
- Keep `github-page/` and `vercel-page/` independent: `vercel-page/` must work alone once copied to the author's repo. The Python scripts live in `vercel-page/scripts/`; github-page only receives copied output.
- The JSON format is a contract with the Next app. New fields must be optional. **Never overwrite the library's `category`**; official classification goes in `specialite` / `groupe`.
- **Every guess is flagged:** `specialiteSource` ∈ **confirmée | vérifiée | probable | à vérifier** (pass 0, theses in `theses-fmpm-specialites.csv`) or **catalogue | rapporteur | titre** (theses not yet in that file). Guesses = probable, à vérifier, rapporteur, titre: hatched bars on charts and "?" chips in the UI. `specialiteCatalogue` = the library category's official mapping, kept for every thesis that has one.
- **The classification CSVs come from `achma-learning/these`; never edit them here.** Public copies of `theses-fmpm-specialites.csv` and `theses-fmpm-page-de-garde.csv` have **no These2.0 column** (third-party data is not republished). Refresh: in `these`, `fetch_page1.py <csv> <dir> <tmp>` → `page_de_garde.py <dir>` → `classer_fmpm.py [theses.json]`; copy both CSVs here minus the These2.0 column; then `python pipeline/scripts/reclassify.py` and `python pipeline/scripts/build_charts.py --json these2/data/theses.json --out these2/stats`. Manual checks are made in `these` (`verifications-manuelles.csv`), never here.
- **The pipeline must stay deterministic** (same sources → same bytes). Change detection relies on it: no timestamps or randomness inside `data`, sorted output, `metadata={"Software": None}` on PNGs.
- Be polite to the faculty servers: `PAUSE_S = 1.0`, OPAC pages of 100, retries with backoff, no parallel requests. The user once stopped a 500-records-per-page OPAC query.
- Charts: one series = one hue (`#2a78d6` light / `#3987e5` dark), always light + dark PNGs, "Non classée" in gray and last, the legend in its own row under stacked bars.
- github-page stays zero-dependency, with no external scripts. Charts are SVG drawn by `charts.js`; matplotlib stays the PNG download option.
- **A new chart** = add it in `build_charts.py` (PNG + table, shows up with its PNG) and, to make it clickable, add a renderer in `charts.js: RENDER` keyed by the same id. Colours come from CSS variables (`--accent`, `--c0..c3`, `--inferred`, `--neutral`), never hard-coded.

## 6. Fragile Bits & Landmines
- **Change detection = output diff.** `update_theses.py` rebuilds everything and compares `canonical(data)` with the committed file. Unchanged means the file (and its `lastFetched`) is left alone. Anything non-deterministic added to the data would make every week look "changed".
- **Dynamic charts read `stats.json` tables, not `theses.json`.** They are only as fresh as the last pipeline run; a chart's numbers and its PNG always agree. A click filters from `theses.json`, so its count must equal the bar (checked: Pr M. BOUSKRAOUI 68, "traitement" 317, Pr L. ESSAADOUNI 236). If you change how `build_charts.py` counts something, change the matching filter in `dashboard.js`.
- **Cache-busting:** chart PNGs keep the same file names, so pages append `?v=<stats.version>` (a hash of the data). Remove it and visitors may see last month's chart.
- **Runner pinned to `ubuntu-24.04`** (not `ubuntu-latest`, which becomes Ubuntu 26 on 2026-10-19: `setup-python` may lack Python builds for a brand-new OS). Actions on Node 24 versions: `checkout@v5`, `setup-python@v6`. Move the pin deliberately, after a manual run on the new image.
- **Schedules die after 60 idle days** on public repos. Two guards, keep both: the Monday `status.json` commit (repo activity) and the « Keep the schedule alive » step (`gh api -X PUT …/actions/workflows/<file>/enable`, needs `permissions: actions: write`). GitHub also emails the owner before disabling; re-enable from the Actions tab.
- **The official list reuses thesis numbers** (2025-214, 2026-26/36/63: two different theses, same N°, same PDF link) and prints some lines twice (2023-125, 2025-329). `update_theses.py` keys a thesis by year + N°, and by year + N° + author (`author_key`: accents, case and word order ignored) only when two authors share a number; `specialites.py` pass 0 then picks the classification line of the same author (`load_facts` keeps both).
- **`pages.yml` uses `workflow_run`** because pushes made with `GITHUB_TOKEN` don't trigger other workflows. Don't "simplify" it to `push` only.
- **Userscript CSV fallback:** `vercel-page/json/official-export.csv` (header `Année,N°,Auteur,Titre,PDF (texte intégral),…`, UTF-8 with BOM). Used only for years the site doesn't answer. Delete it once the site is reachable again, or it stays a silent backup with old rows.
- **Encodings:** official pages are windows-1252 up to 2025 and UTF-8 from 2026; decode UTF-8 first, then fall back. The OPAC says ISO-8859-1 but sends cp1252 bytes, which `fix_c1()` repairs.
- **OPAC collapsed notices:** each page lists 100 notices but renders ~5. The rest come from `ajax.php?module=expand_notice` (`img[param]` values joined by `|*|*|`, 40 per call). Records are matched by the PDF name `theseNN-YY`; records without it are skipped.
- **Library lag:** the OPAC has had no category since 2024 and almost no 2025–2026 records. Recent theses now get their specialty from the cover-page vote (pass 0); only theses newer than the last `theses-fmpm-specialites.csv` fall back to title guesses.
- **Classifier accuracy (5-fold cross-validation, title only, the worst case):** 65 % overall; at the 0.9 threshold it covers 61 % of theses with ~82 % precision. `TITLE_THRESHOLD = 0.9` on purpose: 0.6 gave ~73 % and visibly wrong labels.
- **Rules in `split_catalogue` are heuristics:** library "Neurologie" mostly becomes Neurochirurgie (Marrakech has a big neurosurgery department), and "Chirurgie" is split by keywords. Médecine nucléaire currently has 0 theses.
- **Vercel:** the file system is read-only, so `/api/renew-data` can't persist there. Use the Action instead.
- **Skip on cleanup:** `vercel-page/json/file copy.json` (author's old snapshot). `vercel-page/.github/workflows/` is inert here on purpose: it's for the author's repo.

## 7. Current State
- **Last shipped (2026-10-16):**
  - Weekly check with change detection. Verified: a second run on unchanged sources gave "no change" and a byte-identical file (same md5).
  - `status.json` and a "vérifié le …" line on both sites; `?v=` cache-busting on charts.
  - Every thesis classified into the 42 official specialties and 3 groups: library 3,158 · rapporteur 223 · title 436 · still unclassified 197 of 4,014 (95 % classified).
  - New charts "par groupe" and "par spécialité officielle", stacked by classification source.
  - Userscript CSV fallback.
  - Earlier the same day: split into `github-page/` + `vercel-page/`, Python pipeline (3,219 → 4,014 theses), 10 matplotlib charts, Pages deploy, backup zip. PR: achma-learning/these2.0#1.
- **Shipped 2026-10-17:** interactive SVG dashboard (click → filters the table, "⬇ PNG" per chart), live-site links in README, Vercel deploy of `vercel-page/` (root directory = `vercel-page`). `vercel-page`'s own `/dashboard` still shows static PNGs.
- **Shipped 2026-10-17 (later):** repo merged into `achma-learning/theses-maroc` (`these2/` site, `pipeline/scripts/`, workflow `update-these2.yml`). **Final FMPM classification as pass 0**: every cover page of the 4 013 FMPM theses read in `these` (33 PDFs answer 404), one weighted vote → `theses.json` now confirmée 3 489 · probable 466 · à vérifier 47 · catalogue 7 · rapporteur 1 · titre 1 · 3 unclassified; dashboard shows 42/42 specialties. `reclassify.py`, `specialiteCatalogue` always stored, charts in 3 columns (Confirmée / Probable / À vérifier ou titre seul). `index.html` (all-faculties page) reads the same CSV (`statut:` field, facet, « ? »).
- **Working on now:** the owner checks the 49 « à vérifier » theses by hand in `these`; then copy + `reclassify.py`.
- **Next up:**
  1. Send `vercel-page/` to Akram Ammour (original author). Its Next "Categories" page still uses the library category; it could switch to `specialite`.
  2. Later, not now: also search FMPDF Fès theses (`https://cdim.fmp-usmba.ac.ma/e_theses/`, stats at `.../stats/`).
  3. Each weekly run adds new theses that pass 0 doesn't cover yet (they fall back to catalogue / rapporteur / titre): rerun the `these` cover-page steps for them from time to time. 16 theses can't be resolved (PDF 404 and absent from the OPAC).

## 8. Update Protocol (Verbatim)
> **For the AI Assistant:** When asked to "Update CONTEXT.md":
> 1. Re-run Phase 0 — check for new or changed `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` / `.github/` files, merge what's new, and re-run Phase 3 so each of them still points to `CONTEXT.md`.
> 2. Re-scan the tree, manifests, and `.github/workflows/` for drift.
> 3. Read our recent conversation for new decisions, fragile bits discovered, or shifted goals.
> 4. Refresh the `_Last synced_` line with today's date and current commit SHA.
> 5. Rewrite — do not append. One clean source of truth. Preserve still-true content, revise the rest.
> 6. Keep §1 and §2 in plain English. Keep the file under ~200 lines.
