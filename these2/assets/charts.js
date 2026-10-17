// Interactive SVG charts drawn in the browser from the tables in stats/stats.json.
// stats.json is fetched without cache on every visit, so the charts always show the latest data;
// the matplotlib PNGs stay available through the download button.
// A chart id without a renderer here falls back to its PNG (see dashboard.js).
(function () {
  "use strict";
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (n) => Number(n).toLocaleString("fr-FR");
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const UNCLASSIFIED = "Non classée";
  const PATTERN = `<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 6L6 0" style="stroke:var(--accent);stroke-width:1.5"/></pattern></defs>`;

  function ticks(max) {
    const raw = max / 5, mag = 10 ** Math.floor(Math.log10(raw || 1));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag;
    const out = [];
    for (let v = 0; v <= max + step * 0.01; v += step) out.push(v);
    return out;
  }

  // One clickable mark. `pick` is what the explorer table should filter on when it is clicked.
  const hit = (tag, attrs, tip, pick) =>
    `<${tag} class="hit ${attrs.cls || ""}" ${attrs.xy} tabindex="0" role="button" data-tip="${esc(tip)}" data-pick="${esc(JSON.stringify(pick))}" aria-label="${esc(tip)}"/>`;

  // Vertical bars, optionally stacked. rows: [{label, segs:[{v, cls}], tip, pick}]
  function vbars(rows, { unit = "", max } = {}) {
    const W = 900, H = 340, L = 46, R = 10, T = 12, B = 40;
    const top = max || Math.max(1, ...rows.map((r) => r.segs.reduce((a, s) => a + s.v, 0)));
    const tk = ticks(top), ymax = tk[tk.length - 1] || 1;
    const bw = (W - L - R) / rows.length, y = (v) => T + (H - T - B) * (1 - v / ymax);
    let g = tk.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}${unit}</text>`).join("");
    rows.forEach((r, i) => {
      let acc = 0;
      const x = L + i * bw + bw * 0.12;
      for (const s of r.segs) {
        if (s.v > 0) g += hit("rect", { cls: s.cls, xy: `x="${x}" width="${bw * 0.76}" y="${y(acc + s.v)}" height="${y(acc) - y(acc + s.v)}"` }, s.tip || r.tip, r.pick);
        acc += s.v;
      }
      g += `<text class="ax" x="${L + i * bw + bw / 2}" y="${H - B + 16}" text-anchor="middle">${esc(r.label)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" role="img">${PATTERN}${g}</svg>`;
  }

  // Horizontal bars, optionally stacked. rows: [{label, segs, total, tip, pick}]
  function hbars(rows, { labelW = 230, rowH = 22 } = {}) {
    const W = 900, R = 60, T = 6, H = T + rows.length * rowH + 6;
    const max = Math.max(1, ...rows.map((r) => r.total));
    const x = (v) => labelW + (W - labelW - R) * (v / max);
    let g = "";
    rows.forEach((r, i) => {
      const yy = T + i * rowH;
      let acc = 0;
      g += `<text class="ax" x="${labelW - 8}" y="${yy + rowH * 0.68}" text-anchor="end"><title>${esc(r.label)}</title>${esc(cut(r.label, 36))}</text>`;
      const rest = r.total - r.segs.reduce((a, s) => a + s.v, 0); // unclassified rows carry no source split
      for (const s of rest > 0 ? [...r.segs, { v: rest, cls: "cn" }] : r.segs) {
        if (s.v > 0) g += hit("rect", { cls: s.cls, xy: `x="${x(acc)}" y="${yy + 2}" width="${Math.max(1, x(acc + s.v) - x(acc))}" height="${rowH - 5}"` }, s.tip || r.tip, r.pick);
        acc += s.v;
      }
      g += `<text class="val" x="${x(r.total) + 5}" y="${yy + rowH * 0.68}">${fmt(r.total)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" role="img">${PATTERN}${g}</svg>`;
  }

  function heatmap(head, rows) {
    const years = head.slice(1), labelW = 190, W = 900, cw = (W - labelW - 6) / years.length, rh = 24, T = 22, H = T + rows.length * rh + 4;
    const max = Math.max(1, ...rows.flatMap((r) => r.slice(1)));
    let g = years.map((yr, j) => `<text class="ax" x="${labelW + j * cw + cw / 2}" y="14" text-anchor="middle">${esc(yr)}</text>`).join("");
    rows.forEach((r, i) => {
      g += `<text class="ax" x="${labelW - 8}" y="${T + i * rh + rh * 0.66}" text-anchor="end">${esc(cut(r[0], 30))}</text>`;
      years.forEach((yr, j) => {
        const v = r[j + 1], a = v ? 0.12 + 0.88 * Math.sqrt(v / max) : 0.04;
        const tip = `${r[0]} · ${yr} : ${fmt(v)} thèse(s)`;
        g += hit("rect", { xy: `x="${labelW + j * cw + 1}" y="${T + i * rh + 1}" width="${cw - 2}" height="${rh - 2}" rx="3" style="fill:var(--accent);fill-opacity:${a.toFixed(2)}"` }, tip, { spec: r[0], year: yr });
        if (v) g += `<text x="${labelW + j * cw + cw / 2}" y="${T + i * rh + rh * 0.66}" text-anchor="middle" font-size="10" style="pointer-events:none;fill:${a > 0.55 ? "#fff" : "var(--text)"}">${v}</text>`;
      });
    });
    return `<svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
  }

  const legend = (items) => `<div class="legend">${items.map(([cls, name]) => `<span><i class="sw ${cls}"></i>${esc(name)}</span>`).join("")}</div>`;
  const CAT = ["c0", "c1", "c2", "c3", "cn"];

  // Every renderer returns {html, hint}. t = {head, rows}.
  const RENDER = {
    "by-year": (t) => ({
      html: vbars(t.rows.map(([y, n, j]) => ({ label: y, segs: [{ v: n, cls: "s0" }], tip: `${y} : ${fmt(n)} thèses (${fmt(j)} avec jury connu)`, pick: { year: y } }))),
      hint: "Clic sur une barre : liste des thèses de l'année",
    }),
    "english-share": (t) => ({
      html: vbars(t.rows.map(([y, n, p]) => ({ label: y, segs: [{ v: p, cls: "s0" }], tip: `${y} : ${p} % en anglais (${fmt(n)} thèses)`, pick: { year: y } })), { unit: " %" }),
      hint: "Clic sur une barre : liste des thèses de l'année",
    }),
    "by-group": (t) => ({
      html: hbars(t.rows.map((r) => ({
        label: r[0], total: r[4], pick: { group: r[0] }, tip: `${r[0]} : ${fmt(r[4])} thèses`,
        segs: [1, 2, 3].map((k) => ({ v: r[k], cls: "s" + (k - 1), tip: `${r[0]} · ${t.head[k]} : ${fmt(r[k])}` })),
      })), { labelW: 190, rowH: 34 }) + legend([["s0", "Page de garde ou bibliothèque"], ["s1", "Déduite du rapporteur"], ["s2", "Déduite du titre"]]),
      hint: "Clic sur une barre : thèses du groupe",
    }),
    "by-specialty": (t) => ({
      html: hbars(t.rows.map((r) => ({
        label: r[0], total: r[5], pick: { spec: r[0] }, tip: `${r[0]} (${r[1]}) : ${fmt(r[5])} thèses`,
        segs: [2, 3, 4].map((k) => ({ v: r[k], cls: r[0] === UNCLASSIFIED ? "cn" : "s" + (k - 2), tip: `${r[0]} · ${t.head[k]} : ${fmt(r[k])}` })),
      }))) + legend([["s0", "Page de garde ou bibliothèque"], ["s1", "Déduite du rapporteur"], ["s2", "Déduite du titre"]]),
      hint: "Clic sur une barre : thèses de la spécialité",
    }),
    "specialty-heatmap": (t) => ({ html: heatmap(t.head, t.rows), hint: "Clic sur une case : spécialité et année" }),
    "study-design": (t) => ({
      html: vbars(t.rows.map((r) => ({
        label: r[0], pick: { year: r[0] }, tip: `${r[0]} : ${fmt(r.slice(1).reduce((a, b) => a + b, 0))} thèses`,
        segs: r.slice(1).map((v, k) => ({ v, cls: CAT[k], tip: `${r[0]} · ${t.head[k + 1]} : ${fmt(v)}` })),
      }))) + legend(t.head.slice(1).map((h, k) => [CAT[k], h])),
      hint: "Type d'étude lu dans le titre (estimation) · clic : thèses de l'année",
    }),
    "top-keywords": (t) => list(t, 25, (n) => ({ kw: n }), "Clic : thèses indexées avec ce mot-clé", "thèses"),
    "by-rapporteur": (t) => list(t, 30, (n) => ({ prof: n, role: "rap" }), "Clic : thèses encadrées par ce rapporteur", "thèses"),
    "top-professors": (t) => list(t, 25, (n) => ({ prof: n }), "Clic : thèses où ce professeur siège (tous rôles)", "jurys"),
    cities: (t) => list(t, 13, (n) => ({ q: n }), "Clic : thèses dont le titre cite la ville", "thèses"),
  };
  function list(t, top, pick, hint, noun) {
    return {
      html: hbars(t.rows.slice(0, top).map(([name, n]) => ({ label: name, total: n, segs: [{ v: n, cls: "s0" }], tip: `${name} : ${fmt(n)} ${noun}`, pick: pick(name) }))),
      hint,
    };
  }

  function render(chart) {
    const r = RENDER[chart.id];
    return r ? r(chart.table) : null;
  }

  // One tooltip for the whole page, driven by the data-tip attribute of the mark under the pointer.
  function wire(root, onPick) {
    const tip = document.getElementById("tip") || document.body.appendChild(Object.assign(document.createElement("div"), { id: "tip" }));
    const show = (el, x, y) => { tip.textContent = el.dataset.tip; tip.style.display = "block"; tip.style.left = Math.min(x + 12, innerWidth - 290) + "px"; tip.style.top = y + 14 + "px"; };
    root.addEventListener("mousemove", (e) => { const el = e.target.closest("[data-tip]"); el ? show(el, e.clientX, e.clientY) : (tip.style.display = "none"); });
    root.addEventListener("mouseleave", () => (tip.style.display = "none"));
    root.addEventListener("focusin", (e) => { const el = e.target.closest("[data-tip]"); if (el) { const b = el.getBoundingClientRect(); show(el, b.left, b.top); } });
    root.addEventListener("focusout", () => (tip.style.display = "none"));
    root.addEventListener("click", (e) => { const el = e.target.closest("[data-pick]"); if (el) onPick(JSON.parse(el.dataset.pick)); });
    root.addEventListener("keydown", (e) => {
      const el = e.target.closest("[data-pick]");
      if (el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onPick(JSON.parse(el.dataset.pick)); }
    });
  }

  window.Charts = { render, wire };
})();
