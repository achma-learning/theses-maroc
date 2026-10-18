// ==UserScript==
// @name         FMPM thèses — Ultra : recherche, diagrammes, années, PDF
// @namespace    https://github.com/achma-learning/these
// @version      2.0.0
// @description  Catalogue officiel des thèses FMPM : recherche dans toutes les années (lues en direct), ruban 🏠 Accueil + 2006 → année en cours (suit le calendrier), résumé et étiquettes sur chaque page annuelle, diagrammes (spécialités FMPM, type d'étude, hôpitaux, langue, mots), exports CSV, diagnostic. Sur les PDF de thèse : un petit bouton pour revenir à l'accueil, à la liste de l'année, ou passer à la thèse précédente / suivante.
// @homepageURL  https://github.com/achma-learning/theses-maroc/tree/main/userscripts
// @match        https://wd.fmpm.uca.ma/biblio/theses/*
// @match        http://wd.fmpm.uca.ma/biblio/theses/*
// @noframes
// @grant        none
// @license      MIT
// @run-at       document-idle
// ==/UserScript==

/*
 * v2 « Ultra » = v0.1-diagrams + ce qu'il faut pour rester utile sans entretien.
 *  - Années : 2006 → année de l'horloge, recalculé à chaque page. 2027 apparaît seul en 2027 ; tant que la
 *    faculté n'a pas mis 2027.htm en ligne, l'année est grisée « pas encore publiée ».
 *  - Cache par année (localStorage) : un échec n'efface jamais une bonne copie, il est signalé et l'ancienne
 *    copie est utilisée ; une liste qui perd plus de la moitié de ses lignes est une anomalie (ancienne copie
 *    gardée, « Vider le cache » pour accepter la nouvelle). Années récentes relues toutes les 12 h, anciennes
 *    tous les 7 jours, erreurs réessayées après 15 min. Une page à la fois, pause 400 ms, délai max 20 s.
 *  - États d'une année : à jour · copie ancienne · pas encore publiée (404) · erreur (réseau, délai, HTTP)
 *    · anomalie (page lue mais aucun tableau de thèses reconnu). Panneau « Diagnostic » : état de chaque
 *    année, relire, vider le cache, copier le diagnostic (à joindre à un signalement).
 *  - Page annuelle : la page elle-même sert de source pour son année, résumé (n° partagés, lignes répétées),
 *    étiquettes de spécialité dans le tableau ; lien 2019.htm#n12 = ligne n° 12 surlignée.
 *  - PDF (annee-htm/FT/… et art/…) : petit bouton en bas à gauche — 🏠, « ← Liste 2019 », ▴. Déplié : thèse
 *    précédente / suivante, fiche These2.0, résumé 2006-2014, copier la référence, ruban des années. Replié,
 *    il ne fait aucune requête. PDF absent (404) : il s'ouvre et dit quelle thèse manque.
 *    Testé avec le lecteur PDF de Chromium. Firefox ouvre les PDF dans pdf.js, où les scripts utilisateur
 *    ne tournent pas : pas de bouton là (le reste du script marche).
 *  - Spécialités : classement du dépôt public achma-learning/theses-maroc (barycentre rapporteur / catégorie
 *    / président / titre), cache 24 h ; s'il est injoignable, la dernière copie sert (date affichée).
 *  - Remplace v0-stable et v0.1-diagrams (même barre, même « CSV brut » pour build_fmpm.py) : n'en garder
 *    qu'un actif. S'ils tournent ensemble, v2 retire leur barre, ou ils s'arrêtent en voyant celle de v2.
 * Tests : userscripts/tests/run.js (Playwright, pages du site enregistrées, dates simulées 2026 et 2027).
 */
(function () {
  'use strict';
  const VERSION = '2.0.0';
  const D = document;
  if (!D.body || D.documentElement.hasAttribute('data-fmpm-ultra')) return; // no page, or already running
  D.documentElement.setAttribute('data-fmpm-ultra', VERSION);

  // ---- Constants ------------------------------------------------------------------------------------------
  const SITE = new URL('/biblio/theses/', location.href);
  const BASE = new URL('annee-htm/', SITE);
  const HOME = new URL('Accueil.html', SITE).href;
  const FIRST_YEAR = 2006;
  // Follows the calendar: read at every page load, so the year list needs no edit next January.
  const LAST_YEAR = Math.max(FIRST_YEAR, new Date().getFullYear());
  const YEARS_ALL = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);
  const PAUSE_MS = 400, TIMEOUT_MS = 20000, SPE_TIMEOUT_MS = 30000;
  const HOUR = 3600 * 1000;
  const TTL_RECENT = 12 * HOUR, TTL_OLD = 7 * 24 * HOUR, RETRY_MS = 15 * 60 * 1000, SPE_TTL = 24 * HOUR;
  const NS = 'fmpm-ultra-v1:';
  // v0.x caches: dropped only if storage is full (they rebuild themselves).
  const LEGACY_KEYS = ['fmpm-theses-cache-v1', 'fmpm-theses-cache-v2'].concat([1, 2, 3, 4, 5].map(i => `fmpm-theses-spe-cache-v${i}`));
  const MAX_SHOWN = 200;
  const HEADER = ['Année', 'N°', 'Auteur', 'Titre', 'PDF (texte intégral)', 'Article (résumé, 2006-2014)'];
  const HEADER_PLUS = HEADER.concat(['Spécialité FMPM', 'Option FMPM', 'Statut', 'Confiance', 'Spécialité secondaire', 'Signalement', 'Fiche These2.0']);
  const SPE_URL = 'https://raw.githubusercontent.com/achma-learning/theses-maroc/main/archive/fmpm/theses-fmpm-specialites.csv';
  const T2_SITE = 'https://thesefmpm3.vercel.app';            // These2.0, same list, updated every day
  const OPTIONS = ['Spécialités de médecine', 'Spécialités de chirurgie', 'Spécialités de Biologie'];
  const SHORT = { 'Spécialités de médecine': 'Médecine', 'Spécialités de chirurgie': 'Chirurgie', 'Spécialités de Biologie': 'Biologie' };

  // ---- Route ----------------------------------------------------------------------------------------------
  const PATH = location.pathname;
  const PDF_M = PATH.match(/\/annee-htm\/(FT|art)\/(\d{4})\/([^/]+)$/i);
  const PAGE_YEAR = Number((PATH.match(/\/annee-htm\/(\d{4})\.htm$/i) || [])[1]) || null;
  const ROUTE = /\.pdf$/i.test(PATH) ? 'pdf' : PAGE_YEAR ? 'year' : 'site';

  // ---- Helpers --------------------------------------------------------------------------------------------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const norm = s => clean(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’'`]/g, "'").toLowerCase();
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Same person whatever the accents, case or word order (« IMANE EL OUAFRI » = « EL OUAFRI IMANE »).
  const person = s => norm(s).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  const fmt = n => Math.round(n).toLocaleString('fr-FR');
  const pct = (a, b) => b ? `${Math.round(100 * a / b)} %` : '—';
  const day = t => t ? new Date(t).toLocaleDateString('fr-FR') : '—';
  const stamp = t => t ? new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const yearUrl = y => new URL(`${y}.htm`, BASE).href;
  const pathKey = u => { try { return decodeURIComponent(new URL(u, location.href).pathname).toLowerCase(); } catch { return String(u).toLowerCase(); } };
  // Links of the official pages: http(s) only (the 2007-2014 pages also hold file:/// links), always https.
  const safeUrl = (href, base) => {
    try { const u = new URL(href, base); return /^https?:$/.test(u.protocol) ? u.href.replace(/^http:/, 'https:') : ''; } catch { return ''; }
  };
  const isSure = s => s.st === 'confirmée' || s.st === 'vérifiée';
  // These2.0 fiche: /these/<PDF file name> (its page looks the name up in the official link).
  const ficheUrl = r => { const m = (r.pdf || '').match(/\/(these\d+-\d{2})\.pdf$/i); return m ? `${T2_SITE}/these/${m[1]}` : ''; };

  // ---- Local storage (never required: blocked or full storage = run without cache) -------------------------
  const store = {
    ok: true,
    get(k) { try { return JSON.parse(localStorage.getItem(NS + k) || 'null'); } catch { return null; } },
    set(k, v) {
      const s = JSON.stringify(v);
      for (let attempt = 0; attempt < 2; attempt++) {
        try { localStorage.setItem(NS + k, s); store.ok = true; return true; } catch {
          if (attempt === 0) LEGACY_KEYS.forEach(x => { try { localStorage.removeItem(x); } catch { /* blocked */ } });
        }
      }
      store.ok = false;
      return false;
    },
    clear() {
      try { Object.keys(localStorage).filter(k => k.startsWith(NS) && k !== NS + 'dock').forEach(k => localStorage.removeItem(k)); } catch { /* blocked */ }
    },
  };

  // ---- Reading the official year pages -------------------------------------------------------------------
  // Older pages are windows-1252, 2026 is UTF-8, and the server sends no charset: valid UTF-8 wins.
  function decode(buf) {
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), enc: 'utf-8' }; }
    catch { return { text: new TextDecoder('windows-1252').decode(buf), enc: 'windows-1252' }; }
  }

  // One <tr> per thesis: N° | Auteur | Titre | TEXTE INTEGRAL (+ article link 2006-2014).
  // The site prints some lines twice (2023-125, 2025-329): same N° + same author = one thesis. It also
  // gives one N° to two different theses (2025-214, 2026-26/36/63): both are kept.
  function parseYear(src, y, pageUrl) {
    const doc = typeof src === 'string' ? new DOMParser().parseFromString(src, 'text/html') : src;
    const rows = [], seen = new Set();
    let bad = 0;
    for (const tr of doc.querySelectorAll('tr')) {
      const cells = [...tr.children].filter(c => c.tagName === 'TD' || c.tagName === 'TH');
      if (cells.length < 3) continue;
      const num = clean(cells[0].textContent);
      if (!/^\d+$/.test(num)) continue;
      const author = clean(cells[1].textContent);
      const key = `${Number(num)}|${person(author)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const links = [...tr.querySelectorAll('a[href]')].map(a => safeUrl(a.getAttribute('href'), pageUrl)).filter(Boolean);
      const titleCell = cells[2].cloneNode(true);
      titleCell.querySelectorAll('a, .fmpm-u-badges, .fmpm-badges').forEach(a => a.remove());
      const title = clean(titleCell.textContent);
      if (!author || !title) bad++;
      rows.push({ year: y, num: String(Number(num)), author, title,
        pdf: links.find(h => /\/FT\//i.test(h)) || '', article: links.find(h => /\/art\//i.test(h)) || '' });
    }
    return { rows, bad, looksLikeList: /auteur|titre|th[eè]se/i.test(doc.body ? doc.body.textContent : '') };
  }

  // Never throws: { status: ok | empty | missing | error | anomaly, rows?, enc?, http?, detail }.
  async function fetchYear(y) {
    const url = yearUrl(y), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { cache: 'no-cache', credentials: 'same-origin', signal: ctl.signal });
      if (res.status === 404 || res.status === 410)
        return { status: 'missing', http: res.status, detail: y >= LAST_YEAR ? `pas encore publiée (HTTP ${res.status})` : `page absente du site (HTTP ${res.status})` };
      if (!res.ok) return { status: 'error', http: res.status, detail: `HTTP ${res.status}` };
      const { text, enc } = decode(await res.arrayBuffer());
      let p;
      try { p = parseYear(text, y, url); } catch (e) { return { status: 'anomaly', enc, detail: `analyse impossible : ${e.message}` }; }
      if (p.rows.length) return { status: 'ok', rows: p.rows, enc, detail: p.bad ? `${p.bad} ligne(s) sans auteur ou titre` : '' };
      return p.looksLikeList ? { status: 'empty', rows: [], enc, detail: 'page en ligne, aucune thèse listée' }
        : { status: 'anomaly', enc, detail: 'page lue mais aucun tableau de thèses reconnu (mise en page changée ?)' };
    } catch (e) {
      return { status: 'error', detail: e && e.name === 'AbortError' ? `délai dépassé (${TIMEOUT_MS / 1000} s)` : `réseau : ${e && e.message || e}` };
    } finally { clearTimeout(timer); }
  }

  // Compact storage: rows as arrays, links relative to annee-htm/ (≈ 600 kB for 20 years).
  const REL = BASE.href.replace(/^http:/, 'https:');
  const rel = u => u && u.startsWith(REL) ? u.slice(REL.length) : u;
  const abs = u => !u ? '' : /^https?:/.test(u) ? u : REL + u;
  const pack = r => [r.num, r.author, r.title, rel(r.pdf), rel(r.article)];
  const unpack = (y, a) => ({ year: y, num: a[0], author: a[1], title: a[2], pdf: abs(a[3]), article: abs(a[4]) });

  // Cache entry of a year = { v, good: last good copy { at, rows, enc } | null, last: last attempt }.
  // A failed attempt never replaces a good copy; a list that suddenly loses half its lines is not trusted.
  function merge(prev, res, now = Date.now()) {
    let good = prev && prev.good || null;
    const last = { at: now, status: res.status, detail: res.detail || '', http: res.http || 0 };
    if (res.status === 'ok' || res.status === 'empty') {
      const before = good ? good.rows.length : 0, after = res.rows.length;
      if (before >= 20 && after < before * 0.5) {
        last.status = 'anomaly';
        last.detail = `${after} thèse(s) lue(s) au lieu de ${before} : ancienne copie gardée (« Vider le cache » pour accepter la nouvelle liste)`;
      } else good = { at: now, rows: res.rows.map(pack), enc: res.enc || '' };
    }
    return { v: 1, good, last };
  }

  const ttlFor = y => y >= LAST_YEAR - 1 ? TTL_RECENT : TTL_OLD;
  function needsFetch(e, y, now = Date.now()) {
    const l = e && e.last;
    if (!l) return true;
    const age = now - l.at;
    if (age < 0) return true;                                      // clock moved back
    if (l.status === 'ok' || l.status === 'empty') return age > ttlFor(y);
    if (l.status === 'missing' && y >= LAST_YEAR) return age > TTL_RECENT; // the new year's page, checked twice a day
    return age > RETRY_MS;                                         // error, anomaly, past year gone: retry soon, not on every page
  }

  const YEARS = {};                                                // year → cache entry
  const validEntry = e => !!e && e.v === 1 && !!e.last && typeof e.last.at === 'number' &&
    (!e.good || (Array.isArray(e.good.rows) && typeof e.good.at === 'number'));
  const loadCachedYears = () => {
    for (const y of YEARS_ALL) { const e = store.get(`year:${y}`); if (validEntry(e)) YEARS[y] = e; }
  };

  // What the ribbon, the warnings and the diagnostic say about one year.
  function yearView(y) {
    const e = YEARS[y];
    if (!e) return { y, code: 'unknown', label: 'pas encore lue', n: 0, detail: '' };
    const g = e.good, l = e.last, n = g ? g.rows.length : 0;
    let code, label;
    if ((l.status === 'ok' || l.status === 'empty') && g) {
      const stale = Date.now() - g.at > ttlFor(y);
      code = stale ? 'stale' : 'ok'; label = stale ? 'copie ancienne' : 'à jour';
    } else if (l.status === 'missing' && !g) {
      code = 'none'; label = y >= LAST_YEAR ? 'pas encore publiée sur le site' : 'absente du site (404)';
    } else {
      code = 'err';
      label = (l.status === 'anomaly' ? 'anomalie' : l.status === 'missing' ? 'absente du site (404)' : 'erreur') +
        (g ? ` — copie du ${day(g.at)} utilisée` : ' — aucune copie');
    }
    const nums = g ? g.rows.map(a => +a[0]) : [];
    return { y, code, label, n, detail: l.detail, status: l.status, goodAt: g && g.at, lastAt: l.at, enc: g && g.enc,
      max: nums.length ? Math.max(...nums) : 0, noPdf: g ? g.rows.filter(a => !a[3]).length : 0 };
  }
  const isProblem = v => v.code === 'err' || (v.code === 'none' && v.y < LAST_YEAR);

  // ---- Year report: the oddities of the official list ------------------------------------------------------
  // A N° given to two theses, and a line whose author + title repeat another N° (a copy error of the list:
  // the N° is a real thesis, its PDF may be another one — 2018-138, 2021-213 checked on the covers).
  function yearReport(rows) {
    const nums = rows.map(r => +r.num), max = nums.length ? Math.max(...nums) : 0, have = new Set(nums);
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
  const rowKey = r => `${r.year}|${r.num}|${person(r.author)}`;
  function flagsFor(rows) {                                        // rowKey → { shared, twice: [other N°] }
    const flags = new Map(), reports = new Map(), byYear = new Map();
    for (const r of rows) (byYear.get(r.year) || byYear.set(r.year, []).get(r.year)).push(r);
    const flag = r => flags.get(rowKey(r)) || flags.set(rowKey(r), {}).get(rowKey(r));
    for (const [y, rs] of byYear) {
      const rep = yearReport(rs);
      reports.set(y, rep);
      for (const r of rs) if (rep.shared.includes(+r.num)) flag(r).shared = true;
      for (const grp of rep.twice) for (const r of grp) flag(r).twice = grp.filter(o => o !== r).map(o => o.num);
    }
    return { flags, reports };
  }
  const flagText = f => [f && f.shared && 'n° partagé', f && f.twice && `ligne répétée : n° ${f.twice.join(', ')}`].filter(Boolean).join(' ; ');
  const BADGE_TIPS = {
    shared: n => `Le n° ${n} est donné à deux thèses différentes dans la liste officielle (même lien PDF)`,
    twice: 'Même auteur et même titre qu\'un autre n° dans la liste officielle : erreur de copie probable. Ce n° est une thèse à part entière ; son PDF peut être une autre thèse (2018-138, 2021-213 vérifiés).',
  };

  // ---- Specialties (classification of the public repo, optional) ------------------------------------------
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
    return { head, rows: rows.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] || '']))) };
  }

  // "année|n°" → { spe, opt, st, who, conf, sec, parts }, or { byAuthor: { who: entry } } for a N° given to two
  // theses: never give one thesis the other's specialty. Rows without specialty are kept for that reason.
  function buildSpeMap(packed) {
    const map = {}, optOf = {};
    for (const [y, num, who, spe, opt, st, conf, sec, rep] of packed) {
      const parts = (rep || '').split('; ').map(p => p.split('=')).filter(p => p.length === 2).map(([k, v]) => [k, +v]);
      const e = { spe, opt, st: st || 'classée', who, conf: conf ? +conf : null, sec, parts: parts.length ? parts : [[spe, 1]] };
      if (spe) optOf[spe] = opt;
      const k = `${y}|${num}`, old = map[k];
      if (!old) map[k] = e;                                          // usual case: one thesis per N°
      else if (old.byAuthor) old.byAuthor[e.who] = e;
      else if (old.who !== e.who) map[k] = { byAuthor: { [old.who]: old, [e.who]: e } };
    }
    return { map, optOf };
  }

  let SPE = null, OPT_OF = {}, SPE_INFO = { status: 'loading', detail: '' };
  const speOf = r => {
    const e = SPE && SPE[`${r.year}|${r.num}`], x = e && e.byAuthor ? e.byAuthor[person(r.author)] : e;
    return x && x.spe ? x : null;
  };
  function useSpe(c, status, detail = '') {
    const b = buildSpeMap(c.rows);
    SPE = b.map; OPT_OF = b.optOf;
    SPE_INFO = { status, at: c.at, n: c.rows.length, detail };
  }
  async function fetchText(url, ms) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch(url, { cache: 'no-cache', credentials: 'omit', signal: ctl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      throw e && e.name === 'AbortError' ? new Error(`délai dépassé (${ms / 1000} s)`) : e;
    } finally { clearTimeout(timer); }
  }
  async function loadSpe(force, done) {
    const c = store.get('spe'), have = c && c.v === 1 && Array.isArray(c.rows) && c.rows.length;
    const age = have ? Date.now() - c.at : Infinity;
    if (have && !force && age >= 0 && age < SPE_TTL) { useSpe(c, 'ok'); done(); return; }
    if (have) { useSpe(c, 'stale', 'mise à jour en cours…'); done(); }
    try {
      const { head, rows } = parseCSV(await fetchText(SPE_URL, SPE_TIMEOUT_MS));
      if (!head.includes('Spécialité FMPM') || !head.includes('N°') || !head.includes('Auteur')) throw new Error('colonnes attendues absentes');
      if (rows.length < 100 || (have && rows.length < c.rows.length * 0.5)) throw new Error(`${rows.length} lignes seulement`);
      const packed = rows.map(r => [Number(r['Année']), String(Number(r['N°'])), person(r['Auteur']), r['Spécialité FMPM'] || '',
        r['Option FMPM'] || '', r['Statut'] || '', r['Confiance'] || '', r['Spécialité secondaire'] || '', r['Répartition'] || '']);
      const fresh = { v: 1, at: Date.now(), rows: packed };
      store.set('spe', fresh);
      useSpe(fresh, 'ok');
    } catch (e) {
      const msg = e && e.message || String(e);
      if (have) SPE_INFO = { status: 'stale', at: c.at, n: c.rows.length, detail: msg };
      else SPE_INFO = { status: 'error', detail: msg };
    }
    done();
  }

  // ---- Shared look ------------------------------------------------------------------------------------------
  const TOKENS = `
    :host { all: initial; }
    .box { --surface: #fcfcfb; --ink: #0b0b0b; --ink2: #52514e; --muted: #77756e; --grid: #e4e3df; --accent: #2a78d6;
           --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100; --s5: #e87ba4; --s6: #008300; --s7: #6250d6; --s8: #e34948;
           --other: #b4b2ab; --hover: #eef4fc; --accent-hover: #1c5cab; --warn-bg: #fdf1dc; --warn: #8a4b00;
           font: 14px/1.45 system-ui, sans-serif; color: var(--ink); background: var(--surface); }
    @media (prefers-color-scheme: dark) {
      .box { --surface: #1a1a19; --ink: #f0efec; --ink2: #c3c2b7; --muted: #a3a298; --grid: #34332f; --accent: #3987e5;
             --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181; --s6: #008300; --s7: #9085e9; --s8: #e66767;
             --other: #6b6a63; --hover: #23324a; --accent-hover: #86b6ef; --warn-bg: #3a2a10; --warn: #f3c27a; }
    }
    button { font: inherit; padding: 7px 12px; border: 1px solid var(--accent); border-radius: 6px; background: var(--surface); color: var(--accent); cursor: pointer; }
    button:hover { background: var(--hover); }
    button:disabled { opacity: .5; cursor: default; }
    a { color: var(--accent); }
    :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .nav { display: flex; flex-wrap: wrap; gap: 4px; font-size: 12.5px; }
    .nav a { text-decoration: none; padding: 1px 6px; border-radius: 10px; border: 1px solid var(--grid); color: var(--accent); }
    .nav a.on { background: var(--accent); color: var(--surface); border-color: var(--accent); }
    .nav a.home { border-color: var(--accent); font-weight: 600; }
    .nav a.st-stale { border-style: dashed; }
    .nav a.st-none { opacity: .6; border-style: dashed; color: var(--muted); }
    .nav a.st-err { border-color: var(--warn); }
    .nav a.st-err::after { content: ' ⚠'; }`;

  // Year ribbon: 🏠 Accueil + every year from 2006 to this year; state in the tooltip and the outline.
  function ribbon(cur) {
    let s = `<a class="home" href="${esc(HOME)}" title="Page d'accueil des thèses FMPM">🏠 Accueil</a>`;
    for (const y of YEARS_ALL) {
      const v = yearView(y);
      const tip = `${y} : ${v.n ? `${fmt(v.n)} thèses — ` : ''}${v.label}${v.detail && v.code !== 'ok' && v.code !== 'stale' ? ` (${v.detail})` : ''}`;
      s += `<a class="yr st-${v.code}${y === cur ? ' on' : ''}" href="${esc(yearUrl(y))}" title="${esc(tip)}"${y === cur ? ' aria-current="page"' : ''}>${y}</a>`;
    }
    return s;
  }

  function download(name, text) {
    const a = D.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    D.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  // Clipboard API, else the old select + copy; `shown` = a textarea left visible for a manual copy.
  async function copyText(text, shown) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* no permission */ }
    const ta = shown || D.createElement('textarea');
    ta.value = text;
    if (shown) ta.hidden = false; else { ta.style.cssText = 'position:fixed;left:-9999px;top:0'; D.body.append(ta); }
    ta.select();
    let ok = false;
    try { ok = D.execCommand('copy'); } catch { /* unsupported */ }
    if (!shown) ta.remove();
    return ok;
  }

  if (ROUTE === 'pdf') { initDock(); return; }

  // ==== Catalogue pages (Accueil.html, annee-htm/AAAA.htm, …) ===============================================
  // v0-stable / v0.1-diagrams ran first? Take over their place (they stop by themselves if v2 is first).
  let LEGACY_SEEN = false;
  for (const id of ['fmpm-search-host', 'fmpm-diagrams-host']) { const e = D.getElementById(id); if (e) { e.remove(); LEGACY_SEEN = true; } }
  D.querySelectorAll('.fmpm-badges').forEach(e => e.remove());

  // ---- Data state -------------------------------------------------------------------------------------------
  let DATA = { rows: [], at: 0, atMax: 0 }, INDEX = [], FLAGS = new Map(), REPORTS = new Map();
  let PROGRESS = '', LOADING = null, LAST_HITS = [];
  const FILTER = { year: PAGE_YEAR, spe: null, opt: null };             // on a year page the charts open on that year
  let MODE = 'principal';                                          // 'principal' | 'fractionnel'

  loadCachedYears();
  if (PAGE_YEAR) {
    // Year pages pin #masthead and #pagecell1 with position:absolute (table at top:200px, height 4948px, its own
    // scrollbar): put them back in the page flow, so the bar above and the charts below don't cover the table.
    const st = D.createElement('style');
    st.textContent = '#masthead,#pagecell1{position:static!important;width:auto!important;height:auto!important;margin:8px 29px!important;overflow:visible!important}';
    D.head.append(st);
    // This page is the freshest copy of its own year: no request for it.
    const p = parseYear(D, PAGE_YEAR, location.href);
    if (p.rows.length) {
      YEARS[PAGE_YEAR] = merge(YEARS[PAGE_YEAR], { status: 'ok', rows: p.rows, enc: D.characterSet, detail: p.bad ? `${p.bad} ligne(s) sans auteur ou titre` : 'lue sur cette page' });
      store.set(`year:${PAGE_YEAR}`, YEARS[PAGE_YEAR]);
    }
  }

  function rebuild() {
    const rows = [];
    let at = Infinity, atMax = 0;
    for (const y of YEARS_ALL) {
      const g = YEARS[y] && YEARS[y].good;
      if (!g) continue;
      for (const a of g.rows) rows.push(unpack(y, a));
      if (g.rows.length) { at = Math.min(at, g.at); atMax = Math.max(atMax, g.at); }
    }
    DATA = { rows, at: rows.length ? at : 0, atMax };
    INDEX = rows.map(r => ({ r, n: norm(`${r.author} ${r.title} ${r.year}`) }));
    ({ flags: FLAGS, reports: REPORTS } = flagsFor(rows));
  }

  // Newest year first; one page at a time. mode: 'auto' (what is due) | 'all' | 'failed'.
  function refresh(mode) {
    if (LOADING) return LOADING;
    const now = Date.now();
    const todo = YEARS_ALL.slice().reverse().filter(y => mode === 'all' ? true
      : mode === 'failed' ? (!YEARS[y] || isProblem(yearView(y)) || yearView(y).code === 'none') : needsFetch(YEARS[y], y, now));
    if (!todo.length) { render(); return Promise.resolve(); }
    LOADING = (async () => {
      let i = 0;
      for (const y of todo) {
        i++;
        if (mode === 'auto') {                                     // another tab may have just read it
          const other = store.get(`year:${y}`);
          if (validEntry(other) && !needsFetch(other, y)) { YEARS[y] = other; scheduleRender(); continue; }
        }
        PROGRESS = `Lecture ${y}… (${i}/${todo.length})`;
        renderMeta();
        YEARS[y] = merge(YEARS[y], await fetchYear(y));
        store.set(`year:${y}`, YEARS[y]);
        scheduleRender();
        if (i < todo.length) await sleep(PAUSE_MS);
      }
    })().finally(() => { LOADING = null; PROGRESS = ''; render(); });
    return LOADING;
  }

  // ---- UI: bar on top (shadow DOM so the old site CSS cannot touch it) ------------------------------------
  const host = D.createElement('div');
  host.id = 'fmpm-search-host';                                    // same id as v0.x: they exit if they see it
  host.dataset.version = VERSION;
  host.style.cssText = 'position:relative;z-index:2147483646';
  D.body.prepend(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
  <style>${TOKENS}
    .box { border-bottom: 2px solid var(--accent); padding: 12px 16px; box-shadow: 0 2px 8px rgba(0,0,0,.12); }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    input { flex: 1 1 280px; font: inherit; padding: 8px 10px; border: 1px solid #9aa4b2; border-radius: 6px; background: var(--surface); color: var(--ink); }
    .meta { color: var(--ink2); font-size: 12.5px; margin-top: 6px; }
    .nav { margin-top: 6px; }
    .warn { margin-top: 6px; font-size: 12.5px; background: var(--warn-bg); color: var(--warn); border-radius: 6px; padding: 5px 8px; }
    .warn button { padding: 1px 8px; font-size: 12px; margin-left: 6px; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
    .chip { font: inherit; font-size: 12.5px; padding: 2px 8px; border-radius: 12px; border: 1px solid var(--accent); color: var(--accent); cursor: pointer; background: var(--surface); }
    ol { margin: 8px 0 0; padding-left: 0; list-style: none; max-height: 60vh; overflow: auto; }
    li { padding: 6px 0; border-top: 1px solid var(--grid); }
    .t { font-weight: 600; }
    .a { color: var(--ink2); font-size: 13px; }
    .spe { color: var(--ink2); font-size: 12px; border: 1px solid var(--grid); border-radius: 10px; padding: 0 6px; }
    .flag { color: var(--warn); background: var(--warn-bg); font-size: 12px; border-radius: 10px; padding: 0 6px; }
    mark { background: #ffe58a; color: #0b0b0b; padding: 0; }
    details { margin-top: 6px; font-size: 12.5px; color: var(--ink2); }
    summary { cursor: pointer; }
    table { border-collapse: collapse; margin-top: 4px; font-variant-numeric: tabular-nums; }
    td, th { border: 1px solid var(--grid); padding: 2px 8px; text-align: right; }
    td.l, th.l { text-align: left; }
    tr.st-err td { background: var(--warn-bg); }
    .diag-acts { margin-top: 6px; }
    .diag-acts button { padding: 3px 10px; font-size: 12.5px; }
    textarea { width: 100%; min-height: 120px; margin-top: 6px; font: 11.5px ui-monospace, monospace; }
  </style>
  <div class="box" role="region" aria-label="Thèses FMPM : recherche, années, diagnostic">
    <div class="row">
      <strong>🔎 Thèses FMPM — toutes années</strong>
      <input id="q" type="search" aria-label="Rechercher dans les titres et les auteurs" placeholder="Mots du titre ou de l'auteur, ex. lupus marrakech (raccourci : /)" autocomplete="off">
      <button id="reload" title="Relire toutes les pages annuelles sur le site">↻ Relire</button>
      <button id="export" title="Toutes les thèses, format brut (Année, N°, Auteur, Titre, PDF, Article) : pour build_fmpm.py">⬇ CSV brut</button>
      <button id="export2" title="Les résultats affichés, avec spécialité, statut et signalements">⬇ CSV résultats</button>
      <button id="t2" title="Même recherche sur These2.0 (thesefmpm3.vercel.app) : jury, spécialités, statistiques ; mis à jour chaque jour">These2.0 ↗</button>
      <button id="todiag" title="Aller aux diagrammes en bas de page">📊 Diagrammes ↓</button>
      <button id="hide" title="Masquer la barre et les diagrammes sur cette page" aria-label="Masquer">✕</button>
    </div>
    <nav class="nav" id="nav" aria-label="Années des thèses FMPM"></nav>
    <div class="meta" id="meta" role="status" aria-live="polite">Chargement…</div>
    <div class="warn" id="warn" hidden></div>
    <div class="meta" id="yearinfo"></div>
    <div class="chips" id="chips"></div>
    <details id="diag"><summary>Diagnostic : état de chaque année, cache (v${VERSION})</summary><div id="diagbody"></div>
      <div class="row diag-acts">
        <button data-act="failed" title="Relire seulement les années en erreur ou absentes">Relire les années en erreur</button>
        <button data-act="all">Tout relire</button>
        <button data-act="clear" title="Effacer les copies locales (années et spécialités) puis tout relire">Vider le cache</button>
        <button data-act="copy" title="Copier ce diagnostic, à joindre à un signalement">Copier le diagnostic</button>
      </div>
      <textarea id="diagtext" readonly hidden aria-label="Texte du diagnostic"></textarea>
    </details>
    <ol id="res" aria-label="Résultats"></ol>
  </div>`;
  const $ = id => root.getElementById(id);

  function renderMeta() {
    const n = DATA.rows.length;
    const when = !DATA.at ? '' : day(DATA.at) === day(DATA.atMax) ? `lu le ${day(DATA.at)}` : `lu entre le ${day(DATA.at)} et le ${day(DATA.atMax)}`;
    const base = n ? `${fmt(n)} thèses du site officiel (${FIRST_YEAR}–${LAST_YEAR}, ${when}). Recherche sans accents ; tous les mots doivent être présents.`
      : LOADING ? '' : 'Aucune thèse lue pour l’instant : voir le diagnostic.';
    $('meta').textContent = PROGRESS ? `${PROGRESS}${n ? ` — ${fmt(n)} thèses déjà là` : ''}` : base;
  }
  function renderWarn() {
    const bad = YEARS_ALL.map(yearView).filter(isProblem);
    const notes = [];
    if (bad.length) notes.push(`⚠ ${bad.length === 1 ? 'Une année n’a pas pu être lue' : `${bad.length} années n’ont pas pu être lues`} : ` +
      bad.map(v => `<b>${v.y}</b> ${esc(v.detail || v.label)}${v.n ? ` (copie du ${day(v.goodAt)} utilisée, ${fmt(v.n)} thèses)` : ' (aucune copie : absente des résultats)'}`).join(' · ') +
      `<button data-act="failed"${LOADING ? ' disabled' : ''}>Réessayer</button>`);
    if (SPE_INFO.status === 'error') notes.push(`⚠ Spécialités indisponibles (${esc(SPE_INFO.detail)}) : les autres diagrammes marchent.`);
    if (!store.ok) notes.push('⚠ Stockage local plein ou bloqué : rien n’est gardé d’une page à l’autre (tout est relu à chaque visite).');
    if (LEGACY_SEEN) notes.push('Une ancienne version du script (v0-stable ou v0.1-diagrams) est aussi active : désactivez-la dans votre gestionnaire de scripts, elle relit le site en double.');
    $('warn').hidden = !notes.length;
    $('warn').innerHTML = notes.join('<br>');
  }
  function renderDiag() {
    if (!$('diag').open) return;
    const rows = YEARS_ALL.slice().reverse().map(yearView);
    const spe = SPE_INFO.status === 'ok' ? `${fmt(SPE_INFO.n)} lignes, fichier lu le ${stamp(SPE_INFO.at)}`
      : SPE_INFO.status === 'stale' ? `copie du ${stamp(SPE_INFO.at)} (${fmt(SPE_INFO.n)} lignes)${SPE_INFO.detail ? ` — ${esc(SPE_INFO.detail)}` : ''}`
        : SPE_INFO.status === 'error' ? `indisponible — ${esc(SPE_INFO.detail)}` : 'chargement…';
    $('diagbody').innerHTML = `<p>Années suivies : ${FIRST_YEAR}–${LAST_YEAR} (année de l’horloge : ${LAST_YEAR}) · relues toutes les 12 h (${LAST_YEAR - 1}–${LAST_YEAR}) ou 7 jours (avant), erreurs après 15 min · stockage local : ${store.ok ? 'ok' : 'plein ou bloqué'}.</p>` +
      '<table><tr><th>Année</th><th class="l">État</th><th>Thèses</th><th>N° max</th><th>Sans PDF</th><th>Copie du</th><th>Dernier essai</th><th class="l">Détail</th></tr>' +
      rows.map(v => `<tr class="st-${v.code}"><td>${v.y}</td><td class="l">${esc(v.label)}</td><td>${v.n ? fmt(v.n) : '—'}</td><td>${v.max || '—'}</td><td>${v.n ? v.noPdf : '—'}</td>` +
        `<td>${v.goodAt ? stamp(v.goodAt) : '—'}</td><td>${v.lastAt ? stamp(v.lastAt) : '—'}</td><td class="l">${esc(v.detail || '')}${v.enc ? ` <small>(${esc(v.enc)})</small>` : ''}</td></tr>`).join('') +
      `</table><p>Spécialités (${esc(SPE_URL.replace('https://', ''))}) : ${spe}.</p>`;
  }
  function diagText() {
    const lines = [`FMPM thèses — Ultra ${VERSION} · diagnostic du ${new Date().toISOString()}`,
      `Page : ${location.href}`, `Navigateur : ${navigator.userAgent}`,
      `Années ${FIRST_YEAR}–${LAST_YEAR} · stockage local : ${store.ok ? 'ok' : 'plein ou bloqué'} · thèses chargées : ${DATA.rows.length}`];
    for (const v of YEARS_ALL.slice().reverse().map(yearView))
      lines.push(`${v.y}  ${v.label.padEnd(30)}  ${String(v.n).padStart(4)} thèses  n° max ${String(v.max).padStart(4)}  copie ${v.goodAt ? new Date(v.goodAt).toISOString() : '—'}  essai ${v.lastAt ? new Date(v.lastAt).toISOString() : '—'}  ${v.status || ''} ${v.detail || ''}`);
    lines.push(`Spécialités : ${SPE_INFO.status}${SPE_INFO.n ? ` · ${SPE_INFO.n} lignes` : ''}${SPE_INFO.at ? ` · ${new Date(SPE_INFO.at).toISOString()}` : ''}${SPE_INFO.detail ? ` · ${SPE_INFO.detail}` : ''}`);
    if (LEGACY_SEEN) lines.push('Ancienne version v0.x aussi active.');
    return lines.join('\n');
  }

  // ---- Year page: summary above, labels in the official table ---------------------------------------------
  function renderYearInfo() {
    if (!PAGE_YEAR) return;
    const y = REPORTS.get(PAGE_YEAR);
    if (!y || !y.n) { $('yearinfo').textContent = ''; return; }
    $('yearinfo').innerHTML = `<b>${PAGE_YEAR}</b> : ${y.n} thèses en ligne, n° 1 à ${y.max}` +
      (y.missing > 0 ? ` — <span title="Numéros absents de la liste : thèses soutenues pas encore mises en ligne, ou numéros sautés">${y.missing} n° pas (encore) en ligne</span>` : '') +
      (y.shared.length ? ` · n° donné à deux thèses : ${y.shared.join(', ')}` : '') +
      (y.twice.length ? ` · <span title="La liste officielle répète l'auteur et le titre d'un autre n° : erreur de copie probable. Chaque n° est une thèse ; ouvrir le PDF pour savoir laquelle.">même auteur et titre sous deux n°</span> : ${y.twice.map(rs => `${esc(rs[0].author)} (${rs.map(r => r.num).join(', ')})`).join(' ; ')}` : '');
  }
  const tableRows = () => [...D.querySelectorAll('tr')].map(tr => [tr, [...tr.children].filter(c => c.tagName === 'TD' || c.tagName === 'TH')])
    .filter(([, cells]) => cells.length >= 3 && /^\d+$/.test(clean(cells[0].textContent)));
  function annotatePage() {
    if (!PAGE_YEAR) return;
    D.querySelectorAll('.fmpm-u-badges').forEach(e => e.remove());
    const byKey = new Map(DATA.rows.filter(r => r.year === PAGE_YEAR).map(r => [`${r.num}|${person(r.author)}`, r]));
    const tag = (txt, title, bg) => `<span title="${esc(title)}" style="display:inline-block;margin:3px 4px 0 0;padding:0 6px;border-radius:9px;font:11px/1.6 system-ui,sans-serif;background:${bg};color:#111">${esc(txt)}</span>`;
    for (const [, cells] of tableRows()) {
      const r = byKey.get(`${Number(clean(cells[0].textContent))}|${person(cells[1].textContent)}`);
      if (!r) continue;
      const s = speOf(r), f = FLAGS.get(rowKey(r));
      let html = '';
      if (s) html += tag(`${s.spe}${isSure(s) ? '' : ' ?'}`, `Spécialité FMPM (classement achma-learning/theses-maroc) : ${s.st}${s.conf != null ? `, confiance ${Math.round(100 * s.conf)} %` : ''}`, '#dbe8fb');
      if (f && f.shared) html += tag('⚠ n° partagé', BADGE_TIPS.shared(r.num), '#fde7c8');
      if (f && f.twice) html += tag(`⚠ ligne répétée : n° ${f.twice.join(', ')}`, BADGE_TIPS.twice, '#fde7c8');
      if (html) cells[2].insertAdjacentHTML('beforeend', `<div class="fmpm-u-badges">${html}</div>`);
    }
  }
  // 2019.htm#n12 (link of the PDF button) = row n° 12 outlined and scrolled into view.
  function highlightHash() {
    const m = location.hash.match(/^#n(\d+)$/);
    D.querySelectorAll('[data-fmpm-hit]').forEach(tr => { tr.removeAttribute('data-fmpm-hit'); tr.style.outline = ''; });
    if (!PAGE_YEAR || !m) return;
    const hits = tableRows().filter(([, cells]) => Number(clean(cells[0].textContent)) === +m[1]).map(([tr]) => tr);
    hits.forEach(tr => { tr.setAttribute('data-fmpm-hit', ''); tr.style.outline = '3px solid #eda100'; tr.style.outlineOffset = '-1px'; });
    if (hits[0]) hits[0].scrollIntoView({ block: 'center' });
  }

  // ---- Search -------------------------------------------------------------------------------------------------
  // Plain case-insensitive match on the words as typed (accent-free matching is only for filtering).
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
  // Specialty filter: the main one; in fractional mode, also the secondary one.
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
    LAST_HITS = hits;
    $('chips').innerHTML = [
      FILTER.year && `<button class="chip" data-f="year" aria-label="Retirer le filtre année ${FILTER.year}">Année ${FILTER.year} ✕</button>`,
      FILTER.opt && `<button class="chip" data-f="opt">${esc(SHORT[FILTER.opt] || FILTER.opt)} ✕</button>`,
      FILTER.spe && `<button class="chip" data-f="spe">${esc(FILTER.spe)}${MODE === 'fractionnel' ? ' (+ secondaire)' : ''} ✕</button>`,
    ].filter(Boolean).join('');
    const raw = query.split(/\s+/);
    $('res').innerHTML = !active ? '' : `<li><em>${hits.length} résultat(s)${hits.length > MAX_SHOWN ? ` — ${MAX_SHOWN} premiers affichés (tous dans « CSV résultats »)` : ''}</em></li>` +
      hits.slice(0, MAX_SHOWN).map(r => {
        const s = speOf(r), f = FLAGS.get(rowKey(r)), fiche = ficheUrl(r);
        return `<li>
        <div class="t">${highlight(r.title, raw)}</div>
        <div class="a">${r.year} · n° ${esc(r.num)} · ${highlight(r.author, raw)}
          ${s ? ` · <span class="spe" title="${esc(speTip(s))}">${esc(s.spe)}${isSure(s) ? '' : ' ?'}</span>${s.sec ? ` <span class="spe" title="Spécialité secondaire (≥ 1/3 de la masse)">+ ${esc(s.sec)}</span>` : ''}` : ''}
          ${f && f.shared ? ` <span class="flag" title="${esc(BADGE_TIPS.shared(r.num))}">⚠ n° partagé</span>` : ''}
          ${f && f.twice ? ` <span class="flag" title="${esc(BADGE_TIPS.twice)}">⚠ ligne répétée : n° ${esc(f.twice.join(', '))}</span>` : ''}
          ${r.pdf ? ` · <a href="${esc(r.pdf)}" target="_blank" rel="noopener">PDF</a>` : ' · <em>sans PDF</em>'}
          ${r.article ? ` · <a href="${esc(r.article)}" target="_blank" rel="noopener">Résumé</a>` : ''}
          ${fiche ? ` · <a href="${esc(fiche)}" target="_blank" rel="noopener" title="Fiche These2.0 : jury, spécialité, liens">These2.0</a>` : ''}</div>
      </li>`;
      }).join('');
    lastMs = performance.now() - t0;
    renderCharts(base, filtered(base), query);
  }

  function toCSV(header, lines) {
    const q = v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    return '﻿' + [header].concat(lines).map(l => l.map(v => q(String(v))).join(',')).join('\n') + '\n';
  }
  const byYearNum = rows => rows.slice().sort((a, b) => b.year - a.year || a.num - b.num);
  const rawLine = r => [String(r.year), r.num, r.author, r.title, r.pdf, r.article];

  // ---- UI: diagrams in the footer ---------------------------------------------------------------------------
  const foot = D.createElement('div');
  foot.id = 'fmpm-diagrams-host';
  foot.style.cssText = 'position:relative;z-index:2147483645;margin-top:24px';
  D.body.append(foot);
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
    .legend span { display: inline-flex; align-items: center; gap: 5px; }
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
    .bar-slot:focus-visible { outline: 2px solid var(--accent); }
    .axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); margin-top: 4px; font-variant-numeric: tabular-nums; }
  </style>
  <div class="box" id="fbox" role="region" aria-label="Diagrammes des thèses FMPM">
    <h2>📊 Diagrammes des thèses FMPM <a href="${T2_SITE}/stats" target="_blank" rel="noopener" style="font-size:12.5px;font-weight:400">même tableau sur These2.0 ↗</a></h2>
    <div class="sub" id="fsub">Chargement…</div>
    <div class="grid">
      <div class="card wide">
        <div class="hero"><b id="h-total">0</b><span id="h-lbl">thèses au total</span><span class="ms" id="h-ms"></span></div>
        <p class="chart-title" id="h-title">Thèses par année — cliquez une barre pour filtrer l'année</p>
        <div class="bars" id="h-bars" role="list"></div><div class="axis" id="h-axis"></div></div>
      <div class="card wide"><div class="head"><h3>Spécialités FMPM par année (médecine · chirurgie · biologie)</h3>
        <span class="seg" id="mode" role="group" aria-label="Mode de comptage"><button data-mode="principal" class="on" aria-pressed="true" title="Chaque thèse compte 1 pour sa spécialité principale">Principal</button><button data-mode="fractionnel" aria-pressed="false" title="Chaque thèse vaut 1, réparti selon ses parts de masse (barycentre)">Fractionnel</button></span></div>
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
    <div class="tip" id="tip" role="tooltip"></div>
  </div>`;
  const F = id => froot.getElementById(id);

  // ---- Title-derived dimensions (indicative) -------------------------------------------------------------------
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
  const EN = /\b(the|of|and|in|with|among|patients|study|assessment|knowledge|outcomes?)\b/g;
  const isEnglish = t => (t.match(EN) || []).length >= 2;

  // ---- SVG charts ------------------------------------------------------------------------------------------------
  const COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
  const OPT_COLOR = { [OPTIONS[0]]: COLORS[0], [OPTIONS[1]]: COLORS[1], [OPTIONS[2]]: COLORS[2] };
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
  function yearChart(el, ys, allCounts, stacks, onClick, label) {
    const W = Math.max(300, el.clientWidth || 900), H = 200, pad = { t: 16, r: 8, b: 26, l: 40 };
    const max = niceMax(Math.max(1, ...ys.map(y => allCounts ? (allCounts.get(y) || 0) : stacks.reduce((s, st) => s + (st.counts.get(y) || 0), 0))));
    const bw = (W - pad.l - pad.r) / ys.length, w = Math.max(4, bw * 0.68), sy = v => (H - pad.t - pad.b) * v / max;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label || 'Diagramme par année')}">` + axis(W, H, pad, max);
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
      const lab = i % Math.ceil(ys.length * 34 / W) === 0 ? `<text x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${String(y).slice(onClick ? 0 : 2)}</text>` : '';
      s += `<g class="hit" data-year="${y}" data-tip="${esc(tip)}"><rect x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${H - pad.t - pad.b}" fill="transparent"/>${marks}</g>${lab}`;
    });
    el.innerHTML = s + '</svg>';
    if (onClick) el.querySelectorAll('[data-year]').forEach(g => g.addEventListener('click', () => onClick(+g.dataset.year)));
  }

  // Ranked horizontal bars with direct value labels.
  function hbars(el, items, total, color, onClick) {
    if (!items.length) { el.innerHTML = '<p class="note">Aucun indice dans ces titres.</p>'; return; }
    const W = Math.max(300, el.clientWidth || 420), row = 22, lw = 170, H = items.length * row + 4, max = Math.max(...items.map(i => i[1]));
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(items.map(([k, v]) => `${k} ${v}`).join(', '))}">`;
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
        if (isSure(s)) it.sure += w;
      }
      if (MODE === 'principal' && s.sec && s.sec !== s.spe && OPT_OF[s.sec] === opt) item(s.sec).sec++;
    }
    const list = [...items].filter(([, it]) => it.v > 0.004).sort((a, b) => b[1].v - a[1].v);
    const total = list.reduce((a, [, it]) => a + it.v, 0), color = OPT_COLOR[opt];
    const head = `<h4 data-opt="${esc(opt)}" title="Filtrer l'option"><span style="color:${color}">●</span> ${esc(SHORT[opt])} <small>${fmt(total)} thèses</small></h4>`;
    if (!list.length) return `<div>${head}<p class="note">Aucune thèse.</p></div>`;
    const W = 420, row = 20, lw = 168, vw = 62, H = list.length * row + 2;
    const max = Math.max(...list.map(([, it]) => it.v + it.sec)), sx = v => (W - lw - vw) * v / max;
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(`${SHORT[opt]} : ${list.slice(0, 8).map(([k, it]) => `${k} ${fmt(it.v)}`).join(', ')}`)}">`;
    list.forEach(([k, it], i) => {
      const y = i * row + 2;
      let x = lw, marks = '';
      for (const st of ['vérifiée', 'confirmée', 'probable', 'à vérifier']) {
        const w = sx(it.st[st] || 0);
        if (w <= 0) continue;
        marks += `<rect class="mk" x="${x}" y="${y}" width="${Math.max(w - 1, 0.5)}" height="13" fill="${color}" fill-opacity="${STATUS_OP[st]}"/>`;
        x += w;
      }
      if (MODE === 'principal' && (it.sec || it.sure < it.v)) {               // range: confirmed → + secondary
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
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Carte spécialité par année">`;
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
      if (y) { FILTER.year = FILTER.year === y && FILTER.spe === g.dataset.spe ? null : y; FILTER.spe = g.dataset.spe; }
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
        data-tip="${y} · ${fmt(v)} thèse${v > 1 ? 's' : ''}" aria-label="${y} : ${v} thèse(s)"${FILTER.year === y ? ' aria-current="true"' : ''}><div class="bar" style="height:${h}%"></div></div>`;
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
    if (!DATA.rows.length) { F('fsub').textContent = LOADING ? 'Chargement…' : 'Aucune donnée : voir le diagnostic en haut de page.'; return; }
    const ys = years();
    const label = query ? `« ${query} »` : 'toutes les thèses';
    F('fsub').textContent = `${fmt(rows.length)} thèse(s) — ${label}${FILTER.year || FILTER.spe || FILTER.opt ? ' (avec filtres)' : ''} · site officiel ${day(DATA.at) === day(DATA.atMax) ? `lu le ${day(DATA.at)}` : `lu du ${day(DATA.at)} au ${day(DATA.atMax)}`}` +
      (SPE_INFO.status === 'stale' ? ` · spécialités : copie du ${day(SPE_INFO.at)}` : '');
    heroChart(rows, query);

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
      yearChart(F('c-opt'), ys, null, stacks, y => { FILTER.year = FILTER.year === y ? null : y; search(); }, 'Spécialités FMPM par année');
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
      F('c-opt').innerHTML = `<p class="note">${SPE_INFO.status === 'error' ? `Fichier des spécialités indisponible (${esc(SPE_INFO.detail)}) : ` : 'Chargement des spécialités… '}${esc(SPE_URL)}</p>`;
      F('c-spe').innerHTML = F('c-heat').innerHTML = F('c-kpi').innerHTML = '';
    }

    const t = rows.map(r => ` ${norm(r.title)} `);
    hbars(F('c-design'), DESIGNS.map(([k, re]) => [k, t.filter(x => re.test(x)).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]), rows.length, 'var(--s7)');
    hbars(F('c-places'), PLACES.map(([k, re]) => [k, t.filter(x => re.test(x)).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 10), rows.length, 'var(--s3)');

    const en = count(rows.filter(r => isEnglish(norm(r.title))), r => r.year), tot = count(rows, r => r.year);
    const share = new Map(ys.map(y => [y, tot.get(y) ? Math.round(100 * (en.get(y) || 0) / tot.get(y)) : 0]));
    yearChart(F('c-lang'), ys, null, [{ label: '% en anglais', color: 'var(--s4)', counts: share }], null, 'Part des titres en anglais par année');
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

  // ---- Rendering --------------------------------------------------------------------------------------------
  let renderTimer = 0;
  const scheduleRender = () => { clearTimeout(renderTimer); renderTimer = setTimeout(render, 150); };
  function render() {
    clearTimeout(renderTimer);
    rebuild();
    $('nav').innerHTML = ribbon(PAGE_YEAR);
    $('reload').disabled = !!LOADING;
    renderMeta(); renderWarn(); renderDiag(); renderYearInfo(); annotatePage(); search();
  }

  // ---- Events -------------------------------------------------------------------------------------------------
  let timer;
  $('q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 120); });
  $('reload').addEventListener('click', () => { refresh('all'); render(); });
  $('t2').addEventListener('click', () => {
    const q = $('q').value.trim();
    open(`${T2_SITE}/search${q ? `?search=${encodeURIComponent(q)}` : ''}`, '_blank', 'noopener');
  });
  $('hide').addEventListener('click', () => { host.remove(); foot.remove(); D.querySelectorAll('.fmpm-u-badges').forEach(e => e.remove()); });
  $('todiag').addEventListener('click', () => foot.scrollIntoView({ behavior: 'smooth' }));
  $('chips').addEventListener('click', e => { const c = e.target.closest('[data-f]'); if (c) { FILTER[c.dataset.f] = null; search(); } });
  $('export').addEventListener('click', () => {
    if (!DATA.rows.length) { $('meta').textContent = 'Rien à exporter : chargez d\'abord les données.'; return; }
    const d = new Date().toISOString().slice(0, 10), gaps = YEARS_ALL.map(yearView).filter(v => isProblem(v) && !v.n).map(v => v.y);
    download(`fmpm-officiel-brut-${d}.csv`, toCSV(HEADER, byYearNum(DATA.rows).map(rawLine)));
    $('meta').textContent = `Exporté : fmpm-officiel-brut-${d}.csv (${DATA.rows.length} lignes). Étape suivante : build_fmpm.py (voir archive/fmpm/methode/README.md).` +
      (gaps.length ? ` ⚠ Années absentes de l'export (non lues) : ${gaps.join(', ')}.` : '');
  });
  $('export2').addEventListener('click', () => {
    if (!LAST_HITS.length) { $('meta').textContent = 'Aucun résultat à exporter.'; return; }
    const d = new Date().toISOString().slice(0, 10);
    download(`fmpm-resultats-${d}.csv`, toCSV(HEADER_PLUS, byYearNum(LAST_HITS).map(r => {
      const s = speOf(r);
      return rawLine(r).concat([s ? s.spe : '', s ? s.opt : '', s ? s.st : '', s && s.conf != null ? String(s.conf) : '', s ? s.sec : '', flagText(FLAGS.get(rowKey(r))), ficheUrl(r)]);
    })));
    $('meta').textContent = `Exporté : fmpm-resultats-${d}.csv (${LAST_HITS.length} lignes, avec spécialité, statut et signalements).`;
  });
  root.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'failed' || act === 'all') { refresh(act); render(); }
    else if (act === 'clear') {
      if (!confirm('Effacer les copies locales des listes et des spécialités, puis tout relire sur le site ?')) return;
      store.clear();
      for (const y of Object.keys(YEARS)) delete YEARS[y];
      await refresh('all');
      loadSpe(true, render);
    } else if (act === 'copy') {
      const ok = await copyText(diagText(), $('diagtext'));
      b.textContent = ok ? 'Copié ✓' : 'Copiez le texte ci-dessous';
      setTimeout(() => { b.textContent = 'Copier le diagnostic'; }, 2500);
    }
  });
  $('diag').addEventListener('toggle', renderDiag);
  const pin = slot => { const y = +slot.dataset.year; FILTER.year = FILTER.year === y ? null : y; search(); };
  F('h-bars').addEventListener('click', e => { const s = e.target.closest('.bar-slot'); if (s) pin(s); });
  F('h-bars').addEventListener('keydown', e => {
    const s = e.target.closest('.bar-slot');
    if (s && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pin(s); }
  });
  F('totop').addEventListener('click', () => { host.scrollIntoView({ behavior: 'smooth' }); $('q').focus(); });
  F('mode').addEventListener('click', e => {
    const m = e.target.dataset.mode;
    if (!m || m === MODE) return;
    MODE = m;
    F('mode').querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.mode === MODE); b.setAttribute('aria-pressed', String(b.dataset.mode === MODE)); });
    search();
  });
  D.addEventListener('keydown', e => {
    const t = e.composedPath()[0] || {};                           // the real target, even inside a shadow root
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') && !t.isContentEditable) {
      e.preventDefault(); $('q').focus();
    }
  });
  let rz;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => DATA.rows.length && search(), 200); });
  addEventListener('hashchange', highlightHash);
  // v0.x started after v2 cannot add its bar (same id), but one that ran first may still label the table late.
  new MutationObserver(ms => {
    for (const m of ms) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if ((n.classList && n.classList.contains('fmpm-badges')) || (n.id === 'fmpm-diagrams-host' && n !== foot) || (n.id === 'fmpm-search-host' && n !== host)) {
        n.remove();
        if (!LEGACY_SEEN) { LEGACY_SEEN = true; renderWarn(); }
      }
    }
  }).observe(D.body, { childList: true, subtree: true });

  // ---- Start: cached data at once, then what is due, one page at a time ----------------------------------------
  render();
  highlightHash();
  loadSpe(false, () => render());
  refresh('auto');

  // ==== PDF pages (annee-htm/FT/AAAA/theseNN-AA.pdf, art/…): a small dock, bottom left ==========================
  function initDock() {
    // Chromium's viewer: a document of type application/pdf holding an <embed>. Anything else here is an
    // HTML page in place of the PDF: the server's « 404 Not Found » when the file is missing.
    const viewer = D.contentType === 'application/pdf' || !!D.querySelector('embed[type="application/pdf"]');
    const notFound = !viewer && /\b404\b|not found|introuvable/i.test(`${D.title} ${(D.body.textContent || '').slice(0, 600)}`);
    const year = PDF_M ? +PDF_M[2] : null;
    const isArt = !!PDF_M && /^art$/i.test(PDF_M[1]);
    let file = PDF_M ? PDF_M[3] : '';
    try { file = decodeURIComponent(file); } catch { /* keep as is */ }
    const fileNum = Number((file.match(/^(?:these|article)[\s_-]*0*(\d+)/i) || [])[1]) || null;
    const here = pathKey(location.href);
    const listUrl = year ? `${yearUrl(year)}${fileNum ? `#n${fileNum}` : ''}` : HOME;
    let open = !viewer || store.get('dock') === 'open', filled = false;

    const dock = D.createElement('div');
    dock.id = 'fmpm-ultra-dock';
    dock.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647';
    D.body.append(dock);
    const sr = dock.attachShadow({ mode: 'open' });
    sr.innerHTML = `
    <style>${TOKENS}
      .box { background: transparent; font-size: 13px; }
      .pill { display: inline-flex; align-items: center; gap: 2px; background: var(--surface); border: 1px solid var(--accent); border-radius: 18px;
              padding: 2px; box-shadow: 0 2px 10px rgba(0,0,0,.25); opacity: .88; }
      .pill:hover, .pill:focus-within, .box.open .pill { opacity: 1; }
      .pill a, .pill button { padding: 4px 10px; border: 0; border-radius: 14px; text-decoration: none; color: var(--accent); background: transparent; font: inherit; cursor: pointer; }
      .pill a:hover, .pill button:hover { background: var(--hover); }
      .panel { position: absolute; left: 0; bottom: calc(100% + 6px); width: min(560px, calc(100vw - 24px)); max-height: 70vh; overflow: auto;
               box-sizing: border-box; background: var(--surface); color: var(--ink); border: 1px solid var(--grid); border-radius: 10px;
               padding: 10px 12px; box-shadow: 0 4px 18px rgba(0,0,0,.28); }
      .msg { background: var(--warn-bg); color: var(--warn); border-radius: 6px; padding: 5px 8px; margin-bottom: 8px; }
      .msg:empty { display: none; }
      .info { margin-bottom: 8px; }
      .info .t { font-weight: 600; }
      .info .a, .small { color: var(--ink2); font-size: 12.5px; }
      .tag { display: inline-block; margin: 3px 4px 0 0; padding: 0 6px; border-radius: 9px; font-size: 11.5px; background: var(--hover); color: var(--ink); }
      .tag.w { background: var(--warn-bg); color: var(--warn); }
      .acts { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
      .acts a, .acts button { font-size: 12.5px; padding: 3px 9px; border: 1px solid var(--accent); border-radius: 6px; text-decoration: none; }
      .acts .off { opacity: .45; pointer-events: none; border-style: dashed; }
      .nav { font-size: 12px; }
    </style>
    <div class="box" id="box">
      <div class="panel" id="panel" role="region" aria-label="Navigation des thèses FMPM" hidden>
        <div class="msg" id="msg" role="alert"></div>
        <div class="info" id="info"></div>
        <div class="acts" id="acts"></div>
        <nav class="nav" id="nav" aria-label="Années des thèses FMPM"></nav>
      </div>
      <div class="pill">
        <a href="${esc(HOME)}" title="Accueil des thèses FMPM" aria-label="Accueil des thèses FMPM">🏠</a>
        ${year ? `<a href="${esc(listUrl)}" title="Liste officielle ${year}${fileNum ? `, ligne n° ${fileNum} surlignée` : ''}">← Liste ${year}</a>` : ''}
        <button id="tog" aria-controls="panel" aria-expanded="false" title="Thèse précédente / suivante, fiche, années">▴</button>
      </div>
    </div>`;
    const R = id => sr.getElementById(id);

    function paint() {
      R('panel').hidden = !open;
      R('box').classList.toggle('open', open);
      R('tog').setAttribute('aria-expanded', String(open));
      R('tog').textContent = open ? '▾' : '▴';
      R('tog').title = open ? 'Replier' : 'Thèse précédente / suivante, fiche, années';
      if (open && !filled) {
        filled = true;
        fill().catch(e => { R('info').textContent = `Erreur du script : ${e && e.message || e}`; });
      }
    }
    R('tog').addEventListener('click', () => {
      open = !open;
      if (viewer) store.set('dock', open ? 'open' : 'closed');     // remembered on PDFs only, not on a 404 page
      paint();
    });
    sr.addEventListener('keydown', e => { if (e.key === 'Escape' && open) { open = false; paint(); R('tog').focus(); } });

    async function fill() {
      loadCachedYears();
      R('nav').innerHTML = ribbon(year);
      if (notFound) R('msg').textContent = `⚠ Ce fichier n’existe pas sur le serveur de la faculté (erreur 404)${year ? ' : la liste officielle a peut-être un lien erroné.' : '.'}`;
      else if (!viewer) R('msg').textContent = 'Cette adresse n’a pas renvoyé de PDF.';
      if (!year) { R('info').textContent = ''; R('acts').innerHTML = ''; return; }
      R('info').textContent = `Lecture de la liste ${year}…`;
      let e = YEARS[year];
      if (needsFetch(e, year)) {                                   // one request, only when the dock is opened
        e = merge(e, await fetchYear(year));
        store.set(`year:${year}`, e);
        YEARS[year] = e;
        R('nav').innerHTML = ribbon(year);
      }
      const rows = e && e.good ? e.good.rows.map(a => unpack(year, a)) : [];
      if (!rows.length) {
        const v = yearView(year);
        R('info').textContent = `Liste ${year} indisponible : ${v.label}${v.detail ? ` (${v.detail})` : ''}.`;
        R('acts').innerHTML = '';
        return;
      }
      const sc = store.get('spe');                                  // specialties: local copy only, no download here
      if (sc && sc.v === 1 && Array.isArray(sc.rows)) { const b = buildSpeMap(sc.rows); SPE = b.map; }
      const link = r => isArt ? r.article : r.pdf;
      const mine = rows.filter(r => link(r) && pathKey(link(r)) === here);
      const cur = mine.length ? mine : fileNum ? rows.filter(r => +r.num === fileNum) : [];
      const { flags } = flagsFor(rows);
      const seq = [], seen = new Set();                            // reading order: N° ascending, one stop per file
      for (const r of rows.slice().sort((a, b) => a.num - b.num)) {
        const l = link(r);
        if (!l || seen.has(pathKey(l))) continue;
        seen.add(pathKey(l)); seq.push(r);
      }
      const i = seq.findIndex(r => pathKey(link(r)) === here);
      const prev = i >= 0 ? seq[i - 1] : fileNum ? seq.filter(r => +r.num < fileNum).pop() : null;
      const next = i >= 0 ? seq[i + 1] : fileNum ? seq.find(r => +r.num > fileNum) : null;

      R('info').innerHTML = !cur.length
        ? `<span class="small">Ce fichier n’est pas dans la liste officielle ${year} (copie du ${day(e.good.at)}).</span>`
        : (cur.length > 1 ? `<div class="small">Ce ${isArt ? 'fichier' : 'PDF'} est lié à ${cur.length} lignes de la liste officielle :</div>` : '') +
          cur.map(r => {
            const s = speOf(r), f = flags.get(rowKey(r));
            return `<div><div class="t">${esc(r.title)}</div><div class="a">${year} · n° ${esc(r.num)} · ${esc(r.author)}${mine.length ? '' : ' <em>(d’après le n° du fichier)</em>'}</div>` +
              (s ? `<span class="tag" title="${esc(`Spécialité FMPM (classement achma-learning/theses-maroc) : ${s.st}`)}">${esc(s.spe)}${isSure(s) ? '' : ' ?'}</span>` : '') +
              (f && f.shared ? `<span class="tag w" title="${esc(BADGE_TIPS.shared(r.num))}">⚠ n° partagé</span>` : '') +
              (f && f.twice ? `<span class="tag w" title="${esc(BADGE_TIPS.twice)}">⚠ ligne répétée : n° ${esc(f.twice.join(', '))}</span>` : '') + '</div>';
          }).join('');
      const step = (r, txt) => r ? `<a href="${esc(link(r))}" title="${esc(`n° ${r.num} · ${r.author} — ${r.title}`)}">${txt.replace('#', esc(r.num))}</a>`
        : `<a class="off" aria-disabled="true">${txt.replace('n° #', 'aucune')}</a>`;
      const c0 = cur[0], fiche = c0 && ficheUrl(c0), other = c0 && (isArt ? c0.pdf : c0.article);
      R('acts').innerHTML = step(prev, '‹ n° #') + step(next, 'n° # ›') +
        (fiche ? `<a href="${esc(fiche)}" target="_blank" rel="noopener" title="Fiche These2.0 : jury, spécialité">Fiche These2.0 ↗</a>` : '') +
        (other ? `<a href="${esc(other)}">${isArt ? 'Texte intégral' : 'Résumé (article)'}</a>` : '') +
        (c0 ? '<button id="cite" title="Auteur. Titre. Thèse n°, FMPM, année. Lien">📋 Copier la référence</button>' : '');
      if (c0) R('cite').addEventListener('click', async () => {
        const ok = await copyText(`${c0.author}. ${c0.title}. Thèse n° ${c0.num}, Faculté de Médecine et de Pharmacie de Marrakech, ${year}. ${c0.pdf || location.href}`);
        R('cite').textContent = ok ? 'Copié ✓' : 'Copie impossible';
      });
    }
    paint();
  }
})();
