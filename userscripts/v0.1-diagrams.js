// ==UserScript==
// @name         FMPM thèses — recherche en ligne + diagrammes
// @namespace    https://github.com/achma-learning/these
// @version      1.2.1
// @description  Barre de recherche en haut du catalogue officiel des thèses FMPM (toutes les années, lues en direct) et, en pied de page, des diagrammes dynamiques qui suivent la recherche : thèses par année, spécialités FMPM (médecine / chirurgie / biologie, comptage principal ou fractionnaire, statut, carte spécialité × année), type d'étude, hôpitaux cités, langue, mots fréquents.
// @match        https://wd.fmpm.uca.ma/biblio/theses/*
// @match        http://wd.fmpm.uca.ma/biblio/theses/*
// @exclude      https://wd.fmpm.uca.ma/biblio/theses/annee-htm/FT/*
// @exclude      http://wd.fmpm.uca.ma/biblio/theses/annee-htm/FT/*
// @exclude      https://wd.fmpm.uca.ma/biblio/theses/annee-htm/art/*
// @exclude      http://wd.fmpm.uca.ma/biblio/theses/annee-htm/art/*
// @grant        none
// @license      MIT
// @run-at       document-idle
// ==/UserScript==

/*
 * v0.1 = v0-stable (recherche en direct + export CSV brut) + diagrammes en pied de page.
 *  - EN HAUT : la barre de recherche, inchangée, + « 📊 Diagrammes ↓ ».
 *  - EN BAS  : diagrammes SVG sans bibliothèque, recalculés à chaque recherche (toutes les thèses si
 *    la recherche est vide). Clic sur une barre d'année ou une part de camembert = filtre ; clic sur
 *    un mot = ajouté à la recherche.
 *  - Spécialités : liste officielle FMPM (42 spécialités, 3 options), classement final du dépôt
 *    (vote pondéré rapporteur / catégorie / président / titre, lu sur la page de garde de chaque
 *    thèse) — fichier theses-fmpm-specialites.csv du dépôt public
 *    achma-learning/theses-maroc, chargé une fois (cache 24 h). Sans ce fichier, les autres
 *    diagrammes marchent quand même.
 *  - Une thèse = une spécialité (la plus lourde du barycentre) : chaque diagramme totalise le vrai nombre de
 *    thèses. Mode « Fractionnel » : chaque thèse vaut toujours 1 mais est répartie selon ses parts de masse
 *    (colonne Répartition) — total inchangé. Teinte des barres = statut (confirmée / probable / à vérifier) ;
 *    trait fin = fourchette « confirmées seules » → « + thèses où la spécialité est secondaire ».
 *  - Type d'étude, hôpitaux, langue : lus dans le TITRE (indicatif, pas une donnée officielle).
 * Installation : Tampermonkey/Violentmonkey (nouveau script → coller), ou F12 → Console → coller
 * tout le fichier sur https://wd.fmpm.uca.ma/biblio/theses/Accueil.html.
 * Politesse : une page annuelle à la fois, pause de 400 ms, résultats gardés 24 h en cache local.
 */
(function () {
  'use strict';
  if (/\/annee-htm\/(FT|art)\/|\.pdf$/i.test(location.pathname)) return; // PDF (texte intégral, résumé) : laisser le lecteur PDF
  if (document.documentElement.hasAttribute('data-fmpm-ultra')) return;     // v2-ultra is running on this page
  if (document.getElementById('fmpm-search-host')) return; // already injected

  const BASE = new URL('/biblio/theses/annee-htm/', location.href);
  const FIRST_YEAR = 2006;
  const PAUSE_MS = 400;
  const CACHE_KEY = 'fmpm-theses-cache-v2'; // v1 counted lines printed twice on the site
  const SPE_KEY = 'fmpm-theses-spe-cache-v5'; // v1 = ancien fichier président (551 classées) ; v2 = sans statut ni parts ; v3 = N° réutilisés confondus
  const CACHE_TTL = 24 * 3600 * 1000;
  const RETRY_TTL = 30 * 60 * 1000;                               // a load where a year failed: tried again after 30 min,
                                                                  // then 2 h, 8 h, 24 h while it keeps failing
  const MAX_SHOWN = 200;
  const HEADER = ['Année', 'N°', 'Auteur', 'Titre', 'PDF (texte intégral)', 'Article (résumé, 2006-2014)'];
  const SPE_URL = 'https://raw.githubusercontent.com/achma-learning/theses-maroc/main/archive/fmpm/theses-fmpm-specialites.csv';
  const OPTIONS = ['Spécialités de médecine', 'Spécialités de chirurgie', 'Spécialités de Biologie'];
  const SHORT = { 'Spécialités de médecine': 'Médecine', 'Spécialités de chirurgie': 'Chirurgie', 'Spécialités de Biologie': 'Biologie' };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const norm = s => clean(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’'`]/g, "'").toLowerCase();
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Older pages are windows-1252, 2026 is UTF-8: decode as UTF-8, fall back if it breaks.
  async function fetchYear(y) {
    const url = new URL(`${y}.htm`, BASE);
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return { year: y, status: res.status, rows: [] };
    const buf = await res.arrayBuffer();
    let html = new TextDecoder('utf-8').decode(buf);
    if (html.includes('�')) html = new TextDecoder('windows-1252').decode(buf);
    return { year: y, status: 200, rows: parseYear(html, y, url) };
  }

  // Same person whatever the accents, case or word order (« IMANE EL OUAFRI » = « EL OUAFRI IMANE »).
  const person = s => norm(s).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  const T2_SITE = 'https://thesefmpm3.vercel.app';            // These2.0, same list, updated every day

  // One <tr> per thesis: N° | Auteur | Titre | TEXTE INTEGRAL (+ article link 2006-2014).
  // The site prints some lines twice (2023-125, 2025-329): same N° + same author = one thesis. It also
  // gives one N° to two different theses (2025-214, 2026-26/36/63): both are kept.
  function parseYear(html, y, pageUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const out = [], seen = new Set();
    for (const tr of doc.querySelectorAll('tr')) {
      const cells = [...tr.children].filter(c => c.tagName === 'TD' || c.tagName === 'TH');
      if (cells.length < 3) continue;
      const num = clean(cells[0].textContent);
      if (!/^\d+$/.test(num)) continue;
      const links = [...tr.querySelectorAll('a[href]')].map(a => new URL(a.getAttribute('href'), pageUrl).href.replace(/^http:/, 'https:'));
      const key = `${Number(num)}|${person(cells[1].textContent)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const titleCell = cells[2].cloneNode(true);
      titleCell.querySelectorAll('a').forEach(a => a.remove());
      out.push({
        year: y, num: String(Number(num)), author: clean(cells[1].textContent), title: clean(titleCell.textContent),
        pdf: links.find(h => /\/FT\//i.test(h)) || '', article: links.find(h => /\/art\//i.test(h)) || ''
      });
    }
    return out;
  }

  function readCache(key, anyAge) {
    try {
      const c = JSON.parse(localStorage.getItem(key) || 'null');
      const ttl = c && c.failed ? Math.min(CACHE_TTL, RETRY_TTL * 4 ** ((c.streak || 1) - 1)) : CACHE_TTL;
      return c && (anyAge || Date.now() - c.at < ttl) ? c : null;
    } catch { return null; }
  }
  function writeCache(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* quota or blocked storage: run without cache */ }
  }

  // A year that cannot be read keeps its rows from the previous load instead of vanishing from the results
  // (and from the CSV export); such a load is marked `failed` and kept 30 min only. This year's page not yet
  // online (404 in January) is not a failure.
  async function loadAll(force, onProgress) {
    const cached = !force && readCache(CACHE_KEY);
    if (cached) return cached;
    const prev = readCache(CACHE_KEY, true);                         // any age: stands in for a year that fails now
    const last = new Date().getFullYear();
    const rows = [], perYear = {};
    let failed = 0;
    const gone = [];                                                 // failed years with no copy: absent from results
    for (let y = last; y >= FIRST_YEAR; y--) {
      onProgress(`Lecture ${y}…`);
      let r;
      try { r = await fetchYear(y); } catch (e) { r = { status: 0, error: e.message, rows: [] }; }
      const old = prev ? prev.rows.filter(x => x.year === y) : [];
      if (r.status === 200 && (r.rows.length || !old.length)) {
        perYear[y] = { theses: r.rows.length, sansPDF: r.rows.filter(x => !x.pdf).length, nMax: Math.max(0, ...r.rows.map(x => +x.num)) };
        rows.push(...r.rows);
      } else if (r.status === 404 && y === last && !old.length) perYear[y] = 'pas encore en ligne (HTTP 404)';
      else {                                                         // includes a page that suddenly lists nothing
        rows.push(...old);
        failed++;
        if (!old.length) gone.push(y);
        perYear[y] = (r.status === 200 ? 'page sans aucune thèse' : r.status ? `HTTP ${r.status}` : `erreur : ${r.error}`) +
          (old.length ? ` — copie précédente gardée (${old.length} thèses)` : ' — aucune copie');
      }
      await sleep(PAUSE_MS);
    }
    const data = { at: Date.now(), rows, perYear, failed, gone, streak: failed ? ((prev && prev.failed && prev.streak) || 0) + 1 : 0 };
    writeCache(CACHE_KEY, data);
    return data;
  }

  // Minimal RFC 4180 parser (quoted fields, doubled quotes, newlines inside quotes).
  function parseCSV(text) {
    const rows = []; let row = [], f = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    const head = rows.shift() || [];
    return rows.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] || ''])));
  }

  // "année|n°" → { spe, opt, st, conf, sec, parts } from the final classification (barycentre, classer_fmpm.py).
  // parts = [[spécialité, part de masse]…] (colonne Répartition), sec = spécialité secondaire (≥ 1/3 de la masse).
  async function loadSpecialties() {
    const cached = readCache(SPE_KEY);
    if (cached) return cached.map;
    const res = await fetch(SPE_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const map = {};
    for (const r of parseCSV(await res.text())) {
      const spe = r['Spécialité FMPM'];                                     // kept even when empty: a reused N° must
                                                                              // stay two theses, or one takes the other's
      const parts = (r['Répartition'] || '').split('; ').map(p => p.split('=')).filter(p => p.length === 2).map(([k, v]) => [k, +v]);
      const e = { spe, opt: r['Option FMPM'] || '', st: r['Statut'] || 'classée', who: person(r['Auteur']),
        conf: r['Confiance'] ? +r['Confiance'] : null, sec: r['Spécialité secondaire'] || '', parts: parts.length ? parts : [[spe, 1]] };
      const k = `${r['Année']}|${r['N°']}`, old = map[k];
      if (!old) map[k] = e;                                                  // usual case: one thesis per N°
      else if (old.byAuthor) old.byAuthor[e.who] = e;
      else if (old.who !== e.who) map[k] = { byAuthor: { [old.who]: old, [e.who]: e } };
    }
    writeCache(SPE_KEY, { at: Date.now(), map });
    return map;
  }

  function toCSV(rows) {
    const q = v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const sorted = rows.slice().sort((a, b) => b.year - a.year || a.num - b.num);
    const lines = [HEADER.map(q).join(',')].concat(sorted.map(r =>
      [String(r.year), r.num, r.author, r.title, r.pdf, r.article].map(q).join(',')));
    return '﻿' + lines.join('\n') + '\n';
  }

  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---- Title-derived dimensions (indicative) ---------------------------------------------
  const DESIGNS = [
    ['Expérience d’un service', /experience d[ue'] |experience des services|au sein du service|au service d/],
    ['Rétrospective', /retrospecti/],
    ['Prospective', /prospecti/],
    ['À propos de cas', /a propos d[e']|cas clinique|case report/],
    ['Revue de la littérature', /revue de (la )?litterature|revue systematique|meta-?analyse|literature review|systematic review/],
    ['Enquête / connaissances', /enquete|connaissances|attitudes|pratiques|perception|knowledge|survey|questionnaire/],
    ['Transversale', /transversal|cross-sectional/],
    ['Épidémiologique', /epidemiolog|prevalence|incidence|profil/],
  ];
  const PLACES = [
    ['CHU Mohammed VI', /chu mohammed vi|chu med vi|chu mohamed vi|chu de marrakech|chu mohammed 6/],
    ['Hôpital Militaire Avicenne', /militaire|avicenne|\bhma\b/],
    ['Hôpital Ibn Tofail', /ibn tofa/],
    ['Hôpital Arrazi', /arrazi|ar-razi/],
    ['Hôpital Mère-Enfant', /mere[- ]enfant|mere et enfant/],
    ['Centre d’oncologie / CRO', /oncologie.*(centre|hematologie)|centre regional d'oncologie|\bcro\b/],
    ['Hôpital Ibn Nafis', /ibn nafis/],
    ['Hôpital Ibn Zohr', /ibn zohr/],
    ['Agadir', /agadir/], ['Safi', /\bsafi\b/], ['Essaouira', /essaouira/], ['Beni Mellal', /beni[- ]mellal/],
    ['Ouarzazate', /ouarzazate/], ['Laâyoune', /laayoune/], ['Guelmim', /guelmim/],
  ];
  const STOP = new Set(('de du des la le les et en au aux a l d un une dans chez par pour sur avec sans entre ou propos ' +
    'experience service cas etude chu marrakech mohammed vi hopital militaire avicenne prise charge profil revue litterature ' +
    'apport place interet evaluation serie resultats the of in and at to for with on an from patients clinique cliniques ' +
    'epidemiologique epidemiologiques therapeutique therapeutiques diagnostique aspects ibn tofail est son ses sa leur leurs ' +
    'cours lors apres avant non type role').split(' '));
  const EN = /\b(the|of|and|in|with|among|patients|study|assessment|knowledge|outcomes?)\b/;
  const isEnglish = t => (t.match(new RegExp(EN.source, 'g')) || []).length >= 2;

  // ---- UI: search bar on top (shadow DOM so the old site CSS cannot touch it) -----------
  const TOKENS = `
    :host { all: initial; }
    .box { --surface: #fcfcfb; --ink: #0b0b0b; --ink2: #52514e; --muted: #8a8880; --grid: #e4e3df; --accent: #2a78d6;
           --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100; --s5: #e87ba4; --s6: #008300; --s7: #6250d6; --s8: #e34948;
           --other: #b4b2ab; --hover: #eef4fc; --accent-hover: #1c5cab;
           font: 14px/1.45 system-ui, sans-serif; color: var(--ink); background: var(--surface); }
    @media (prefers-color-scheme: dark) {
      .box { --surface: #1a1a19; --ink: #f0efec; --ink2: #c3c2b7; --muted: #9a998f; --grid: #34332f; --accent: #3987e5;
             --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181; --s6: #008300; --s7: #9085e9; --s8: #e66767;
             --other: #6b6a63; --hover: #23324a; --accent-hover: #86b6ef; }
    }
    button { font: inherit; padding: 7px 12px; border: 1px solid var(--accent); border-radius: 6px; background: var(--surface); color: var(--accent); cursor: pointer; }
    button:hover { background: var(--hover); }
    a { color: var(--accent); }`;

  const host = document.createElement('div');
  host.id = 'fmpm-search-host';
  host.style.cssText = 'position:relative;z-index:2147483646';
  document.body.prepend(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
  <style>${TOKENS}
    .box { border-bottom: 2px solid var(--accent); padding: 12px 16px; box-shadow: 0 2px 8px rgba(0,0,0,.12); }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    input { flex: 1 1 280px; font: inherit; padding: 8px 10px; border: 1px solid #9aa4b2; border-radius: 6px; background: var(--surface); color: var(--ink); }
    .meta { color: var(--ink2); font-size: 12.5px; margin-top: 6px; }
    .nav { margin-top: 6px; gap: 4px; font-size: 12.5px; }
    .nav a { text-decoration: none; padding: 1px 6px; border-radius: 10px; border: 1px solid var(--grid); color: var(--accent); }
    .nav a.on { background: var(--accent); color: var(--surface); border-color: var(--accent); }
    .nav a.home { border-color: var(--accent); font-weight: 600; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
    .chip { font-size: 12.5px; padding: 2px 8px; border-radius: 12px; border: 1px solid var(--accent); color: var(--accent); cursor: pointer; }
    ol { margin: 8px 0 0; padding-left: 0; list-style: none; max-height: 60vh; overflow: auto; }
    li { padding: 6px 0; border-top: 1px solid var(--grid); }
    .t { font-weight: 600; }
    .a { color: var(--ink2); font-size: 13px; }
    .spe { color: var(--ink2); font-size: 12px; border: 1px solid var(--grid); border-radius: 10px; padding: 0 6px; }
    mark { background: #ffe58a; color: #0b0b0b; padding: 0; }
    details { margin-top: 6px; font-size: 12.5px; color: var(--ink2); }
    table { border-collapse: collapse; margin-top: 4px; }
    td, th { border: 1px solid var(--grid); padding: 2px 8px; text-align: right; }
  </style>
  <div class="box">
    <div class="row">
      <strong>🔎 Thèses FMPM — toutes années, en direct</strong>
      <input id="q" type="search" placeholder="Mots du titre ou de l'auteur, ex. lupus marrakech (raccourci : /)" autocomplete="off">
      <button id="reload" title="Relire toutes les pages annuelles sur le site">↻ Relire en ligne</button>
      <button id="export" title="Télécharger le CSV brut pour mettre à jour la copie locale du dépôt">⬇ Exporter CSV brut</button>
      <button id="t2" title="Même recherche sur These2.0 (thesefmpm3.vercel.app) : jury, spécialités, statistiques ; mis à jour chaque jour">These2.0 ↗</button>
      <button id="todiag" title="Aller aux diagrammes en bas de page">📊 Diagrammes ↓</button>
      <button id="hide" title="Masquer">✕</button>
    </div>
    <div class="row nav" id="nav"></div>
    <div class="meta" id="meta">Chargement…</div>
    <div class="meta" id="yearinfo"></div>
    <div class="chips" id="chips"></div>
    <details id="det"><summary>Thèses par année (site officiel)</summary><div id="years"></div></details>
    <ol id="res"></ol>
  </div>`;
  const $ = id => root.getElementById(id);

  // ---- Year pages (annee-htm/AAAA.htm) and home ------------------------------------------------------------
  // The site's own year links are stale: the 2007-2014 pages stop at 2022, and on 2026.htm « 2026 » opens 2025.htm.
  const PAGE_YEAR = Number((location.pathname.match(/\/annee-htm\/(\d{4})\.htm$/i) || [])[1]) || null;
  const HOME = new URL('/biblio/theses/Accueil.html', location.href).href;
  let pageSpe = null;                                            // set by the diagrams script (specialty per thesis)
  function renderNav(lastYear) {
    let s = `<a class="home" href="${HOME}" title="Page d'accueil des thèses FMPM">🏠 Accueil</a>`;
    for (let y = FIRST_YEAR; y <= lastYear; y++)
      s += `<a class="yr${y === PAGE_YEAR ? ' on' : ''}" href="${new URL(`${y}.htm`, BASE).href}">${y}</a>`;
    $('nav').innerHTML = s;
  }
  // What the official list of this year says, and its oddities: a N° given to two theses, and a line whose author +
  // title repeat another N° (a copy error of the list: the N° is a real thesis, its PDF may be another one).
  function yearReport(rows) {
    const nums = rows.map(r => +r.num), max = Math.max(0, ...nums), have = new Set(nums);
    const byNum = new Map(), byThesis = new Map();
    for (const r of rows) {
      byNum.set(+r.num, [...(byNum.get(+r.num) || []), r]);
      const k = `${person(r.author)}|${norm(r.title)}`;
      byThesis.set(k, [...(byThesis.get(k) || []), r]);
    }
    return {
      n: rows.length, max, missing: max - have.size,
      shared: [...byNum].filter(([, rs]) => new Set(rs.map(r => person(r.author))).size > 1).map(([n]) => n),
      twice: [...byThesis.values()].filter(rs => rs.length > 1),
    };
  }
  function renderYearInfo() {
    if (!PAGE_YEAR) return;
    const rows = DATA.rows.filter(r => r.year === PAGE_YEAR);
    if (!rows.length) { $('yearinfo').textContent = ''; return; }
    const y = yearReport(rows);
    $('yearinfo').innerHTML = `<b>${PAGE_YEAR}</b> : ${y.n} thèses en ligne, n° 1 à ${y.max}` +
      (y.missing > 0 ? ` — <span title="Numéros absents de la liste : thèses soutenues pas encore mises en ligne, ou numéros sautés">${y.missing} n° pas (encore) en ligne</span>` : '') +
      (y.shared.length ? ` · n° donné à deux thèses : ${y.shared.join(', ')}` : '') +
      (y.twice.length ? ` · <span title="La liste officielle répète l'auteur et le titre d'un autre n° : erreur de copie probable. Chaque n° est une thèse ; ouvrir le PDF pour savoir laquelle.">même auteur et titre sous deux n°</span> : ${y.twice.map(rs => `${esc(rs[0].author)} (${rs.map(r => r.num).join(', ')})`).join(' ; ')}` : '');
  }
  // Labels in the official table: specialty (diagrams script) and warnings about the numbering.
  function annotatePage() {
    if (!PAGE_YEAR) return;
    const rows = DATA.rows.filter(r => r.year === PAGE_YEAR), y = yearReport(rows);
    const twiceOf = new Map(y.twice.flatMap(rs => rs.map(r => [`${r.num}|${person(r.author)}`, rs.filter(o => o !== r).map(o => o.num)])));
    document.querySelectorAll('.fmpm-badges').forEach(e => e.remove());
    for (const tr of document.querySelectorAll('tr')) {
      const cells = [...tr.children].filter(c => c.tagName === 'TD' || c.tagName === 'TH');
      if (cells.length < 3 || !/^\d+$/.test(clean(cells[0].textContent))) continue;
      const num = String(Number(clean(cells[0].textContent))), who = person(cells[1].textContent);
      const r = rows.find(x => x.num === num && person(x.author) === who);
      if (!r) continue;
      const tag = (txt, title, bg) => `<span title="${esc(title)}" style="display:inline-block;margin:3px 4px 0 0;padding:0 6px;border-radius:9px;font:11px/1.6 system-ui,sans-serif;background:${bg};color:#111">${esc(txt)}</span>`;
      let html = '';
      const s = pageSpe && pageSpe(r);
      if (s) html += tag(`${s.spe}${s.st === 'confirmée' || s.st === 'vérifiée' ? '' : ' ?'}`, `Spécialité FMPM (classement achma-learning/theses-maroc) : ${s.st}${s.conf != null ? `, confiance ${Math.round(100 * s.conf)} %` : ''}`, '#dbe8fb');
      if (y.shared.includes(+num)) html += tag('⚠ n° partagé', `Le n° ${num} est donné à deux thèses différentes dans la liste officielle (même lien PDF)`, '#fde7c8');
      const other = twiceOf.get(`${num}|${who}`);
      if (other) html += tag(`⚠ ligne répétée : n° ${other.join(', ')}`, 'Même auteur et même titre qu\'un autre n° dans la liste officielle : erreur de copie probable. Ce n° est une thèse à part entière ; son PDF peut être une autre thèse (2018-138, 2021-213 vérifiés).', '#fde7c8');
      if (html) cells[2].insertAdjacentHTML('beforeend', `<div class="fmpm-badges">${html}</div>`);
    }
  }
  renderNav(new Date().getFullYear());
  if (PAGE_YEAR) {
    // Year pages pin #masthead and #pagecell1 with position:absolute (table at top:200px, height 4948px, its own
    // scrollbar): put them back in the page flow, so the bar above and the charts below don't cover the table.
    const st = document.createElement('style');
    st.textContent = '#masthead,#pagecell1{position:static!important;width:auto!important;height:auto!important;margin:8px 29px!important;overflow:visible!important}';
    document.head.append(st);
  }

  // ---- UI: diagrams in the footer ---------------------------------------------------------
  const foot = document.createElement('div');
  foot.id = 'fmpm-diagrams-host';
  foot.style.cssText = 'position:relative;z-index:2147483645;margin-top:24px';
  document.body.append(foot);
  const froot = foot.attachShadow({ mode: 'open' });
  froot.innerHTML = `
  <style>${TOKENS}
    .box { border-top: 2px solid var(--accent); padding: 16px; }
    h2 { font-size: 17px; margin: 0 0 2px; }
    .sub { color: var(--ink2); font-size: 12.5px; margin-bottom: 12px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: 14px; }
    .card { border: 1px solid var(--grid); border-radius: 10px; padding: 12px 14px; min-width: 0; }
    .card.wide { grid-column: 1 / -1; }
    h3 { font-size: 14px; margin: 0 0 2px; font-weight: 600; }
    .note { color: var(--muted); font-size: 11.5px; margin: 0 0 8px; }
    svg { display: block; max-width: 100%; height: auto; overflow: visible; }
    svg text { fill: var(--ink2); font: 11px system-ui, sans-serif; }
    svg .lab { fill: var(--ink); }
    .hit { cursor: pointer; }
    .hit:hover > .mk { opacity: .78; }
    .legend { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: var(--ink); margin-top: 6px; }
    .legend span { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
    .legend i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
    .opts { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; margin-top: 10px; }
    .opts h4 { font-size: 13.5px; margin: 0 0 4px; cursor: pointer; }
    .opts h4 small { color: var(--muted); font-weight: 400; }
    .seg { display: inline-flex; border: 1px solid var(--accent); border-radius: 6px; overflow: hidden; }
    .seg button { border: 0; border-radius: 0; padding: 4px 10px; font-size: 12.5px; }
    .seg button.on { background: var(--accent); color: var(--surface); }
    .kpi { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 12.5px; color: var(--ink2); margin: 6px 0 2px; font-variant-numeric: tabular-nums; }
    .kpi b { color: var(--ink); }
    .head { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
    .words { display: flex; flex-wrap: wrap; gap: 6px; }
    .words button { padding: 2px 8px; font-size: 12.5px; }
    .tip { position: fixed; pointer-events: none; background: var(--ink); color: var(--surface); font-size: 12px;
           padding: 4px 8px; border-radius: 6px; white-space: nowrap; display: none; z-index: 10; }
    .top { margin-top: 10px; }
    /* « Thèses par année » — même dessin que thesis-archive.html */
    .hero { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    .hero b { font-size: 26px; font-variant-numeric: tabular-nums; }
    .hero span { font-weight: 600; }
    .hero .ms { color: var(--muted); font-weight: 400; font-size: 13px; }
    .chart-title { font-size: 12.5px; color: var(--ink2); margin: 2px 0 6px; }
    .bars { display: flex; align-items: flex-end; gap: 2px; height: 110px; border-bottom: 1px solid var(--grid); }
    .bar-slot { flex: 1 1 0; height: 100%; display: flex; align-items: flex-end; cursor: pointer; min-width: 0; }
    .bar { width: 100%; background: var(--s1); border-radius: 4px 4px 0 0; }
    .bar-slot:hover .bar, .bar-slot:focus .bar, .bar-slot.on .bar { background: var(--accent-hover); }
    .bar-slot:focus { outline: none; }
    .axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); margin-top: 4px; font-variant-numeric: tabular-nums; }
  </style>
  <div class="box" id="fbox">
    <h2>📊 Diagrammes des thèses FMPM <a href="https://thesefmpm3.vercel.app/stats" target="_blank" rel="noopener" style="font-size:12.5px;font-weight:400">même tableau sur These2.0 ↗</a></h2>
    <div class="sub" id="fsub">Chargement…</div>
    <div class="grid">
      <div class="card wide">
        <div class="hero"><b id="h-total">0</b><span id="h-lbl">thèses au total</span><span class="ms" id="h-ms"></span></div>
        <p class="chart-title" id="h-title">Thèses par année — cliquez une barre pour filtrer l'année</p>
        <div class="bars" id="h-bars" role="list"></div><div class="axis" id="h-axis"></div></div>
      <div class="card wide"><div class="head"><h3>Spécialités FMPM par année (médecine · chirurgie · biologie)</h3>
        <span class="seg" id="mode"><button data-mode="principal" class="on" title="Chaque thèse compte 1 pour sa spécialité principale">Principal</button><button data-mode="fractionnel" title="Chaque thèse vaut 1, réparti selon ses parts de masse (barycentre)">Fractionnel</button></span></div>
        <p class="note" id="mode-note"></p>
        <div class="kpi" id="c-kpi"></div>
        <div id="c-opt"></div></div>
      <div class="card wide"><h3>Spécialités, par option</h3>
        <p class="note">Teinte = statut : <b>foncé</b> confirmée · <b>moyen</b> probable · <b>clair</b> à vérifier. <span id="range-note">Trait fin = fourchette : confirmées seules → + thèses où la spécialité est secondaire.</span> Clic = filtrer.</p>
        <div class="opts" id="c-spe"></div></div>
      <div class="card wide"><h3>Carte spécialité × année</h3>
        <p class="note">Plus la case est foncée, plus il y a de thèses. Clic sur une case = filtrer spécialité + année ; sur un nom = la spécialité.</p>
        <div id="c-heat"></div></div>
      <div class="card"><h3>Type d’étude</h3><p class="note">D’après le titre — indicatif. Une thèse peut compter dans plusieurs types.</p><div id="c-design"></div></div>
      <div class="card"><h3>Hôpitaux et villes cités</h3><p class="note">D’après le titre — indicatif.</p><div id="c-places"></div></div>
      <div class="card"><h3>Titres en anglais, par année</h3><p class="note">Part des titres rédigés en anglais (détection par mots-outils).</p><div id="c-lang"></div></div>
      <div class="card"><h3>Mots les plus fréquents des titres</h3><p class="note">Clic = ajouter à la recherche.</p><div id="c-words" class="words"></div></div>
    </div>
    <div class="top"><button id="totop">↑ Recherche</button></div>
    <div class="tip" id="tip"></div>
  </div>`;
  const F = id => froot.getElementById(id);

  let DATA = { rows: [], perYear: {}, at: 0 };
  let INDEX = [];
  let SPE = null, SPE_ERR = '';
  const FILTER = { year: PAGE_YEAR, spe: null, opt: null };             // on a year page the charts open on that year
  let MODE = 'principal';                                          // 'principal' | 'fractionnel'
  let OPT_OF = {};                                                 // spécialité → option

  function setData(d) {
    DATA = d;
    INDEX = d.rows.map(r => ({ r, n: norm(`${r.author} ${r.title} ${r.year}`) }));
    const when = new Date(d.at).toLocaleString('fr-FR');
    $('meta').textContent = `${d.rows.length} thèses lues sur le site officiel (${when})` +
      (d.failed > (d.gone || []).length ? ` — ⚠ ${d.failed - (d.gone || []).length} année(s) non lue(s), copie précédente utilisée` : '') +
      ((d.gone || []).length ? ` — ⚠ absente(s) des résultats et de l'export (non lue, aucune copie) : ${d.gone.join(', ')}` : '') +
      (d.failed ? ' (voir « Thèses par année »)' : '') +
      '. Recherche sans accents ; tous les mots doivent être présents.';
    $('years').innerHTML = '<table><tr><th>Année</th><th>Thèses</th><th>Sans PDF</th><th>N° max</th></tr>' +
      Object.keys(d.perYear).sort((a, b) => b - a).map(y => {
        const v = d.perYear[y];
        return typeof v === 'string' ? `<tr><td>${y}</td><td colspan="3">${esc(v)}</td></tr>`
          : `<tr><td>${y}</td><td>${v.theses}</td><td>${v.sansPDF}</td><td>${v.nMax}</td></tr>`;
      }).join('') + '</table>';
    renderYearInfo();
    annotatePage();
    search();
  }

  // A N° reused for two theses holds one entry per author: never give one thesis the other's specialty.
  const speOf = r => {
    const e = SPE && SPE[`${r.year}|${r.num}`], x = e && e.byAuthor ? e.byAuthor[person(r.author)] : e;
    return x && x.spe ? x : null;
  };
  pageSpe = speOf;

  // Plain case-insensitive match on the words as typed (accent-free matching is only for filtering), on the raw
  // text: matching the escaped HTML broke it (« ar » inside « <mark> », « amp » inside « &amp; »).
  function highlight(text, terms) {
    const ts = terms.filter(t => t.length >= 2).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!ts.length) return esc(text);
    return text.split(new RegExp(`(${ts.join('|')})`, 'gi')).map((p, i) => i % 2 ? `<mark>${esc(p)}</mark>` : esc(p)).join('');
  }

  // Query matches (without the chart filters) feed the charts; the list also applies the filters.
  function matches() {
    const terms = norm($('q').value).split(' ').filter(Boolean);
    return terms.length ? INDEX.filter(x => terms.every(t => x.n.includes(t))).map(x => x.r) : DATA.rows;
  }
  // Spécialité filtrée : la principale ; en mode fractionnel, aussi la secondaire.
  const hasSpe = (r, spe) => { const s = speOf(r); return !!s && (s.spe === spe || (MODE === 'fractionnel' && s.sec === spe)); };
  function filtered(rows, skipYear) {
    return rows.filter(r => (skipYear || !FILTER.year || r.year === FILTER.year)
      && (!FILTER.spe || hasSpe(r, FILTER.spe)) && (!FILTER.opt || speOf(r)?.opt === FILTER.opt));
  }

  let lastMs = 0;
  function search() {
    const t0 = performance.now();
    const query = $('q').value.trim();
    const base = matches();
    // the year of a year page is already listed by the official table below: no result list for it alone
    const active = query || (FILTER.year && FILTER.year !== PAGE_YEAR) || FILTER.spe || FILTER.opt;
    const hits = filtered(base).slice().sort((a, b) => b.year - a.year || a.num - b.num);
    $('chips').innerHTML = [
      FILTER.year && `<span class="chip" data-f="year">Année ${FILTER.year} ✕</span>`,
      FILTER.opt && `<span class="chip" data-f="opt">${esc(SHORT[FILTER.opt] || FILTER.opt)} ✕</span>`,
      FILTER.spe && `<span class="chip" data-f="spe">${esc(FILTER.spe)}${MODE === 'fractionnel' ? ' (+ secondaire)' : ''} ✕</span>`,
    ].filter(Boolean).join('');
    const raw = query.split(/\s+/);
    $('res').innerHTML = !active ? '' : `<li><em>${hits.length} résultat(s)${hits.length > MAX_SHOWN ? ` — ${MAX_SHOWN} premiers affichés` : ''}</em></li>` +
      hits.slice(0, MAX_SHOWN).map(r => {
        const s = speOf(r);
        return `<li>
        <div class="t">${highlight(r.title, raw)}</div>
        <div class="a">${r.year} · n° ${esc(r.num)} · ${highlight(r.author, raw)}
          ${s ? ` · <span class="spe" title="${esc(speTip(s))}">${esc(s.spe)}${s.st === 'confirmée' || s.st === 'vérifiée' ? '' : ' ?'}</span>${s.sec ? ` <span class="spe" title="Spécialité secondaire (≥ 1/3 de la masse)">+ ${esc(s.sec)}</span>` : ''}` : ''}
          ${r.pdf ? ` · <a href="${esc(r.pdf)}" target="_blank" rel="noopener">PDF</a>` : ' · <em>sans PDF</em>'}
          ${r.article ? ` · <a href="${esc(r.article)}" target="_blank" rel="noopener">Résumé</a>` : ''}</div>
      </li>`;
      }).join('');
    lastMs = performance.now() - t0;
    renderCharts(base, filtered(base), query);
  }

  // ---- SVG charts ----------------------------------------------------------------------------
  const COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
  const OPT_COLOR = { [OPTIONS[0]]: COLORS[0], [OPTIONS[1]]: COLORS[1], [OPTIONS[2]]: COLORS[2] };
  const fmt = n => Math.round(n).toLocaleString('fr-FR');
  const speTip = s => `${s.st}${s.conf != null ? ` · confiance ${Math.round(100 * s.conf)} %` : ''} · ` +
    s.parts.map(([k, v]) => `${k} ${Math.round(100 * v)} %`).join(' · ');
  // Contributions of one thesis: principal → [[spe, 1]] ; fractionnel → its mass shares (sum 1).
  const contrib = r => { const s = speOf(r); return !s ? [] : MODE === 'fractionnel' ? s.parts : [[s.spe, 1]]; };
  const wcount = (rows, key) => {
    const m = new Map();
    for (const r of rows) for (const [spe, w] of contrib(r)) { const k = key(r, spe); if (k != null) m.set(k, (m.get(k) || 0) + w); }
    return m;
  };
  const STATUS_OP = { 'vérifiée': 1, 'confirmée': 1, 'probable': 0.55, 'à vérifier': 0.25 };
  const pct = (a, b) => b ? `${Math.round(100 * a / b)} %` : '—';
  const years = () => {
    const ys = DATA.rows.map(r => r.year);
    const lo = Math.min(FIRST_YEAR, ...ys), hi = Math.max(...ys, lo);
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  };
  const count = (rows, key) => rows.reduce((m, r) => { const k = key(r); if (k != null) m.set(k, (m.get(k) || 0) + 1); return m; }, new Map());

  // Rounded top only (4 px data-end, square at the baseline).
  function barPath(x, y, w, h, r = 4) {
    if (h <= 0) return '';
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  function niceMax(v) {
    if (v <= 5) return 5;
    const p = 10 ** Math.floor(Math.log10(v)), m = v / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }
  function axis(W, H, pad, max) {
    let s = '';
    const n = max % 4 === 0 ? 4 : 5;                               // integer ticks (niceMax → 1/2/5 × 10^k)
    for (let i = 0; i <= n; i++) {
      const v = max * i / n, y = H - pad.b - (H - pad.t - pad.b) * i / n;
      s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" stroke="var(--grid)"/>` +
        `<text x="${pad.l - 6}" y="${y + 4}" text-anchor="end">${fmt(Math.round(v))}</text>`;
    }
    return s;
  }

  // Bars per year: outline = all theses, fill = current matches (or stacked series if given).
  function yearChart(el, ys, allCounts, stacks, onClick) {
    const W = Math.max(300, el.clientWidth || 900), H = 200, pad = { t: 16, r: 8, b: 26, l: 40 };
    const max = niceMax(Math.max(1, ...ys.map(y => allCounts ? (allCounts.get(y) || 0) : stacks.reduce((s, st) => s + (st.counts.get(y) || 0), 0))));
    const bw = (W - pad.l - pad.r) / ys.length, w = Math.max(4, bw * 0.68), sy = v => (H - pad.t - pad.b) * v / max;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">` + axis(W, H, pad, max);
    ys.forEach((y, i) => {
      const x = pad.l + i * bw + (bw - w) / 2, base = H - pad.b;
      let tip = `${y}`, acc = 0, marks = '';
      if (allCounts) {
        const a = allCounts.get(y) || 0;
        marks += `<path d="${barPath(x + 0.5, base - sy(a), w - 1, sy(a))}" fill="none" stroke="var(--other)"/>`;
        tip += ` — toutes : ${fmt(a)}`;
      }
      stacks.forEach((st, k) => {
        const v = st.counts.get(y) || 0;
        if (!v) return;
        const h = sy(v), top = k === stacks.length - 1 || !stacks.slice(k + 1).some(o => o.counts.get(y));
        const gap = acc ? 2 : 0;                                   // 2 px surface gap between segments
        marks += top ? `<path class="mk" d="${barPath(x, base - acc - h, w, Math.max(0, h - gap))}" fill="${st.color}"/>`
          : `<rect class="mk" x="${x}" y="${base - acc - h}" width="${w}" height="${Math.max(0, h - gap)}" fill="${st.color}"/>`;
        acc += h;
        tip += ` · ${st.label} : ${fmt(v)}`;
      });
      const label = i % Math.ceil(ys.length * 34 / W) === 0 ? `<text x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${String(y).slice(onClick ? 0 : 2)}</text>` : '';
      s += `<g class="hit" data-year="${y}" data-tip="${esc(tip)}"><rect x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${H - pad.t - pad.b}" fill="transparent"/>${marks}</g>${label}`;
    });
    el.innerHTML = s + '</svg>';
    if (onClick) el.querySelectorAll('[data-year]').forEach(g => g.addEventListener('click', () => onClick(+g.dataset.year)));
  }

  // Ranked horizontal bars with direct value labels.
  function hbars(el, items, total, color, onClick) {
    if (!items.length) { el.innerHTML = '<p class="note">Aucun indice dans ces titres.</p>'; return; }
    const W = Math.max(300, el.clientWidth || 420), row = 22, lw = 170, H = items.length * row + 4, max = Math.max(...items.map(i => i[1]));
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">`;
    items.forEach(([k, v], i) => {
      const y = i * row + 3, w = (W - lw - 60) * v / max;
      s += `<g class="${onClick ? 'hit' : ''}" data-k="${esc(k)}" data-tip="${esc(`${k} : ${fmt(v)} (${pct(v, total)})`)}">` +
        `<rect x="0" y="${y - 2}" width="${W}" height="${row}" fill="transparent"/>` +
        `<text class="lab" x="${lw - 8}" y="${y + 12}" text-anchor="end">${esc(k.length > 28 ? k.slice(0, 27) + '…' : k)}</text>` +
        `<path class="mk" d="M${lw},${y}H${lw + Math.max(w - 4, 0)}Q${lw + w},${y} ${lw + w},${y + 4}V${y + 12}Q${lw + w},${y + 16} ${lw + Math.max(w - 4, 0)},${y + 16}H${lw}Z" fill="${color}"/>` +
        `<text x="${lw + w + 6}" y="${y + 12}">${fmt(v)} · ${pct(v, total)}</text></g>`;
    });
    el.innerHTML = s + '</svg>';
    if (onClick) el.querySelectorAll('[data-k]').forEach(g => g.addEventListener('click', () => onClick(g.dataset.k)));
  }

  // One option: ranked bars, segments shaded by status, thin range line (principal mode only).
  function speBars(opt, rows) {
    const items = new Map();
    const item = k => items.get(k) || items.set(k, { v: 0, st: {}, sure: 0, sec: 0 }).get(k);
    for (const r of rows) {
      const s = speOf(r);
      if (!s) continue;
      for (const [spe, w] of contrib(r)) {
        if (OPT_OF[spe] !== opt) continue;
        const it = item(spe);
        it.v += w; it.st[s.st] = (it.st[s.st] || 0) + w;
        if (s.st === 'confirmée' || s.st === 'vérifiée') it.sure += w;
      }
      if (MODE === 'principal' && s.sec && s.sec !== s.spe && OPT_OF[s.sec] === opt) item(s.sec).sec++;
    }
    const list = [...items].filter(([, it]) => it.v > 0.004).sort((a, b) => b[1].v - a[1].v);
    const total = list.reduce((a, [, it]) => a + it.v, 0), color = OPT_COLOR[opt];
    const head = `<h4 data-opt="${esc(opt)}" title="Filtrer l'option"><span style="color:${color}">●</span> ${esc(SHORT[opt])} <small>${fmt(total)} thèses</small></h4>`;
    if (!list.length) return `<div>${head}<p class="note">Aucune thèse.</p></div>`;
    const W = 420, row = 20, lw = 168, vw = 62, H = list.length * row + 2;
    const max = Math.max(...list.map(([, it]) => it.v + it.sec)), sx = v => (W - lw - vw) * v / max;
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">`;
    list.forEach(([k, it], i) => {
      const y = i * row + 2;
      let x = lw, marks = '';
      for (const st of ['vérifiée', 'confirmée', 'probable', 'à vérifier']) {
        const w = sx(it.st[st] || 0);
        if (w <= 0) continue;
        marks += `<rect class="mk" x="${x}" y="${y}" width="${Math.max(w - 1, 0.5)}" height="13" fill="${color}" fill-opacity="${STATUS_OP[st]}"/>`;
        x += w;
      }
      if (MODE === 'principal' && (it.sec || it.sure < it.v)) {               // fourchette confirmées → + secondaires
        const a = lw + sx(it.sure), b = lw + sx(it.v + it.sec), ym = y + 16.5;
        marks += `<path d="M${a},${ym - 2}V${ym + 2}M${a},${ym}H${b}M${b},${ym - 2}V${ym + 2}" stroke="var(--ink2)" stroke-width="1" fill="none"/>`;
      }
      const st = Object.entries(it.st).map(([n, v]) => `${n} ${fmt(v)}`).join(', ');
      const tip = `${k} : ${fmt(it.v)} (${pct(it.v, total)}) — ${st}` + (MODE === 'principal' ? ` · fourchette ${fmt(it.sure)}–${fmt(it.v + it.sec)}` : '');
      svg += `<g class="hit" data-spe="${esc(k)}" data-tip="${esc(tip)}"><rect x="0" y="${y - 2}" width="${W}" height="${row}" fill="transparent"/>` +
        `<text class="lab" x="${lw - 6}" y="${y + 10.5}" text-anchor="end"${FILTER.spe === k ? ' style="font-weight:700"' : ''}>${esc(k.length > 27 ? k.slice(0, 26) + '…' : k)}</text>` +
        `${marks}<text x="${lw + sx(Math.max(it.v, MODE === 'principal' ? it.v + it.sec : 0)) + 5}" y="${y + 10.5}">${fmt(it.v)}</text></g>`;
    });
    return `<div>${head}${svg}</svg></div>`;
  }

  // Specialty × year heatmap, rows grouped by option and ranked by total.
  function heatmap(el, rows, ys) {
    const cell = wcount(rows, (r, spe) => `${spe}|${r.year}`), tot = wcount(rows, (r, spe) => spe);
    const spes = OPTIONS.flatMap(o => [...tot].filter(([k, v]) => OPT_OF[k] === o && v > 0.004).sort((a, b) => b[1] - a[1]).map(([k]) => k));
    if (!spes.length) { el.innerHTML = '<p class="note">Aucune thèse classée.</p>'; return; }
    const W = Math.max(520, el.clientWidth || 900), lw = 190, top = 16, rh = 15;
    const cw = (W - lw - 40) / ys.length, H = top + spes.length * rh + 2, max = Math.max(...cell.values());
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">`;
    ys.forEach((y, j) => {
      if (j % Math.ceil(ys.length * 30 / (W - lw)) === 0) s += `<text x="${lw + j * cw + cw / 2}" y="11" text-anchor="middle">${String(y).slice(2)}</text>`;
    });
    spes.forEach((k, i) => {
      const y = top + i * rh, c = OPT_COLOR[OPT_OF[k]];
      s += `<g class="hit" data-spe="${esc(k)}" data-tip="${esc(`${k} : ${fmt(tot.get(k))} thèses`)}"><text class="lab" x="${lw - 6}" y="${y + 11}" text-anchor="end">${esc(k.length > 30 ? k.slice(0, 29) + '…' : k)}</text></g>`;
      ys.forEach((yr, j) => {
        const v = cell.get(`${k}|${yr}`) || 0;
        s += `<g class="hit" data-spe="${esc(k)}" data-year="${yr}" data-tip="${esc(`${k} · ${yr} : ${fmt(v)}`)}"><rect class="mk" x="${lw + j * cw + 0.5}" y="${y + 0.5}" width="${cw - 1}" height="${rh - 1}" rx="2"` +
          (v ? ` fill="${c}" fill-opacity="${(0.1 + 0.9 * Math.sqrt(v / max)).toFixed(2)}"` : ' fill="var(--grid)" fill-opacity="0.35"') + '/></g>';
      });
      s += `<text x="${W - 34}" y="${y + 11}">${fmt(tot.get(k))}</text>`;
    });
    el.innerHTML = s + '</svg>';
    el.querySelectorAll('[data-spe]').forEach(g => g.addEventListener('click', () => {
      const y = g.dataset.year ? +g.dataset.year : null;
      if (y) { FILTER.spe = g.dataset.spe; FILTER.year = FILTER.year === y && FILTER.spe === g.dataset.spe ? null : y; }
      else FILTER.spe = FILTER.spe === g.dataset.spe ? null : g.dataset.spe;
      search();
    }));
  }

  // Big total + bars per year (ignores the year pin so it can be seen and changed), ticks every 5 years.
  function heroChart(rows, query) {
    const total = FILTER.year ? rows.filter(r => r.year === FILTER.year).length : rows.length;
    F('h-total').textContent = fmt(total);
    F('h-lbl').textContent = (total > 1 ? 'thèses' : 'thèse') + (FILTER.year ? ` en ${FILTER.year}` : '') + (query ? ` pour « ${query} »` : ' au total');
    F('h-ms').textContent = `${lastMs < 1 ? '<1' : Math.round(lastMs)} ms`;
    const by = count(rows.filter(r => r.year), r => r.year);
    if (!by.size) { F('h-bars').innerHTML = ''; F('h-axis').innerHTML = ''; return; }
    const ys = [...by.keys()], y0 = Math.min(...ys), y1 = Math.max(...ys), max = Math.max(...by.values());
    let html = '';
    for (let y = y0; y <= y1; y++) {
      const v = by.get(y) || 0, h = v ? Math.max(3, Math.round(v / max * 100)) : 0;
      html += `<div class="bar-slot${FILTER.year === y ? ' on' : ''}" role="listitem" tabindex="0" data-year="${y}"
        data-tip="${y} · ${fmt(v)} thèse${v > 1 ? 's' : ''}" aria-label="${y} : ${v} thèse(s)"><div class="bar" style="height:${h}%"></div></div>`;
    }
    F('h-bars').innerHTML = html;
    const span = y1 - y0, ticks = [y0];
    if (span >= 8) { const step = span > 40 ? 10 : 5; for (let y = Math.ceil((y0 + 1) / step) * step; y < y1 - step / 2; y += step) ticks.push(y); }
    if (y1 !== y0) ticks.push(y1);
    F('h-axis').innerHTML = ticks.map(t => `<span>${t}</span>`).join('');
    F('h-title').textContent = FILTER.year ? `Thèses par année — filtré sur ${FILTER.year} (recliquez pour retirer)`
      : `Thèses par année (${y0}–${y1}) — cliquez une barre pour filtrer l'année`;
  }

  function renderCharts(base, rows, query) {
    if (!DATA.rows.length) return;
    const ys = years();
    const label = query ? `« ${query} »` : 'toutes les thèses';
    F('fsub').textContent = `${fmt(rows.length)} thèse(s) — ${label}${FILTER.year || FILTER.spe || FILTER.opt ? ' (avec filtres)' : ''} · site officiel lu le ${new Date(DATA.at).toLocaleDateString('fr-FR')}`;
    heroChart(filtered(base, true), query);                        // all years: the pin is shown, not applied

    if (SPE) {
      F('mode-note').textContent = MODE === 'principal'
        ? 'Une thèse = une spécialité : la plus lourde du barycentre (rapporteur 3, catégorie 2, président 1,5, titre 2/1/0,5 ; option puis spécialité). Les totaux = le vrai nombre de thèses.'
        : 'Chaque thèse vaut 1, réparti selon ses parts de masse (ex. 0,7 médecine interne + 0,3 néphrologie) : total inchangé. Le filtre de spécialité inclut aussi les thèses où elle est secondaire.';
      F('range-note').style.display = MODE === 'principal' ? '' : 'none';
      const cls = rows.map(speOf).filter(Boolean), by = count(cls, s => s.st);
      F('c-kpi').innerHTML = `<span><b>${fmt(rows.length)}</b> thèses</span><span><b>${fmt(cls.length)}</b> classées</span>` +
        ['vérifiée', 'confirmée', 'probable', 'à vérifier'].filter(k => by.get(k)).map(k => `<span>${k} <b>${fmt(by.get(k))}</b></span>`).join('') +
        `<span>avec spécialité secondaire <b>${fmt(cls.filter(s => s.sec).length)}</b></span>`;
      const stacks = OPTIONS.map(o => ({ label: SHORT[o], color: OPT_COLOR[o], counts: wcount(rows, (r, spe) => OPT_OF[spe] === o ? r.year : null) }))
        .concat([{ label: 'non classées', color: 'var(--other)', counts: count(rows, r => speOf(r) ? null : r.year) }]);
      yearChart(F('c-opt'), ys, null, stacks, y => { FILTER.year = FILTER.year === y ? null : y; search(); });
      F('c-opt').insertAdjacentHTML('beforeend', `<div class="legend">${stacks.map(st => `<span><i style="background:${st.color}"></i>${st.label} — ${fmt([...st.counts.values()].reduce((a, b) => a + b, 0))}</span>`).join('')}</div>`);
      F('c-spe').innerHTML = OPTIONS.map(o => speBars(o, rows)).join('');
      F('c-spe').querySelectorAll('[data-spe]').forEach(g => g.addEventListener('click', () => {
        FILTER.spe = FILTER.spe === g.dataset.spe ? null : g.dataset.spe; search();
      }));
      F('c-spe').querySelectorAll('[data-opt]').forEach(g => g.addEventListener('click', () => {
        FILTER.opt = FILTER.opt === g.dataset.opt ? null : g.dataset.opt; search();
      }));
      heatmap(F('c-heat'), filtered(base, true), ys);
    } else {
      F('c-opt').innerHTML = `<p class="note">${SPE_ERR ? `Fichier des spécialités indisponible (${esc(SPE_ERR)}) : ` : 'Chargement des spécialités… '}${esc(SPE_URL)}</p>`;
      F('c-spe').innerHTML = F('c-heat').innerHTML = F('c-kpi').innerHTML = '';
    }

    const t = rows.map(r => ` ${norm(r.title)} `);
    hbars(F('c-design'), DESIGNS.map(([k, re]) => [k, t.filter(x => re.test(x)).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]), rows.length, 'var(--s7)');
    hbars(F('c-places'), PLACES.map(([k, re]) => [k, t.filter(x => re.test(x)).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 10), rows.length, 'var(--s3)');

    const en = count(rows.filter(r => isEnglish(norm(r.title))), r => r.year), tot = count(rows, r => r.year);
    const share = new Map(ys.map(y => [y, tot.get(y) ? Math.round(100 * (en.get(y) || 0) / tot.get(y)) : 0]));
    yearChart(F('c-lang'), ys, null, [{ label: '% en anglais', color: 'var(--s4)', counts: share }], null);
    F('c-lang').insertAdjacentHTML('beforeend', `<p class="note">${fmt([...en.values()].reduce((a, b) => a + b, 0))} titre(s) en anglais sur ${fmt(rows.length)} · axe = % des thèses de l’année.</p>`);

    const qwords = new Set(norm(query).split(' '));
    const wc = new Map();
    for (const x of t) for (const w of new Set(x.match(/[a-z][a-z-]{3,}/g) || [])) if (!STOP.has(w) && !qwords.has(w)) wc.set(w, (wc.get(w) || 0) + 1);
    F('c-words').innerHTML = [...wc].sort((a, b) => b[1] - a[1]).slice(0, 24)
      .map(([w, n]) => `<button data-w="${esc(w)}" title="${n} thèse(s)">${esc(w)} · ${n}</button>`).join('') || '<p class="note">—</p>';
    F('c-words').querySelectorAll('[data-w]').forEach(b => b.addEventListener('click', () => {
      $('q').value = `${$('q').value.trim()} ${b.dataset.w}`.trim(); search(); host.scrollIntoView({ behavior: 'smooth' });
    }));
  }

  // One tooltip for every chart (marks carry data-tip; hit areas are larger than the marks).
  froot.addEventListener('mousemove', e => {
    const g = e.composedPath().find(n => n.dataset && n.dataset.tip);
    const tip = F('tip');
    if (!g) { tip.style.display = 'none'; return; }
    tip.textContent = g.dataset.tip;
    tip.style.display = 'block';
    const x = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8);
    tip.style.left = `${x}px`; tip.style.top = `${e.clientY + 14}px`;
  });
  froot.addEventListener('mouseleave', () => { F('tip').style.display = 'none'; }, true);

  async function start(force) {
    $('meta').textContent = 'Chargement…';
    try { setData(await loadAll(force, msg => { $('meta').textContent = msg; })); }
    catch (e) { $('meta').textContent = 'Erreur de chargement : ' + e.message; }
  }

  let timer;
  $('q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 120); });
  $('reload').addEventListener('click', () => start(true));
  $('t2').addEventListener('click', () => {
    const q = $('q').value.trim();
    open(`${T2_SITE}/search${q ? `?search=${encodeURIComponent(q)}` : ''}`, '_blank', 'noopener');
  });
  $('hide').addEventListener('click', () => { host.remove(); foot.remove(); });
  $('todiag').addEventListener('click', () => foot.scrollIntoView({ behavior: 'smooth' }));
  const pin = slot => { const y = +slot.dataset.year; FILTER.year = FILTER.year === y ? null : y; search(); };
  F('h-bars').addEventListener('click', e => { const s = e.target.closest('.bar-slot'); if (s) pin(s); });
  F('h-bars').addEventListener('keydown', e => {
    const s = e.target.closest('.bar-slot');
    if (s && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pin(s); }
  });
  F('totop').addEventListener('click', () => { host.scrollIntoView({ behavior: 'smooth' }); $('q').focus(); });
  $('chips').addEventListener('click', e => { const f = e.target.dataset.f; if (f) { FILTER[f] = null; search(); } });
  $('export').addEventListener('click', () => {
    if (!DATA.rows.length) { $('meta').textContent = 'Rien à exporter : chargez d\'abord les données.'; return; }
    const d = new Date().toISOString().slice(0, 10);
    download(`fmpm-officiel-brut-${d}.csv`, toCSV(DATA.rows));
    $('meta').textContent = `Exporté : fmpm-officiel-brut-${d}.csv (${DATA.rows.length} lignes). Étape suivante : build_fmpm.py (voir archive/fmpm/methode/README.md).`;
  });
  document.addEventListener('keydown', e => {
    const t = e.composedPath()[0] || {};                             // the real target, even inside the shadow root
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') && !t.isContentEditable) { e.preventDefault(); $('q').focus(); }
  });

  let rz;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => DATA.rows.length && search(), 200); });

  F('mode').addEventListener('click', e => {
    const m = e.target.dataset.mode;
    if (!m || m === MODE) return;
    MODE = m;
    F('mode').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.mode === MODE));
    search();
  });

  loadSpecialties().then(m => { SPE = m; OPT_OF = {}; for (const v of Object.values(m)) for (const e of v.byAuthor ? Object.values(v.byAuthor) : [v]) OPT_OF[e.spe] = e.opt; }).catch(e => { SPE_ERR = e.message; }).finally(() => { if (DATA.rows.length) { search(); annotatePage(); } });
  start(false);
})();
