#!/usr/bin/env python3
"""Met à jour la copie locale FMPM à partir de l'export brut du userscript.

Usage :
    python3 archive/fmpm/methode/build_fmpm.py <fmpm-officiel-brut-AAAA-MM-JJ.csv> [--dry-run] [--force]

Étapes :
  1. lit l'export brut (fmpm-recherche.user.js → « Exporter CSV brut ») ;
  2. nettoie les espaces, fusionne les doublons exacts du catalogue (même année, n°, auteur, titre) ;
  3. compare avec le CSV actuel (par année, lignes ajoutées / disparues, titres « … » complétés) ;
  4. renomme l'ancien CSV en <nom>-backup.csv (écrase le backup précédent) ;
  5. écrit le nouveau theses-fmpm-AAAA-AAAA.csv (UTF-8 avec BOM, mêmes colonnes) ;
  6. régénère catalogue-theses-fmpm.md (même plan, bloc « Ressources » conservé).

--dry-run : rapport seulement, rien n'est écrit.
--force   : écrit même si le nouveau fichier a beaucoup moins de lignes (export probablement cassé).
--merge   : garde la ligne actuelle quand la thèse y est déjà (même année + n° + auteur ou début de
            titre) — le site réintroduit parfois des accents cassés (« Expïrience ») et des
            apostrophes typographiques que la copie locale avait corrigés ; prend le titre du site
            seulement s'il complète un titre « … », et ajoute les thèses nouvelles. Recommandé.
Python 3 standard, aucune dépendance.
"""
import csv
import datetime
import re
import sys
import unicodedata
from collections import Counter, OrderedDict
from pathlib import Path

HEADER = ['Année', 'N°', 'Auteur', 'Titre', 'PDF (texte intégral)', 'Article (résumé, 2006-2014)']
FMPM_DIR = Path(__file__).resolve().parent.parent
CATALOGUE = FMPM_DIR / 'catalogue-theses-fmpm.md'
CSV_NAME = re.compile(r'^theses-fmpm-(\d{4})-(\d{4})\.csv$')
MIN_RATIO = 0.95  # refuse to write if the new file has fewer than 95 % of the old rows


def clean(s):
    return re.sub(r'\s+', ' ', (s or '')).strip()


def read_rows(path):
    with open(path, encoding='utf-8-sig', newline='') as f:
        reader = csv.reader(f)
        header = next(reader)
        if header != HEADER:
            sys.exit(f'En-tête inattendu dans {path} :\n  {header}\nattendu :\n  {HEADER}')
        return [[clean(c) for c in (row + [''] * len(HEADER))[:len(HEADER)]] for row in reader if any(row)]


def key(row):
    return (row[0], row[1], row[2].lower(), row[3].lower())


def base(s):
    s = unicodedata.normalize('NFD', s.lower())
    return ''.join(c for c in s if c.isascii() and c.isalnum())


def merge(old, rows):
    """Old rows win for theses already there; truncated titles are completed; new theses added."""
    by_slot = {}
    for r in rows:
        by_slot.setdefault((r[0], r[1]), []).append(r)
    used, out, completed = set(), [], 0
    for o in old:
        match = next((r for r in by_slot.get((o[0], o[1]), []) if id(r) not in used and (
            base(r[2]) == base(o[2]) or base(r[3])[:25] == base(o[3])[:25])), None)
        if match is None:
            out.append(o)
            continue
        used.add(id(match))
        o = list(o)
        if o[3].endswith('…') and not match[3].endswith('…') and base(match[3]).startswith(base(o[3])[:30]):
            o[3] = match[3]
            completed += 1
        o[4], o[5] = o[4] or match[4], o[5] or match[5]
        out.append(o)
    added = [r for r in rows if id(r) not in used]
    kept_only_here = len(old) - len(used)
    return sorted(out + added, key=sort_key), len(added), completed, kept_only_here


def sort_key(row):
    year = int(row[0]) if row[0].isdigit() else 0
    num = int(row[1]) if row[1].isdigit() else 10 ** 6
    return (-year, num)


def current_csv():
    found = [p for p in FMPM_DIR.iterdir() if CSV_NAME.match(p.name)]
    if len(found) != 1:
        sys.exit(f'Il faut exactement un theses-fmpm-AAAA-AAAA.csv dans {FMPM_DIR}, trouvé : {[p.name for p in found]}')
    return found[0]


def md_cell(s):
    return s.replace('|', '\\|') or '—'


def build_catalogue(rows, today, merged):
    text = CATALOGUE.read_text(encoding='utf-8') if CATALOGUE.exists() else ''
    m = re.search(r'## Ressources\n.*?(?=\n## )', text, re.S)
    ressources = m.group(0).rstrip() if m else '## Ressources\n\n- **Catalogue officiel (par année)** : https://wd.fmpm.uca.ma/biblio/theses/Accueil.html'
    years = sorted({r[0] for r in rows}, key=lambda y: -int(y))
    by_year = OrderedDict((y, [r for r in rows if r[0] == y]) for y in years)
    truncated = sum(r[3].endswith('…') for r in rows)
    no_pdf = sum(not r[4] for r in rows)

    limites = []
    if truncated:
        limites.append(f'- {truncated} titres sont coupés (marqués « … ») ; le titre complet figure dans le PDF.')
    if no_pdf:
        limites.append(f'- {no_pdf} thèses sans lien vers le texte intégral dans le catalogue officiel.')
    limites.append('- Les numéros manquants dans une année sont absents du catalogue officiel lui-même.')
    if merged:
        limites.append(f'- {merged} doublons exacts du catalogue (même année, n°, auteur, titre) ont été fusionnés.')
    limites.append('- Même n° pour deux thèses différentes : les deux sont gardées, comme dans la source.')
    limites.append('- Copie figée : pour les thèses ajoutées depuis, chercher en ligne (`archive/fmpm/methode/fmpm-recherche.user.js`).')

    out = [
        f'# Catalogue des thèses soutenues à la FMPM ({years[-1]} → {years[0]})',
        '',
        f'Faculté de Médecine et de Pharmacie de Marrakech — {len(rows)} thèses, extraites le {today:%d/%m/%Y} du catalogue officiel.',
        '',
        ressources,
        '',
        '## Limites de cette liste',
        '',
        *limites,
        '',
        '## Nombre de thèses par année',
        '',
        '| Année | Thèses |',
        '|---|---|',
        *[f'| {y} | {len(rs)} |' for y, rs in by_year.items()],
    ]
    for y, rs in by_year.items():
        out += ['', f'## {y}', '', '| N° | Auteur | Titre | PDF |', '|---|---|---|---|']
        for r in rs:
            links = []
            if r[4]:
                links.append(f'[PDF]({r[4]})')
            if r[5]:
                links.append(f'[Résumé]({r[5]})')
            out.append(f'| {r[1]} | {md_cell(r[2])} | {md_cell(r[3])} | {" · ".join(links)} |')
    return '\n'.join(out) + '\n'


def main(argv):
    args = [a for a in argv if not a.startswith('--')]
    dry, force, do_merge = '--dry-run' in argv, '--force' in argv, '--merge' in argv
    if len(args) != 1:
        sys.exit(__doc__)
    raw_path = Path(args[0])
    today = datetime.date.today()

    raw = read_rows(raw_path)
    seen, rows = set(), []
    for r in raw:
        if not (r[2] or r[3]):
            continue
        if key(r) in seen:
            continue
        seen.add(key(r))
        rows.append(r)
    merged = len(raw) - len(rows)
    rows.sort(key=sort_key)

    old_path = current_csv()
    old = read_rows(old_path)
    if do_merge:
        rows, n_added, n_completed, n_kept = merge(old, rows)
        print(f'--merge : {n_added} thèses ajoutées, {n_completed} titres « … » complétés, '
              f'{n_kept} lignes gardées bien qu\'absentes du site (ou autre auteur/titre sous ce n°).\n')
    old_keys = {key(r) for r in old}
    new_keys = {key(r) for r in rows}
    old_by_slot = {(r[0], r[1], r[2].lower()): r for r in old}

    c_old, c_new = Counter(r[0] for r in old), Counter(r[0] for r in rows)
    print(f'Ancien : {old_path.name} — {len(old)} lignes')
    print(f'Nouveau : {raw_path.name} — {len(raw)} lignes brutes, {merged} doublons exacts fusionnés → {len(rows)} lignes\n')
    print(f'{"Année":>6} {"avant":>6} {"après":>6} {"écart":>6}')
    for y in sorted(set(c_old) | set(c_new), key=lambda y: -int(y)):
        d = c_new[y] - c_old[y]
        print(f'{y:>6} {c_old[y]:>6} {c_new[y]:>6} {d:>+6}' + ('' if d == 0 else '  ←'))

    completed = 0
    for r in rows:
        o = old_by_slot.get((r[0], r[1], r[2].lower()))
        if o and o[3].endswith('…') and not r[3].endswith('…') and r[3].lower().startswith(o[3][:-1].rstrip().lower()[:40]):
            completed += 1
    added = [r for r in rows if key(r) not in old_keys]
    gone = [r for r in old if key(r) not in new_keys]
    print(f'\nLignes nouvelles ou modifiées : {len(added)} (dont {completed} titres « … » complétés)')
    print(f'Lignes de l\'ancien fichier absentes du nouveau : {len(gone)}')
    for r in gone[:15]:
        print(f'   - {r[0]} n°{r[1]} {r[2]} — {r[3][:80]}')
    if len(gone) > 15:
        print(f'   … et {len(gone) - 15} autres')

    if len(rows) < MIN_RATIO * len(old) and not force:
        sys.exit(f'\nArrêt : le nouveau fichier a {len(rows)} lignes contre {len(old)} (moins de {MIN_RATIO:.0%}). '
                 'Export probablement incomplet. Relancer l\'export, ou --force si c\'est voulu.')
    if dry:
        print('\n--dry-run : rien n\'a été écrit.')
        return

    years = [int(r[0]) for r in rows if r[0].isdigit()]
    new_path = FMPM_DIR / f'theses-fmpm-{min(years)}-{max(years)}.csv'
    backup = old_path.with_name(old_path.stem + '-backup.csv')
    old_path.replace(backup)
    with open(new_path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(HEADER)
        w.writerows(rows)
    CATALOGUE.write_text(build_catalogue(rows, today, merged), encoding='utf-8')

    print(f'\nÉcrit : {new_path.name} ({len(rows)} lignes) ; ancien fichier → {backup.name} ; {CATALOGUE.name} régénéré.')
    if new_path.name != old_path.name:
        print(f'⚠ Nom changé ({old_path.name} → {new_path.name}) : mettre à jour SOURCES dans thesis-archive.html, '
              'README.md, CONTEXT.md et archive/sources-theses-maroc.md dans le même commit.')
    print('À faire ensuite : mettre à jour les nombres (README, CONTEXT, sources-theses-maroc.md, pied de page de thesis-archive.html).')


if __name__ == '__main__':
    main(sys.argv[1:])
