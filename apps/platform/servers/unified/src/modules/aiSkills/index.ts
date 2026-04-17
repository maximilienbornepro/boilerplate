// Module entry point : init the pool, seed default skills from their markdown
// files (only rows that don't exist yet), expose the admin router.

import { initPool, seedSkill, upsertSkillMetadata } from './dbService.js';
import { initLogsPool } from './analysisLogsService.js';
import { readDefaultFile } from './skillLoader.js';
import { SKILLS } from './registry.js';
import { createRoutes } from './routes.js';

export async function initAiSkills(): Promise<void> {
  await initPool();
  await initLogsPool();

  for (const def of SKILLS) {
    const content = await readDefaultFile(def);
    const inserted = await seedSkill(def.slug, def.name, def.description, content);
    if (!inserted) {
      // Keep the admin-facing label and description aligned with the registry.
      await upsertSkillMetadata(def.slug, def.name, def.description);
    }
  }

  console.log(`[AiSkills] ${SKILLS.length} skill(s) enregistré(s)`);
}

export function createAiSkillsRouter() {
  return createRoutes();
}

export { loadSkill } from './skillLoader.js';
export { logAnalysis } from './analysisLogsService.js';
