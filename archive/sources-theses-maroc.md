# Archives de thèses — facultés de médecine marocaines

Utiliser ces sources pour vérifier qu'un sujet n'a pas déjà été traité avant de le proposer.

> Dernière mise à jour : 16/10/2026.

**Recherche locale :** `index.html` (racine du site) cherche dans les 4 CSV extraits à la fois (sans accents, filtres faculté/année, graphique par année) et renvoie la requête vers les sources ci-dessous (Toubkal, These2.0, OPAC FMPM, Google texte intégral, CDIM…). Ouvrir avec `python3 -m http.server` puis `http://localhost:8000/`, ou ouvrir le fichier et choisir le dossier `archive`.

## Vue d'ensemble

| Faculté | Toubkal (collection) | Archive locale | Liste publiée ici |
|---|---|---|---|
| FMPM — Marrakech | [handle/3](https://toubkal.imist.ma/handle/123456789/3) | catalogue par année + PDF texte intégral + OPAC bibliothèque | ✅ 2006-2026 (3 633 thèses) |
| FMPR — Rabat, Médecine | [handle/22](https://toubkal.imist.ma/handle/123456789/22) | listes annuelles PDF 1969-2025 | ✅ 18 860 thèses |
| FMPR — Rabat, Pharmacie | [handle/22](https://toubkal.imist.ma/handle/123456789/22) | listes annuelles PDF 1990-2025 | ✅ 3 623 thèses  |
| FMD — Rabat (Médecine dentaire) | [handle/23](https://toubkal.imist.ma/handle/123456789/23) | — | ❌ |
| FMPC — Casablanca | [handle/43](https://toubkal.imist.ma/handle/123456789/43) | archive à trouver ; page procédures/formulaires | ❌ |
| FMPDF — Fès | [handle/51](https://toubkal.imist.ma/handle/123456789/51) | base CDIM + serveur PDF `e_theses` + statistiques/cartographie | ✅ 2007-2026 (4 657 thèses) |

---

## Recherche nationale
- **Toubkal (IMIST/CNRST)** — dépôt national des thèses :
  - Recherche : https://toubkal.imist.ma/search
  - Liste des communautés (une par faculté) : https://toubkal.imist.ma/community-list
  - Liens par faculté : voir le tableau ci-dessus et chaque section.
  - ⚠️ Refuse l'accès automatisé (robots.txt) : à consulter soi-même dans le navigateur (c'est aussi là qu'on trouve les PDF, notamment pour la FMPR).

---

## FMPM — Marrakech
- Catalogue officiel par année : https://wd.fmpm.uca.ma/biblio/theses/Accueil.html (une page par année : `…/biblio/theses/annee-htm/AAAA.htm`)
- **Recherche en ligne sur le site officiel** (toujours à jour) : userscript [`archive/fmpm/methode/fmpm-recherche.user.js`](fmpm/methode/), installable en un clic sur Greasy Fork : https://greasyfork.org/scripts/600588 — barre de recherche sur toutes les années relues en direct + export du CSV brut pour mettre à jour la liste (`build_fmpm.py`, voir `archive/fmpm/methode/README.md`).
- PDF texte intégral : `https://wd.fmpm.uca.ma/biblio/theses/annee-htm/FT/AAAA/theseNN-AA.pdf`
- Résumé / article (2006-2014 seulement) : `https://wd.fmpm.uca.ma/biblio/theses/annee-htm/art/AAAA/articleNN-AA.pdf`
- **OPAC de la bibliothèque FMPM** (catalogue PMB) : https://lib.fmpm.uca.ma/lib/opac_css/index.php — utile pour contrôler les titres tronqués et l'année 2023. Vérifié le 16/10/2026 : répond, robots.txt absent ; l'ancienne adresse `biblio.fmpm.uca.ma` ne répond plus.
- These2.0 (moteur non officiel, fait par un étudiant) : recherche `https://thesefmpm.vercel.app/search?page=1&search=TERME` ; fiche `https://thesefmpm.vercel.app/these/theseNN-AA` avec président, rapporteur, jury, mots-clés, spécialité. 3 219 thèses, s'arrête en 2024 (n° 38) — vérifié le 16/10/2026. La fiche de chaque thèse FMPM 2006-2024 de `index.html` y renvoie.
- Toubkal : https://toubkal.imist.ma/handle/123456789/3
- **Liste complète extraite (2006-2026)** : `archive/fmpm/catalogue-theses-fmpm.md` et `archive/fmpm/theses-fmpm-2006-2026.csv`
  - Lacunes : 385 titres tronqués « … » ; 2023 incomplet après le n° 261 (à re-scraper).

---

## FMPR — Rabat
- Toubkal (pour trouver les PDF) : https://toubkal.imist.ma/handle/123456789/22
- Liste des thèses par année (Médecine 1969-2025, Pharmacie 1990-2025) : http://biblio.medramo.ac.ma/bib/index.php/liste-des-theses-par-annee — refuse l'accès automatisé (robots.txt) : télécharger les PDF soi-même (script PowerShell) puis les joindre.
- Catalogue en ligne : http://biblio.medramo.ac.ma/bib/Catalogue%20en%20ligne%20.htm
- OPAC : http://biblio.medramo.ac.ma/opac_fmp/index.php (hébergé sur le domaine de Rabat ; longtemps classé par erreur sous FMPC)

### Médecine
- **Listes annuelles PDF** : `http://biblio.medramo.ac.ma/bib/THESES/MEDECINE/MAAAA.pdf` (1969-2024) ; 2025 : https://drive.google.com/file/d/1OaWNQ1-rcdcI4WI5_vhbwsFUz26xM7Qg/view
- **Code d'une thèse** : M + n° d'ordre sur 3 chiffres + année (ex. M0012024 = 1re thèse soutenue en 2024).
- **EXTRAIT (13/10/2026)** : 18 860 thèses 1969-2025 → `archive/fmpr/medecine/theses-fmpr-medecine-1969-2025.csv` (colonnes : Faculté, Filière, Année, N°, Code, Numéro (source), Auteur, Titre, Rapporteur / Directeur, Spécialité (2001-2006), Remarque, Contrôle, Page, Source PDF). Catalogue : `archive/fmpr/medecine/catalogue-theses-fmpr-medecine.md`.
  - Toutes les listes ont une couche texte (pas d'OCR nécessaire) ; extraction dans l'ordre de dessin du PDF (garde les titres multi-lignes entiers).
  - Lacunes : 2004-2007 = ancienne OCR (quelques lettres manquantes, corrigées en partie) ; 32 numéros reconstitués d'après les voisins ; ~45 titres absents dans la source ; 18 thèses « non soutenues » / 1 « reporter » (2020-2023).

### Pharmacie
- **Listes annuelles PDF** : `http://biblio.medramo.ac.ma/bib/THESES/PHARMACIE/PAAAA.pdf` (1990-2024) ; 2025 : https://drive.google.com/file/d/1jc7nIVelqCUe7yharsa80K5kxnHFEoBn/view
- **Code d'une thèse** : P + n° d'ordre sur 3 chiffres + année (ex. P0132022 = 13e thèse de 2022).
- **EXTRAIT (13/10/2026)** : 3 623 thèses soutenues 1990-2025 (+ 29 « non soutenues », 5 lignes vides). CSV et catalogue .md dans `archive/fmpr/pharmacie/`.
  - 36 listes, toutes avec couche texte, pas d'OCR. Tableaux à bordures (1990-2024) reconstruits par géométrie (bornes de colonnes + bandes de lignes), car plusieurs cellules de la source ont des bordures manquantes ; 2025 sans bordures, colonnes lues depuis l'en-tête.
  - Vérification (NOM, TITRE, ANNÉE) : auteur et titre comparés ligne par ligne à une 2e extraction indépendante (texte des cellules ; 2025 : découpage du texte brut + contrôle manuel) → concordance totale ; 99,96 % des mots des listes retrouvés ; année = liste + code de la thèse (4 cellules « Année » contradictoires signalées dans la colonne Remarque du CSV). Correction : extraction au niveau des caractères (un auteur collé au titre en 2007).
  - Corrections : 7 doublons fusionnés (co-rapporteurs gardés), P012013 → P0122013, accents abîmés réparés. Rapporteur absent des listes 1991-1997 et 2006.

### Divers FMPR
- Dépôt GitHub (khalid-khiar) : https://github.com/khalid-khiar/fmprthese/ — c'est le code de « OTROHATI / أطروحتي », la plateforme FMPR des **sujets de thèse proposés** et des formulaires (dépôt de sujet, autorisation de soutenance). Ce n'est **pas** une archive des thèses soutenues : le dépôt ne contient aucune liste de thèses (les données sont dans une base Firebase « doctorat-fmpr »).
- Serveur interne : http://10.29.12.37:8080/THESES%20ET%20MEMOIRES/ — adresse privée, accessible seulement depuis le réseau de la faculté.

### Faculté de Médecine Dentaire — Rabat
- Toubkal : https://toubkal.imist.ma/handle/123456789/23

---

## FMPC — Casablanca
- Toubkal : https://toubkal.imist.ma/handle/123456789/43
- Gestion des thèses — formulaires et procédures : https://www.fmpc.ac.ma/gestion-des-theses-formulaires-et-procedures/ (démarches administratives, pas une liste de thèses ; utile pour comparer avec la procédure FMPM/FMPR).
- Archive propre de la faculté : **à trouver** (l'OPAC `biblio.medramo.ac.ma/opac_fmp/` est sur le domaine de Rabat, voir FMPR).

---

## FMPDF — Fès
- Toubkal : https://toubkal.imist.ma/handle/123456789/51
- Page thèses de la faculté : https://www.fmp-usmba.ac.ma/theses/
- **Base de données des thèses (CDIM) — source principale** : https://cdim.fmp-usmba.ac.ma/theses/index.php
- **Serveur des PDF de thèses (CDIM, texte intégral)** : https://cdim.fmp-usmba.ac.ma/e_theses/
- Statistiques de la faculté (CDIM) : https://cdim.fmp-usmba.ac.ma/stats/ — utile pour contrôler les totaux par année après extraction.
- Cartographie des thèses (2025) : https://cdim.fmp-usmba.ac.ma/stats/cartographie_2025/
- Mémoires de fin de spécialité : https://cdim.fmp-usmba.ac.ma/memoires/index.php
- robots.txt : absent (404) → pas d'interdiction. Extraction faite dans le navigateur (userscript).
- **Code d'une thèse** : n° d'ordre + année sur 2 chiffres (`12-07` = 12e thèse de 2007) ; PDF : `https://cdim.fmp-usmba.ac.ma/e_theses/N-AA.pdf` (22 anciens fichiers en `.rar`).
- **API** : le tableau est rempli par `data.php?action=search_theses` (POST DataTables côté serveur, JSON : titre, auteur, rapporteur, resume, telechargement). Filtres : `annee`, `specialite`, `rapporteur`, `rechercheRapide`. Le serveur ignore le tri demandé (ordre de saisie) et plafonne à 100 lignes par requête (une demande plus grande renvoie 10 lignes, sans erreur) ; la pagination par 100 est stable (vérifié : 0 doublon entre pages).
- **Outil** : userscript Tampermonkey `archive/fmpdf/methode/userscript-*.js` — bouton sur la page des thèses, exporte 3 CSV ; puis `build_fmpf.py <complet.csv> <sortie> 4669` → CSV, catalogue .md, PDF A4.
- **EXTRAIT (13/10/2026, userscript v1.1)** : **4 657 thèses 2007-2026**, avec spécialité (49 spécialités utilisées) et résumé (99 %). Publiés ici : `archive/fmpdf/theses-fmpf-2007-2026.csv` (format FMPM) et `catalogue-theses-fmpf.md`. Les résumés ne sont pas republiés (texte des auteurs) : les consulter sur la base du CDIM.
  - Comptage : base 4 669 → export 4 664 lignes distinctes → 1 enregistrement vide (`1-99`) et 6 doubles saisies fusionnées (même code + même auteur, titre retouché : 24-24, 46-24, 62-24, 227-24, 138-23, 436-23 ; meilleur titre gardé, l'autre noté en Contrôle) → 4 657. Les 5 lignes non exportées sont des **doubles saisies exactes, vérifiées** (tous champs identiques, résumé compris, sur la même page du serveur : 1-07, 119-24, 158-24, 215-24, 133-25) → **extraction complète, aucune thèse ne manque**.
  - 3 codes portés par deux thèses différentes (245-22, 250-22, 36-24) : les deux gardées et signalées.
  - Lacunes de numérotation : 19 n° absents (2017-2026). Signalés aussi : `-1-07`, `-2-07` (codes négatifs), `280-07` hors série, 225-24 = 225-25 (même thèse sur deux années), 237-18 sans auteur, 22 fichiers `.rar`.
  - Leçon : ne jamais dédoublonner sur un seul champ (la v1.0 dédoublonnait par lien PDF et perdait les thèses partageant un code).