# Spec — transcript-ai-suggestions

## Comportement

Après la fin d'un call enregistré, le système compare automatiquement la transcription complète avec le contenu actuel du document suivitess, et génère des suggestions de complétion via Claude.

## Scénarios

### QUAND le call se termine et qu'au moins 5 répliques ont été capturées
ALORS le système génère des suggestions IA automatiquement
ET le statut passe à "Traitement..."
ET le badge change en "N suggestions disponibles" à la fin

### QUAND le document est vide (aucune note prise pendant le call)
ALORS les suggestions couvrent les principaux sujets de la transcription
ET chaque sujet de discussion devient une suggestion de type "new-subject"

### QUAND le document contient des notes
ALORS l'IA compare les notes avec la transcription
ET suggère des compléments pour les sujets partiellement documentés (type "update-situation")
ET propose les sujets manquants non documentés (type "new-subject")
ET n'ajoute pas de doublons pour ce qui est déjà dans les notes

### QUAND la transcription est trop longue (> 50 000 caractères)
ALORS la transcription est tronquée aux 50 000 premiers caractères pour l'analyse IA

### QUAND aucune réplique n'a été capturée (sous-titres non disponibles)
ALORS aucune suggestion n'est générée
ET un message "Aucune transcription disponible — sous-titres non activés ?" est affiché

## Types de suggestions

| Type | Description |
|------|-------------|
| `new-subject` | Un sujet discuté non présent dans les notes |
| `update-situation` | Une décision/information à ajouter à la situation d'un sujet existant |
| `new-section` | Une thématique entière non couverte dans les notes |

## Contraintes

- Maximum 20 suggestions par call (pour éviter de surcharger l'utilisateur)
- Chaque suggestion doit inclure un `rationale` en français expliquant pourquoi elle est proposée
- Les suggestions sont associées au document et à l'enregistrement — pas à l'utilisateur
