# FMPM — recherche en ligne et mise à jour de la liste

Le catalogue officiel des thèses de la FMPM (https://wd.fmpm.uca.ma/biblio/theses/Accueil.html) a une page par année et pas de moteur de recherche. La liste publiée ici (`archive/fmpm/theses-fmpm-2006-2026.csv`) en est une copie figée.

| Fichier | Rôle |
|---|---|
| `fmpm-recherche.user.js` | **En ligne, toujours à jour.** Ajoute une barre de recherche sur le site officiel : relit toutes les années en direct (une page à la fois, pause 400 ms, cache 24 h), recherche sans accents, tableau « thèses par année ». Bouton **Exporter CSV brut**. |
| `build_fmpm.py` | **Mise à jour de la copie.** Transforme l'export brut en `theses-fmpm-AAAA-AAAA.csv` + `catalogue-theses-fmpm.md`, garde l'ancien CSV en `…-backup.csv`. Python 3, sans dépendance. |

## Installer le userscript

- **En un clic : [Greasy Fork — FMPM thèses, recherche en ligne + export CSV](https://greasyfork.org/scripts/600588)** (avec Tampermonkey ou Violentmonkey). Mises à jour automatiques. Licence MIT.
- Ou sans extension : ouvrir https://wd.fmpm.uca.ma/biblio/theses/Accueil.html → F12 → Console → coller tout `fmpm-recherche.user.js` → Entrée.

Une barre apparaît en haut de la page ; `/` pour y aller. Tout se passe dans votre navigateur, sur le site de la faculté : rien n'est envoyé ailleurs.

## Mettre à jour la liste (≈ une fois par an)

1. Sur le site, **⬇ Exporter CSV brut** → `fmpm-officiel-brut-AAAA-MM-JJ.csv`.
2. Contrôler : `python3 archive/fmpm/methode/build_fmpm.py fmpm-officiel-brut-AAAA-MM-JJ.csv --dry-run` (avant / après par année, lignes nouvelles, titres « … » complétés). Refuse d'écrire si le nouvel export a moins de 95 % des lignes de l'ancien (`--force` pour passer outre).
3. Écrire : même commande sans `--dry-run`. Si le nom du CSV change (nouvelle année), mettre à jour `SOURCES` dans `index.html`.
