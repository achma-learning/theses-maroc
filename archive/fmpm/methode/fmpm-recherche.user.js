// ==UserScript==
// @name         FMPM thèses — recherche en ligne + export CSV
// @namespace    https://github.com/achma-learning/these
// @version      1.2.1
// @description  Ajoute une barre de recherche au catalogue officiel des thèses FMPM (toutes les années, lues en direct sur le site) et exporte le CSV brut pour mettre à jour la copie locale du dépôt.
// @match        https://wd.fmpm.uca.ma/biblio/theses/*
// @match        http://wd.fmpm.uca.ma/biblio/theses/*
// @exclude      https://wd.fmpm.uca.ma/biblio/theses/annee-htm/FT/*
// @exclude      http://wd.fmpm.uca.ma/biblio/theses/annee-htm/FT/*
// @exclude      https://wd.fmpm.uca.ma/biblio/theses/annee-htm/art/*
// @exclude      http://wd.fmpm.uca.ma/biblio/theses/annee-htm/art/*
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
  if (/\/annee-htm\/(FT|art)\/|\.pdf$/i.test(location.pathname)) return; // PDF (texte intégral, résumé) : laisser le lecteur PDF
  if (document.documentElement.hasAttribute('data-fmpm-ultra')) return;     // v2-ultra is running on this page
  if (document.getElementById('fmpm-search-host')) return; // already injected

  const BASE = new URL('/biblio/theses/annee-htm/', location.href);
  const FIRST_YEAR = 2006;
  const PAUSE_MS = 400;
  const CACHE_KEY = 'fmpm-theses-cache-v2'; // v1 counted lines printed twice on the site
  const CACHE_TTL = 24 * 3600 * 1000;
  const RETRY_TTL = 30 * 60 * 1000;                               // a load where a year failed: tried again after 30 min,
                                                                  // then 2 h, 8 h, 24 h while it keeps failing
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

  function readCache(anyAge) {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      const ttl = c && c.failed ? Math.min(CACHE_TTL, RETRY_TTL * 4 ** ((c.streak || 1) - 1)) : CACHE_TTL;
      return c && (anyAge || Date.now() - c.at < ttl) ? c : null;
    } catch { return null; }
  }
  function writeCache(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* quota or blocked storage: run without cache */ }
  }

  // A year that cannot be read keeps its rows from the previous load instead of vanishing from the results
  // (and from the CSV export); such a load is marked `failed` and kept 30 min only. This year's page not yet
  // online (404 in January) is not a failure.
  async function loadAll(force, onProgress) {
    const cached = !force && readCache();
    if (cached) return cached;
    const prev = readCache(true);                                    // any age: stands in for a year that fails now
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
    .nav { margin-top: 6px; gap: 4px; font-size: 12.5px; }
    .nav a { text-decoration: none; padding: 1px 6px; border-radius: 10px; border: 1px solid #d5d8de; color: #2a78d6; }
    .nav a.on { background: #2a78d6; color: #fff; border-color: #2a78d6; }
    .nav a.home { border-color: #2a78d6; font-weight: 600; }
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
    <div class="row nav" id="nav"></div>
    <div class="meta" id="meta">Chargement…</div>
    <div class="meta" id="yearinfo"></div>
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

  let DATA = { rows: [], perYear: {}, at: 0 };
  let INDEX = [];

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

  // Plain case-insensitive match on the words as typed (accent-free matching is only for filtering), on the raw
  // text: matching the escaped HTML broke it (« ar » inside « <mark> », « amp » inside « &amp; »).
  function highlight(text, terms) {
    const ts = terms.filter(t => t.length >= 2).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!ts.length) return esc(text);
    return text.split(new RegExp(`(${ts.join('|')})`, 'gi')).map((p, i) => i % 2 ? `<mark>${esc(p)}</mark>` : esc(p)).join('');
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
    const t = e.composedPath()[0] || {};                             // the real target, even inside the shadow root
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') && !t.isContentEditable) { e.preventDefault(); $('q').focus(); }
  });

  start(false);
})();
