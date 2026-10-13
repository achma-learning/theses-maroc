"""Construit le catalogue des thèses FMP Fès (CSV, Markdown, PDF A4)
à partir de l'export du userscript (theses-fmpf-complet.csv).

Usage : python3 build_fmpf.py <theses-fmpf-complet.csv> <dossier_sortie>
"""
import csv, html, re, sys, collections
from datetime import date
from pathlib import Path

SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
TODAY = date.today().strftime("%d/%m/%Y")
SITE = "https://cdim.fmp-usmba.ac.ma/theses/index.php"

CIV = {"m": "M", "mr": "M", "mme": "Mme", "mlle": "Mlle", "melle": "Mlle"}

rows = list(csv.DictReader(open(SRC, encoding="utf-8-sig")))
n_src = len(rows)

recs = []
for r in rows:
    code = r["Code"].strip()
    m = re.fullmatch(r"(-?\d+)-(\d{2,4})", code)
    num = int(m.group(1)) if m else None
    yy = m.group(2) if m else ""
    code_year = (yy if len(yy) == 4 else ("19" + yy if yy and int(yy) > 50 else "20" + yy)) if yy else ""
    lien = r.get("Lien") or r.get("PDF (texte intégral)", "")
    recs.append({
        "Année": r["Année"].strip(), "N°": num, "Code": code,
        "Civilité": CIV.get(r["Civilité"].strip().lower(), r["Civilité"].strip()),
        "Auteur": r["Auteur"].strip(), "Titre": r["Titre"].strip(),
        "Rapporteur": r["Rapporteur"].strip(), "Spécialité": r.get("Spécialité", "").strip(),
        "PDF": lien.strip(), "Format": (r.get("Format") or lien.rsplit(".", 1)[-1]).lower(),
        "Résumé": r.get("Résumé", "").strip(), "_code_year": code_year, "notes": [],
    })

# ---------- Contrôles ----------
vides = [x for x in recs if not x["Auteur"] and not x["Titre"]]
recs = [x for x in recs if x not in vides]

by_year = collections.defaultdict(list)
for x in recs:
    by_year[x["Année"]].append(x)

dup_key = collections.defaultdict(list)
for x in recs:
    if x["Titre"]:
        dup_key[(x["Auteur"].lower(), x["Titre"].lower())].append(x)
for group in dup_key.values():
    if len(group) > 1:
        for x in group:
            autres = sorted({f'{g["Code"]}' for g in group if g is not x})
            x["notes"].append("doublon possible : même auteur et titre que " + ", ".join(autres))

lacunes, hors_serie = {}, []
for y, g in by_year.items():
    nums = sorted(x["N°"] for x in g if x["N°"] and x["N°"] > 0)
    # n° hors série : très loin au-delà de la série continue de l'année
    for x in g:
        n = x["N°"]
        if n and n > 0:
            prev = max([k for k in nums if k < n], default=0)
            if n - prev > 50:
                x["notes"].append(f"n° hors série (série de l'année : 1-{prev})")
                hors_serie.append(x)
    serie = [k for k in nums if not any(h["N°"] == k and h["Année"] == y for h in hors_serie)]
    if serie:
        lacunes[y] = sorted(set(range(1, max(serie) + 1)) - set(serie))

for x in recs:
    if x["N°"] is None:
        x["notes"].append("code illisible")
    elif x["N°"] < 1:
        x["notes"].append("code atypique (n° négatif dans la base)")
    if x["_code_year"] and x["_code_year"] != x["Année"]:
        x["notes"].append(f"année du code ({x['_code_year']}) ≠ année de la base")
    if not x["Titre"]:
        x["notes"].append("titre absent de la base")
    if not x["Auteur"]:
        x["notes"].append("auteur absent de la base")
    if x["Format"] == "rar":
        x["notes"].append("fichier .rar (archive, pas un PDF)")
    x["Contrôle"] = " ; ".join(x["notes"]) or "OK"

def sort_key(x):
    n = x["N°"] if x["N°"] is not None else 10**6
    return (-int(x["Année"]), n if n > 0 else 10**5 + abs(n), x["Auteur"])
recs.sort(key=sort_key)
years = sorted(by_year, key=int, reverse=True)
y_min, y_max = years[-1], years[0]
has_spec = any(x["Spécialité"] for x in recs)

# ---------- CSV ----------
base = f"theses-fmpf-{y_min}-{y_max}"
with open(OUT / f"{base}.csv", "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f)
    w.writerow(["Année", "N°", "Auteur", "Titre", "PDF (texte intégral)", "Article (résumé, 2006-2014)"])
    for x in recs:
        w.writerow([x["Année"], x["N°"], x["Auteur"], x["Titre"], x["PDF"], ""])

cols = ["Faculté", "Année", "N°", "Code", "Civilité", "Auteur", "Titre", "Rapporteur"]
cols += ["Spécialité"] if has_spec else []
cols += ["PDF (texte intégral)", "Format", "Contrôle", "Résumé"]
with open(OUT / f"{base}-complet.csv", "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f)
    w.writerow(cols)
    for x in recs:
        row = ["FMP Fès", x["Année"], x["N°"], x["Code"], x["Civilité"], x["Auteur"], x["Titre"], x["Rapporteur"]]
        row += [x["Spécialité"]] if has_spec else []
        row += [x["PDF"], x["Format"], x["Contrôle"], x["Résumé"]]
        w.writerow(row)

# ---------- Statistiques partagées ----------
signal = [x for x in recs if x["Contrôle"] != "OK"]
n_lac = sum(len(v) for v in lacunes.values())
n_res = sum(1 for x in recs if x["Résumé"])

limites = [
    f"{len(recs)} thèses ; {len(vides)} enregistrement(s) vide(s) de la base écarté(s) "
    f"({', '.join(v['Code'] for v in vides)} : ni auteur ni titre).",
    f"Numéros absents de la base (lacunes dans la numérotation d'une année) : {n_lac}. "
    "Ce sont soit des thèses jamais saisies, soit des numéros non attribués — voir le tableau des lacunes.",
    f"{len(signal)} lignes signalées dans la colonne Contrôle du CSV complet "
    "(codes atypiques, doublons possibles, fichiers .rar, titre absent…).",
    "Titres et noms reproduits tels qu'ils figurent dans la base (coquilles comprises), "
    "pour pouvoir les retrouver par recherche exacte sur le site.",
    f"Résumé disponible pour {n_res} thèses ({100*n_res/len(recs):.1f} %) : dans le CSV complet uniquement.",
]
ANNONCE = int(sys.argv[3]) if len(sys.argv) > 3 else None
if ANNONCE and ANNONCE > n_src:
    limites.insert(0, f"Incomplet : la base annonce {ANNONCE} enregistrements, l'export en contient {n_src} "
                   f"({ANNONCE - n_src} lignes fusionnées à tort par la v1.0 du userscript, surtout en 2022-2025). "
                   "À compléter avec un export v1.1.")
if not has_spec:
    limites.append("Spécialité : le filtre du site ne renvoie aucune thèse ; colonne non disponible.")

# ---------- Markdown ----------
def md(s):
    return s.replace("|", "\\|").replace("\n", " ")

L = [f"# Catalogue des thèses soutenues à la FMP Fès ({y_min} → {y_max})", "",
     f"Faculté de Médecine et de Pharmacie de Fès (USMBA) — {len(recs)} thèses, extraites le {TODAY} "
     "de la base du CDIM.", "",
     "## Ressources", "",
     f"- **Base des thèses (CDIM)** : {SITE} — recherche par mot-clé, année, rapporteur ; résumé de chaque thèse",
     "- **Texte intégral (PDF)** : `https://cdim.fmp-usmba.ac.ma/e_theses/N-AA.pdf` "
     "(ex. thèse n° 5 de 2007 → `e_theses/5-07.pdf` ; quelques fichiers anciens en `.rar`)",
     "- **Code d'une thèse** : n° d'ordre + 2 derniers chiffres de l'année (`12-07` = 12e thèse de 2007)",
     "- **Statistiques et cartographie** : https://cdim.fmp-usmba.ac.ma/stats/",
     "- **Toubkal (dépôt national)** : https://toubkal.imist.ma/handle/123456789/51", "",
     "## Limites de cette liste", ""]
L += [f"- {t}" for t in limites] + ["", "## Nombre de thèses par année", "", "| Année | Thèses | N° absents |", "|---|---|---|"]
for y in years:
    lac = lacunes.get(y, [])
    lac_txt = ", ".join(map(str, lac)) if len(lac) <= 12 else f"{len(lac)} (voir la section de l'année)"
    L.append(f"| {y} | {len(by_year[y])} | {lac_txt or '—'} |")
L.append("")
for y in years:
    L += [f"## {y}", "", "| N° | Auteur | Titre | Rapporteur | PDF |", "|---|---|---|---|---|"]
    for x in [r for r in recs if r["Année"] == y]:
        titre = md(x["Titre"]) or "*(titre absent de la base)*"
        flag = " ⚠" if x["Contrôle"] != "OK" else ""
        lien = f"[{x['Format'].upper()}]({x['PDF']})" if x["PDF"] else ""
        L.append(f"| {x['Code'] if (x['N°'] or 0) < 1 else x['N°']}{flag} | {md(x['Auteur'])} | {titre} | {md(x['Rapporteur'])} | {lien} |")
    if len(lacunes.get(y, [])) > 12:
        L += ["", f"N° absents de la base pour {y} : " + ", ".join(map(str, lacunes[y]))]
    L.append("")
L += ["---", "", "⚠ = ligne signalée (détail dans la colonne Contrôle du CSV complet)."]
(OUT / "catalogue-theses-fmpf.md").write_text("\n".join(L), encoding="utf-8")

# ---------- PDF A4 ----------
e = html.escape
H = [f"""<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
@page {{ size: A4; margin: 14mm 12mm 16mm 12mm;
  @bottom-center {{ content: "Thèses FMP Fès {y_min}-{y_max} — page " counter(page) " / " counter(pages); font: 7.5pt Carlito; color:#666 }} }}
body {{ font: 8.4pt/1.28 Carlito, 'Liberation Sans', sans-serif; color:#111 }}
h1 {{ font-size: 19pt; margin: 0 0 4pt; color:#0b3c4a }}
h2 {{ font-size: 13pt; color:#0b3c4a; border-bottom: 1.5pt solid #1a7d7f; padding-bottom: 2pt; margin: 0 0 6pt; page-break-before: always }}
h2.first {{ page-break-before: auto }}
.sub {{ color:#444; margin-bottom: 10pt }}
ul {{ padding-left: 14pt }} li {{ margin-bottom: 2pt }}
table {{ width:100%; border-collapse: collapse }}
th {{ background:#1a7d7f; color:#fff; text-align:left; padding:3pt 4pt; font-weight:600 }}
td {{ border-bottom: .4pt solid #c9dcdc; padding:2.4pt 4pt; vertical-align: top }}
tr {{ page-break-inside: avoid }}
thead {{ display: table-header-group }}
.n {{ width: 7%; white-space: nowrap; color:#0b3c4a; font-weight:600 }}
.a {{ width: 20% }} .r {{ width: 18%; color:#333 }}
.flag {{ color:#b3261e }} .miss {{ color:#666; font-style: italic }}
a {{ color:#1a5f8a; text-decoration:none }}
.stats td, .stats th {{ text-align:right }} .stats td:first-child, .stats th:first-child {{ text-align:left }}
.stats {{ width: 60% }}
.note {{ color:#555; font-size:7.8pt; margin-top:6pt }}
</style></head><body>
<h1>Thèses soutenues à la FMP Fès</h1>
<div class="sub">Faculté de Médecine et de Pharmacie de Fès (USMBA) — {y_min} → {y_max} — <b>{len(recs)} thèses</b><br>
Source : base des thèses du CDIM ({e(SITE)}), extraite le {TODAY}.</div>
<h2 class="first">Mode d'emploi et limites</h2><ul>
<li>Le titre de chaque thèse est un lien vers son texte intégral (PDF du CDIM).</li>
<li>Code d'une thèse : n° d'ordre + année sur 2 chiffres (12-07 = 12<sup>e</sup> thèse de 2007).</li>
""" + "".join(f"<li>{e(t)}</li>" for t in limites) +
"""<li><span class="flag">⚠</span> signale une ligne à vérifier (détail dans la colonne Contrôle du CSV complet).</li></ul>
<h2 class="first" style="margin-top:14pt">Nombre de thèses par année</h2><table class="stats"><thead><tr><th>Année</th><th>Thèses</th><th>N° absents</th></tr></thead><tbody>"""]
for y in years:
    H.append(f"<tr><td>{y}</td><td>{len(by_year[y])}</td><td>{len(lacunes.get(y, [])) or '—'}</td></tr>")
H.append(f"<tr><th>Total</th><th>{len(recs)}</th><th>{n_lac}</th></tr></tbody></table>")
for y in years:
    H.append(f"<h2>{y} — {len(by_year[y])} thèses</h2><table><thead><tr><th class='n'>N°</th><th class='a'>Auteur</th>"
             "<th>Titre</th><th class='r'>Rapporteur</th></tr></thead><tbody>")
    for x in [r for r in recs if r["Année"] == y]:
        num = x["Code"] if (x["N°"] or 0) < 1 else str(x["N°"])
        flag = " <span class='flag'>⚠</span>" if x["Contrôle"] != "OK" else ""
        t = e(x["Titre"]) if x["Titre"] else "<span class='miss'>(titre absent de la base)</span>"
        if x["PDF"]:
            t = f"<a href='{e(x['PDF'])}'>{t}</a>" + (" <span class='miss'>[.rar]</span>" if x["Format"] == "rar" else "")
        H.append(f"<tr><td class='n'>{e(num)}{flag}</td><td class='a'>{e(x['Auteur'])}</td><td>{t}</td><td class='r'>{e(x['Rapporteur'])}</td></tr>")
    H.append("</tbody></table>")
    if lacunes.get(y):
        H.append(f"<div class='note'>N° absents de la base en {y} : {', '.join(map(str, lacunes[y]))}</div>")
H.append("</body></html>")
(OUT / "_catalogue.html").write_text("".join(H), encoding="utf-8")

from weasyprint import HTML
doc = HTML(string="".join(H)).render()
doc.write_pdf(OUT / f"catalogue-theses-fmpf-{y_min}-{y_max}.pdf")

# ---------- Rapport console ----------
print(f"source : {n_src} lignes | thèses : {len(recs)} | vides écartés : {len(vides)} | pages PDF : {len(doc.pages)}")
print(f"lacunes : {n_lac} -> " + "; ".join(f"{y}: {v}" for y, v in sorted(lacunes.items()) if v and len(v) <= 12))
print(f"signalées : {len(signal)}")
for x in signal:
    print(f"  {x['Code']:>8}  {x['Contrôle']}")
