# The FMPM thesis website — what we learned (for These2.0)

_Written 17/10/2026 from the work in `achma-learning/these` (userscripts, full refresh of the official list, cover page of every PDF read). Audience: [`achma-learning/these2.0`](https://github.com/achma-learning/these2.0), which analyses FMPM theses only. English on purpose (These2.0's docs are English). Every number below was measured on that day; re-measure before relying on it._

## 1. Map of the site

| What | URL | Notes |
|---|---|---|
| Home | `https://wd.fmpm.uca.ma/biblio/theses/Accueil.html` | Static HTML. Title still says « (2006-2025) », body says 2006-2026. One link per year. No robots.txt (404), no CSP, no CORS header. |
| Year page | `…/biblio/theses/annee-htm/<YYYY>.htm` | One `<tr>` per thesis: `N° · Auteur · Titre · TEXTE INTEGRAL`. **windows-1252 up to 2025, UTF-8 in 2026** (decode UTF-8 first, fall back if U+FFFD appears). CRLF, titles wrapped over several lines (collapse whitespace). |
| Full text | `…/annee-htm/FT/<YYYY>/these<NN>-<YY>.pdf` | `NN` = n° zero-padded to 2 digits (`these05-24.pdf`, `these166-25.pdf`). Server: openresty, `Accept-Ranges: bytes`, `Content-Length`, `ETag`, `Last-Modified`. |
| Article / abstract | `…/annee-htm/art/<YYYY>/article<NN>-<YY>.pdf` | Only **2006-2015** (1 095 links). |
| Library OPAC (PMB) | `https://lib.fmpm.uca.ma/lib/opac_css/` | Already used by These2.0 for jury/category; lags (no category since 2024, few 2025-26 records). |

### Quirks of the official list (export of 17/10/2026: 4 015 rows)
- **2 exact duplicates** and **6 n° slots used twice** (2023-125, 2025-214, 2025-329, 2026-26, 2026-36, 2026-63): sometimes the same thesis, sometimes two different ones → key on year + n° + author, never year + n° alone.
- **Non-PDF "PDF" links:** 2020-68 → `these68-20/Plan.pps`, 2018-53 → `these53-18/…/index.htm`, 2022-334 → `these33422.pdf` (no dash). 2 rows have no full-text link (2014-17 has only the article).
- **Broken files:** 6 of the first 420 PDFs tried answered **404** although listed (2025-155, 186, 224, 284; 2026-8, 100) — see §5 for the full count.
- **Corrupted accents in the HTML itself (2026 page):** raw bytes `Exp\xc3\xafrience` = « Expïrience », « expörience »… plus typographic apostrophes replacing the ASCII ones. A refresh that blindly trusts the site downgrades good titles: in `these` we keep the old row when the slot already exists and take the site's title only when it **completes a truncated « … » title** (`build_fmpm.py --merge`: +380 theses, 383 titles completed, 0 downgraded).
- **The list lags far behind the numbering.** N° max vs theses listed: 2023 466 / 415, **2024 631 / 395, 2025 406 / 174**, 2026 188 / 117. ≈ 600 numbers of 2023-2026 are not online (yet). Gaps also exist in older years (2013: 4, 2016: 8, 2018: 13, 2021: 15, 2022: 21). A "theses per year" chart must say "listed online", not "defended".

## 2. Fetching PDFs politely: you only need ~600 KB per thesis

Median PDF ≈ 4.3 MB, some > 70 MB (scans, photos). Downloading 4 000 PDFs ≈ 17 GB. Instead, for the **cover page only**:

1. `Range: bytes=-300000` → last 300 KB **and** the total size (`Content-Range: bytes a-b/TOTAL`) in one request.
2. `Range: bytes=0-299999` → first 300 KB.
3. Write both at their real offsets into a zero-filled buffer of TOTAL bytes and run `pdftotext -f 1 -l 1 -layout`. The xref table/trailer at the end points correctly at page 1's objects, which Word puts at the start. Missing middle = page 1 still renders.
4. If page 1 has no "JURY/Président/Thèse", retry with 3 MB + 1 MB, then the full file.

Result: ≈ 90 % of theses decode from 600 KB, ≈ 2.5 s per thesis, one request at a time. Code: `archive/fmpm/methode/fetch_page1.py` in `these` (stdlib + poppler; PNG kept when there is no text layer, then `tesseract -l fra`).

## 3. What the cover page (page 1) contains

Since ≈ 2007 every PDF opens on the same official cover:

```
Année 2026                                   Thèse N° 36
Les éventrations post-opératoires à l'hôpital Ibn Tofail Marrakech
THÈSE PRÉSENTÉE ET SOUTENUE PUBLIQUEMENT LE 19/01/2026
PAR Mr. CHEKROUNI Ilias   Né le 01/01/2000 à Khénifra
POUR L'OBTENTION DU DOCTORAT EN MÉDECINE
MOTS-CLÉS : Éventrations – Incisional hernia – Épidémiologie – Prothèse – Chirurgie
JURY
Mr. R.BENELKHAIAT        PRÉSIDENT     Professeur de Chirurgie générale
Mr. Y.NARJIS             RAPPORTEUR    Professeur de Chirurgie générale
Mme. A.HAMRI                           Professeur de Chirurgie générale   } JUGES
Mr. M.KHALLOUKI                        Professeur de Anesthésie Réanimation
```

So the PDF itself gives, **officially and for every year including 2024-2026** (which the OPAC lacks): defence date, author, birth date/place, keywords, **president, rapporteur, judges, each with his title and specialty**. That is the missing source for These2.0's recent theses (CONTEXT §7 "Next up 3").

### Parsing traps (all met on real covers)
- **Layout:** role label on the name line (`… PRÉSIDENT`), on its own line, split over two lines (`RAPPORTEU` / `SE`, `PRESIDENT` / `E`), or once for a group (`JUGES` beside the bracket). The first member listed is the president, the second the rapporteur, when labels are missing.
- **Accented / truncated labels:** `PRÉSIDENT`, `PRESIDEN`, `RAPPORTEU`. Match with `pr[eé]siden\w*`, `rapporteu\w*`.
- **English theses (since 2025):** `Year / Thesis N°`, `CHAIRMAN`, `SUPERVISOR`, `JUDGE`, `Professor of Otorhinolaryngology`.
- **Name repeated** on two lines (`M.SBIHI` / `M.SBIHI`), page-layout debris (`P P`, `E`, `SE`), name glued to the role (`N.ZAMRAOUI PRÉSIDENT`).
- **Specialty on the next line:** `Professeur de l'enseignement supérieur` / `de Chirurgie Générale`; `Professeur d'` / `Anesthésie et réanimation`.
- **Broken Word fonts:** some text comes out **shifted by 29 code points** — `3URIHVVHXU` = « Professeur », `G·+pPDWRORJLH` = « d'Hématologie », `$QDWRPLH 3DWKRORJLTXH` = « Anatomie Pathologique »; `·` = apostrophe, `p` = é, `\x03` = space. Decode with `chr(ord(c)+29)` for 0x21-0x5D. Some covers mix decoded and shifted text in one line.
- **Spaces inside words:** `P sychiatrie`, `Pé diatrie`, `Radiother apy`, `Gy nécologie`.
- **Substring trap:** `urolog` is inside « ne**urolog**ie » — anchor every specialty pattern at word start (this bug misread every neurologist as a urologist until a regression test caught it).
- **Scanned covers** (mostly 2007-2012): no text layer → OCR (`tesseract -l fra --psm 4`) reads them well enough.
- **Non-specialty titles:** `Doyen de la Faculté…` (the dean as president), basic sciences (`Anatomie`, `Histologie-embryologie`, `Biophysique`, `Physiologie`) → not in the official list; fall back to the rapporteur.

## 4. Classifying by the official list from the cover

Rule asked by the owner of `these`: **the thesis specialty is its jury president's specialty**, mapped onto the official list (42 specialties, 3 options), with two readable corrections:
1. president outside the list or unreadable → rapporteur;
2. president ≠ rapporteur and the title clearly names the rapporteur's specialty (high-confidence title match, e.g. « … Expérience du service de neurologie » with a radiologist president) → rapporteur.

Label → official specialty mapping (most specific first): anatomie pathologique before anatomie; chirurgie pédiatrique / cardio-vasculaire / vasculaire / thoracique / plastique / maxillo-faciale / neurochirurgie / traumato-orthopédie / urologie / ORL / ophtalmologie / gynéco-obstétrique / urgences; réanimation médicale before anesthésie-réanimation; radiothérapie before radiologie; pédopsychiatrie before psychiatrie; hématologie biologique → Analyses biologiques médicales, hématologie clinique → Hématologie clinique; microbiologie / bactériologie / virologie / parasitologie / immunologie → Analyses biologies médicales; « Chirurgie générale / viscérale / digestive » → Chirurgie générale. Full table + 31 regression cases: `archive/specialites/page_de_garde.py` (`TITLE_MAP`, `LABEL_TESTS`).

## 5. Results on all FMPM theses (17/10/2026)

RESULTS_PLACEHOLDER

## 6. Suggestions for These2.0

1. **Add the cover page as a source** (`specialiteSource = "page de garde"`), between the library category and the title guess — or even first: it is official, per thesis, and exists for 2024-2026 where the OPAC has nothing. Port `fetch_page1.py` + `page_de_garde.py` (stdlib + poppler-utils + tesseract on the Action runner: `apt-get install poppler-utils tesseract-ocr-fra`). Cache page-1 text by `ETag` so the weekly run only reads new PDFs.
2. **Jury for recent theses:** take president / rapporteur / judges from the cover when the OPAC has no record.
3. **Merge, don't overwrite, when refreshing the list** — the site reintroduces corrupted accents; keep your cleaned title unless the new one completes a « … ».
4. **Show the lag:** "listed online / highest n°" per year (2024: 395 / 631) so nobody reads 2024-2025 as a drop in theses.
5. **Key = year + n° + author**; handle the 3 non-PDF links and the 404 PDFs (show "PDF indisponible sur le site" rather than a dead link).
6. **New chart ideas already prototyped** in `these/userscripts/v0.1-diagrams.js` (live, on the official site): specialties by option per year + one donut per option; study design, hospitals cited, English share, frequent words — all recomputed for the current search.
7. **Defence date and keywords** are on every cover too: a "theses per month / defence season" chart and keyword search for 2024-2026 become possible without the OPAC.
