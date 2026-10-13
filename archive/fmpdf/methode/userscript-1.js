// ==UserScript==
// @name         FMP Fès — Export des thèses (CDIM)
// @namespace    https://github.com/achma-learning
// @version      1.0.0
// @description  Exporte toutes les thèses du CDIM (FMP Fès) en CSV : année, n° d'ordre, auteur, titre, rapporteur, spécialité, résumé, lien PDF — avec contrôle de complétude.
// @author       achma-learning
// @match        https://cdim.fmp-usmba.ac.ma/theses/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const API = new URL('data.php?action=search_theses', location.href).href;
  const BIG = 10000;   // on tente tout en une requête
  const PAGE = 500;    // repli si le serveur plafonne
  const PAUSE = 250;   // ms entre requêtes (politesse)

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const parser = new DOMParser();
  const clean = (s) =>
    s == null ? '' :
    (parser.parseFromString(String(s), 'text/html').body.textContent || '')
      .replace(/\s+/g, ' ').trim();

  // ---------- UI ----------
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:99999;width:340px;max-height:60vh;' +
    'background:#fff;border:2px solid #1a7d7f;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.25);' +
    'font:13px/1.4 Segoe UI,sans-serif;color:#0a1718;display:flex;flex-direction:column;overflow:hidden';
  box.innerHTML = `
    <div style="background:linear-gradient(90deg,#1a7d7f,#982c5a);color:#fff;padding:8px 12px;font-weight:600">
      Export des thèses — FMP Fès
    </div>
    <div style="padding:10px 12px;display:flex;flex-direction:column;gap:6px">
      <label style="margin:0;font-weight:400"><input type="checkbox" id="fx-spec" checked> Étiqueter les spécialités (plus lent)</label>
      <button id="fx-go" style="border-radius:8px">Exporter toutes les thèses</button>
    </div>
    <pre id="fx-log" style="margin:0;padding:8px 12px;background:#f4f8f8;flex:1;overflow:auto;white-space:pre-wrap;font-size:12px"></pre>`;
  document.body.appendChild(box);
  const logEl = box.querySelector('#fx-log');
  const log = (m) => { logEl.textContent += m + '\n'; logEl.scrollTop = logEl.scrollHeight; };

  // ---------- Paramètres DataTables (copiés depuis la page) ----------
  function baseParams() {
    try {
      const p = window.jQuery && jQuery('#example').DataTable().ajax.params();
      if (p && p.columns) return JSON.parse(JSON.stringify(p));
    } catch (e) { /* repli ci-dessous */ }
    const names = ['titre', 'auteur', 'rapporteur', null, 'telechargement', null];
    return {
      draw: 1,
      columns: names.map((d, i) => ({
        data: d === null ? null : d, name: '',
        searchable: !!d && d !== 'telechargement', orderable: !!d && d !== 'telechargement',
        search: { value: '', regex: false },
      })),
      order: [{ column: 0, dir: 'asc' }],
      start: 0, length: 10, search: { value: '', regex: false },
    };
  }

  // Même encodage que la page : multipart, objets en JSON
  async function post(params, filters) {
    const fd = new FormData();
    for (const k in params) {
      const v = params[k];
      fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v);
    }
    for (const k in filters) fd.append(k, filters[k]);
    for (let i = 1; i <= 3; i++) {
      try {
        const r = await fetch(API, { method: 'POST', body: fd, credentials: 'same-origin' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.json();
      } catch (e) {
        log(`   essai ${i} échoué : ${e.message}`);
        await sleep(1500 * i);
      }
    }
    throw new Error('requête impossible');
  }

  function parseDl(html) {
    const doc = parser.parseFromString(html || '', 'text/html');
    const a = doc.querySelector('a');
    const href = a ? a.getAttribute('href') || '' : '';
    const url = href ? new URL(href, location.href).href : '';
    const code = clean(html);
    const m = code.match(/(\d+)\s*-\s*(\d{2,4})/) || href.match(/(\d+)-(\d{2,4})\.\w+$/);
    let num = '', yr = '';
    if (m) {
      num = parseInt(m[1], 10);
      const y = m[2];
      yr = y.length === 4 ? y : (+y > 50 ? '19' + y : '20' + y);
    }
    const ext = (href.match(/\.(\w+)$/) || [])[1] || '';
    return { url, code, num, yr, ext: ext.toLowerCase() };
  }

  const key = (r) => parseDl(r.telechargement).url || clean(r.auteur) + '|' + clean(r.titre);

  async function fetchAll(f) {
    const p = baseParams();
    p.search = { value: '', regex: false };
    p.draw = 1; p.start = 0; p.length = BIG;
    const filters = { annee: '', specialite: '', rapporteur: '', rechercheRapide: '', ...f };
    const j = await post(p, filters);
    const total = +j.recordsFiltered;
    let rows = j.data || [];
    if (rows.length < total) {
      // Le serveur plafonne : pagination + déduplication
      const step = rows.length || PAGE;
      const m = new Map(rows.map((r) => [key(r), r]));
      for (let s = step; s < total; s += step) {
        p.start = s; p.length = step; p.draw++;
        const jj = await post(p, filters);
        (jj.data || []).forEach((r) => m.set(key(r), r));
        await sleep(PAUSE);
      }
      rows = [...m.values()];
    }
    await sleep(PAUSE);
    return { rows, total };
  }

  async function getJSON(action) {
    try {
      const r = await fetch(new URL('data.php?action=' + action, location.href), { credentials: 'same-origin' });
      return await r.json();
    } catch (e) { return []; }
  }

  // ---------- CSV ----------
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  function download(name, header, rows) {
    const csv = '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  function splitCivilite(raw) {
    const s = clean(raw);
    const m = s.match(/^(M(?:lle|elle|me|r)?)\s*\.\s*/i) || s.match(/^(Mlle|Melle|Mme)\s+/i);
    return m ? { civ: m[1], nom: s.slice(m[0].length).trim() } : { civ: '', nom: s };
  }

  // ---------- Exécution ----------
  async function run() {
    const btn = box.querySelector('#fx-go');
    btn.disabled = true; logEl.textContent = '';
    try {
      log('1/3  Passe globale…');
      const all = await fetchAll({});
      log(`     serveur : ${all.total} — récupéré : ${all.rows.length}`);

      const db = new Map();
      all.rows.forEach((r) => db.set(key(r), { r, anneeFiltre: '', spec: '' }));

      log('2/3  Passe par année…');
      let annees = await getJSON('get_annees');
      if (!Array.isArray(annees) || !annees.length) {
        annees = []; for (let y = 2000; y <= new Date().getFullYear(); y++) annees.push(y);
      }
      const ctrl = [];
      for (const a of annees) {
        const res = await fetchAll({ annee: a });
        res.rows.forEach((r) => {
          const k = key(r);
          if (!db.has(k)) db.set(k, { r, anneeFiltre: '', spec: '' });
          db.get(k).anneeFiltre = String(a);
        });
        const ok = res.rows.length === res.total ? 'OK' : 'ÉCART';
        ctrl.push([a, res.total, res.rows.length, ok]);
        if (res.total) log(`     ${a} : ${res.rows.length} [${ok}]`);
      }

      if (box.querySelector('#fx-spec').checked) {
        log('3/3  Passe par spécialité…');
        const specs = await getJSON('get_specialites');
        for (const s of specs || []) {
          const res = await fetchAll({ specialite: s.num_specialite });
          res.rows.forEach((r) => { const e = db.get(key(r)); if (e) e.spec = clean(s.nom_specialite); });
          log(`     ${clean(s.nom_specialite)} : ${res.rows.length}`);
        }
      } else log('3/3  Spécialités ignorées.');

      // Construction des lignes
      const recs = [...db.values()].map(({ r, anneeFiltre, spec }) => {
        const d = parseDl(r.telechargement);
        const { civ, nom } = splitCivilite(r.auteur);
        const annee = anneeFiltre || d.yr;
        let controle = 'OK';
        if (!annee) controle = 'sans année';
        else if (anneeFiltre && d.yr && anneeFiltre !== d.yr) controle = `année filtre ${anneeFiltre} ≠ code ${d.yr}`;
        else if (!anneeFiltre) controle = 'année déduite du code';
        if (!d.url) controle += ' ; pas de lien';
        return {
          annee, num: d.num, code: d.code, civ, nom,
          titre: clean(r.titre), rapporteur: clean(r.rapporteur), spec,
          url: d.url, ext: d.ext, controle, resume: clean(r.resume),
        };
      });
      recs.sort((a, b) => (+b.annee || 0) - (+a.annee || 0) || (+a.num || 1e9) - (+b.num || 1e9) || a.nom.localeCompare(b.nom));

      download('theses-fmpf.csv',
        ['Année', 'N°', 'Auteur', 'Titre', 'PDF (texte intégral)', 'Article (résumé, 2006-2014)'],
        recs.map((t) => [t.annee, t.num, t.nom, t.titre, t.url, '']));
      await sleep(600);
      download('theses-fmpf-complet.csv',
        ['Année', 'N°', 'Code', 'Civilité', 'Auteur', 'Titre', 'Rapporteur', 'Spécialité', 'Lien', 'Format', 'Contrôle', 'Résumé'],
        recs.map((t) => [t.annee, t.num, t.code, t.civ, t.nom, t.titre, t.rapporteur, t.spec, t.url, t.ext, t.controle, t.resume]));
      await sleep(600);
      download('controle-par-annee.csv', ['Année', 'Annoncé', 'Récupéré', 'Statut'], ctrl);

      const pb = recs.filter((t) => t.controle !== 'OK').length;
      log(`\nTERMINÉ : ${recs.length} thèses uniques (serveur : ${all.total}).`);
      log(`Lignes à vérifier (colonne Contrôle) : ${pb}`);
      log('3 fichiers CSV téléchargés.');
    } catch (e) {
      log('ERREUR : ' + e.message);
    } finally {
      btn.disabled = false;
    }
  }

  box.querySelector('#fx-go').addEventListener('click', run);
})();