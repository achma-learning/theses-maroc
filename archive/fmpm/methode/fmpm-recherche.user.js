// ==UserScript==
// @name         FMPM thèses — recherche en ligne + export CSV
// @namespace    https://github.com/achma-learning/these
// @version      1.0.2
// @description  Ajoute une barre de recherche au catalogue officiel des thèses FMPM (toutes les années, lues en direct sur le site) et exporte le CSV brut pour mettre à jour la copie locale du dépôt.
// @match        https://wd.fmpm.uca.ma/biblio/theses/*
// @match        http://wd.fmpm.uca.ma/biblio/theses/*
// @exclude      https://wd.fmpm.uca.ma/biblio/theses/annee-htm/FT/*
// @exclude      http://wd.fmpm.uca.ma/biblio/theses/annee-htm/FT/*
// @grant        none
// @license MIT
// @run-at       document-idle
// @downloadURL https://update.greasyfork.org/scripts/600588/FMPM%20th%C3%A8ses%20%E2%80%94%20recherche%20en%20ligne%20%2B%20export%20CSV.user.js
// @updateURL https://update.greasyfork.org/scripts/600588/FMPM%20th%C3%A8ses%20%E2%80%94%20recherche%20en%20ligne%20%2B%20export%20CSV.meta.js
// ==/UserScript==

/*
 * Deux usages, un seul script :
 *  1. EN LIGNE — recherche dans toutes les pages annuelles du site officiel (comme These2.0,
 *     mais toujours à jour puisque les pages sont relues sur le site lui-même).
 *  2. COPIE LOCALE — bouton « Exporter CSV brut » → fmpm-officiel-brut-AAAA-MM-JJ.csv,
 *     à passer ensuite dans build_fmpm.py (dédoublonnage, backup, catalogue).
 * Installation : Tampermonkey/Violentmonkey (fichier .user.js), ou coller tout le fichier dans
 * la console sur https://wd.fmpm.uca.ma/biblio/theses/Accueil.html.
 * Politesse : une page annuelle à la fois, pause de 400 ms, résultat gardé 24 h en cache local.
 */
(function () {
  'use strict';
  if (/\/annee-htm\/FT\//i.test(location.pathname)) return; // PDF texte intégral : laisser le lecteur PDF
  if (document.getElementById('fmpm-search-host')) return; // already injected

  const BASE = new URL('/biblio/theses/annee-htm/', location.href);
  const FIRST_YEAR = 2006;
  const PAUSE_MS = 400;
  const CACHE_KEY = 'fmpm-theses-cache-v2'; // v1 counted lines printed twice on the site
  const CACHE_TTL = 24 * 3600 * 1000;
  const MAX_SHOWN = 200;
  const HEADER = ['Année', 'N°', 'Auteur', 'Titre', 'PDF (texte intégral)', 'Article (résumé, 2006-2014)'];

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

  function readCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      return c && Date.now() - c.at < CACHE_TTL ? c : null;
    } catch { return null; }
  }
  function writeCache(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* quota or blocked storage: run without cache */ }
  }

  async function loadAll(force, onProgress) {
    const cached = !force && readCache();
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
    writeCache(data);
    return data;
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

  // ---- UI (shadow DOM so the old site CSS cannot touch it) -------------------------------
  const host = document.createElement('div');
  host.id = 'fmpm-search-host';
  host.style.cssText = 'position:relative;z-index:2147483646';
  document.body.prepend(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
  <style>
    :host { all: initial; }
    .box { font: 14px/1.45 system-ui, sans-serif; color: #111; background: #fff; border-bottom: 2px solid #2a78d6;
           padding: 12px 16px; box-shadow: 0 2px 8px rgba(0,0,0,.12); }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    input { flex: 1 1 280px; font: inherit; padding: 8px 10px; border: 1px solid #9aa4b2; border-radius: 6px; }
    button { font: inherit; padding: 7px 12px; border: 1px solid #2a78d6; border-radius: 6px; background: #fff; color: #2a78d6; cursor: pointer; }
    button:hover { background: #eef4fc; }
    .meta { color: #555; font-size: 12.5px; margin-top: 6px; }
    ol { margin: 8px 0 0; padding-left: 0; list-style: none; max-height: 60vh; overflow: auto; }
    li { padding: 6px 0; border-top: 1px solid #eee; }
    .t { font-weight: 600; }
    .a { color: #444; font-size: 13px; }
    mark { background: #ffe58a; padding: 0; }
    a { color: #1a5fb4; }
    details { margin-top: 6px; font-size: 12.5px; color: #333; }
    table { border-collapse: collapse; margin-top: 4px; }
    td, th { border: 1px solid #ddd; padding: 2px 8px; text-align: right; }
  </style>
  <div class="box">
    <div class="row">
      <strong>🔎 Thèses FMPM — toutes années, en direct</strong>
      <input id="q" type="search" placeholder="Mots du titre ou de l'auteur, ex. lupus marrakech (raccourci : /)" autocomplete="off">
      <button id="reload" title="Relire toutes les pages annuelles sur le site">↻ Relire en ligne</button>
      <button id="export" title="Télécharger le CSV brut pour mettre à jour la copie locale du dépôt">⬇ Exporter CSV brut</button>
      <button id="t2" title="Même recherche sur These2.0 (thesefmpm3.vercel.app) : jury, spécialités, statistiques ; mis à jour chaque jour">These2.0 ↗</button>
      <button id="hide" title="Masquer">✕</button>
    </div>
    <div class="meta" id="meta">Chargement…</div>
    <details id="det"><summary>Thèses par année (site officiel)</summary><div id="years"></div></details>
    <ol id="res"></ol>
  </div>`;
  const $ = id => root.getElementById(id);

  let DATA = { rows: [], perYear: {}, at: 0 };
  let INDEX = [];

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

  function search() {
    const q = norm($('q').value);
    const terms = q.split(' ').filter(Boolean);
    if (!terms.length) { $('res').innerHTML = ''; return; }
    const hits = INDEX.filter(x => terms.every(t => x.n.includes(t))).map(x => x.r)
      .sort((a, b) => b.year - a.year || a.num - b.num);
    const raw = $('q').value.trim().split(/\s+/);
    $('res').innerHTML = `<li><em>${hits.length} résultat(s)${hits.length > MAX_SHOWN ? ` — ${MAX_SHOWN} premiers affichés` : ''}</em></li>` +
      hits.slice(0, MAX_SHOWN).map(r => `<li>
        <div class="t">${highlight(r.title, raw)}</div>
        <div class="a">${r.year} · n° ${esc(r.num)} · ${highlight(r.author, raw)}
          ${r.pdf ? ` · <a href="${esc(r.pdf)}" target="_blank" rel="noopener">PDF</a>` : ' · <em>sans PDF</em>'}
          ${r.article ? ` · <a href="${esc(r.article)}" target="_blank" rel="noopener">Résumé</a>` : ''}</div>
      </li>`).join('');
  }

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
  $('hide').addEventListener('click', () => host.remove());
  $('export').addEventListener('click', () => {
    if (!DATA.rows.length) { $('meta').textContent = 'Rien à exporter : chargez d\'abord les données.'; return; }
    const d = new Date().toISOString().slice(0, 10);
    download(`fmpm-officiel-brut-${d}.csv`, toCSV(DATA.rows));
    $('meta').textContent = `Exporté : fmpm-officiel-brut-${d}.csv (${DATA.rows.length} lignes). Étape suivante : build_fmpm.py (voir archive/fmpm/methode/README.md).`;
  });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) { e.preventDefault(); $('q').focus(); }
  });

  start(false);
})();
