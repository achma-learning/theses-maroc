# FMPM — recherche en ligne et mise à jour de la liste

Le catalogue officiel des thèses de la FMPM (https://wd.fmpm.uca.ma/biblio/theses/Accueil.html) a une page par année et pas de moteur de recherche. La liste publiée ici (`archive/fmpm/theses-fmpm-2006-2026.csv`) en est une copie figée.

| Fichier | Rôle |
|---|---|
| `fmpm-recherche.user.js` | **En ligne, toujours à jour.** Ajoute une barre de recherche sur le site officiel : relit toutes les années en direct (une page à la fois, pause 400 ms, cache 24 h), recherche sans accents, tableau « thèses par année ». Bouton **Exporter CSV brut**. |
| `build_fmpm.py` | **Mise à jour de la copie.** Transforme l'export brut en `theses-fmpm-AAAA-AAAA.csv` + `catalogue-theses-fmpm.md`, garde l'ancien CSV en `…-backup.csv`. Python 3, sans dépendance. |
| `fetch_page1.py` | **Page de garde.** Lit la page 1 de chaque PDF (jury et spécialité du président) avec des requêtes HTTP Range (début + fin du fichier), sans télécharger le PDF entier → `archive/fmpm/theses-fmpm-page-de-garde.csv`. |
| `analyse-site-fmpm.md` | Ce qu'on sait du site officiel : structure, pièges, contenu de la page de garde, retard de la liste sur la numérotation (en anglais). |

Les userscripts sont aussi à la racine, dans [`userscripts/`](../../../userscripts/README.md) : `v0-stable.js` (= `fmpm-recherche.user.js`) et `v0.1-diagrams.js` (+ diagrammes dynamiques en pied de page).

## Installer le userscript

- **En un clic : [Greasy Fork — FMPM thèses, recherche en ligne + export CSV](https://greasyfork.org/scripts/600588)** (avec Tampermonkey ou Violentmonkey). Mises à jour automatiques. Licence MIT.
- Ou sans extension : ouvrir https://wd.fmpm.uca.ma/biblio/theses/Accueil.html → F12 → Console → coller tout `fmpm-recherche.user.js` → Entrée.

Une barre apparaît en haut de la page ; `/` pour y aller. Tout se passe dans votre navigateur, sur le site de la faculté : rien n'est envoyé ailleurs.

## Mettre à jour la liste (≈ une fois par an)

1. Sur le site, **⬇ Exporter CSV brut** → `fmpm-officiel-brut-AAAA-MM-JJ.csv`.
2. Contrôler : `python3 archive/fmpm/methode/build_fmpm.py fmpm-officiel-brut-AAAA-MM-JJ.csv --dry-run --merge` (avant / après par année, lignes nouvelles, titres « … » complétés). Refuse d'écrire si le nouvel export a moins de 95 % des lignes de l'ancien (`--force` pour passer outre).
   `--merge` (recommandé) garde la ligne actuelle quand la thèse y est déjà et ne prend le titre du site que s'il complète un titre « … » : la page 2026 du site contient des accents cassés (« Expïrience »).
3. Écrire : même commande sans `--dry-run`. Si le nom du CSV change (nouvelle année), mettre à jour `SOURCES` dans `index.html`.
