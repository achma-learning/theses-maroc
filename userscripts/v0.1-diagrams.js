// ==UserScript==
// @name         FMPM thèses — recherche en ligne + diagrammes
// @namespace    https://github.com/achma-learning/these
// @version      0.1.0
// @description  Barre de recherche en haut du catalogue officiel des thèses FMPM (toutes les années, lues en direct) et, en pied de page, des diagrammes dynamiques qui suivent la recherche : thèses par année, spécialités FMPM (médecine / chirurgie / biologie), type d'étude, hôpitaux cités, langue, mots fréquents.
// @match        https://wd.fmpm.uca.ma/biblio/theses/*
// @match        http://wd.fmpm.uca.ma/biblio/theses/*
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
 *  - Spécialités : liste officielle FMPM (42 spécialités, 3 options), lue sur la page de garde de
 *    chaque thèse (président du jury) — fichier theses-fmpm-page-de-garde.csv du dépôt public
 *    achma-learning/theses-maroc, chargé une fois (cache 24 h). Sans ce fichier, les autres
 *    diagrammes marchent quand même.
 *  - Type d'étude, hôpitaux, langue : lus dans le TITRE (indicatif, pas une donnée officielle).
 * Installation : Tampermonkey/Violentmonkey (nouveau script → coller), ou F12 → Console → coller
 * tout le fichier sur https://wd.fmpm.uca.ma/biblio/theses/Accueil.html.
 * Politesse : une page annuelle à la fois, pause de 400 ms, résultats gardés 24 h en cache local.
 */
(function () {
  'use strict';
  if (document.getElementById('fmpm-search-host')) return; // already injected

  const BASE = new URL('/biblio/theses/annee-htm/', location.href);
  const FIRST_YEAR = 2006;
  const PAUSE_MS = 400;
  const CACHE_KEY = 'fmpm-theses-cache-v1';
  const SPE_KEY = 'fmpm-theses-spe-cache-v1';
  const CACHE_TTL = 24 * 3600 * 1000;
  const MAX_SHOWN = 200;
  const HEADER = ['Année', 'N°', 'Auteur', 'Titre', 'PDF (texte intégral)', 'Article (résumé, 2006-2014)'];
  const SPE_URL = 'https://raw.githubusercontent.com/achma-learning/theses-maroc/main/archive/fmpm/theses-fmpm-page-de-garde.csv';
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

  // One <tr> per thesis: N° | Auteur | Titre | TEXTE INTEGRAL (+ article link 2006-2014).
  function parseYear(html, y, pageUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const out = [];
    for (const tr of doc.querySelectorAll('tr')) {
      const cells = [...tr.children].filter(c => c.tagName === 'TD' || c.tagName === 'TH');
      if (cells.length < 3) continue;
      const num = clean(cells[0].textContent);
      if (!/^\d+$/.test(num)) continue;
      const links = [...tr.querySelectorAll('a[href]')].map(a => new URL(a.getAttribute('href'), pageUrl).href.replace(/^http:/, 'https:'));
      const titleCell = cells[2].cloneNode(true);
      titleCell.querySelectorAll('a').forEach(a => a.remove());
      out.push({
        year: y, num: String(Number(num)), author: clean(cells[1].textContent), title: clean(titleCell.textContent),
        pdf: links.find(h => /\/FT\//i.test(h)) || '', article: links.find(h => /\/art\//i.test(h)) || ''
      });
    }
    return out;
  }

  function readCache(key) {
    try {
      const c = JSON.parse(localStorage.getItem(key) || 'null');
      return c && Date.now() - c.at < CACHE_TTL ? c : null;
    } catch { return null; }
  }
  function writeCache(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* quota or blocked storage: run without cache */ }
  }

  async function loadAll(force, onProgress) {
    const cached = !force && readCache(CACHE_KEY);
    if (cached) return cached;
    const last = new Date().getFullYear();
    const rows = [], perYear = {};
    for (let y = last; y >= FIRST_YEAR; y--) {
      onProgress(`Lecture ${y}…`);
      try {
        const r = await fetchYear(y);
        perYear[y] = r.status === 200 ? { theses: r.rows.length, sansPDF: r.rows.filter(x => !x.pdf).length,
          nMax: Math.max(0, ...r.rows.map(x => +x.num)) } : `HTTP ${r.status}`;
        rows.push(...r.rows);
      } catch (e) { perYear[y] = 'erreur : ' + e.message; }
      await sleep(PAUSE_MS);
    }
    const data = { at: Date.now(), rows, perYear };
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

  // "année|n°" → { spe, opt } from the cover-page file (président du jury), else These2.0 mapping.
  async function loadSpecialties() {
    const cached = readCache(SPE_KEY);
    if (cached) return cached.map;
    const res = await fetch(SPE_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const map = {};
    for (const r of parseCSV(await res.text())) {
      const spe = r['Spécialité FMPM'] || r['Spécialité These2.0 (correspondance)'];
      if (spe) map[`${r['Année']}|${r['N°']}`] = { spe, opt: r['Option FMPM'] || '', src: r['Spécialité FMPM'] ? 'page de garde' : 'These2.0' };
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
      <button id="todiag" title="Aller aux diagrammes en bas de page">📊 Diagrammes ↓</button>
      <button id="hide" title="Masquer">✕</button>
    </div>
    <div class="meta" id="meta">Chargement…</div>
    <div class="chips" id="chips"></div>
    <details id="det"><summary>Thèses par année (site officiel)</summary><div id="years"></div></details>
    <ol id="res"></ol>
  </div>`;
  const $ = id => root.getElementById(id);

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
    .pies { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin-top: 8px; }
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
    <h2>📊 Diagrammes des thèses FMPM</h2>
    <div class="sub" id="fsub">Chargement…</div>
    <div class="grid">
      <div class="card wide">
        <div class="hero"><b id="h-total">0</b><span id="h-lbl">thèses au total</span><span class="ms" id="h-ms"></span></div>
        <p class="chart-title" id="h-title">Thèses par année — cliquez une barre pour filtrer l'année</p>
        <div class="bars" id="h-bars" role="list"></div><div class="axis" id="h-axis"></div></div>
      <div class="card wide"><h3>Spécialités FMPM par année (médecine · chirurgie · biologie)</h3>
        <p class="note">Spécialité du président du jury lue sur la page de garde (à défaut catégorie These2.0) — liste officielle des 42 spécialités FMPM. Clic sur une part = filtrer.</p>
        <div id="c-opt"></div><div class="pies" id="c-pies"></div></div>
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
  const FILTER = { year: null, spe: null, opt: null };

  function setData(d) {
    DATA = d;
    INDEX = d.rows.map(r => ({ r, n: norm(`${r.author} ${r.title} ${r.year}`) }));
    const when = new Date(d.at).toLocaleString('fr-FR');
    $('meta').textContent = `${d.rows.length} thèses lues sur le site officiel (${when}). Recherche sans accents ; tous les mots doivent être présents.`;
    $('years').innerHTML = '<table><tr><th>Année</th><th>Thèses</th><th>Sans PDF</th><th>N° max</th></tr>' +
      Object.keys(d.perYear).sort((a, b) => b - a).map(y => {
        const v = d.perYear[y];
        return typeof v === 'string' ? `<tr><td>${y}</td><td colspan="3">${esc(v)}</td></tr>`
          : `<tr><td>${y}</td><td>${v.theses}</td><td>${v.sansPDF}</td><td>${v.nMax}</td></tr>`;
      }).join('') + '</table>';
    search();
  }

  const speOf = r => SPE && SPE[`${r.year}|${r.num}`];

  function highlight(text, terms) {
    let out = esc(text);
    for (const t of terms) {
      if (t.length < 2) continue;
      // plain case-insensitive match on the words as typed (accent-free matching is only for filtering)
      const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      out = out.replace(re, m => `<mark>${m}</mark>`);
    }
    return out;
  }

  // Query matches (without the chart filters) feed the charts; the list also applies the filters.
  function matches() {
    const terms = norm($('q').value).split(' ').filter(Boolean);
    return terms.length ? INDEX.filter(x => terms.every(t => x.n.includes(t))).map(x => x.r) : DATA.rows;
  }
  function filtered(rows) {
    return rows.filter(r => (!FILTER.year || r.year === FILTER.year)
      && (!FILTER.spe || speOf(r)?.spe === FILTER.spe) && (!FILTER.opt || speOf(r)?.opt === FILTER.opt));
  }

  let lastMs = 0;
  function search() {
    const t0 = performance.now();
    const query = $('q').value.trim();
    const base = matches();
    const active = query || FILTER.year || FILTER.spe || FILTER.opt;
    const hits = filtered(base).slice().sort((a, b) => b.year - a.year || a.num - b.num);
    $('chips').innerHTML = [
      FILTER.year && `<span class="chip" data-f="year">Année ${FILTER.year} ✕</span>`,
      FILTER.opt && `<span class="chip" data-f="opt">${esc(SHORT[FILTER.opt] || FILTER.opt)} ✕</span>`,
      FILTER.spe && `<span class="chip" data-f="spe">${esc(FILTER.spe)} ✕</span>`,
    ].filter(Boolean).join('');
    const raw = query.split(/\s+/);
    $('res').innerHTML = !active ? '' : `<li><em>${hits.length} résultat(s)${hits.length > MAX_SHOWN ? ` — ${MAX_SHOWN} premiers affichés` : ''}</em></li>` +
      hits.slice(0, MAX_SHOWN).map(r => {
        const s = speOf(r);
        return `<li>
        <div class="t">${highlight(r.title, raw)}</div>
        <div class="a">${r.year} · n° ${esc(r.num)} · ${highlight(r.author, raw)}
          ${s ? ` · <span class="spe" title="Spécialité FMPM (${esc(s.src)})">${esc(s.spe)}</span>` : ''}
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
  const fmt = n => n.toLocaleString('fr-FR');
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

  // Donut: top 6 + « Autres » (part-to-whole at a glance), every specialty listed in the legend.
  function donut(opt, rows) {
    const c = [...count(rows, r => speOf(r)?.opt === opt ? speOf(r).spe : null)].sort((a, b) => b[1] - a[1]);
    const total = c.reduce((s, [, v]) => s + v, 0);
    const head = c.slice(0, 6), tail = c.slice(6);
    const parts = head.map(([k, v], i) => ({ k, v, color: COLORS[i] }))
      .concat(tail.length ? [{ k: `Autres (${tail.length})`, v: tail.reduce((s, [, v]) => s + v, 0), color: 'var(--other)', others: tail }] : []);
    const R = 70, r = 42, cx = 80, cy = 80;
    let a0 = -Math.PI / 2, s = `<svg viewBox="0 0 160 160" style="max-width:190px;margin:auto" role="img">`;
    if (!total) s += `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="var(--grid)" stroke-width="${R - r}"/>`;
    for (const p of parts) {
      const a1 = a0 + 2 * Math.PI * p.v / total, big = a1 - a0 > Math.PI ? 1 : 0;
      const P = (rad, ang) => `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`;
      const d = parts.length === 1 ? `M${cx},${cy - R}A${R},${R} 0 1 1 ${cx - 0.01},${cy - R}L${cx - 0.01},${cy - r}A${r},${r} 0 1 0 ${cx},${cy - r}Z`
        : `M${P(R, a0)}A${R},${R} 0 ${big} 1 ${P(R, a1)}L${P(r, a1)}A${r},${r} 0 ${big} 0 ${P(r, a0)}Z`;
      const tip = p.others ? `${p.k} : ${p.others.map(([k, v]) => `${k} ${v}`).join(', ')}` : `${p.k} : ${fmt(p.v)} (${pct(p.v, total)})`;
      s += `<g class="${p.others ? '' : 'hit'}" data-spe="${p.others ? '' : esc(p.k)}" data-tip="${esc(tip)}"><path class="mk" d="${d}" fill="${p.color}" stroke="var(--surface)" stroke-width="2"/></g>`;
      a0 = a1;
    }
    s += `<text x="${cx}" y="${cy - 2}" text-anchor="middle" class="lab" style="font-size:16px;font-weight:600">${fmt(total)}</text>` +
      `<text x="${cx}" y="${cy + 14}" text-anchor="middle">thèses</text></svg>`;
    const legend = c.map(([k, v], i) => `<span data-spe="${esc(k)}" title="Filtrer"><i style="background:${i < 6 ? COLORS[i] : 'var(--other)'}"></i>${esc(k)} — ${fmt(v)}</span>`).join('');
    return `<div><h3 style="text-align:center"><span class="hit" data-opt="${esc(opt)}" style="color:${OPT_COLOR[opt]}">●</span> ${esc(opt)}</h3>${s}<div class="legend">${legend || '<span class="note">Aucune thèse.</span>'}</div></div>`;
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
    heroChart(rows, query);

    if (SPE) {
      const stacks = OPTIONS.map(o => ({ label: SHORT[o], color: OPT_COLOR[o], counts: count(rows, r => speOf(r)?.opt === o ? r.year : null) }))
        .concat([{ label: 'non classées', color: 'var(--other)', counts: count(rows, r => speOf(r) ? null : r.year) }]);
      yearChart(F('c-opt'), ys, null, stacks, y => { FILTER.year = FILTER.year === y ? null : y; search(); });
      F('c-opt').insertAdjacentHTML('beforeend', `<div class="legend">${stacks.map(st => `<span><i style="background:${st.color}"></i>${st.label} — ${fmt([...st.counts.values()].reduce((a, b) => a + b, 0))}</span>`).join('')}</div>`);
      F('c-pies').innerHTML = OPTIONS.map(o => donut(o, rows)).join('');
      F('c-pies').querySelectorAll('[data-spe]').forEach(g => g.dataset.spe && g.addEventListener('click', () => {
        FILTER.spe = FILTER.spe === g.dataset.spe ? null : g.dataset.spe; search();
      }));
      F('c-pies').querySelectorAll('[data-opt]').forEach(g => g.addEventListener('click', () => {
        FILTER.opt = FILTER.opt === g.dataset.opt ? null : g.dataset.opt; search();
      }));
    } else {
      F('c-opt').innerHTML = `<p class="note">${SPE_ERR ? `Fichier des spécialités indisponible (${esc(SPE_ERR)}) : ` : 'Chargement des spécialités… '}${esc(SPE_URL)}</p>`;
      F('c-pies').innerHTML = '';
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
    if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) { e.preventDefault(); $('q').focus(); }
  });

  let rz;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => DATA.rows.length && search(), 200); });

  loadSpecialties().then(m => { SPE = m; }).catch(e => { SPE_ERR = e.message; }).finally(() => { if (DATA.rows.length) search(); });
  start(false);
})();
