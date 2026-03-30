## 1. Base de données

- [ ] 1.1 Créer `database/init/05_cv_adaptations_schema.sql` avec la table `cv_adaptations` (id, cv_id FK, user_id FK, job_offer TEXT, adapted_cv JSONB, changes JSONB, ats_before JSONB, ats_after JSONB, job_analysis JSONB, name VARCHAR, created_at, updated_at)
- [ ] 1.2 Ajouter index sur `cv_adaptations(cv_id)` et `cv_adaptations(user_id)`

## 2. Backend — Service DB

- [ ] 2.1 Créer `apps/platform/servers/unified/src/modules/mon-cv/adaptationDbService.ts` avec les fonctions : `createAdaptation()`, `getAdaptationsByCV()`, `getAdaptation()`, `updateAdaptation()`, `deleteAdaptation()`
- [ ] 2.2 `getAdaptationsByCV` retourne la liste triée par `created_at DESC` (sans `adapted_cv` pour alléger la liste — juste id, cv_id, name, job_offer (100 chars), ats_after.overall, changes summary, created_at)
- [ ] 2.3 `updateAdaptation` recalcule `ats_after` via `scoreCV()` à partir du `adapted_cv` mis à jour et du `job_analysis` stocké

## 3. Backend — Routes

- [ ] 3.1 Ajouter dans `routes.ts` : `GET /cvs/:id/adaptations` → liste des adaptations
- [ ] 3.2 Ajouter `POST /cvs/:id/adaptations` → créer une adaptation (body: `{ adaptedCvData, changes, atsBefore, atsAfter, jobAnalysis, jobOffer, name? }`)
- [ ] 3.3 Ajouter `GET /adaptations/:id` → détail complet d'une adaptation
- [ ] 3.4 Ajouter `PUT /adaptations/:id` → màj `adapted_cv` + `name` + recalcul `ats_after`
- [ ] 3.5 Ajouter `DELETE /adaptations/:id` → suppression avec vérification `user_id`
- [ ] 3.6 Ajouter `POST /adaptations/:id/pdf` → génère le PDF de `adapted_cv` stocké

## 4. Frontend — Types et API

- [ ] 4.1 Ajouter dans `types/index.ts` : `CVAdaptation` (complet), `CVAdaptationListItem` (allégé pour la liste)
- [ ] 4.2 Ajouter dans `services/api.ts` : `getAdaptations(cvId)`, `createAdaptation(cvId, payload)`, `getAdaptation(id)`, `updateAdaptation(id, payload)`, `deleteAdaptation(id)`, `downloadAdaptationPDF(id, filename)`

## 5. Frontend — Composant AdaptCVPage (modification)

- [ ] 5.1 Modifier `handleValidate()` dans `AdaptCVPage.tsx` : appelle `createAdaptation()` au lieu de `onAdapt()` — passe `adaptedCvData`, `changes`, `atsBefore`, `atsAfter`, `jobAnalysis`, `jobOffer`
- [ ] 5.2 Après création réussie, naviguer vers la liste des adaptations du CV (passer `cvId` via props à `AdaptCVPage`)
- [ ] 5.3 Mettre à jour l'interface `AdaptCVPageProps` : remplacer `onAdapt` par `cvId: number` et `onSaved: (adaptationId: number) => void`
- [ ] 5.4 Mettre à jour tous les appelants de `AdaptCVPage` pour passer `cvId` et `onSaved`

## 6. Frontend — AdaptationsListPage

- [ ] 6.1 Créer `components/AdaptationsListPage/AdaptationsListPage.tsx` : liste des adaptations d'un CV, affiche score ATS, date, aperçu offre, nombre de missions ajoutées
- [ ] 6.2 Créer `components/AdaptationsListPage/AdaptationsListPage.css`
- [ ] 6.3 Bouton "PDF" sur chaque ligne → appelle `downloadAdaptationPDF`
- [ ] 6.4 Bouton "Voir / Éditer" → navigue vers `AdaptationDetailPage`
- [ ] 6.5 Bouton "Supprimer" → confirmation via `ConfirmModal` puis `deleteAdaptation`
- [ ] 6.6 État vide avec CTA "Adapter ce CV"

## 7. Frontend — AdaptationDetailPage

- [ ] 7.1 Créer `components/AdaptationDetailPage/AdaptationDetailPage.tsx` : affiche score ATS avant/après, offre complète, sections éditables (missions, projet, compétences) — réutiliser les composants éditables d'`AdaptCVPage`
- [ ] 7.2 Créer `components/AdaptationDetailPage/AdaptationDetailPage.css`
- [ ] 7.3 Bouton "Sauvegarder" → `updateAdaptation()` avec le contenu édité reconstruit
- [ ] 7.4 Bouton "Télécharger PDF" → `downloadAdaptationPDF`
- [ ] 7.5 Score ATS se recalcule en temps réel à l'édition (réutiliser `computeScoreCV` client-side avec `job_analysis` stocké dans l'adaptation)

## 8. Frontend — Navigation

- [ ] 8.1 Mettre à jour le routeur du module `mon-cv` : ajouter routes `/adaptations/:cvId` et `/adaptations/:cvId/:adaptationId`
- [ ] 8.2 Dans la liste des CVs (`CVListPage` ou équivalent), ajouter un bouton "Adaptations (N)" qui navigue vers `AdaptationsListPage`
- [ ] 8.3 Le compteur "N" est récupéré via `getAdaptations(cvId).length` (ou un champ `adaptations_count` dénormalisé)

## 9. Tests

- [ ] 9.1 Ajouter tests dans `mon-cv.test.ts` : structure de `CVAdaptation`, `CVAdaptationListItem`, logique de reconstruction du CV adapté depuis une adaptation, calcul `ats_after` après édition

## 10. Vérification finale

- [ ] 10.1 `npm test` passe (601+ tests)
- [ ] 10.2 Flux complet : adapter un CV → valider → voir dans la liste → éditer → score mis à jour → PDF téléchargeable
- [ ] 10.3 Le CV original reste inchangé après toute adaptation
