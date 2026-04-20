// Module entry point : init the pool, seed default skills from their markdown
// files (only rows that don't exist yet), expose the admin router.

import { initPool, seedSkill, upsertSkillMetadata, getSkillBySlug } from './dbService.js';
import { initLogsPool } from './analysisLogsService.js';
import { initVersionsPool, ensureSkillVersion } from './skillVersionService.js';
import { initScoresPool } from './scoring/scoringService.js';
import { buildLlmJudge, registerScorer } from './scoring/scorers.js';
import { initEvalPool } from './eval/datasetService.js';
import { recoverOrphanedExperiments } from './eval/experimentService.js';
import { readDefaultFile } from './skillLoader.js';
import { SKILLS } from './registry.js';
import { createRoutes } from './routes.js';

export async function initAiSkills(): Promise<void> {
  await initPool();
  await initLogsPool();
  await initVersionsPool();
  await initScoresPool();
  await initEvalPool();

  // Mark experiments that were running/pending when the previous process
  // died (dev reload, OOM, deploy) as 'error' so the UI isn't stuck showing
  // them as "in progress" forever.
  try {
    const n = await recoverOrphanedExperiments();
    if (n > 0) console.log(`[AiSkills] Recovered ${n} orphaned experiment(s) → marked as error`);
  } catch (err) {
    console.error('[AiSkills] recoverOrphanedExperiments failed:', err);
  }

  for (const def of SKILLS) {
    const content = await readDefaultFile(def);
    const inserted = await seedSkill(def.slug, def.name, def.description, content);
    if (!inserted) {
      // Keep the admin-facing label and description aligned with the registry.
      await upsertSkillMetadata(def.slug, def.name, def.description);
    }

    // Register a baseline version for every skill — whether we just inserted
    // the row or it already existed with a possibly-customized content.
    const row = await getSkillBySlug(def.slug);
    await ensureSkillVersion(def.slug, row?.content ?? content, null);
  }

  // Register the default LLM-judge scorer (uses the editable judge skill).
  registerScorer(buildLlmJudge({
    skillSlug: 'llm-judge-faithfulness',
    id: 'llm-judge:faithfulness/v1',
    name: 'faithfulness',
    appliesToSkills: [
      'suivitess-route-source-to-review',
      'suivitess-import-source-into-document',
      'suivitess-reformulate-subject',
    ],
  }));

  console.log(`[AiSkills] ${SKILLS.length} skill(s) enregistré(s)`);
}

export function createAiSkillsRouter() {
  return createRoutes();
}

export { loadSkill } from './skillLoader.js';
export { logAnalysis, attachProposalsToLog } from './analysisLogsService.js';
export { runSkill } from './runSkill.js';
export { ensureSkillVersion, hashContent, shortHash } from './skillVersionService.js';
