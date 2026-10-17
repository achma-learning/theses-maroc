# FMPM — recherche en ligne et mise à jour de la copie locale

Le catalogue officiel (https://wd.fmpm.uca.ma/biblio/theses/Accueil.html) a **une page par année** (`annee-htm/AAAA.htm`), une ligne par thèse : N° · Auteur · Titre · lien `TEXTE INTEGRAL` (`FT/AAAA/theseNN-AA.pdf`), plus un lien article/résumé pour 2006-2014 (`art/AAAA/articleNN-AA.pdf`). Pages en windows-1252 jusqu'à 2025, en UTF-8 en 2026. Le site ajoute les nouvelles thèses au fil de l'année : notre CSV n'est qu'une **copie figée**.

Deux usages, deux fichiers :

| Fichier | Rôle |
|---|---|
| `fmpm-recherche.user.js` | **En ligne.** Ajoute une barre de recherche sur le site officiel, relit toutes les années en direct (cache 24 h) — toujours à jour, comme These2.0 mais sans intermédiaire. Bouton **Exporter CSV brut**. |
| `build_fmpm.py` | **Copie locale.** Transforme l'export brut en `theses-fmpm-AAAA-AAAA.csv` + `catalogue-theses-fmpm.md`, garde l'ancien fichier en `…-backup.csv`. |
| `fetch_page1.py` | **Page de garde.** Lit la page 1 de chaque PDF (jury, spécialité du président) sans télécharger le PDF entier → `archive/specialites/page_de_garde.py`. |
| `analyse-site-fmpm.md` | Ce qu'on sait du site officiel (structure, pièges, page de garde, retard de la liste) — écrit pour These2.0, en anglais. |

Les userscripts (recherche, diagrammes) sont aussi dans [`userscripts/`](../../../userscripts/README.md) à la racine : `v0-stable.js` (= `fmpm-recherche.user.js`) et `v0.1-diagrams.js` (+ diagrammes en pied de page).

## 1. Chercher en ligne

- **Installation en un clic : [Greasy Fork](https://greasyfork.org/scripts/600588)** (Tampermonkey / Violentmonkey → « Installer ») — publié le 16/10/2026, licence MIT, mises à jour automatiques. Le fichier du dépôt est identique (mêmes `@downloadURL`/`@updateURL`) : changer le code ici → republier sur Greasy Fork avec un `@version` plus grand.
- Ou à la main : créer un script dans Tampermonkey, coller `fmpm-recherche.user.js`, enregistrer.
- Ou sans extension : ouvrir https://wd.fmpm.uca.ma/biblio/theses/Accueil.html → F12 → Console → coller tout le fichier → Entrée.
- Une barre apparaît en haut de la page. `/` pour y aller. Recherche sans accents, tous les mots doivent être présents. « Thèses par année » montre ce que le site contient aujourd'hui.

## 2. Mettre à jour la copie locale (≈ une fois par an, ou quand le site a beaucoup changé)

1. Sur le site, cliquer **⬇ Exporter CSV brut** → `fmpm-officiel-brut-AAAA-MM-JJ.csv`.
2. Mettre ce fichier dans le dépôt (par exemple `archive/fmpm/methode/`) — ou le donner à Claude.
3. Contrôler sans rien écrire :
   ```bash
   python3 archive/fmpm/methode/build_fmpm.py archive/fmpm/methode/fmpm-officiel-brut-AAAA-MM-JJ.csv --dry-run --merge
   ```
   **`--merge` (recommandé)** : garde notre ligne quand la thèse y est déjà, prend le titre du site seulement s'il complète un titre « … », ajoute les nouvelles. Raison : le site réintroduit des accents cassés (« Expïrience » dans les octets mêmes de la page 2026) et des apostrophes typographiques que notre copie avait corrigés — sans `--merge`, ≈ 350 titres propres seraient remplacés par leur version abîmée (constaté le 17/10/2026).
   Le rapport donne, par année, avant / après, les lignes nouvelles, les titres « … » complétés et les lignes disparues.
   Si le nouveau fichier a moins de 95 % des lignes de l'ancien, le script refuse d'écrire (export probablement cassé) — `--force` pour passer outre si c'est voulu.
4. Écrire :
   ```bash
   python3 archive/fmpm/methode/build_fmpm.py archive/fmpm/methode/fmpm-officiel-brut-AAAA-MM-JJ.csv --merge
   ```
   → l'ancien CSV devient `theses-fmpm-AAAA-AAAA-backup.csv` (un seul backup, écrasé à chaque mise à jour), le nouveau CSV et le catalogue sont écrits.
5. Puis la page de garde des nouvelles thèses : `python3 archive/fmpm/methode/fetch_page1.py archive/fmpm/theses-fmpm-AAAA-AAAA.csv <dossier_page1> <dossier_tmp>` (reprend là où il s'est arrêté), `python3 archive/specialites/page_de_garde.py <dossier_page1>`, `python3 archive/specialites/export_non_classees.py`, `python3 archive/specialites/graphiques_fmpm.py`.
6. Dans le même commit : mettre à jour les nombres (README, CONTEXT, `archive/sources-theses-maroc.md`, pied de page de `thesis-archive.html`) ; si le nom du CSV a changé (nouvelle année), mettre à jour `SOURCES` dans `thesis-archive.html`. Supprimer l'export brut une fois intégré.

Règles du dépôt respectées : rien n'est inventé (chaque ligne vient du site), UTF-8 avec BOM, en-têtes identiques, doublons exacts fusionnés seulement, deux thèses différentes avec le même n° gardées.

## 3. Couche These2.0 (jury, mots-clés, spécialité) — non officielle

[These2.0](https://thesefmpm.vercel.app) est un moteur de recherche des thèses FMPM fait par un étudiant (Akram Ammour), **pas par la faculté**. Il n'est plus à jour (3 219 thèses, s'arrête en 2024 n° 38), mais il a pour 2006-2024 des champs que la liste officielle n'a pas : **président, rapporteur, jury, mots-clés, spécialité, langue** (probablement recopiés des notices de l'OPAC de la bibliothèque — non vérifié).

- `scrape_these2.py <sortie.csv>` recopie ces champs tels quels (rien n'est deviné) → `archive/fmpm/these2-fmpm-2006-2024.csv` (16/10/2026 : 3 212 fiches sur 3 219 ; 7 répondent HTTP 500 côté These2.0, même après relance). Stdlib, une requête à la fois, pause 0,4 s, reprenable (cache `<sortie>.cache.json`, à ne pas committer). robots.txt absent au 16/10/2026.
- `thesis-archive.html` charge ce fichier s'il est là (case « jury + mots-clés FMPM », cochée par défaut) et le joint aux lignes FMPM par **année + N°**, seulement si le titre ou l'auteur concordent. Il n'écrase jamais un champ officiel ; chaque champ affiché porte la mention « These2.0 ». Décocher la case = recherche sur les seules données officielles.
- Le CSV officiel `theses-fmpm-2006-2026.csv` n'est **pas modifié** : la couche reste un fichier à part, comme le CSV complet de Fès.
- Pas dans le dépôt public `theses-maroc` (données compilées par un tiers).

### Ce qu'on a retenu de These2.0 (et ce qu'on n'a pas copié)

Repris dans `thesis-archive.html` : chaque nom, mot-clé et spécialité est **cliquable** (lance la recherche) ; une **fiche** par thèse avec son propre lien (`#fiche=fmpm-2024-5`) ; navigation **par spécialité** — ici en facettes comptées sur les résultats, avec aussi les rapporteurs / jury les plus fréquents et les mots-clés ; tri titre / auteur ; filtre `langue:en`.

Pas repris : serveur Next.js + base de données (nos CSV statiques suffisent, hors ligne), blocage de Ctrl+P / Ctrl+S, Ctrl+F détourné, images décoratives chargées depuis Unsplash (fuite de vie privée), interface en anglais seulement, recherche limitée à la FMPM.
