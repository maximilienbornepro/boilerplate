## Context

Le module `mon-cv` dispose déjà d'un système multi-CV (table `cvs`) et d'une API d'adaptation IA (`/cv/adapt`). Actuellement, le résultat d'une adaptation est soit appliqué directement au CV de base (écrasement), soit perdu si l'utilisateur ne valide pas. Il n'existe aucune persistance de l'historique.

## Goals / Non-Goals

**Goals:**
- Persister chaque adaptation validée comme entité indépendante
- Permettre la consultation, l'édition et le téléchargement de n'importe quelle adaptation passée
- Ne jamais muter le CV de base lors d'une adaptation
- Garder le comportement existant d'`AdaptCVPage` — seul le "Valider" change de sémantique

**Non-Goals:**
- Versioning du CV de base lui-même
- Partage public d'une adaptation (embed)
- Comparaison côte-à-côte de deux adaptations
- Limiter le nombre d'adaptations par CV (pas de quota)

## Decisions

### 1. Table `cv_adaptations` séparée (pas un champ JSON dans `cvs`)

**Décision** : nouvelle table avec FK vers `cvs.id`.

**Pourquoi** : une adaptation est une entité propre avec son propre cycle de vie (édition, suppression). La stocker dans `cvs` briserait la séparation et rendrait les requêtes de liste complexes.

**Alternatif écarté** : champ `adaptations JSONB[]` dans `cvs` — requêtes difficiles, pas de suppression partielle propre.

### 2. Schéma de la table

```sql
CREATE TABLE cv_adaptations (
  id          SERIAL PRIMARY KEY,
  cv_id       INTEGER NOT NULL REFERENCES cvs(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_offer   TEXT NOT NULL,
  adapted_cv  JSONB NOT NULL,          -- CVData adapté (éditable)
  changes     JSONB NOT NULL,          -- { newMissions, newProject, addedSkills }
  ats_before  JSONB NOT NULL,          -- AtsScore avant adaptation
  ats_after   JSONB NOT NULL,          -- AtsScore après adaptation (mis à jour à l'édition)
  job_analysis JSONB NOT NULL,         -- JobAnalysis pour rescoring client-side
  name        VARCHAR(255),            -- optionnel, ex: "Adaptation LinkedIn mars 2026"
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);
```

`user_id` en doublon (dénormalisé depuis `cvs`) pour simplifier les requêtes sans JOIN sur `cvs`.

### 3. "Valider" dans AdaptCVPage → `POST /cvs/:id/adaptations`

**Décision** : `handleValidate()` appelle `createAdaptation()` au lieu d'`onAdapt()` qui mutait le CV de base.

**Conséquence** : le callback `onAdapt` est supprimé de l'interface de `AdaptCVPage`. Après sauvegarde, on navigue vers la liste des adaptations du CV.

### 4. Routes backend

```
GET  /mon-cv-api/cvs/:id/adaptations       — liste des adaptations d'un CV
POST /mon-cv-api/cvs/:id/adaptations       — créer une adaptation
GET  /mon-cv-api/adaptations/:id           — détail d'une adaptation
PUT  /mon-cv-api/adaptations/:id           — màj contenu + ats_after recomputed
DELETE /mon-cv-api/adaptations/:id         — supprimer
POST /mon-cv-api/adaptations/:id/pdf       — générer PDF de l'adaptation
```

Toutes sous `authMiddleware`. Vérification `user_id` sur chaque route.

### 5. Navigation frontend

La page principale du module `mon-cv` liste les CVs. Pour chaque CV :
- Bouton "Adaptations (N)" → `AdaptationsListPage` (liste des adaptations de ce CV)
- Bouton "Adapter" → `AdaptCVPage` (comme avant, mais "Valider" crée une adaptation)

`AdaptationsListPage` → clic sur une adaptation → `AdaptationDetailPage` (lecture + édition + PDF).

## Risks / Trade-offs

- [Rupture de comportement] `onAdapt` callback supprimé → vérifier tous les appelants de `AdaptCVPage` → Mitigation : chercher tous les usages de `onAdapt` avant implémentation
- [Données volumineuses] `adapted_cv` et `job_analysis` sont de gros JSONB → Mitigation : index GIN non nécessaire pour cette phase, la liste utilise uniquement des champs scalaires
- [Réécriture du score à l'édition] Le score `ats_after` doit être recalculé côté serveur lors d'un `PUT` → Mitigation : `scoreCV()` est déjà exporté de `adaptService.ts`, appelable sans IA

## Migration Plan

1. Ajouter `05_cv_adaptations_schema.sql` (auto-exécuté au démarrage Docker)
2. Déployer backend (routes nouvelles, sans breaking change sur les routes existantes)
3. Déployer frontend (AdaptCVPage modifié — les utilisateurs existants ne perdent rien)

Rollback : supprimer la table + retirer les nouvelles routes (les anciennes routes `/cv/adapt` etc. sont inchangées).

## Open Questions

- Faut-il un champ `name` libre sur l'adaptation ? → Oui, optionnel (l'utilisateur peut renommer)
- Limite du nombre d'adaptations par CV ? → Non pour cette phase
