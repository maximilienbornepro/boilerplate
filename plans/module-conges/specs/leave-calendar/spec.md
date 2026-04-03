## Exigences ajoutées

### Exigence : Vue calendrier annuelle
Le système DOIT afficher un calendrier année complète montrant tous les membres de l'équipe en lignes et les dates en colonnes. Chaque ligne membre DOIT afficher ses congés sous forme de barres horizontales colorées couvrant les dates de congé.

#### Scénario : Vue par défaut au chargement
- **QUAND** l'utilisateur navigue vers le module Congés
- **ALORS** le calendrier affiche l'année en cours (1er janvier au 31 décembre) avec tous les membres ayant la permission `conges`

#### Scénario : État vide
- **QUAND** aucun utilisateur n'a la permission `conges`
- **ALORS** le calendrier affiche un message indiquant qu'aucun membre n'est disponible

### Exigence : Navigation annuelle
Le système DOIT fournir des contrôles de navigation permettant de passer à l'année précédente ou suivante.

#### Scénario : Naviguer vers l'année précédente
- **QUAND** l'utilisateur clique sur le bouton année précédente
- **ALORS** le calendrier se recharge avec les données de l'année précédente

#### Scénario : Naviguer vers l'année suivante
- **QUAND** l'utilisateur clique sur le bouton année suivante
- **ALORS** le calendrier se recharge avec les données de l'année suivante

#### Scénario : Raccourci aujourd'hui
- **QUAND** l'utilisateur clique sur le bouton "Aujourd'hui"
- **ALORS** le calendrier revient à l'année en cours

### Exigence : Bascule de mode de vue
Le système DOIT supporter deux modes de zoom : `month` (par défaut) et `week`. Le mode de vue contrôle la granularité des colonnes du calendrier.

#### Scénario : Vue mois
- **QUAND** le mode de vue est `month`
- **ALORS** le calendrier affiche les mois en en-têtes de colonnes avec les jours dans chaque mois

#### Scénario : Vue semaine
- **QUAND** le mode de vue est `week`
- **ALORS** le calendrier affiche une vue plus détaillée avec une granularité hebdomadaire

### Exigence : Visualisation des barres de congés
Chaque congé DOIT être rendu sous forme de barre horizontale colorée sur la ligne du membre, utilisant la couleur assignée au membre. Les demi-journées DOIVENT être visuellement distinctes des journées complètes.

#### Scénario : Affichage congé journée complète
- **QUAND** un membre a un congé journée complète sur une date
- **ALORS** la barre remplit entièrement la cellule du jour avec la couleur du membre

#### Scénario : Affichage congé demi-journée
- **QUAND** un congé commence ou se termine avec une période matin/après-midi
- **ALORS** la barre indique visuellement la demi-journée (remplissage partiel)

#### Scénario : Affichage congé multi-jours
- **QUAND** un congé couvre plusieurs jours
- **ALORS** la barre s'étend de manière continue sur tous les jours de la plage
