// Dashboard: charts are drawn in the browser by charts.js from the tables in stats.json (fetched
// without cache on every visit); the matplotlib PNGs from scripts/build_charts.py are the download
// option. Clicking a mark filters the explorer table at the bottom (data/theses.json).
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-");
  const UNCLASSIFIED = "Non classée";
  const MAX_ROWS = 500;
  // Folder holding stats/ and data/, relative to the page: "" for these2/dashboard.html, "../these2/" for visuals/.
  const BASE = document.body.dataset.base || "";

  const table = (head, rows) => `<table><thead><tr>${head.map((h, i) => `<th class="${i ? "n" : ""}">${esc(h)}</th>`).join("")}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i && typeof c === "number" ? "n" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;

  // ?v=<version> (hash of the data) makes browsers fetch new PNGs as soon as the data changes,
  // instead of showing a cached old chart under the same file name.
  let statusLine = "";
  function renderCharts(s) {
    $("sub").textContent = `${s.total} thèses · données du ${s.lastFetched}${statusLine} · sources : wd.fmpm.uca.ma (liste officielle) et lib.fmpm.uca.ma (jury)`;
    $("kpis").innerHTML = s.kpis.map(([v, l]) => `<div class="kpi"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join("");
    const sections = [...new Set(s.charts.map((c) => c.section))];
    $("toc").innerHTML = sections.map((x) => `<a href="#${slug(x)}">${esc(x)}</a>`).join("") + `<a href="#explorer">Filtrage dynamique</a>`;
    const isDark = () => document.documentElement.dataset.theme === "dark" ||
      (document.documentElement.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    $("charts").innerHTML = sections.map((sec) => `<h2 id="${slug(sec)}">${esc(sec)}</h2>` +
      s.charts.filter((c) => c.section === sec).map((c) => {
        const live = window.Charts && Charts.render(c);
        const png = `${BASE}stats/${c.id}.png?v=${s.version}`;
        const dl = `<a class="btn dl" href="${png}" data-light="${png}" data-dark="${BASE}stats/${c.id}-dark.png?v=${s.version}" download="${c.id}.png" title="Télécharger le graphique matplotlib (PNG)">⬇ PNG</a>`;
        return `
        <section class="chart">${live ? `
          <div class="viz"><h3>${esc(c.title)}</h3><div class="plot" aria-label="${esc(c.alt)}">${live.html}</div>
            <p class="hint">${esc(live.hint)}</p>${dl}</div>` : `
          <div class="viz"><a href="${png}" target="_blank" rel="noopener" title="Ouvrir en grand"><picture>
              <source srcset="${BASE}stats/${c.id}-dark.png?v=${s.version}" media="(prefers-color-scheme: dark)">
              <img src="${png}" alt="${esc(c.alt)}" loading="lazy"></picture></a>${dl}</div>`}
          <details><summary>Voir les chiffres</summary><div class="scroll">${table(c.table.head, c.table.rows)}</div></details>
        </section>`;
      }).join("")).join("");
    // the PNG matching the page theme (the theme can change after the page was drawn)
    $("charts").addEventListener("click", (e) => {
      const a = e.target.closest("a.dl");
      if (a) a.href = isDark() ? a.dataset.dark : a.dataset.light;
    });
    if (window.Charts) Charts.wire($("charts"), applyPick);
  }

  // ---------------------------------------------------------------- explorer
  let ROWS = [];
  function fill(id, values) {
    $(id).insertAdjacentHTML("beforeend", values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join(""));
  }
  // Chart clicks add these on top of the selects: a keyword or a professor (optionally only as rapporteur).
  let extra = null;
  // same key as prof_key() in build_charts.py, so a click matches the bar it came from
  const pk = (n) => String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/^\s*(PR|PROFESSEUR|DR)\.?\s+/, "").replace(/\.\s*/g, ". ").replace(/\s+/g, " ").trim();
  function applyPick(p) {
    for (const id of ["fq", "fgroup", "fspec", "fyear"]) $(id).value = "";
    extra = null;
    if (p.year) $("fyear").value = String(p.year);
    if (p.group) $("fgroup").value = p.group;
    if (p.spec) $("fspec").value = p.spec;
    if (p.q) $("fq").value = p.q;
    if (p.kw) extra = { kind: "kw", key: norm(p.kw).replace(/[^a-z0-9']+/g, " ").trim(), label: `mot-clé « ${p.kw} »` };
    if (p.prof) extra = { kind: p.role === "rap" ? "rap" : "prof", key: pk(p.prof), label: `${p.role === "rap" ? "rapporteur" : "professeur"} ${p.prof}` };
    renderRows();
    $("explorer").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function current() {
    const q = norm($("fq").value).split(/\s+/).filter(Boolean);
    const cl = $("fgroup").value, sp = $("fspec").value, y = $("fyear").value;
    return ROWS.filter((r) => (!cl || r.group === cl) && (!sp || r.spec === sp) && (!y || String(r.year) === y) &&
      q.every((w) => r.n.includes(w)) && (!extra || (extra.kind === "kw" ? r.kw.has(extra.key) : extra.kind === "rap" ? r.rap === extra.key : r.profs.has(extra.key))));
  }
  function renderRows() {
    const rows = current();
    $("factive").innerHTML = extra ? `Filtre du graphique : ${esc(extra.label)} <button class="btn" type="button" id="xclear">Retirer</button>` : "";
    if (extra) $("xclear").addEventListener("click", () => { extra = null; renderRows(); });
    $("fmeta").textContent = `${rows.length} thèse(s)${rows.length > MAX_ROWS ? ` · ${MAX_ROWS} premières affichées, l'export CSV contient tout` : ""}`;
    $("frows").innerHTML = rows.slice(0, MAX_ROWS).map((r) => `<tr>
      <td>${r.year}</td><td>${r.ord}</td><td>${esc(r.spec)}${r.guess ? ` <span title="${esc(r.guess)}">?</span>` : ""}</td><td>${esc(r.group)}</td>
      <td>${esc(r.title)}<br><small>Dr ${esc(r.author)}</small></td>
      <td>${r.href ? `<a href="${esc(r.href)}" target="_blank" rel="noopener">PDF</a>` : ""}</td></tr>`).join("");
  }
  function exportCsv() {
    const q = (v) => (/[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const lines = [["Année", "N°", "Auteur", "Titre", "Spécialité (liste officielle)", "Source de la spécialité", "Groupe", "Rapporteur", "PDF"].join(",")]
      .concat(current().map((r) => [r.year, r.ord, r.author, r.title, r.spec, r.source, r.group, r.rapporteur, r.href].map(q).join(",")));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `theses-fmpm-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function start() {
    try {
      const [s, d, st] = await Promise.all([
        fetch(BASE + "stats/stats.json", { cache: "no-cache" }).then((r) => r.json()),
        fetch(BASE + "data/theses.json", { cache: "no-cache" }).then((r) => r.json()),
        fetch(BASE + "data/status.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => null),
      ]);
      if (st) {
        const day = (iso) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
        statusLine = ` · vérifié le ${day(st.checkedAt)} (contrôle hebdomadaire du site officiel)${Date.now() - new Date(st.checkedAt) > 9 * 864e5 ? " ⚠ contrôle en retard" : ""}`;
      }
      renderCharts(s);
      ROWS = d.data.map((t) => {
        const spec = t.specialite || UNCLASSIFIED;
        const guess = t.specialiteSource === "titre" ? "déduite du titre" : t.specialiteSource === "rapporteur" ? "déduite du rapporteur" : "";
        return {
          year: t.year, ord: t.ord, title: t.title, author: t.author, rapporteur: t.rapporteur || "",
          href: t.href && t.href !== "not found" ? t.href : "", spec, guess, source: t.specialiteSource || "",
          group: t.groupe || UNCLASSIFIED, n: norm(`${t.title} ${t.author}`),
          kw: new Set((t.tags || []).map((k) => norm(k).replace(/[^a-z0-9']+/g, " ").trim())), rap: pk(t.rapporteur || ""),
          profs: new Set((t.profs || []).filter(Boolean).map(pk)),
        };
      }).sort((a, b) => b.year - a.year || b.ord - a.ord);
      fill("fgroup", [...new Set(ROWS.map((r) => r.group))].sort((a, b) => (a === UNCLASSIFIED) - (b === UNCLASSIFIED) || a.localeCompare(b, "fr")));
      fill("fspec", [...new Set(ROWS.map((r) => r.spec))].sort((a, b) => (a === UNCLASSIFIED) - (b === UNCLASSIFIED) || a.localeCompare(b, "fr")));
      fill("fyear", [...new Set(ROWS.map((r) => r.year))]);
      renderRows();
    } catch (e) {
      $("sub").textContent = "Impossible de charger les données : " + e.message;
    }
  }

  let timer;
  $("fq").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(renderRows, 150); });
  for (const id of ["fgroup", "fspec", "fyear"]) $(id).addEventListener("change", renderRows);
  $("reset").addEventListener("click", () => { for (const id of ["fq", "fgroup", "fspec", "fyear"]) $(id).value = ""; extra = null; renderRows(); });
  $("csv").addEventListener("click", exportCsv);
  start();
})();
