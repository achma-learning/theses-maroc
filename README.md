# Thèses de médecine au Maroc : recherche

Moteur de recherche des thèses soutenues dans les facultés de médecine marocaines : FMPM Marrakech, FMPR Rabat (médecine et pharmacie) et FMP Fès. Il sert à vérifier qu'un sujet n'a pas déjà été traité.

- **Page :** `index.html`. Elle lit les CSV du dossier `archive/`.
- **Recherche en direct sur le site de la FMPM (toujours à jour) :** userscript [sur Greasy Fork](https://greasyfork.org/scripts/600588) — détails dans [`archive/fmpm/methode/`](archive/fmpm/methode/README.md).
- **Spécialités :** les thèses sont classées selon la [liste officielle des spécialités de la FMPM](archive/specialites/liste-specialites-fmpm-2024.pdf) (42 spécialités : médecine, chirurgie, biologie ; en texte brut : [`specialites-fmpm.txt`](archive/specialites/specialites-fmpm.txt)), par correspondance avec le libellé de chaque source — 97 % des thèses de Fès, une partie des thèses de pharmacie de Rabat. Recherche `spe:"oncologie medicale"`, `option:chirurgie`. Règles et table : [`archive/specialites/`](archive/specialites/README.md).
- **Sources et limites :** [`archive/sources-theses-maroc.md`](archive/sources-theses-maroc.md)
- **En local :** `python3 -m http.server`, puis http://localhost:8000/

Dans la page : recherche sans accents (`diabete` trouve « DIABÈTE »), filtres faculté / années, graphique par année. Les noms de rapporteurs, spécialités et mots-clés sont **cliquables** ; le panneau **🧭 Affiner** compte, pour les résultats, les spécialités et les rapporteurs les plus fréquents ; **🗂 Fiche** ouvre une thèse avec son propre lien (`#fiche=fmpm-2024-5`). Syntaxe complète : bouton **?**.

Les données sont les listes que les facultés publient déjà (titre, auteur, année, rapporteur). Les résumés et les PDF ne sont pas republiés : la page renvoie vers les sources officielles. Vérifiez toujours un sujet sur [Toubkal](https://toubkal.imist.ma/search).
