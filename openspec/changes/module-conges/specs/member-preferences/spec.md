## Exigences ajoutées

### Exigence : Membres issus des permissions gateway
Les membres affichés dans le calendrier DOIVENT être les utilisateurs ayant la permission `conges` dans le gateway. Aucune inscription séparée n'est nécessaire.

#### Scénario : Lister les membres
- **QUAND** le client envoie `GET /conges/api/members`
- **ALORS** le serveur retourne tous les utilisateurs avec la permission `conges`, incluant leurs préférences de couleur et ordre de tri

#### Scénario : Nouvel utilisateur avec permission
- **QUAND** un utilisateur reçoit la permission `conges` via l'admin gateway
- **ALORS** il apparaît dans la liste des membres avec une couleur et un ordre de tri par défaut

### Exigence : Préférence de couleur utilisateur
Chaque membre DOIT avoir une couleur personnalisable utilisée pour ses barres de congés dans le calendrier. Une couleur par défaut DOIT être attribuée si aucune n'est définie.

#### Scénario : Modifier la couleur d'un membre
- **QUAND** l'utilisateur ouvre le panel équipe et change la couleur d'un membre
- **ALORS** la préférence de couleur est sauvegardée et les barres du calendrier se mettent à jour

#### Scénario : Couleur par défaut
- **QUAND** un membre n'a aucune préférence de couleur définie
- **ALORS** une couleur par défaut est utilisée pour ses barres de calendrier

### Exigence : Préférence d'ordre de tri
Chaque membre DOIT avoir un ordre de tri personnalisable contrôlant sa position dans les lignes du calendrier.

#### Scénario : Modifier l'ordre de tri
- **QUAND** l'utilisateur change l'ordre de tri d'un membre dans le panel équipe
- **ALORS** la ligne du membre se déplace à la nouvelle position dans le calendrier

### Exigence : Interface du panel équipe
Le système DOIT fournir un panel équipe (modale) pour voir tous les membres et gérer leurs préférences d'affichage (couleur, ordre de tri).

#### Scénario : Ouvrir le panel équipe
- **QUAND** l'utilisateur clique sur le bouton "Équipe"
- **ALORS** une modale s'ouvre montrant tous les membres avec leur couleur et ordre de tri actuels

#### Scénario : Fermer le panel équipe
- **QUAND** l'utilisateur ferme le panel équipe
- **ALORS** la modale se ferme et les changements sont déjà sauvegardés (sauvegarde automatique au changement)
