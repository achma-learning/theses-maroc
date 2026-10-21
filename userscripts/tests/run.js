#!/usr/bin/env node
// Tests of the FMPM userscripts (v2-ultra, v0.1-diagrams, v0-stable) in Chromium, through Playwright.
//
//   node userscripts/tests/run.js              offline: the faculty's pages come from fixtures/ (saved 2026-10-18),
//                                              the clock is simulated (2026, then 2027). Run on every push.
//   node userscripts/tests/run.js --live       + the real site and the real specialties file (weekly in CI).
//   … --grep=PDF                               only the tests whose name matches (some share a page: keep their order).
//   xvfb-run -a node userscripts/tests/run.js --pdf-live
//                                              + a real thesis PDF in Chromium's PDF viewer, v2 loaded as an
//                                                extension content script (needs a display, hence xvfb).
// Exit code 1 if a test fails. Screenshots of the live runs go to userscripts/tests/out/ (not committed).
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');

function loadPlaywright() {
  try { return require('playwright'); } catch { /* not local */ }
  const g = require('child_process').execSync('npm root -g').toString().trim();
  return require(path.join(g, 'playwright'));
}
const { chromium } = loadPlaywright();

const DIR = __dirname, US = path.join(DIR, '..'), OUT = path.join(DIR, 'out');
const FIX = f => fs.readFileSync(path.join(DIR, 'fixtures', f));
const SRC = { v2: 'v2-ultra.js', v01: 'v0.1-diagrams.js', v0: 'v0-stable.js' };
const CODE = Object.fromEntries(Object.entries(SRC).map(([k, f]) => [k, fs.readFileSync(path.join(US, f), 'utf8')]));
const SITE = 'https://wd.fmpm.uca.ma/biblio/theses/';
const ARGS = new Set(process.argv.slice(2));
const T2026 = Date.UTC(2026, 9, 18, 10, 0, 0), T2027 = Date.UTC(2027, 0, 15, 10, 0, 0);
const HEADER = 'Année,N°,Auteur,Titre,PDF (texte intégral),"Article (résumé, 2006-2014)"';  // as v0's export (build_fmpm.py)

// ---- Tiny test harness -----------------------------------------------------------------------------------------
const results = [];
const GREP = (process.argv.find(a => a.startsWith('--grep=')) || '').slice(7);  // --grep=regex: run matching tests only
async function test(name, fn) {
  if (GREP && !new RegExp(GREP, 'i').test(name)) return;
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true }); console.log(`✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`); }
  catch (e) { results.push({ name, ok: false, e }); console.log(`✗ ${name}\n    ${String(e && e.stack || e).split('\n').slice(0, 3).join('\n    ')}`); }
}
function assert(c, msg) { if (!c) throw new Error(msg); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} : attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`); }

// ---- The fake site -----------------------------------------------------------------------------------------------
const FIXTURE_YEARS = { 2007: '2007.htm', 2014: '2014.htm', 2019: '2019.htm', 2026: '2026.htm' };
const COUNTS = { 2007: 87, 2014: 91, 2019: 273, 2026: 117 };    // independent count (python + BeautifulSoup)
const SYNTH_ROWS = 3;
// Years without a saved page: a small page of the same shape (3 theses).
function synth(y, n = SYNTH_ROWS) {
  const yy = String(y).slice(2);
  const rows = Array.from({ length: n }, (_, i) => `<tr><td>${i + 1}</td><td>AUTEUR${y} NUMERO${i + 1}</td>` +
    `<td>Titre synthétique ${y} n° ${i + 1} : expérience du service</td><td><a href="./FT/${y}/these${String(i + 1).padStart(2, '0')}-${yy}.pdf">TEXTE INTEGRAL</a></td></tr>`).join('');
  return `<html><head><meta charset="utf-8"><title>Thèses ${y}</title></head><body><table><tr><th>N°</th><th>Auteur</th><th>Titre</th><th>Texte</th></tr>${rows}</table></body></html>`;
}
const VIEWER = '<!doctype html><html><body style="margin:0;height:100vh"><embed type="application/pdf" src="about:blank" style="width:100%;height:100%"></body></html>';
const NOT_FOUND = '<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN"><html><head><title>404 Not Found</title></head><body><h1>Not Found</h1><p>The requested URL was not found on this server.</p></body></html>';
const total = (lastYear, skip = []) => {
  let n = 0;
  for (let y = 2006; y <= Math.min(lastYear, 2026); y++) if (!skip.includes(y)) n += COUNTS[y] || SYNTH_ROWS;
  return n;
};

// Simulated clock that keeps ticking, continuous across the pages of a context (offset fixed when it is created).
function fakeDate(offset) {
  const Real = Date;
  class FakeDate extends Real {
    constructor(...a) { if (a.length) super(...a); else super(Real.now() + offset); }
    static now() { return Real.now() + offset; }
  }
  globalThis.Date = FakeDate;
}

// ctx.fake = { years: { 2019: 'abort' | 500 | '<html…>' | Buffer }, missingPdf: Set, spe: 'abort' | 500 | text, log: [] }
async function fakeContext(browser, now, lastPublished = 2026) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, acceptDownloads: true, locale: 'fr-FR' });
  ctx.fake = { years: {}, missingPdf: new Set(), spe: null, log: [], errors: [] };
  await ctx.addInitScript(fakeDate, now - Date.now());
  await ctx.route('https://wd.fmpm.uca.ma/**', route => {
    const url = new URL(route.request().url()), p = url.pathname, f = ctx.fake;
    f.log.push(p);
    const html = (body, status = 200, type = 'text/html') => route.fulfill({ status, body, headers: { 'content-type': type } });
    if (p === '/biblio/theses/Accueil.html') return html(FIX('Accueil.html'));
    if (p.endsWith('/emx_nav_left.css')) return html(FIX('emx_nav_left.css'), 200, 'text/css');
    let m = p.match(/\/annee-htm\/(\d{4})\.htm$/);
    if (m) {
      const y = +m[1], o = f.years[y];
      if (o === 'abort') return route.abort('failed');
      if (typeof o === 'number') return html(`<h1>Erreur ${o}</h1>`, o);
      if (typeof o === 'string' || Buffer.isBuffer(o)) return html(o);
      if (y > lastPublished || y < 2006) return html(NOT_FOUND, 404, 'text/html; charset=iso-8859-1');
      return html(FIXTURE_YEARS[y] ? FIX(FIXTURE_YEARS[y]) : synth(y));
    }
    m = p.match(/\/annee-htm\/(FT|art)\/\d{4}\/([^/]+\.pdf)$/i);
    if (m) return f.missingPdf.has(m[2]) ? html(NOT_FOUND, 404, 'text/html; charset=iso-8859-1') : html(VIEWER);
    return html(NOT_FOUND, 404, 'text/html; charset=iso-8859-1');
  });
  await ctx.route('https://raw.githubusercontent.com/**', route => {
    const f = ctx.fake;
    f.log.push('SPE');
    if (f.spe === 'abort') return route.abort('failed');
    if (typeof f.spe === 'number') return route.fulfill({ status: f.spe, body: 'nope' });
    return route.fulfill({ status: 200, body: typeof f.spe === 'string' ? f.spe : FIX('specialites-extrait.csv'),
      headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' } });
  });
  return ctx;
}

async function openWith(ctx, url, ...scripts) {
  const page = await ctx.newPage();
  page.on('pageerror', e => ctx.fake ? ctx.fake.errors.push(e.message) : console.log('PAGEERROR', e.message));
  page.on('dialog', d => d.accept());
  await page.goto(url, { waitUntil: 'load' });
  for (const s of scripts) await page.addScriptTag({ content: CODE[s] });
  return page;
}
const yearsLog = ctx => ctx.fake.log.filter(p => /\/annee-htm\/\d{4}\.htm$/.test(p));

// Inside v2's shadow roots.
const bar = (page, fn, arg) => page.evaluate(([f, a]) => {
  const r = document.getElementById('fmpm-search-host').shadowRoot;
  return new Function('r', 'a', `return (${f})(r, a)`)(r, a);
}, [fn.toString(), arg]);
async function waitIdle(page, timeout = 60000) {
  await page.waitForFunction(() => {
    const r = document.getElementById('fmpm-search-host')?.shadowRoot;
    return r && !r.getElementById('reload').disabled && /thèses du site officiel|Aucune thèse/.test(r.getElementById('meta').textContent);
  }, null, { timeout, polling: 200 });
  await page.waitForTimeout(250);                                 // the debounced render
}
const metaCount = async page => Number(((await bar(page, r => r.getElementById('meta').textContent)).match(/^([\d\s  ]+) thèses/) || [])[1]?.replace(/\D/g, '') || NaN);
const navInfo = page => bar(page, r => [...r.querySelectorAll('#nav a')].map(a => ({ t: a.textContent, c: a.className, title: a.title, cur: a.getAttribute('aria-current') })));
async function downloadText(page, click) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  return { name: dl.suggestedFilename(), text: fs.readFileSync(await dl.path(), 'utf8') };
}
function csvLines(text) {                                         // enough for these files: count records, not fields
  let n = 0, q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i]; if (c === '"') q = !q; else if (c === '\n' && !q) n++; }
  return n;
}

// ---- Offline tests -------------------------------------------------------------------------------------------------
async function offline(browser) {
  const fixtureNums = [...new Set([...FIX('2026.htm').toString().matchAll(/href="\.\/FT\/2026\/these(\d+)-26\.pdf"/g)].map(m => +m[1]))].sort((a, b) => a - b);

  await test('métadonnées : @version = VERSION, @match, aucune URL de mise à jour inventée', async () => {
    const head = CODE.v2.split('==/UserScript==')[0];
    const ver = head.match(/@version\s+(\S+)/)[1];
    eq(ver, CODE.v2.match(/const VERSION = '([^']+)'/)[1], 'VERSION');
    assert(/@match\s+https:\/\/wd\.fmpm\.uca\.ma\/biblio\/theses\/\*/.test(head), '@match https');
    assert(/@grant\s+none/.test(head) && /@noframes/.test(head), '@grant none + @noframes');
    assert(!/@(updateURL|downloadURL|exclude)/.test(head), 'pas de @updateURL / @downloadURL / @exclude (les PDF sont voulus)');
    for (const k of ['v01', 'v0']) {
      const h = CODE[k].split('==/UserScript==')[0];
      assert(/@exclude\s+https:\/\/wd\.fmpm\.uca\.ma\/biblio\/theses\/annee-htm\/FT\/\*/.test(h), `${SRC[k]} laisse les PDF tranquilles`);
      assert(/@exclude\s+https:\/\/wd\.fmpm\.uca\.ma\/biblio\/theses\/annee-htm\/art\/\*/.test(h), `${SRC[k]} laisse les PDF de résumé (art/) tranquilles`);
    }
    const copy = path.join(US, '..', 'archive', 'fmpm', 'methode', 'fmpm-recherche.user.js');
    if (fs.existsSync(copy)) eq(fs.readFileSync(copy, 'utf8'), CODE.v0, 'archive/fmpm/methode/fmpm-recherche.user.js = v0-stable.js');
  });

  // One context = one browser profile (localStorage kept between pages), clock on 2026-10-18.
  const ctx = await fakeContext(browser, T2026);
  let page;
  await test('2026 : ruban 🏠 Accueil + 2006→2026, toutes les années lues, décodage UTF-8 et windows-1252', async () => {
    page = await openWith(ctx, `${SITE}Accueil.html`, 'v2');
    await waitIdle(page);
    const nav = await navInfo(page);
    eq(nav.map(a => a.t), ['🏠 Accueil', ...Array.from({ length: 21 }, (_, i) => String(2006 + i))], 'ruban');
    assert(nav.slice(1).every(a => /st-ok/.test(a.c)), `toutes à jour : ${nav.filter(a => !/st-ok|home/.test(a.c)).map(a => a.t)}`);
    eq(await metaCount(page), total(2026), 'thèses lues');
    eq(await bar(page, r => r.getElementById('warn').hidden), true, 'aucun avertissement');
    eq(yearsLog(ctx).length, 21, 'une requête par année');
    eq(ctx.fake.log.filter(p => p === 'SPE').length, 1, 'fichier des spécialités lu une fois');
    const { name, text } = await downloadText(page, () => bar(page, r => r.getElementById('export').click()));
    assert(/^fmpm-officiel-brut-2026-10-18\.csv$/.test(name), `nom du fichier : ${name}`);
    assert(text.startsWith('\uFEFF' + HEADER + '\n'), `BOM + en-tête v0 inchangé : ${JSON.stringify(text.slice(0, 90))}`);
    eq(csvLines(text) - 1, total(2026), 'lignes du CSV brut');
    assert(!text.includes('�'), 'aucun caractère de remplacement (décodage)');
    assert(/Hôpital|hôpital|thérapeutique|Évaluation|évaluation/.test(text), 'accents présents');
    assert(text.split('\n')[1].startsWith('2026,'), 'année la plus récente en premier');
    eq(ctx.fake.errors, [], 'erreurs JavaScript');
  });

  await test('cache : deuxième page sans aucune requête vers le site', async () => {
    ctx.fake.log.length = 0;
    const p2 = await openWith(ctx, `${SITE}Accueil.html`, 'v2');
    await waitIdle(p2);
    eq(yearsLog(ctx), [], 'pages annuelles relues');
    eq(ctx.fake.log.filter(p => p === 'SPE').length, 0, 'spécialités relues');
    eq(await metaCount(p2), total(2026), 'thèses');
    await p2.close();
  });

  await test('recherche, surlignage, « / » dans la barre, CSV résultats', async () => {
    await bar(page, r => { const q = r.getElementById('q'); q.value = 'lupus'; q.dispatchEvent(new Event('input')); });
    await page.waitForTimeout(400);
    const res = await bar(page, r => [...r.querySelectorAll('#res li')].slice(1).map(li => ({ t: li.textContent, m: li.querySelectorAll('mark').length })));
    assert(res.length > 0, 'des résultats pour « lupus »');
    assert(res.every(x => /lupus/i.test(x.t) && x.m > 0), 'chaque résultat contient le mot, surligné');
    const { text } = await downloadText(page, () => bar(page, r => r.getElementById('export2').click()));
    assert(text.startsWith('\uFEFF' + HEADER + ',Spécialité FMPM,Option FMPM,Statut,Confiance,Spécialité secondaire,Signalement,Fiche These2.0\n'), `en-tête CSV résultats : ${JSON.stringify(text.slice(0, 200))}`);
    eq(csvLines(text) - 1, res.length, 'lignes du CSV résultats');
    await bar(page, r => { const q = r.getElementById('q'); q.value = ''; q.focus(); });
    await page.keyboard.type('a/b');
    eq(await bar(page, r => r.getElementById('q').value), 'a/b', '« / » tapé dans la recherche');
    await page.locator('body').click({ position: { x: 5, y: 600 } });
    await page.keyboard.press('/');
    eq(await page.evaluate(() => document.activeElement?.id), 'fmpm-search-host', '« / » ailleurs = aller à la recherche');
    await bar(page, r => { const q = r.getElementById('q'); q.value = ''; q.dispatchEvent(new Event('input')); });
  });

  await test('échec partiel : 2019 coupé et 2014 en HTTP 500 → copies gardées, signalées, puis réessai', async () => {
    Object.assign(ctx.fake.years, { 2019: 'abort', 2014: 500 });
    await bar(page, r => r.getElementById('reload').click());
    await waitIdle(page);
    eq(await metaCount(page), total(2026), 'aucune thèse perdue');
    const warn = await bar(page, r => r.getElementById('warn').hidden ? '' : r.getElementById('warn').textContent);
    assert(/2019/.test(warn) && /2014/.test(warn) && /HTTP 500/.test(warn) && /copie du/.test(warn), `avertissement : ${warn}`);
    const nav = await navInfo(page);
    assert(/st-err/.test(nav.find(a => a.t === '2019').c) && /copie du/.test(nav.find(a => a.t === '2019').title), 'ruban : 2019 en erreur');
    await bar(page, r => { r.getElementById('diag').open = true; });
    await page.waitForTimeout(100);
    const diag = await bar(page, r => r.getElementById('diagbody').textContent);
    assert(/erreur — copie du/.test(diag) && /réseau/.test(diag), 'diagnostic : erreur réseau, copie utilisée');
    const p2 = await openWith(ctx, `${SITE}Accueil.html`, 'v2');      // a new page within 15 min: no retry storm
    await waitIdle(p2);
    eq(await metaCount(p2), total(2026), 'thèses après rechargement');
    await p2.close();
    ctx.fake.years = {};
    ctx.fake.log.length = 0;
    await bar(page, r => r.querySelector('#warn [data-act="failed"]').click());
    await waitIdle(page);
    eq(yearsLog(ctx).map(p => p.slice(-8, -4)).sort(), ['2014', '2019'], 'réessai : seulement les années en erreur');
    eq(await bar(page, r => r.getElementById('warn').hidden), true, 'avertissement levé');
  });

  await test('anomalies : page sans tableau, tableau vidé, liste réduite de moitié → ancienne copie ; « Accepter » pour une seule année', async () => {
    const headerOnly = synth(2006, 0);                              // header row kept, theses gone (rows turned into divs…)
    Object.assign(ctx.fake.years, { 2014: '<html><body><p>Site en maintenance</p></body></html>', 2026: synth(2026), 2006: headerOnly });
    await bar(page, r => r.getElementById('reload').click());
    await waitIdle(page);
    eq(await metaCount(page), total(2026), 'aucune thèse perdue');
    const diag = await bar(page, r => r.getElementById('diagbody').textContent);
    assert(/aucun tableau de thèses reconnu/.test(diag), 'anomalie 2014 décrite (pas de tableau)');
    assert(/3 thèse\(s\) lue\(s\) au lieu de 117/.test(diag), 'anomalie 2026 décrite (moitié perdue)');
    assert(/page en ligne sans aucune thèse, pour une année passée/.test(diag), 'anomalie 2006 décrite (tableau vidé, petite année passée)');
    assert(/st-err/.test((await navInfo(page)).find(a => a.t === '2006').c), 'ruban : 2006 en anomalie, pas « à jour »');
    eq(await bar(page, r => [...r.querySelectorAll('[data-act="accept"]')].map(b => b.dataset.year)), ['2026'], 'bouton « Accepter » pour la liste raccourcie seulement');
    await bar(page, r => r.querySelector('[data-act="accept"][data-year="2026"]').click());
    await waitIdle(page);
    eq(await metaCount(page), total(2026, [2026]) + SYNTH_ROWS, '2026 réduite acceptée ; 2014 et 2006 gardent leur copie');
    ctx.fake.years = {};
    await bar(page, r => r.getElementById('reload').click());
    await waitIdle(page);
    eq(await metaCount(page), total(2026), 'retour à la normale');
  });

  await test('pendant une relecture : CSV brut des copies autorisé, « Vider le cache » attend puis relit tout', async () => {
    ctx.fake.log.length = 0;
    await bar(page, r => r.getElementById('reload').click());
    await page.waitForTimeout(1200);                                // a few years read, many left
    const { text } = await downloadText(page, () => bar(page, r => r.getElementById('export').click()));
    eq(csvLines(text) - 1, total(2026), 'CSV brut complet (copies locales) pendant la relecture');
    assert(/copies locales exportées/.test(await bar(page, r => r.getElementById('meta').textContent)), 'export signalé comme fait pendant la relecture');
    await bar(page, r => r.querySelector('[data-act="clear"]').click());
    await page.waitForTimeout(500);
    await waitIdle(page, 120000);                                   // the running load, then the full re-read, with no idle gap
    eq(await metaCount(page), total(2026), 'toutes les thèses après vidage pendant la lecture');
    const nav = await navInfo(page);
    assert(nav.slice(1).every(a => /st-ok/.test(a.c)), `toutes les années relues : ${nav.filter(a => !/st-ok|home/.test(a.c)).map(a => a.t)}`);
    eq(yearsLog(ctx).length, 42, 'la lecture en cours (21) puis une relecture complète (21)');
  });
  if (page) await page.close();                                   // undefined when --grep skipped the first test

  await test('page annuelle 2026 : résumé, mise en page, étiquettes, #n36, aucune requête pour 2026', async () => {
    const c = await fakeContext(browser, T2026);
    const p = await openWith(c, `${SITE}annee-htm/2026.htm#n36`, 'v2');
    await waitIdle(p);
    const info = await bar(p, r => r.getElementById('yearinfo').textContent);
    for (const s of ['2026 : 117 thèses en ligne, n° 1 à 188', '74 n° pas (encore) en ligne', 'n° donné à deux thèses : 26, 36, 63', 'CHEKROUNI'])
      assert(info.includes(s), `résumé contient « ${s} » : ${info}`);
    eq(await p.evaluate(() => getComputedStyle(document.getElementById('pagecell1')).position), 'static', '#pagecell1 remis dans le flux');
    const nav = await navInfo(p);
    eq(nav.filter(a => a.cur === 'page').map(a => a.t), ['2026'], 'année courante marquée');
    const badges = await p.evaluate(() => [...document.querySelectorAll('.fmpm-u-badges')].map(b => b.textContent));
    assert(badges.length > 100, `étiquettes : ${badges.length}`);
    eq(badges.filter(b => b.includes('n° partagé')).length, 6, 'lignes « n° partagé » (26, 36, 63 : deux thèses chacun)');
    assert(badges.some(b => /ligne répétée : n° 100/.test(b)) && badges.some(b => /ligne répétée : n° 36/.test(b)), 'lignes répétées 36 / 100');
    eq(await p.evaluate(() => document.querySelectorAll('[data-fmpm-hit]').length), 2, 'n° 36 surligné (deux lignes)');
    eq(c.fake.log.filter(x => x.endsWith('/2026.htm')).length, 1, '2026.htm chargé une seule fois (la navigation)');
    eq(await bar(p, r => r.querySelectorAll('#res li').length), 0, 'pas de liste de résultats sur la page annuelle seule');
    eq(c.fake.errors, [], 'erreurs JavaScript');
    await c.close();
  });

  await test('2027 : ruban jusqu’à 2027 sans modifier le script, 2027 « pas encore publiée », aucun avertissement', async () => {
    const c = await fakeContext(browser, T2027);
    const p = await openWith(c, `${SITE}Accueil.html`, 'v2');
    await waitIdle(p);
    const nav = await navInfo(p);
    eq(nav[nav.length - 1].t, '2027', 'dernière année');
    eq(nav.length, 1 + 22, 'Accueil + 2006…2027');
    const y27 = nav[nav.length - 1];
    assert(/st-none/.test(y27.c) && /pas encore publiée/.test(y27.title), `2027 : ${y27.c} / ${y27.title}`);
    eq(await bar(p, r => r.getElementById('warn').hidden), true, 'pas d’avertissement pour une année pas encore publiée');
    eq(await metaCount(p), total(2026), 'thèses');
    c.fake.years[2027] = synth(2027);
    await bar(p, r => r.getElementById('reload').click());
    await waitIdle(p);
    assert(/st-ok/.test((await navInfo(p)).pop().c), '2027 publiée : à jour');
    eq(await metaCount(p), total(2026) + SYNTH_ROWS, 'thèses 2027 ajoutées');
    const p01 = await openWith(c, `${SITE}Accueil.html`, 'v01');
    const nav01 = await p01.evaluate(() => [...document.getElementById('fmpm-search-host').shadowRoot.querySelectorAll('#nav a')].map(a => a.textContent));
    eq(nav01[nav01.length - 1], '2027', 'v0.1-diagrams : ruban jusqu’à 2027');
    await c.close();
  });

  await test('premier passage avec 2019 injoignable : absente des résultats, signalée « aucune copie »', async () => {
    const c = await fakeContext(browser, T2026);
    c.fake.years[2019] = 'abort';
    c.fake.years[2010] = synth(2010, 0);                            // past year online with its header only
    const p = await openWith(c, `${SITE}Accueil.html`, 'v2');
    await p.waitForTimeout(1000);
    await bar(p, r => r.getElementById('export').click());
    assert(/aucune copie, le CSV brut sera complet à la fin/.test(await bar(p, r => r.getElementById('meta').textContent)), 'CSV brut refusé au premier chargement');
    await waitIdle(p);
    eq(await metaCount(p), total(2026, [2019, 2010]), 'thèses sans 2019 ni 2010');
    assert(/2010/.test(await bar(p, r => r.getElementById('warn').textContent)), 'année passée vide signalée (anomalie)');
    const warn = await bar(p, r => r.getElementById('warn').textContent);
    assert(/2019/.test(warn) && /aucune copie/.test(warn), `avertissement : ${warn}`);
    const { text } = await downloadText(p, () => bar(p, r => r.getElementById('export').click()));
    assert(csvLines(text) - 1 === total(2026, [2019, 2010]), 'CSV brut sans 2019 ni 2010');
    assert(/Années absentes de l'export \(non lues\) : 2010, 2019/.test(await bar(p, r => r.getElementById('meta').textContent)), 'export : années manquantes signalées');
    await c.close();
  });

  await test('spécialités : fichier en erreur → diagrammes sans spécialités ; copie expirée utilisée si le dépôt ne répond pas', async () => {
    const c = await fakeContext(browser, T2026);
    c.fake.spe = 500;
    const p = await openWith(c, `${SITE}annee-htm/2026.htm`, 'v2');
    await waitIdle(p);
    assert(/Spécialités indisponibles \(HTTP 500\)/.test(await bar(p, r => r.getElementById('warn').textContent)), 'avertissement spécialités');
    eq(await p.evaluate(() => document.querySelectorAll('.fmpm-u-badges').length) > 0, true, 'étiquettes d’erreurs de liste quand même');
    eq(c.fake.errors, [], 'erreurs JavaScript');
    c.fake.spe = null;
    const p2 = await openWith(c, `${SITE}annee-htm/2026.htm`, 'v2');
    await waitIdle(p2);
    await p2.waitForFunction(() => document.querySelectorAll('.fmpm-u-badges').length > 100);
    await p2.evaluate(() => { const k = 'fmpm-ultra-v1:spe', s = JSON.parse(localStorage.getItem(k)); s.at -= 25 * 3600 * 1000; localStorage.setItem(k, JSON.stringify(s)); });
    c.fake.spe = 'abort';
    const p3 = await openWith(c, `${SITE}annee-htm/2026.htm`, 'v2');
    await waitIdle(p3);
    await p3.waitForTimeout(500);
    const sub = await p3.evaluate(() => document.getElementById('fmpm-diagrams-host').shadowRoot.getElementById('fsub').textContent);
    assert(/spécialités : copie du 17\/10\/2026/.test(sub), `sous-titre : ${sub}`);
    assert(await p3.evaluate(() => document.querySelectorAll('.fmpm-u-badges').length) > 100, 'étiquettes de spécialité depuis la copie');
    await c.close();
  });

  await test('n° partagé avec une seule ligne dans le fichier des spécialités : pas de spécialité volée, pas de fiche ambiguë', async () => {
    const c = await fakeContext(browser, T2026);
    c.fake.spe = FIX('specialites-extrait.csv').toString('utf8').split('\n').filter(l => !/^2026,36,BADRAN/.test(l)).join('\n');
    assert(!/^2026,36,BADRAN/m.test(c.fake.spe) && /^2026,36,CHEKROUNI/m.test(c.fake.spe), 'extrait modifié');
    const p = await openWith(c, `${SITE}annee-htm/2026.htm`, 'v2');
    await waitIdle(p);
    await p.waitForFunction(() => document.querySelectorAll('.fmpm-u-badges').length > 100);
    const rows36 = await p.evaluate(() => [...document.querySelectorAll('tr')].filter(tr => (tr.querySelector('td,th')?.textContent || '').trim().replace(/^0+/, '') === '36')
      .map(tr => ({ who: tr.children[1].textContent.trim(), badges: tr.querySelector('.fmpm-u-badges')?.textContent || '' })));
    const badran = rows36.find(r => /BADRAN/i.test(r.who)), chek = rows36.find(r => /CHEKROUNI/i.test(r.who));
    assert(badran && !/Chirurgie générale/.test(badran.badges), `BADRAN sans la spécialité de CHEKROUNI : ${badran && badran.badges}`);
    assert(chek && /Chirurgie générale/.test(chek.badges), `CHEKROUNI garde la sienne : ${chek && chek.badges}`);
    await bar(p, r => { const q = r.getElementById('q'); q.value = 'chekrouni'; q.dispatchEvent(new Event('input')); });
    await p.waitForTimeout(400);
    const { text } = await downloadText(p, () => bar(p, r => r.getElementById('export2').click()));
    const lines = text.split('\n').filter(l => /CHEKROUNI/i.test(l));
    const l36 = lines.find(l => /^2026,36,/.test(l)), l100 = lines.find(l => /^2026,100,/.test(l));
    assert(l36 && !/thesefmpm3/.test(l36), `n° 36 (partagé) : pas de fiche These2.0 — ${l36}`);
    assert(l100 && /thesefmpm3\.vercel\.app\/these\/these100-26/.test(l100), `n° 100 : fiche — ${l100}`);
    eq(c.fake.errors, [], 'erreurs JavaScript');
    await c.close();
  });

  await test('cohabitation : v2 deux fois = une barre ; v0.1 puis v2 = v2 remplace ; v2 puis v0.1 = v0.1 s’arrête', async () => {
    const c = await fakeContext(browser, T2026);
    const p = await openWith(c, `${SITE}Accueil.html`, 'v2', 'v2');
    eq(await p.evaluate(() => document.querySelectorAll('#fmpm-search-host, #fmpm-diagrams-host').length), 2, 'une barre + un pied');
    await waitIdle(p);
    const p2 = await openWith(c, `${SITE}annee-htm/2026.htm`, 'v01');
    await p2.waitForTimeout(300);
    await p2.addScriptTag({ content: CODE.v2 });
    eq(await p2.evaluate(() => [...document.querySelectorAll('#fmpm-search-host')].map(h => h.dataset.version)), ['2.0.2'], 'barre de v2 seule');
    await p2.waitForFunction(() => document.querySelectorAll('.fmpm-u-badges').length > 100, null, { timeout: 30000 });
    await p2.waitForTimeout(12000);                                  // v0.1 finishes its own load and labels the table
    eq(await p2.evaluate(() => document.querySelectorAll('.fmpm-badges').length), 0, 'étiquettes de v0.1 retirées');
    assert(/ancienne version/.test(await bar(p2, r => r.getElementById('warn').textContent)), 'conseil : désactiver v0.x');
    const p3 = await openWith(c, `${SITE}annee-htm/2026.htm`, 'v2', 'v01', 'v0');
    eq(await p3.evaluate(() => document.querySelectorAll('#fmpm-search-host').length), 1, 'v0.1 et v0-stable s’arrêtent');
    await c.close();
  });

  await test('site modifié : colonne ajoutée, octet windows-1252 égaré dans la page UTF-8 → lecture juste', async () => {
    const c = await fakeContext(browser, T2026);
    const html2019 = new TextDecoder('windows-1252').decode(FIX('2019.htm'))
      .replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, tr => tr.replace(/<\/t[dh]>/i, m => `${m}<td>${/ORD/.test(tr) ? 'DATE' : '14/01/2019'}</td>`));
    c.fake.years[2019] = html2019;                                  // served as UTF-8 text
    const b2026 = FIX('2026.htm'), at = b2026.indexOf('</head>');
    c.fake.years[2026] = Buffer.concat([b2026.subarray(0, at), Buffer.from('<!-- \xe9 -->', 'latin1'), b2026.subarray(at)]);
    const p = await openWith(c, `${SITE}Accueil.html`, 'v2');
    await waitIdle(p);
    eq(await metaCount(p), total(2026), 'thèses');
    const { text } = await downloadText(p, () => bar(p, r => r.getElementById('export').click()));
    const l = text.split('\n').find(x => x.startsWith('2019,1,'));
    assert(l && /^2019,1,AMRANI IDRISSI Salma,Infection du site/.test(l), `colonne ajoutée : auteur et titre à leur place — ${l}`);
    assert(!/Ã©/.test(text) && /Évaluation|évaluation|thérapeutique/.test(text), 'octet égaré : la page UTF-8 reste UTF-8');
    await bar(p, r => { r.getElementById('diag').open = true; });
    await p.waitForTimeout(100);
    assert(/octet\(s\) invalide\(s\)/.test(await bar(p, r => r.getElementById('diagbody').textContent)), 'diagnostic : octets invalides signalés');
    eq(c.fake.errors, [], 'erreurs JavaScript');
    await c.close();
  });

  await test('horloge en retard (2025) sur la page 2026 : l\'année affichée reste dans le ruban et le résumé', async () => {
    const c = await fakeContext(browser, Date.UTC(2025, 9, 18, 10));
    const p = await openWith(c, `${SITE}annee-htm/2026.htm`, 'v2');
    await waitIdle(p);
    const nav = await navInfo(p);
    eq(nav[nav.length - 1].t, '2026', 'ruban jusqu’à 2026');
    assert(/^2026 : 117 thèses en ligne/.test(await bar(p, r => r.getElementById('yearinfo').textContent)), 'résumé 2026');
    await c.close();
  });

  await test('diagrammes au clavier : barre de spécialité (Entrée = filtre, focus gardé), année épinglée sans masquer les autres', async () => {
    const c = await fakeContext(browser, T2026);
    const p = await openWith(c, `${SITE}Accueil.html`, 'v2');
    await waitIdle(p);
    await p.waitForFunction(() => document.getElementById('fmpm-diagrams-host').shadowRoot.querySelector('#c-spe [role="button"][data-spe]'));
    const f = (fn, a) => p.evaluate(([s, x]) => new Function('r', 'a', `return (${s})(r, a)`)(document.getElementById('fmpm-diagrams-host').shadowRoot, x), [fn.toString(), a]);
    const spe = await f(r => { const g = r.querySelector('#c-spe [role="button"][data-spe]'); g.focus(); return g.dataset.spe; });
    await p.keyboard.press('Enter');
    eq(await bar(p, r => [...r.querySelectorAll('#chips [data-f]')].map(x => x.dataset.f)), ['spe'], 'filtre spécialité posé au clavier');
    eq(await f(r => r.activeElement && r.activeElement.dataset.spe), spe, 'focus revenu sur la même barre');
    assert(/résultat/.test(await bar(p, r => r.getElementById('sr').textContent)), 'nombre de résultats annoncé (lecteur d’écran)');
    await bar(p, r => r.querySelector('#chips [data-f="spe"]').click());   // back to all theses
    await f(r => r.querySelector('.bar-slot[data-year="2019"]').focus());
    await p.keyboard.press('Enter');
    eq(await f(r => r.querySelectorAll('.bar-slot').length), 21, 'année épinglée : les 21 barres restent visibles');
    eq(await f(r => r.activeElement && r.activeElement.dataset.year), '2019', 'focus sur la barre 2019');
    await c.close();
  });

  await test('PDF : bouton replié sans requête ; déplié = thèse, n° partagé, préc./suiv., ruban ; état mémorisé', async () => {
    const c = await fakeContext(browser, T2026);
    const url = `${SITE}annee-htm/FT/2026/these36-26.pdf`;
    const p = await openWith(c, url, 'v2');
    const dock = (fn, arg) => p.evaluate(([f, a]) => new Function('r', 'a', `return (${f})(r, a)`)(document.getElementById('fmpm-ultra-dock').shadowRoot, a), [fn.toString(), arg]);
    eq(await p.evaluate(() => !!document.getElementById('fmpm-search-host')), false, 'pas de barre de recherche sur un PDF');
    const pill = await dock(r => [...r.querySelectorAll('.pill a')].map(a => [a.textContent, a.href]));
    eq(pill, [['🏠', `${SITE}Accueil.html`], ['← Liste 2026', `${SITE}annee-htm/2026.htm#n36`]], 'liens du bouton replié');
    eq(await dock(r => r.getElementById('panel').hidden), true, 'replié par défaut');
    await p.waitForTimeout(800);
    eq(yearsLog(c), [], 'aucune requête tant que le bouton est replié');
    await dock(r => r.getElementById('tog').click());
    await p.waitForFunction(() => /CHEKROUNI/.test(document.getElementById('fmpm-ultra-dock').shadowRoot.getElementById('info').textContent));
    eq(yearsLog(c).length, 1, 'une seule requête (liste 2026) en dépliant');
    const info = await dock(r => r.getElementById('info').textContent);
    assert(/lié à 2 lignes/.test(info) && /BADRAN/.test(info) && /n° partagé/.test(info), `infos : ${info}`);
    eq(await dock(r => [...r.querySelectorAll('[data-cite]')].map(b => b.textContent.replace(/\s+/g, ' ').trim())).then(a => a.length), 2, 'une référence par thèse du PDF partagé');
    eq(await dock(r => r.getElementById('box').firstElementChild.className), 'pill', 'bouton avant le panneau (ordre de tabulation)');
    assert(/Navigation des thèses FMPM/.test(await dock(r => r.getElementById('tog').getAttribute('aria-label'))), 'nom accessible du bouton');
    const acts = await dock(r => [...r.querySelectorAll('#acts a')].map(a => [a.textContent, a.getAttribute('href') || '']));
    const prev = fixtureNums.filter(n => n < 36).pop(), next = fixtureNums.find(n => n > 36);
    assert(acts[0][0] === `‹ n° ${prev}` && acts[0][1].endsWith(`/these${String(prev).padStart(2, '0')}-26.pdf`), `précédente : ${acts[0]}`);
    assert(acts[1][0] === `n° ${next} ›` && acts[1][1].endsWith(`/these${String(next).padStart(2, '0')}-26.pdf`), `suivante : ${acts[1]}`);
    assert(!acts.some(([t]) => /These2.0/.test(t)), 'pas de fiche These2.0 pour un PDF partagé par deux thèses (elle montrerait l’une pour l’autre)');
    const nav = await dock(r => [...r.querySelectorAll('#nav a')].map(a => a.textContent));
    eq(nav, ['🏠 Accueil', ...Array.from({ length: 21 }, (_, i) => String(2006 + i))], 'ruban des années');
    await p.reload(); await p.addScriptTag({ content: CODE.v2 });
    eq(await dock(r => r.getElementById('panel').hidden), false, 'déplié mémorisé');
    await dock(r => r.getElementById('tog').focus());
    await p.keyboard.press('Escape');
    await p.reload(); await p.addScriptTag({ content: CODE.v2 });
    eq(await dock(r => r.getElementById('panel').hidden), true, 'replié par Échap, mémorisé');
    const first = `${SITE}annee-htm/FT/2026/these${String(fixtureNums[0]).padStart(2, '0')}-26.pdf`;
    await p.goto(first); await p.addScriptTag({ content: CODE.v2 });
    await dock(r => r.getElementById('tog').click());
    await p.waitForFunction(() => document.getElementById('fmpm-ultra-dock').shadowRoot.querySelector('#acts a'));
    assert(/aucune/.test(await dock(r => r.querySelector('#acts a').textContent)), 'première thèse : pas de précédente');
    const id = `these${String(fixtureNums[0]).padStart(2, '0')}-26`;
    assert(await dock((r, a) => [...r.querySelectorAll('#acts a')].some(x => x.href === `https://thesefmpm3.vercel.app/these/${a}`), id), 'fiche These2.0 d’une thèse non partagée');
    eq(c.fake.errors, [], 'erreurs JavaScript');
    await c.close();
  });

  await test('PDF absent (404) : le bouton s’ouvre et dit quelle thèse manque (2026-100, ligne recopiée)', async () => {
    const c = await fakeContext(browser, T2026);
    c.fake.missingPdf.add('these100-26.pdf');
    const p = await openWith(c, `${SITE}annee-htm/FT/2026/these100-26.pdf`, 'v2');
    await p.waitForFunction(() => /n° 100/.test(document.getElementById('fmpm-ultra-dock')?.shadowRoot.getElementById('info').textContent || ''));
    const r = await p.evaluate(() => { const s = document.getElementById('fmpm-ultra-dock').shadowRoot; return { open: !s.getElementById('panel').hidden, msg: s.getElementById('msg').textContent, info: s.getElementById('info').textContent }; });
    assert(r.open, 'ouvert d’office');
    assert(/404/.test(r.msg), `message : ${r.msg}`);
    assert(/CHEKROUNI/.test(r.info) && /ligne répétée : n° 36/.test(r.info), `infos : ${r.info}`);
    eq(await p.evaluate(() => localStorage.getItem('fmpm-ultra-v1:dock')), null, 'état non mémorisé sur une page 404');
    await c.close();
  });

  await test('v0.1-diagrams et v0-stable 1.2.1 : années en échec (dont l\'année en cours en 404) gardées, surlignage, PDF de résumé', async () => {
    for (const k of ['v01', 'v0']) {
      const c = await fakeContext(browser, T2026);
      const p = await openWith(c, `${SITE}Accueil.html`, k);
      const meta = () => p.evaluate(() => document.getElementById('fmpm-search-host').shadowRoot.getElementById('meta').textContent);
      await p.waitForFunction(() => /thèses lues/.test(document.getElementById('fmpm-search-host').shadowRoot.getElementById('meta').textContent), null, { timeout: 60000 });
      assert((await meta()).startsWith(`${total(2026)} thèses lues`), `${SRC[k]} : ${await meta()}`);
      c.fake.years[2019] = 'abort';
      c.fake.years[2026] = 404;                                      // the current year's page disappears for a while
      await p.evaluate(() => document.getElementById('fmpm-search-host').shadowRoot.getElementById('reload').click());
      await p.waitForTimeout(500);
      await p.waitForFunction(() => /thèses lues/.test(document.getElementById('fmpm-search-host').shadowRoot.getElementById('meta').textContent), null, { timeout: 60000 });
      assert((await meta()).startsWith(`${total(2026)} thèses lues`), `${SRC[k]} après échec de 2019 : ${await meta()}`);
      assert(/2 année\(s\) non lue\(s\), copie précédente utilisée/.test(await meta()), `${SRC[k]} signale les années non lues : ${await meta()}`);
      await p.evaluate(() => { const q = document.getElementById('fmpm-search-host').shadowRoot.getElementById('q'); q.value = 'lupus ar'; q.dispatchEvent(new Event('input')); });
      await p.waitForTimeout(400);
      const res = await p.evaluate(() => document.getElementById('fmpm-search-host').shadowRoot.getElementById('res').innerText);
      assert(/lupus/i.test(res) && !/ark>/.test(res), `${SRC[k]} surlignage intact : ${res.slice(0, 120)}`);
      const pa = await openWith(c, `${SITE}annee-htm/art/2007/article05-07.pdf`, k);
      eq(await pa.evaluate(() => !!document.getElementById('fmpm-search-host')), false, `${SRC[k]} ne s'installe pas sur un PDF de résumé`);
      const yrs = await p.evaluate(() => document.getElementById('fmpm-search-host').shadowRoot.getElementById('years').textContent);
      assert(/2019erreur.*copie du/.test(yrs.replace(/\s+/g, '')) || /2019.*copie/.test(yrs), `${SRC[k]} tableau des années : ${yrs.slice(0, 200)}`);
      eq(c.fake.errors, [], `${SRC[k]} erreurs JavaScript`);
      await c.close();
    }
  });
}

// ---- Live tests (real site) -------------------------------------------------------------------------------------------
async function live(browser) {
  await test('LIVE : site officiel, toutes les années lues, spécialités chargées', async () => {
    const c = await browser.newContext({ viewport: { width: 1300, height: 900 }, locale: 'fr-FR' });
    c.fake = { errors: [] };
    const p = await openWith(c, `${SITE}Accueil.html`, 'v2');
    await waitIdle(p, 240000);
    await bar(p, r => { r.getElementById('diag').open = true; });
    await p.waitForTimeout(300);
    const rows = await bar(p, r => [...r.querySelectorAll('#diagbody tr')].slice(1).map(tr => [...tr.children].map(td => td.textContent)));
    console.log(rows.map(r => `    ${r[0]}  ${r[1].padEnd(28)} ${r[2].padStart(5)}  ${r[7]}`).join('\n'));
    const thisYear = new Date().getFullYear();
    const bad = rows.filter(r => +r[0] < thisYear && !/à jour/.test(r[1]));
    assert(!bad.length, `années passées pas à jour : ${bad.map(r => `${r[0]} ${r[1]} ${r[7]}`).join(' ; ')}`);
    const n = await metaCount(p);
    assert(n >= 3900, `au moins 3 900 thèses (lu : ${n})`);
    await p.waitForFunction(() => /classées/.test(document.getElementById('fmpm-diagrams-host').shadowRoot.getElementById('c-kpi').textContent), null, { timeout: 90000 });
    const kpi = await p.evaluate(() => document.getElementById('fmpm-diagrams-host').shadowRoot.getElementById('c-kpi').textContent);
    const cls = Number((kpi.match(/([\d\s  ]+) classées/) || [])[1]?.replace(/\D/g, ''));
    assert(cls >= 3500, `au moins 3 500 thèses classées (lu : ${cls})`);
    fs.mkdirSync(OUT, { recursive: true });
    await p.screenshot({ path: path.join(OUT, 'live-accueil.png') });
    const y = await openWith(c, `${SITE}annee-htm/${thisYear - 1}.htm`, 'v2');
    await waitIdle(y, 120000);
    const info = await bar(y, r => r.getElementById('yearinfo').textContent);
    assert(new RegExp(`^${thisYear - 1} : \\d+ thèses en ligne`).test(info), `résumé de ${thisYear - 1} : ${info}`);
    eq(c.fake.errors, [], 'erreurs JavaScript');
    await c.close();
  });
}

// ---- Real PDF in Chromium's viewer (v2 as an unpacked extension, like a userscript manager would inject it) -----------
async function pdfLive() {
  await test('PDF LIVE : bouton dans le lecteur PDF de Chromium (these01-19.pdf)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fmpm-ext-'));
    const ext = path.join(tmp, 'ext');
    fs.mkdirSync(ext);
    fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify({
      manifest_version: 3, name: 'FMPM v2 (test)', version: '1.0',
      content_scripts: [{ matches: ['https://wd.fmpm.uca.ma/biblio/theses/*'], js: ['v2-ultra.js'], run_at: 'document_idle' }],
    }));
    fs.copyFileSync(path.join(US, 'v2-ultra.js'), path.join(ext, 'v2-ultra.js'));
    const c = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      headless: false, viewport: { width: 1200, height: 900 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    try {
      const p = c.pages()[0] || await c.newPage();
      await p.goto(`${SITE}annee-htm/FT/2019/these01-19.pdf`, { waitUntil: 'load', timeout: 90000 });
      await p.waitForFunction(() => !!document.getElementById('fmpm-ultra-dock'), null, { timeout: 30000 });
      const kind = await p.evaluate(() => ({ type: document.contentType, embed: !!document.querySelector('embed') }));
      console.log('    document :', JSON.stringify(kind));
      // the dock lives in the content script's world: read its shadow root through the DOM (open mode)
      const links = await p.evaluate(() => [...document.getElementById('fmpm-ultra-dock').shadowRoot.querySelectorAll('.pill a')].map(a => a.textContent));
      eq(links, ['🏠', '← Liste 2019'], 'liens du bouton');
      await p.evaluate(() => document.getElementById('fmpm-ultra-dock').shadowRoot.getElementById('tog').click());
      await p.waitForFunction(() => /n° 1\b/.test(document.getElementById('fmpm-ultra-dock').shadowRoot.getElementById('info').textContent), null, { timeout: 60000 });
      fs.mkdirSync(OUT, { recursive: true });
      await p.waitForTimeout(1500);
      await p.screenshot({ path: path.join(OUT, 'pdf-live.png') });
      console.log('    capture :', path.join(OUT, 'pdf-live.png'));
    } finally { await c.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
  });
}

(async () => {
  const browser = await chromium.launch();
  try {
    if (!ARGS.has('--only-live') && !ARGS.has('--only-pdf')) await offline(browser);
    if (ARGS.has('--live') || ARGS.has('--only-live')) await live(browser);
  } finally { await browser.close(); }
  if (ARGS.has('--pdf-live') || ARGS.has('--only-pdf')) await pdfLive();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} tests réussis${failed.length ? ` — échecs : ${failed.map(r => r.name).join(' | ')}` : ''}`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
