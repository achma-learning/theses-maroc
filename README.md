# Thèses de médecine au Maroc : recherche

Moteur de recherche des thèses soutenues dans les facultés de médecine marocaines : FMPM Marrakech, FMPR Rabat (médecine et pharmacie) et FMP Fès. Il sert à vérifier qu'un sujet n'a pas déjà été traité.

- **Page :** `index.html`. Elle lit les CSV du dossier `archive/`.
- **Sources et limites :** [`archive/sources-theses-maroc.md`](archive/sources-theses-maroc.md)
- **En local :** `python3 -m http.server`, puis http://localhost:8000/

Les données sont les listes que les facultés publient déjà (titre, auteur, année, rapporteur). Les résumés et les PDF ne sont pas republiés : la page renvoie vers les sources officielles. Vérifiez toujours un sujet sur [Toubkal](https://toubkal.imist.ma/search).
