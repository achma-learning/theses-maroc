#!/usr/bin/env python3
"""Draw the FMPM thesis dashboard with matplotlib.

Specialties follow the official FMPM list (docs/liste-des-specialites-fmpm.pdf), see specialites.py.
Inspired by the FMPDF pages (https://cdim.fmp-usmba.ac.ma/stats/dashboard_theses.php and
.../cartographie_2025/cartographie-theses.html) but computed only from FMPM data.

Every chart is written twice: <id>.png (light) and <id>-dark.png (dark), so a page can swap
them with <picture><source media="(prefers-color-scheme: dark)">.
stats.json describes every chart (title, alt text, table of numbers) plus the specialty ->
group map, so the pages render the dashboard generically: add a chart here, it shows up there.

Usage:
  python pipeline/scripts/build_charts.py                                   # these2/data/theses.json -> these2/stats/
  python pipeline/scripts/build_charts.py --json these2/data/theses.json --out these2/stats
"""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # no display on CI
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap  # noqa: E402
from matplotlib.patches import Patch  # noqa: E402

import hashlib  # noqa: E402
import sys  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from specialites import GROUPS  # noqa: E402  (official FMPM list, docs/liste-des-specialites-fmpm.pdf)

UNCLASSIFIED = "Non classée"
TOP = 30

# Study design read from the title. Order matters: the first match wins.
DESIGNS = [
    ("Série de cas", r"propos (de |d')?(\d+|un|une|deux|trois|quatre|cinq) ?cas|serie de cas|cas clinique"),
    ("Enquête / CAP", r"enquete|questionnaire|connaissances|attitudes|pratiques|perception|satisfaction"),
    ("Expérience de service", r"experience"),
    ("Étude rétro/prospective", r"retrospecti|prospecti|epidemiolog|etude|profil"),
]
OTHER_DESIGN = "Autre / non précisé"

CITIES = ["Marrakech", "Agadir", "Safi", "Beni Mellal", "Essaouira", "Ouarzazate", "El Kelaa",
          "Laayoune", "Guelmim", "Errachidia", "Tiznit", "Taroudant", "Khouribga", "Inezgane",
          "Casablanca", "Rabat", "Fes", "Dakhla", "Zagora", "Tata"]

THEMES = {
    "light": dict(surface="#fcfcfb", text="#0b0b0b", muted="#52514e", grid="#e4e3df",
                  series="#2a78d6", inferred="#9cc1ee", neutral="#b5b3ad",
                  cats=["#2a78d6", "#eb6834", "#1baf7a", "#eda100"], heat=["#eef4fc", "#2a78d6", "#0b3a73"]),
    "dark": dict(surface="#1a1a19", text="#f0efec", muted="#c3c2b7", grid="#34332f",
                 series="#3987e5", inferred="#1f4e86", neutral="#5f5e59",
                 cats=["#3987e5", "#d95926", "#199e70", "#c98500"], heat=["#22272e", "#2f6fbf", "#b9d6f8"]),
}


def strip_accents(s: str) -> str:
    return re.sub(r"[̀-ͯ]", "", unicodedata.normalize("NFD", s or ""))


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9']+", " ", strip_accents(s).lower().replace("’", "'")).strip()


def prof_key(name: str) -> str:
    # keep in sync with update_theses.prof_key
    n = strip_accents(name or "").upper()
    n = re.sub(r"^\s*(PR|PROFESSEUR|DR)\.?\s+", "", n)
    n = re.sub(r"\.\s*", ". ", n)
    return re.sub(r"\s+", " ", n).strip()


def specialty(t: dict) -> str:
    return t.get("specialite") or UNCLASSIFIED  # official FMPM specialty, set by specialites.classify_all


def group(t: dict) -> str:
    return t.get("groupe") or UNCLASSIFIED


SOURCES = [("catalogue", "Page de garde ou bibliothèque"), ("rapporteur", "Déduite du rapporteur"),
           ("titre", "Déduite du titre")]


def design(title: str) -> str:
    n = norm(title)
    for name, rx in DESIGNS:
        if re.search(rx, n):
            return name
    return OTHER_DESIGN


# ------------------------------------------------------------------ drawing helpers
def style(ax, th, value_axis: str):
    ax.set_facecolor(th["surface"])
    for side in ("top", "right", "left", "bottom"):
        ax.spines[side].set_visible(False)
    (ax.spines["bottom"] if value_axis == "y" else ax.spines["left"]).set_visible(True)
    (ax.spines["bottom"] if value_axis == "y" else ax.spines["left"]).set_color(th["grid"])
    ax.tick_params(colors=th["muted"], labelsize=9, length=0)
    ax.grid(axis=value_axis, color=th["grid"], linewidth=0.8)
    ax.set_axisbelow(True)


def header(fig, th, main: str, sub: str):
    h = fig.get_figheight()
    fig.text(0.012, 1 - 0.12 / h, main, ha="left", va="top", fontsize=14, fontweight="bold", color=th["text"])
    fig.text(0.012, 1 - 0.44 / h, sub, ha="left", va="top", fontsize=9.5, color=th["muted"])
    return 1 - 0.85 / h


def legend(ax, th, handles, loc="lower right", ncol=1):
    leg = ax.legend(handles=handles, loc=loc, frameon=False, fontsize=9, ncol=ncol)
    for t in leg.get_texts():
        t.set_color(th["text"])


def columns(th, xs, ys, main, sub, fmt="{}"):
    fig, ax = plt.subplots(figsize=(11, 4.6), facecolor=th["surface"])
    bars = ax.bar(xs, ys, width=0.62, color=th["series"])
    for b, v in zip(bars, ys):
        ax.text(b.get_x() + b.get_width() / 2, v + max(ys) * 0.012, fmt.format(v), ha="center", va="bottom",
                fontsize=8.5, color=th["text"])
    style(ax, th, "y")
    ax.set_ylim(0, max(ys) * 1.12)
    top = header(fig, th, main, sub)
    fig.subplots_adjust(left=0.05, right=0.99, top=top, bottom=0.08)
    return fig


def hbars(th, labels, values, main, sub, extras=(), main_label=None, neutral=()):
    """Horizontal bars. extras = [(values, label, hatch), ...] stacked after the main values."""
    n = len(labels)
    fig, ax = plt.subplots(figsize=(11, 1.3 + 0.27 * n + (0.35 if extras else 0)), facecolor=th["surface"])
    ypos = list(range(n))[::-1]
    colors = [th["neutral"] if lab in neutral else th["series"] for lab in labels]
    ax.barh(ypos, values, height=0.62, color=colors)
    totals = list(values)
    handles = [Patch(color=th["series"], label=main_label)] if extras else []
    for vals, label, hatch in extras:
        ax.barh(ypos, vals, left=totals, height=0.62, color=th["inferred"], hatch=hatch,
                edgecolor=th["surface"], linewidth=0)
        totals = [a + b for a, b in zip(totals, vals)]
        handles.append(Patch(facecolor=th["inferred"], hatch=hatch, edgecolor=th["surface"], label=label))
    if handles:  # own row under the plot, so it never covers a bar
        leg = fig.legend(handles=handles, loc="lower center", ncol=len(handles), frameon=False, fontsize=9)
        for t in leg.get_texts():
            t.set_color(th["text"])
    for y, v in zip(ypos, totals):
        ax.text(v + max(totals) * 0.006, y, str(v), va="center", fontsize=8.5, color=th["text"])
    ax.set_yticks(ypos, labels, fontsize=9)
    ax.tick_params(axis="y", colors=th["text"])
    ax.set_xlim(0, max(totals) * 1.08)
    ax.set_ylim(-0.6, n - 0.4)
    style(ax, th, "x")
    ax.tick_params(axis="y", colors=th["text"])
    top = header(fig, th, main, sub)
    left = min(0.42, 0.06 + 0.0068 * max(len(lab) for lab in labels))  # room for the longest label
    fig.subplots_adjust(left=left, right=0.98, top=top, bottom=(0.7 if extras else 0.35) / fig.get_figheight())
    return fig


# ------------------------------------------------------------------ the dashboard
def build(json_path: Path, out: Path) -> dict:
    raw = json.loads(json_path.read_text("utf-8"))
    data, last = raw["data"], raw.get("lastFetched", "")
    data = [t for t in data if isinstance(t.get("year"), int)]
    out.mkdir(parents=True, exist_ok=True)
    total = len(data)
    years = sorted({t["year"] for t in data})
    detailed = [t for t in data if t.get("rapporteur")]

    # ---- counts
    per_year = Counter(t["year"] for t in data)
    detail_year = Counter(t["year"] for t in detailed)

    by_src = defaultdict(Counter)  # specialty -> {source: n}
    grp_src = defaultdict(Counter)  # group -> {source: n}
    for t in data:
        src = t.get("specialiteSource", "none")
        src = "catalogue" if src in ("page de garde", "vérifiée") else src  # facts, drawn solid like the library
        by_src[specialty(t)][src] += 1
        grp_src[group(t)][src] += 1
    specs = sorted(by_src, key=lambda s: (s == UNCLASSIFIED, -sum(by_src[s].values())))
    classified = [s for s in specs if s != UNCLASSIFIED]
    group_of = {s: g for g, ss in GROUPS.items() for s in ss}
    groups = sorted((g for g in grp_src if g != UNCLASSIFIED), key=lambda g: -sum(grp_src[g].values())) + \
        ([UNCLASSIFIED] if UNCLASSIFIED in grp_src else [])
    n_classified = total - sum(by_src[UNCLASSIFIED].values())
    src_extras = lambda rows, counter: [([counter[r][k] for r in rows], label, h)  # noqa: E731
                                        for (k, label), h in zip(SOURCES[1:], ("////", "...."))]
    src_head = [label for _, label in SOURCES]

    rapp = Counter(prof_key(t["rapporteur"]) for t in detailed)
    rapp.pop("", None)
    profs = Counter()
    for t in detailed:
        for p in {prof_key(x) for x in t.get("profs") or [] if x}:
            profs[p] += 1
    profs.pop("", None)

    eng_year = Counter(t["year"] for t in data if "eng" in (t.get("langue") or ""))
    design_year = defaultdict(Counter)
    for t in data:
        design_year[t["year"]][design(t["title"])] += 1
    design_names = [d for d, _ in DESIGNS] + [OTHER_DESIGN]

    tags = Counter()
    for t in data:
        for k in {norm(x) for x in t.get("tags") or [] if len(x) > 2}:
            tags[k] += 1
    top_tags = [(k.capitalize(), n) for k, n in tags.most_common(25)]

    city_counts = Counter()
    for t in data:
        n = norm(t["title"])
        for c in CITIES:
            if re.search(rf"\b{norm(c)}\b", n):
                city_counts[c] += 1
    city_rows = [(c, n) for c, n in city_counts.most_common() if n >= 3]

    heat_specs = classified[:15]
    heat_years = [y for y in years if per_year[y] >= 20]
    heat = [[sum(1 for t in data if t["year"] == y and specialty(t) == s) for y in heat_years] for s in heat_specs]
    keep = [j for j in range(len(heat_years)) if any(row[j] for row in heat)]  # years with no specialty data yet
    heat_years = [heat_years[j] for j in keep]
    heat = [[row[j] for j in keep] for row in heat]

    # ---- chart catalogue (order = order on the page)
    charts = []

    def add(cid, section, title, alt, head, rows, draw):
        charts.append({"id": cid, "section": section, "title": title, "alt": alt,
                       "table": {"head": head, "rows": rows}, "_draw": draw})

    add("by-year", "Volume", "Répartition des thèses par année", "Nombre de thèses soutenues par année",
        ["Année", "Thèses", "Avec jury connu"], [[y, per_year[y], detail_year[y]] for y in years],
        lambda th: columns(th, [str(y) for y in years], [per_year[y] for y in years],
                           "Répartition des thèses par année",
                           f"{total} thèses FMPM · source : wd.fmpm.uca.ma · mis à jour {last} · l'année en cours est partielle"))

    eng_years = [y for y in years if per_year[y] >= 20]
    add("english-share", "Volume", "Part des thèses rédigées en anglais", "Pourcentage de thèses en anglais par année",
        ["Année", "Thèses en anglais", "%"],
        [[y, eng_year[y], round(100 * eng_year[y] / per_year[y], 1)] for y in eng_years],
        lambda th: _line_pct(th, eng_years, [100 * eng_year[y] / per_year[y] for y in eng_years],
                             "Part des thèses rédigées en anglais",
                             f"{sum(eng_year.values())} thèses en anglais sur {total} · langue lue dans le catalogue ou devinée sur le titre"))

    add("by-group", "Thématiques", "Répartition par groupe de spécialités (liste officielle FMPM)",
        "Nombre de thèses en médecine, chirurgie et biologie", ["Groupe"] + src_head + ["Total"],
        [[g] + [grp_src[g][k] for k, _ in SOURCES] + [sum(grp_src[g].values())] for g in groups],
        lambda th: hbars(th, groups, [grp_src[g]["catalogue"] + grp_src[g]["none"] for g in groups],
                         "Répartition par groupe de spécialités (liste officielle FMPM)",
                         f"{n_classified} thèses classées sur {total} ({100 * n_classified / total:.0f} %) · "
                         f"groupes de la « Liste des spécialités » de la FMPM",
                         extras=src_extras(groups, grp_src), main_label=SOURCES[0][1], neutral=(UNCLASSIFIED,)))

    add("by-specialty", "Thématiques", f"Répartition par spécialité officielle ({len(classified)} / 42)",
        "Nombre de thèses par spécialité de la liste officielle FMPM, selon la source de la classification",
        ["Spécialité", "Groupe"] + src_head + ["Total"],
        [[s, group_of.get(s, UNCLASSIFIED)] + [by_src[s][k] for k, _ in SOURCES] + [sum(by_src[s].values())] for s in specs],
        lambda th: hbars(th, specs, [by_src[s]["catalogue"] + by_src[s]["none"] for s in specs],  # "none" = Non classée row
                         f"Répartition par spécialité officielle ({len(classified)} / 42)",
                         "Plein = page de garde (président du jury) ou catégorie du catalogue · rapporteur / titre = déduction automatique (hachures)",
                         extras=src_extras(specs, by_src), main_label=SOURCES[0][1], neutral=(UNCLASSIFIED,)))

    add("specialty-heatmap", "Thématiques", "Spécialités × années (top 15)",
        "Carte de chaleur du nombre de thèses par spécialité et par année",
        ["Spécialité"] + [str(y) for y in heat_years], [[s] + row for s, row in zip(heat_specs, heat)],
        lambda th: _heatmap(th, heat_specs, heat_years, heat))

    add("study-design", "Thématiques", "Type d'étude selon le titre",
        "Répartition des types d'étude par année, en pourcentage", ["Année"] + design_names,
        [[y] + [design_year[y][d] for d in design_names] for y in eng_years],
        lambda th: _stacked_pct(th, eng_years, design_names, design_year))

    add("top-keywords", "Thématiques", "Mots-clés les plus fréquents (top 25)", "Mots-clés les plus utilisés",
        ["Mot-clé", "Thèses"], [list(r) for r in tags.most_common(200)],
        lambda th: hbars(th, [k for k, _ in top_tags], [n for _, n in top_tags],
                         "Mots-clés les plus fréquents (top 25)",
                         f"Mots-clés du catalogue de la bibliothèque · {sum(1 for t in data if t.get('tags'))} thèses indexées"))

    top_r = rapp.most_common(TOP)
    add("by-rapporteur", "Encadrement", f"Répartition des thèses par rapporteur (top {TOP})",
        f"Top {TOP} des rapporteurs", ["Rapporteur", "Thèses"], [[f"Pr {k}", n] for k, n in rapp.most_common()],
        lambda th: hbars(th, [f"Pr {k}" for k, _ in top_r], [n for _, n in top_r],
                         f"Répartition des thèses par rapporteur (top {TOP})",
                         f"{len(rapp)} rapporteurs · {len(detailed)} thèses avec jury connu (catalogue lib.fmpm.uca.ma)"))

    top_p = profs.most_common(25)
    add("top-professors", "Encadrement", "Professeurs les plus sollicités, tous rôles (top 25)",
        "Professeurs présents dans le plus de jurys", ["Professeur", "Jurys"], [[f"Pr {k}", n] for k, n in profs.most_common(200)],
        lambda th: hbars(th, [f"Pr {k}" for k, _ in top_p], [n for _, n in top_p],
                         "Professeurs les plus sollicités, tous rôles (top 25)",
                         "Président, rapporteur, jury ou membre associé · une présence par thèse"))

    add("cities", "Géographie", "Villes citées dans les titres", "Nombre de thèses citant chaque ville dans leur titre",
        ["Ville", "Thèses"], [list(r) for r in city_rows],
        lambda th: hbars(th, [c for c, _ in city_rows], [n for _, n in city_rows], "Villes citées dans les titres",
                         "Lieu d'étude lu dans le titre (« … au CHU Mohammed VI de Marrakech ») · villes citées au moins 3 fois"))

    # ---- render
    plt.rcParams["font.family"] = "DejaVu Sans"
    for mode, th in THEMES.items():
        suffix = "" if mode == "light" else "-dark"
        for c in charts:
            fig = c["_draw"](th)
            fig.savefig(out / f"{c['id']}{suffix}.png", dpi=144, facecolor=th["surface"],
                        metadata={"Software": None})  # no version stamp -> same data, same bytes
            plt.close(fig)

    stats = {
        "total": total, "lastFetched": last,
        # changes whenever the data changes: pages append ?v=<version> to PNG URLs (cache-busting)
        "version": hashlib.sha256(json.dumps(raw["data"], sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:10],
        "kpis": [[total, "thèses"], [len(years), "années"], [f"{len(classified)} / 42", "spécialités officielles"],
                 [f"{100 * n_classified / total:.0f} %", "thèses classées"], [len(rapp), "rapporteurs"],
                 [len(detailed), "thèses avec jury connu"]],
        "groups": {s: group_of.get(s, UNCLASSIFIED) for s in specs},
        "charts": [{k: v for k, v in c.items() if k != "_draw"} for c in charts],
    }
    (out / "stats.json").write_text(json.dumps(stats, ensure_ascii=False), "utf-8")
    print(f"{len(charts)} charts + stats.json written to {out}")
    return stats


def _line_pct(th, xs, ys, main, sub):
    fig, ax = plt.subplots(figsize=(11, 4.2), facecolor=th["surface"])
    ax.plot([str(x) for x in xs], ys, color=th["series"], linewidth=2, marker="o", markersize=6,
            markeredgecolor=th["surface"], markeredgewidth=2, solid_capstyle="round")
    ax.text(len(xs) - 1, ys[-1] + max(ys) * 0.05, f"{ys[-1]:.1f} %", ha="center", fontsize=9, color=th["text"])
    style(ax, th, "y")
    ax.set_ylim(0, max(ys) * 1.25 or 1)
    ax.yaxis.set_major_formatter(lambda v, _: f"{v:.0f} %")
    top = header(fig, th, main, sub)
    fig.subplots_adjust(left=0.06, right=0.99, top=top, bottom=0.09)
    return fig


def _stacked_pct(th, years, names, by_year):
    fig, ax = plt.subplots(figsize=(11, 4.8), facecolor=th["surface"])
    colors = th["cats"] + [th["neutral"]]
    xs = [str(y) for y in years]
    bottom = [0.0] * len(years)
    for name, color in zip(names, colors):
        vals = [100 * by_year[y][name] / max(1, sum(by_year[y].values())) for y in years]
        ax.bar(xs, vals, bottom=bottom, width=0.7, color=color, edgecolor=th["surface"], linewidth=1.5, label=name)
        bottom = [b + v for b, v in zip(bottom, vals)]
    style(ax, th, "y")
    ax.set_ylim(0, 100)
    ax.yaxis.set_major_formatter(lambda v, _: f"{v:.0f} %")
    legend(ax, th, [Patch(color=c, label=n) for n, c in zip(names, colors)], loc="upper center", ncol=5)
    ax.legend_.set_bbox_to_anchor((0.5, -0.07))
    top = header(fig, th, "Type d'étude selon le titre",
                 "Lu dans le titre : « à propos de N cas », « enquête », « expérience du service », « étude rétrospective »…")
    fig.subplots_adjust(left=0.06, right=0.99, top=top, bottom=0.17)
    return fig


def _heatmap(th, specs, years, grid):
    fig, ax = plt.subplots(figsize=(11, 1.4 + 0.36 * len(specs)), facecolor=th["surface"])
    cmap = LinearSegmentedColormap.from_list("seq", th["heat"])
    vmax = max(max(r) for r in grid) or 1
    ax.imshow(grid, aspect="auto", cmap=cmap, vmin=0, vmax=vmax)
    for i, row in enumerate(grid):
        for j, v in enumerate(row):
            if v:
                light_cell = v / vmax < 0.55
                ink = (th["text"] if light_cell else th["surface"]) if th is THEMES["light"] else \
                      (th["text"] if light_cell else "#0b0b0b")
                ax.text(j, i, str(v), ha="center", va="center", fontsize=7.5, color=ink)
    ax.set_xticks(range(len(years)), [str(y) for y in years], fontsize=8.5, color=th["muted"])
    ax.set_yticks(range(len(specs)), specs, fontsize=9, color=th["text"])
    ax.tick_params(length=0)
    for s in ax.spines.values():
        s.set_visible(False)
    top = header(fig, th, "Spécialités × années (top 15)",
                 "Nombre de thèses par spécialité et par année · plus foncé = plus de thèses")
    fig.subplots_adjust(left=0.22, right=0.99, top=top, bottom=0.45 / fig.get_figheight())
    return fig


def main():
    here = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", default=str(here.parent / "these2/data/theses.json"))
    ap.add_argument("--out", default=str(here.parent / "these2/stats"))
    args = ap.parse_args()
    build(Path(args.json), Path(args.out))


if __name__ == "__main__":
    main()
