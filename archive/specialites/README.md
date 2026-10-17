# Spécialités — liste officielle de la FMPM et classement des thèses

| Fichier | Contenu |
|---|---|
| `liste-specialites-fmpm-2024.pdf` | Document officiel « Liste des spécialités — Faculté de Médecine et de Pharmacie de Marrakech » (export Word du 26/10/2024 ; une version Excel de 2020 a exactement le même contenu). |
| `specialites-fmpm.txt` | La même liste en texte brut, par option (numérotée), pour lire ou copier. |
| `specialites-fmpm.csv` | Transcription du PDF : 42 spécialités en 3 options — médecine (23), chirurgie (14), biologie (5). Libellés recopiés tels quels, fautes comprises (« Périphirique », « Analyses biologies médicales »). |
| `correspondance-specialites.csv` | Table qui rattache le libellé propre à chaque source à une spécialité de la liste : `Source, Libellé source, Spécialité FMPM, Option, Remarque`. |

## Ce que c'est, et ce que ce n'est pas

La liste est celle des **spécialités de résidanat** proposées à la FMPM, pas un classement des thèses : aucune liste officielle de thèses ne donne de spécialité. Le classement se fait donc **par correspondance de libellés**, à partir de ce que chaque source donne déjà :

| Source | Libellé utilisé | Thèses | Avec spécialité FMPM | Avec option |
|---|---|---:|---:|---:|
| FMPM | catégorie These2.0 (non officielle, 2006-2024) — **pas publiée sur ce site** : la fiche FMPM renvoie vers These2.0 | 3 201 | 68 % | 84 % |
| FMP Fès | spécialité de la base CDIM (officielle) | 4 657 | 97 % | 97 % |
| FMPR pharmacie | colonne « Thème » (rare) | 345 | 69 % | 69 % |
| FMPR médecine | — (aucun libellé dans les listes) | — | — | — |

Rien n'est deviné à partir des titres : une thèse sans libellé, ou avec un libellé ambigu, reste « non attribuée ».

## Règles de correspondance

- Libellé équivalent → la spécialité (ex. These2.0 « Pneumologie » → « Pneumophtysiologie », Fès « Imagerie médicale » → « Radiologie »).
- Microbiologie, bactériologie, parasitologie, virologie, immunologie, biologie médicale → « Analyses biologies médicales » (remarque « regroupée »).
- Libellé qui mêle deux spécialités → **non attribué**, avec la raison : These2.0 « Neurologie » (contient la neurochirurgie), « Urologie-Nephrologie » (chirurgie + médecine).
- These2.0 « Chirurgie » (toutes les chirurgies sans catégorie propre) → option chirurgie seulement, spécialité non attribuée. À Fès, « Chirurgie » est à côté de libellés pour chaque autre chirurgie → « Chirurgie générale ».
- Disciplines fondamentales absentes de la liste (anatomie, histologie, physiologie, biophysique) et libellés de pharmacie → non attribués.

Chaque choix discutable porte une remarque dans la table. Pour changer un rattachement, modifier la ligne de `correspondance-specialites.csv` (aucun code à toucher) : la page `index.html` relit la table au chargement.

## Dans la page de recherche

`spe:"oncologie medicale"`, `option:chirurgie` (`medecine`, `biologie`), facettes « Spécialités (liste FMPM) » et « Options », ligne « Spécialité FMPM » dans la fiche, avec le libellé d'origine et la remarque. `cat:` cherche toujours le libellé de la source.
