// Central registry of AI skills. Each skill is a markdown file shipped with
// the repository (default content) and may be overridden via the admin UI
// (stored in the `ai_skills` table). The `slug` is the stable id used in code
// and in the DB — renaming the file does not break anything as long as the
// slug stays the same.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const MODULES_DIR = (() => {
  // src/modules/aiSkills/registry.ts → src/modules
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..');
})();

export interface SkillDefinition {
  /** Stable id used in code and DB. Never rename once deployed. */
  slug: string;
  /** Human label shown in the admin UI. */
  name: string;
  /** One-line summary shown in the admin list. */
  description: string;
  /** Where and when it runs — helps admins understand the impact of an edit. */
  usage: {
    /** Which module owns it. */
    module: 'suivitess' | 'delivery';
    /** Backend endpoint that invokes it. */
    endpoint: string;
    /** User action that triggers it. */
    trigger: string;
  };
  /** Absolute path to the default markdown file. */
  defaultFilePath: string;
}

export const SKILLS: readonly SkillDefinition[] = [
  {
    slug: 'suivitess-route-source-to-review',
    name: 'SuiviTess — Router une source vers la bonne review',
    description:
      'Page listing SuiviTess : analyse une transcription / mail / Slack et décide dans QUELLE review et QUELLE section chaque sujet doit aller. Détecte les doublons avec les sujets existants.',
    usage: {
      module: 'suivitess',
      endpoint: 'POST /suivitess/api/transcription/analyze-and-route',
      trigger: 'Import en masse depuis la page listing (BulkTranscriptionImportModal)',
    },
    defaultFilePath: resolve(MODULES_DIR, 'suivitess/skill-route-source-to-review.md'),
  },
  {
    slug: 'suivitess-import-source-into-document',
    name: 'SuiviTess — Intégrer une source dans un suivitess ouvert',
    description:
      'Page d\'un suivitess : analyse une transcription / mail / Slack et propose d\'enrichir les sujets existants ou de créer de nouveaux sujets / sections dans le document courant.',
    usage: {
      module: 'suivitess',
      endpoint: 'POST /suivitess/api/documents/:docId/transcript-analyze-and-propose (et .../content-analyze-and-propose)',
      trigger: 'Assistant d\'import dans un suivitess (TranscriptionWizard — bouton « Analyser et fusionner »)',
    },
    defaultFilePath: resolve(MODULES_DIR, 'suivitess/skill-import-source-into-document.md'),
  },
  {
    slug: 'suivitess-reformulate-subject',
    name: 'SuiviTess — Reformuler un sujet',
    description:
      'Reformule le titre et la situation d\'un sujet pour plus de clarté, sans rien supprimer ni changer le sens.',
    usage: {
      module: 'suivitess',
      endpoint: 'POST /suivitess/api/subjects/:id/reformulate',
      trigger: 'Bouton « Reformuler avec l\'IA » sur un sujet',
    },
    defaultFilePath: resolve(MODULES_DIR, 'suivitess/skill-reformulate-subject.md'),
  },
  {
    slug: 'delivery-reorganize-board',
    name: 'Delivery — Réorganiser un board',
    description:
      'Analyse un delivery board et propose un plan de réorganisation colonne par colonne selon statut, estimation et version fix des tickets externes (Jira, ClickUp, Linear, ...).',
    usage: {
      module: 'delivery',
      endpoint: 'POST /delivery/api/boards/:id/ai-sanity-check',
      trigger: 'Bouton « Vérifier avec l\'IA » sur un delivery board',
    },
    defaultFilePath: resolve(MODULES_DIR, 'delivery/skill-reorganize-board.md'),
  },
  {
    slug: 'llm-judge-faithfulness',
    name: 'Juge IA — Fidélité de l\'output',
    description:
      'Scorer llm-judge : évalue la fidélité factuelle d\'un output IA par rapport à son input source. Utilisé automatiquement dans le scoring des logs.',
    usage: {
      module: 'suivitess',
      endpoint: 'Interne — invoqué par POST /ai-skills/api/logs/:id/rescore',
      trigger: 'Auto-scoring des logs ou clic admin « Relancer scorers »',
    },
    defaultFilePath: resolve(MODULES_DIR, 'aiSkills/skill-llm-judge-faithfulness.md'),
  },
] as const;

export function getSkill(slug: string): SkillDefinition | undefined {
  return SKILLS.find(s => s.slug === slug);
}
