# Userscripts — catalogue officiel des thèses FMPM

Deux scripts qui s'exécutent **sur le site officiel** de la FMPM (https://wd.fmpm.uca.ma/biblio/theses/Accueil.html) : ils relisent en direct toutes les pages annuelles du catalogue, donc ils sont toujours à jour, sans copie intermédiaire.

| Fichier | Version | Ce qu'il ajoute |
|---|---|---|
| [`v0-stable.js`](v0-stable.js) | 1.0.1 | Barre de recherche en haut (toutes les années, sans accents) + bouton **Exporter CSV brut** (pour `archive/fmpm/methode/build_fmpm.py`). Même code que la version publiée sur [Greasy Fork](https://greasyfork.org/scripts/600588) (= `archive/fmpm/methode/fmpm-recherche.user.js`). |
| [`v0.1-diagrams.js`](v0.1-diagrams.js) | 0.1.2 | Tout v0 (barre **en haut**) + **diagrammes dynamiques en pied de page**, recalculés à chaque recherche. |

## Lancer un script

**Sans rien installer :** ouvrir https://wd.fmpm.uca.ma/biblio/theses/Accueil.html → **F12** → onglet **Console** → coller tout le contenu du fichier → **Entrée**. (Chrome demande parfois de taper `allow pasting` d'abord.) À refaire à chaque visite.

**Avec un gestionnaire de userscripts** (Tampermonkey, Violentmonkey) : nouveau script → coller le fichier → enregistrer. Il se lance ensuite tout seul sur le catalogue. Pour `v0-stable`, l'installation en un clic depuis [Greasy Fork](https://greasyfork.org/scripts/600588) donne aussi les mises à jour automatiques.

Politesse : une page annuelle à la fois, pause de 400 ms, résultat gardé 24 h dans le navigateur (bouton **↻ Relire en ligne** pour forcer).

## v0-stable — recherche

![v0-stable : barre de recherche sur le site officiel, recherche « lupus »](captures/v0-stable.png)

## v0.1-diagrams — recherche + diagrammes

La barre reste en haut ; **📊 Diagrammes ↓** descend au pied de page, **↑ Recherche** remonte. Les diagrammes suivent la recherche en cours (toutes les thèses si elle est vide) :

| Diagramme | Ce qu'il montre | Source |
|---|---|---|
| **Thèses par année** | total, temps de calcul, une barre par année — clic = filtrer l'année (recliquer pour retirer) | site officiel |
| **Spécialités FMPM par année** + 3 camemberts | barres empilées médecine / chirurgie / biologie / non classées ; un camembert par option (6 premières spécialités + « Autres »), toutes les spécialités listées dessous — clic = filtrer | classement final du dépôt (vote pondéré rapporteur / catégorie / président / titre, lu sur la page de garde), liste officielle des 42 spécialités FMPM |
| **Type d'étude** | expérience d'un service, rétrospective, prospective, à propos de cas, revue de la littérature, enquête… | titre (indicatif) |
| **Hôpitaux et villes cités** | CHU Mohammed VI, Hôpital Militaire Avicenne, Ibn Tofail, Agadir, Safi… | titre (indicatif) |
| **Titres en anglais, par année** | part des thèses de l'année au titre en anglais | titre (indicatif) |
| **Mots les plus fréquents** | 24 mots des titres (hors mots vides et mots déjà cherchés) — clic = ajouter à la recherche | titre |

![v0.1-diagrams : diagrammes en pied de page, toutes les thèses](captures/v0.1-diagrams.png)

Les spécialités viennent du fichier public [`theses-fmpm-specialites.csv`](https://github.com/achma-learning/theses-maroc/blob/main/archive/fmpm/theses-fmpm-specialites.csv) (dépôt `achma-learning/theses-maroc`, chargé une fois, cache 24 h ; statut confirmée / probable / à vérifier en infobulle). Avant la 0.1.2, le script lisait l'ancien fichier « président du jury » et pouvait garder en cache une version à 551 thèses classées. S'il ne répond pas, les autres diagrammes marchent quand même. Méthode : [`archive/specialites/README.md`](../archive/specialites/README.md).

Rien n'est envoyé ailleurs : le script lit le site de la FMPM et ce fichier GitHub, et garde son cache dans le `localStorage` du navigateur.
