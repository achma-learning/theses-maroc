# Userscripts — catalogue officiel des thèses FMPM

Trois scripts qui s'exécutent **sur le site officiel** de la FMPM (https://wd.fmpm.uca.ma/biblio/theses/Accueil.html) : ils relisent en direct les pages annuelles du catalogue, donc ils sont toujours à jour, sans copie intermédiaire. **N'en activer qu'un.**

| Fichier | Version | Ce qu'il ajoute |
|---|---|---|
| [`v2-ultra.js`](v2-ultra.js) | 2.0.0 | **Recommandé.** Tout v0.1 + ruban 🏠 Accueil · 2006 → **année en cours** (suit le calendrier) sur toutes les pages, cache **par année** qui ne perd jamais une bonne copie, états et **diagnostic**, deux exports CSV, et sur les **PDF** un petit bouton : accueil, liste de l'année, thèse précédente / suivante. Détails ci-dessous. |
| [`v0-stable.js`](v0-stable.js) | 1.2.0 | Barre de recherche en haut (toutes les années, sans accents) + bouton **Exporter CSV brut** (pour `archive/fmpm/methode/build_fmpm.py`). Même code que `archive/fmpm/methode/fmpm-recherche.user.js`. |
| [`v0.1-diagrams.js`](v0.1-diagrams.js) | 1.2.0 | Tout v0 (barre **en haut**, sans l'export CSV) + **diagrammes dynamiques en pied de page**, recalculés à chaque recherche. **C'est la version publiée sur [Greasy Fork](https://greasyfork.org/scripts/600588).** |

**2.0.0 (18/10/2026) — `v2-ultra.js`, nouveau :** voir [v2-ultra](#v2-ultra--pour-durer-sans-entretien).

**1.2.0 (18/10/2026, v0-stable et v0.1-diagrams) :** une année que le site ne sert pas (coupure, délai, erreur HTTP) garde les thèses du chargement précédent au lieu de disparaître de la recherche et de l'export ; un tel chargement est signalé (« ⚠ N année(s) non lue(s) ») et réessayé après 30 min au lieu de rester 24 h en cache. La page de l'année en cours encore absente (404 en janvier) n'est pas une erreur. Le raccourci « / » ne vole plus la barre oblique tapée dans la recherche. Le ruban des années suit déjà le calendrier depuis 1.1.0 (2027 apparaîtra seul).

**1.1.1 :** « même auteur et titre sous deux n° » au lieu de « même thèse » : vérifié sur les PDF, la liste officielle recopie parfois la ligne voisine alors que le n° est une autre thèse (2018-138 Najat Banane, 2021-213 onychomycoses) ; chaque n° reste une thèse.

**1.1.0 (18/10/2026, les deux scripts) — pages des années (`annee-htm/AAAA.htm`) :** bouton **🏠 Accueil** et barre des années 2006 → aujourd'hui (l'année de la page en surbrillance ; les liens du site sont faux : sur 2026.htm « 2026 » ouvre 2025.htm, les pages 2007-2014 s'arrêtent à 2022) ; résumé de l'année (thèses en ligne, n° max, **n° pas encore en ligne**, n° donné à deux thèses, même auteur et titre sous deux n°) ; étiquettes dans le tableau officiel : **spécialité FMPM** (« ? » = pas confirmée, script diagrammes) et ⚠ pour les numéros anormaux ; les diagrammes s'ouvrent sur l'année de la page ; le tableau officiel n'est plus caché (le site le place en `position:absolute`, remis dans le flux). Numéro de version passé à 1.1.0 pour le script diagrammes : Greasy Fork avait déjà publié une 1.0.0, et Tampermonkey ignore un numéro plus petit.

**1.0.2 / 0.2.1 (18/10/2026) :** une ligne imprimée deux fois sur le site officiel (2023-125, 2025-329) compte une seule thèse (4 013 au lieu de 4 015) ; un même n° donné à deux thèses différentes (2025-214, 2026-26/36/63) garde les deux, chacune avec **sa** spécialité (comparaison des auteurs sans accents ni ordre des mots) ; bouton **These2.0 ↗** (même recherche sur https://thesefmpm3.vercel.app, mis à jour chaque jour) et lien vers son tableau `/stats`. Greasy Fork se synchronise tout seul depuis la copie publique `https://github.com/achma-learning/theses-maroc/raw/refs/heads/main/userscripts/v0.1-diagrams.js` (le dépôt `achma-learning/these` est privé : Greasy Fork ne peut pas le lire). Le dossier `userscripts/` de theses-maroc est une copie identique de celui de `these` : modifier dans `these`, recopier, augmenter `@version` (toujours vers le haut : prochaine version ≥ 1.1.0), fusionner les deux.

## Lancer un script

**Sans rien installer :** ouvrir https://wd.fmpm.uca.ma/biblio/theses/Accueil.html → **F12** → onglet **Console** → coller tout le contenu du fichier → **Entrée**. (Chrome demande parfois de taper `allow pasting` d'abord.) À refaire à chaque visite.

**Avec un gestionnaire de userscripts** (Tampermonkey, Violentmonkey) : nouveau script → coller le fichier → enregistrer. Il se lance ensuite tout seul sur le catalogue. Pour `v0.1-diagrams`, l'installation en un clic depuis [Greasy Fork](https://greasyfork.org/scripts/600588) donne aussi les mises à jour automatiques.

Politesse : une page annuelle à la fois, pause de 400 ms, résultat gardé dans le navigateur (v0.x : 24 h ; v2 : 12 h pour les deux dernières années, 7 jours avant) — bouton **↻ Relire** pour forcer.

## v2-ultra — pour durer sans entretien

Même barre et mêmes diagrammes que v0.1, plus :

- **Années qui suivent le calendrier.** Ruban **🏠 Accueil · 2006 … année en cours** sur l'accueil, chaque page annuelle et chaque PDF ; calculé à chaque page, donc 2027 apparaît seul le 1er janvier 2027. Tant que la faculté n'a pas mis `2027.htm` en ligne, l'année est grisée « pas encore publiée » (sans alerte) et revérifiée deux fois par jour.
- **Cache par année, jamais perdu sur un échec.** Une année qui ne répond pas (coupure, délai de 20 s, erreur HTTP) garde sa dernière bonne copie, utilisée et signalée (« copie du … ») ; une page qui répond sans tableau de thèses (mise en page changée) ou qui perd plus de la moitié de ses lignes est une **anomalie** : l'ancienne copie reste (« Vider le cache » pour accepter la nouvelle liste). Années récentes relues toutes les 12 h, anciennes tous les 7 jours, erreurs réessayées après 15 min. Sur une page annuelle, la page elle-même sert de source pour son année (aucune requête).
- **États visibles.** Ruban : contour plein = à jour, tirets = copie ancienne ou pas encore publiée, ⚠ = erreur ou anomalie (détail en infobulle). Bandeau orange s'il manque quelque chose, avec **Réessayer**. **Diagnostic** (dépliable) : pour chaque année état, thèses, n° max, sans PDF, date de la copie, dernier essai, détail, encodage ; boutons *Relire les années en erreur*, *Tout relire*, *Vider le cache*, *Copier le diagnostic* (texte à joindre à un signalement).
- **Deux exports.** **⬇ CSV brut** = exactement le format de v0 (pour `build_fmpm.py`), et dit si une année manque ; **⬇ CSV résultats** = les résultats affichés (tous, pas seulement les 200 premiers) avec spécialité, option, statut, confiance, spécialité secondaire, signalement (n° partagé, ligne répétée) et lien vers la fiche These2.0.
- **Résultats** : signalements « ⚠ n° partagé » / « ⚠ ligne répétée », lien **These2.0** vers la fiche de la thèse (jury, spécialité).
- **Pages annuelles** : résumé, étiquettes de spécialité et d'erreurs de la liste (comme 1.1.x) ; `2019.htm#n12` surligne la ligne n° 12 (lien utilisé par le bouton des PDF).
- **PDF** (`annee-htm/FT/…`, `art/…`) : petit bouton en bas à gauche, **replié par défaut** — 🏠 · **← Liste 2019** · ▴. Déplié : titre, auteur, spécialité (si déjà en cache), signalements ; **‹ n° précédent / n° suivant ›** (ordre de la liste, un arrêt par fichier, lignes sans PDF sautées) ; **Fiche These2.0** ; résumé (2006-2014) ; **📋 Copier la référence** ; ruban des années. Replié, il ne fait **aucune** requête ; déplié, une seule (la liste de l'année, si elle n'est pas en cache). Son état (replié / déplié) est mémorisé. Si le PDF n'existe pas (page « 404 Not Found » du serveur, ex. 2026-100), il s'ouvre et dit quelle thèse de la liste pointe vers ce lien.
- **Cohabitation** : si v0-stable ou v0.1 tourne aussi, v2 retire leur barre (ou ils s'arrêtent en voyant celle de v2) et conseille de les désactiver.

**Limites connues (honnêtes).** Le bouton des PDF est testé dans le **lecteur PDF de Chromium** (Chrome, Edge, Brave…), script chargé comme un gestionnaire de userscripts le ferait (script de contenu d'extension). **Firefox** ouvre les PDF dans pdf.js, où les userscripts ne s'exécutent pas : pas de bouton là, le reste marche. Tampermonkey et Violentmonkey eux-mêmes ne sont pas pilotables par les tests automatiques : le script n'utilise que `@grant none` (DOM, `fetch` vers le même site, `localStorage`), ce qu'ils fournissent tous. Le classement des spécialités vient du dépôt public ; s'il ne répond pas, la dernière copie sert (date affichée), sinon les diagrammes de spécialités sont masqués et les autres marchent.

**Installer / mettre à jour / revenir en arrière.** Greasy Fork (à créer : nouvelle fiche « synchronisée » depuis `https://github.com/achma-learning/theses-maroc/raw/refs/heads/main/userscripts/v2-ultra.js`) donne l'installation en un clic et les mises à jour automatiques ; en attendant : Tampermonkey → nouveau script → coller le fichier (pas de mise à jour automatique). Désactiver alors v0-stable / v0.1. Revenir en arrière : désactiver v2 et réactiver v0.1-diagrams (Greasy Fork [600588](https://greasyfork.org/scripts/600588)), ou coller une version précédente depuis l'historique GitHub. Le cache de v2 (`fmpm-ultra-v1:*` dans le `localStorage` du site) est séparé de celui de v0.x.

**Tests** ([`tests/run.js`](tests/run.js), Playwright + Chromium) : `node userscripts/tests/run.js` rejoue les pages du site enregistrées le 18/10/2026 (`tests/fixtures/`, encodages d'origine) avec une horloge simulée en **2026 puis 2027** : ruban, lecture et décodage de chaque année, cache, échecs partiels (coupure, HTTP 500), anomalies, 2027 pas encore publiée puis publiée, page annuelle (résumé, étiquettes, `#n36`), recherche et exports, spécialités indisponibles ou expirées, cohabitation avec v0.x, bouton des PDF (replié sans requête, précédent / suivant, n° partagé, PDF absent), et le correctif 1.2.0 de v0.x. `--live` : le vrai site (toutes les années passées lues, ≥ 3 900 thèses, ≥ 3 500 classées) ; `xvfb-run -a … --pdf-live` : un vrai PDF dans le lecteur de Chromium. Le dépôt public lance les tests hors ligne à chaque modification de `userscripts/` et les tests en direct chaque lundi (`.github/workflows/userscripts.yml`) : un échec envoie un e-mail de GitHub, signe que le site de la faculté a changé.

## v0-stable — recherche

![v0-stable : barre de recherche sur le site officiel, recherche « lupus »](captures/v0-stable.png)

## v0.1-diagrams — recherche + diagrammes

La barre reste en haut ; **📊 Diagrammes ↓** descend au pied de page, **↑ Recherche** remonte. Les diagrammes suivent la recherche en cours (toutes les thèses si elle est vide) :

| Diagramme | Ce qu'il montre | Source |
|---|---|---|
| **Thèses par année** | total, temps de calcul, une barre par année — clic = filtrer l'année (recliquer pour retirer) | site officiel |
| **Spécialités FMPM par année** | barres empilées médecine / chirurgie / biologie / non classées ; ligne de chiffres (classées, confirmées, probables, à vérifier, avec spécialité secondaire) ; bouton **Principal / Fractionnel** | classement final du dépôt (barycentre en deux temps : option puis spécialité ; rapporteur 3, catégorie 2, président 1,5, titre 2/1/0,5), liste officielle des 42 spécialités FMPM |
| **Spécialités, par option** | barres triées, une colonne par option ; teinte = statut (foncé confirmée, moyen probable, clair à vérifier) ; trait fin = fourchette « confirmées seules » → « + thèses où la spécialité est secondaire » — clic = filtrer | idem (colonnes `Statut`, `Spécialité secondaire`) |
| **Carte spécialité × année** | 42 lignes × années, case plus foncée = plus de thèses — clic sur une case = spécialité + année | idem |
| **Type d'étude** | expérience d'un service, rétrospective, prospective, à propos de cas, revue de la littérature, enquête… | titre (indicatif) |
| **Hôpitaux et villes cités** | CHU Mohammed VI, Hôpital Militaire Avicenne, Ibn Tofail, Agadir, Safi… | titre (indicatif) |
| **Titres en anglais, par année** | part des thèses de l'année au titre en anglais | titre (indicatif) |
| **Mots les plus fréquents** | 24 mots des titres (hors mots vides et mots déjà cherchés) — clic = ajouter à la recherche | titre |

**Une thèse = une spécialité.** Chaque diagramme totalise le vrai nombre de thèses (la spécialité la plus lourde du barycentre). En mode **Fractionnel**, chaque thèse vaut toujours 1 mais se répartit selon ses parts de masse (colonne `Répartition`, ex. 0,7 médecine interne + 0,3 néphrologie) : le total ne change pas, et le filtre de spécialité inclut aussi les thèses où elle est secondaire. Dans la liste des résultats, l'infobulle de la spécialité donne statut, confiance et parts ; « ? » = pas confirmée.

![v0.1-diagrams : diagrammes en pied de page, toutes les thèses](captures/v0.1-diagrams.png)

Les spécialités viennent du fichier public [`theses-fmpm-specialites.csv`](https://github.com/achma-learning/theses-maroc/blob/main/archive/fmpm/theses-fmpm-specialites.csv) (dépôt `achma-learning/theses-maroc`, chargé une fois, cache 24 h ; statut confirmée / probable / à vérifier en infobulle). Avant la 0.1.2, le script lisait l'ancien fichier « président du jury » et pouvait garder en cache une version à 551 thèses classées. S'il ne répond pas, les autres diagrammes marchent quand même. Méthode : [`archive/specialites/README.md`](../archive/specialites/README.md).

Rien n'est envoyé ailleurs : le script lit le site de la FMPM et ce fichier GitHub, et garde son cache dans le `localStorage` du navigateur.
