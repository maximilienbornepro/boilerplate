# Skill — Mon-CV : convertir un CV en version ESN

## À propos de ce skill

- **Slug** : `mon-cv-esn-version`
- **Tier** : 2 (writer / transformation)
- **Où il est utilisé** : bouton « Version ESN » de la CVListPage.
  Crée un nouveau CV (suffixe « · ESN ») dont le contenu est
  réécrit selon le format standard des dossiers de prestation
  (Entreprise de Services du Numérique).

- **Input** : `{ cvData: CVData, initials: string }`
  - `initials` : 2-3 lettres calculées server-side à partir du nom
    complet (ex : « Maximilien Borne » → « MB »). Utilisé partout
    où le CV mentionnerait normalement le prénom.
- **Output** : un objet JSON de la même forme que `CVData`, mais
  reformaté selon les règles ESN décrites plus bas.

## Le format ESN — pourquoi c'est différent

Une ESN propose le profil d'un consultant à un client final. Le
CV est donc :
- **Anonymisé** — pas de nom complet, pas de coordonnées, juste les
  initiales pour identification interne.
- **Rédigé à la 3ᵉ personne** — « MBE est chef de projet… », « Il
  intervient sur… », « Il dispose d'une expérience significative… ».
- **Centré compétences** — un long résumé qui vend le profil, des
  compétences clés bien regroupées.
- **Missions structurées** — pour chaque expérience : un paragraphe
  de **contexte** + une liste de **missions principales** en bullets
  + un **environnement technique** (stack).

## Règles de transformation

### Identité (anonymisation)

- `name` → remplace par les initiales fournies dans `initials`.
- `contact.address`, `contact.city`, `contact.email`, `contact.phone`
  → mets à `""` (vide). Une ESN ne diffuse pas ces infos.
- `profilePhoto` → garde si présente (les ESN affichent souvent une
  photo) ; ne PAS inventer si absente.

### Titre professionnel

- `title` → re-formule en **« Intitulé de poste recherché »** —
  exemple : « Senior Project Manager Android / Streaming Apps ».
  Vise le rôle pour lequel le profil est positionné, pas le rôle
  actuel. Garde court (5-10 mots).

### Résumé du profil (`summary`)

- Doit faire **3 à 5 paragraphes**, à la 3ᵉ personne en utilisant
  les initiales : « MBE est chef de projet senior avec 14 ans
  d'expérience… », « Il intervient principalement sur… », « Il a
  développé une expertise dans… ».
- Mets en avant les expertises **transverses** (volumétrie,
  contextes techniques marquants, méthodologies, langues) plutôt
  que de réciter le parcours.
- Ton **professionnel et factuel**, pas commercial. Pas de
  superlatifs (« exceptionnel », « passionné » → BANNIS).

### Compétences

- Garde les buckets existants (`competences`, `outils`, `dev`,
  `frameworks`, `solutions`, `languages`).
- Tu peux **renommer / regrouper** les items dans des catégories
  plus parlantes pour le client si pertinent — mais en respectant
  les buckets de la structure CVData.
- N'invente AUCUN skill absent du CV original.

### Expériences

Pour chaque `experiences[i]` :

- `title` → garde l'intitulé du poste.
- `company` → garde tel quel.
- `period` → garde tel quel.
- `description` → reformule en UN paragraphe à la 3ᵉ personne qui
  pose le **contexte de la mission** : taille des équipes, enjeux,
  volumétrie, particularités. Exemple :
  > « MBE intervient sur des applications de streaming vidéo à
  > forte audience, couvrant web, mobile et TV connectée dans un
  > contexte OTT critique. »
- `missions` → garde ou reformule chaque mission en **action de
  pilotage** (« Pilotage de… », « Coordination de… », « Validation
  de… », « Animation des… »). Une mission = une ligne courte. Si
  une mission originale est trop longue, garde-la mais nettoie le
  style.
- `projects` → garde inchangé en termes de faits ; reformule
  éventuellement les `description` à la 3ᵉ personne.
- `technologies` → liste les technos clés de la mission, sans
  contexte. Format : array de strings courtes.

### Formations / awards

- Garde la structure et les faits ; tu peux normaliser le
  formatage (« Master en Management... » → « Master Management
  et Technologies de l'Information »).

### Side projects

- Garde inchangé. Si vide, laisse vide.

### Langues

- Liste les langues parlées avec un niveau si présent dans
  l'original (« Anglais : Courant »). Sinon juste le nom.

## Anonymisation rigoureuse — vérifie avant de renvoyer

Avant de retourner le JSON, **relis le résumé et chaque description
d'expérience**. Si tu y trouves :
- le prénom complet → remplace par les initiales
- le nom de famille → remplace par les initiales
- l'email, le téléphone → retire entièrement la phrase
- une adresse postale → retire

## Format de sortie

JSON strict, même structure que `CVData`. Aucun markdown, aucun
préambule, aucune explication.

## Rappel

- 3ᵉ personne avec initiales partout où le candidat est mentionné.
- Coordonnées vidées.
- Résumé long et structurant, ton factuel.
- Chaque expérience = contexte (paragraphe) + missions (bullets) +
  environnement technique (technos).
- Faits préservés, aucune invention.
