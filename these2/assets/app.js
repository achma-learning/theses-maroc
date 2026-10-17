// These2.0 static search: loads data/theses.json once, filters in the browser.
// Data file is regenerated daily by .github/workflows/update-data.yml.
(function () {
  "use strict";

  const PER_PAGE = 50;
  const UNCLASSIFIED = "Non classée";
  const $ = (id) => document.getElementById(id);

  // same idea as data/search.ts in the Next app: lowercase, no accents
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[’'`]/g, "'").toLowerCase();
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // official FMPM specialty (scripts/specialites.py); "rapporteur" / "titre" sources are automatic guesses
  const specOf = (t) => t.specialite || UNCLASSIFIED;
  const isGuess = (t) => ["rapporteur", "titre", "probable", "à vérifier"].includes(t.specialiteSource);
  const guessTitle = (t) => t.specialiteSource === "probable" ? "Spécialité probable (jury, catalogue et titre pas tous d'accord)"
    : t.specialiteSource === "à vérifier" ? "Spécialité à vérifier (sources à égalité)"
    : t.specialiteSource === "titre"
    ? `Spécialité déduite du titre${t.specialiteConfiance ? ` (confiance ${Math.round(t.specialiteConfiance * 100)} %)` : ""}`
    : "Spécialité déduite des autres thèses du rapporteur";

  let ALL = [];
  let page = 1;

  function readParams() {
    const p = new URLSearchParams(location.search);
    $("q").value = p.get("q") || "";
    $("year").value = p.get("year") || "";
    $("spec").value = p.get("spec") || "";
    $("lang").value = p.get("lang") || "";
    $("sort").value = p.get("sort") || "newest";
    page = Math.max(1, Number(p.get("page")) || 1);
  }

  function writeParams() {
    const p = new URLSearchParams();
    for (const k of ["q", "year", "spec", "lang"]) if ($(k).value) p.set(k, $(k).value);
    if ($("sort").value !== "newest") p.set("sort", $("sort").value);
    if (page > 1) p.set("page", page);
    const qs = p.toString();
    history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }

  function highlight(text, terms) {
    let out = esc(text);
    for (const t of terms) {
      if (t.length < 2) continue;
      const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      out = out.replace(re, (m) => `<mark>${m}</mark>`);
    }
    return out;
  }

  function filtered() {
    const terms = norm($("q").value).split(/\s+/).filter(Boolean);
    const year = $("year").value, spec = $("spec").value, lang = $("lang").value;
    const rows = ALL.filter((x) =>
      (!year || String(x.t.year) === year) &&
      (!spec || x.spec === spec) &&
      (!lang || x.t.langue.includes(lang)) &&
      terms.every((w) => x.n.includes(w)));
    const s = $("sort").value;
    const cmp = {
      newest: (a, b) => b.t.year - a.t.year || b.t.ord - a.t.ord,
      oldest: (a, b) => a.t.year - b.t.year || a.t.ord - b.t.ord,
      titleAsc: (a, b) => a.t.title.localeCompare(b.t.title, "fr", { sensitivity: "base" }),
      authorAsc: (a, b) => a.t.author.localeCompare(b.t.author, "fr", { sensitivity: "base" }),
    }[s];
    return rows.sort(cmp);
  }

  function card(t, raw) {
    const pdf = t.href && t.href !== "not found"
      ? `<a href="${esc(t.href)}" target="_blank" rel="noopener">PDF</a>` : "<em>sans PDF</em>";
    const spec = specOf(t);
    const chips = [
      isGuess(t)
        ? `<span class="chip guess" title="${esc(guessTitle(t))}">${esc(spec)} ?</span>`
        : `<span class="chip">${esc(spec)}</span>`,
      `<span class="chip">${t.langue.includes("eng") ? "Anglais" : "Français"}</span>`,
      ...(t.tags || []).slice(0, 6).map((k) => `<span class="chip">${highlight(k, raw)}</span>`),
    ].join("");
    const jury = t.president || t.rapporteur || (t.jury || []).length
      ? `<details><summary>Jury</summary>
           ${t.president ? `Président : ${highlight(t.president, raw)}<br>` : ""}
           ${t.rapporteur ? `Rapporteur : ${highlight(t.rapporteur, raw)}<br>` : ""}
           ${(t.jury || []).length ? `Jury : ${highlight(t.jury.join(" · "), raw)}<br>` : ""}
           ${(t.membreAssocie || []).length ? `Membres associés : ${esc(t.membreAssocie.join(" · "))}` : ""}
         </details>`
      : "";
    return `<li class="card">
      <div class="t">${highlight(t.title, raw)}</div>
      <div class="a">${t.year} · n° ${t.ord} · Dr ${highlight(t.author, raw)} · ${pdf}</div>
      <div class="chips">${chips}</div>
      ${jury}
    </li>`;
  }

  function render() {
    const rows = filtered();
    const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
    page = Math.min(page, pages);
    const raw = $("q").value.trim().split(/\s+/).filter(Boolean);
    $("meta").textContent = `${rows.length} résultat(s) · page ${page} / ${pages}`;
    $("results").innerHTML = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE).map((x) => card(x.t, raw)).join("");
    $("pager").innerHTML = pages > 1
      ? `<button data-p="${page - 1}" ${page === 1 ? "disabled" : ""}>← Précédent</button>
         <span>${page} / ${pages}</span>
         <button data-p="${page + 1}" ${page === pages ? "disabled" : ""}>Suivant →</button>`
      : "";
    writeParams();
  }

  function fillSelect(id, values) {
    const sel = $(id);
    for (const v of values) sel.insertAdjacentHTML("beforeend", `<option value="${esc(v)}">${esc(v)}</option>`);
  }

  // data/status.json is rewritten by the weekly check even when nothing changed
  async function statusText() {
    try {
      const st = await (await fetch("data/status.json", { cache: "no-cache" })).json();
      const d = (iso) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
      const late = Date.now() - new Date(st.checkedAt) > 9 * 864e5; // weekly check missed
      return ` · vérifié le ${d(st.checkedAt)}${late ? " ⚠ contrôle en retard" : ""}`;
    } catch { return ""; }
  }

  async function start() {
    try {
      const res = await fetch("data/theses.json", { cache: "no-cache" });
      const { data, lastFetched } = await res.json();
      ALL = data.map((t) => ({
        t,
        spec: specOf(t),
        n: norm([t.title, t.author, t.year, (t.tags || []).join(" "), (t.category || []).join(" "), t.specialite || "",
          (t.profs || []).join(" ")].join(" ")),
      }));
      fillSelect("year", [...new Set(data.map((t) => t.year))].sort((a, b) => b - a));
      fillSelect("spec", [...new Set(ALL.map((x) => x.spec))].sort((a, b) =>
        (a === UNCLASSIFIED) - (b === UNCLASSIFIED) || a.localeCompare(b, "fr")));
      $("sub").textContent = `${data.length} thèses · données du ${lastFetched}${await statusText()} · recherche sans accents, tous les mots doivent être présents`;
      readParams();
      render();
    } catch (e) {
      $("sub").textContent = "Impossible de charger data/theses.json : " + e.message;
    }
  }

  let timer;
  $("q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { page = 1; render(); }, 150); });
  for (const id of ["year", "spec", "lang", "sort"]) $(id).addEventListener("change", () => { page = 1; render(); });
  $("pager").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-p]");
    if (!b || b.disabled) return;
    page = Number(b.dataset.p);
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) { e.preventDefault(); $("q").focus(); }
  });

  start();
})();
