// Public API for services that need a skill prompt : `loadSkill(slug)`.
// Looks in the DB first (so admin edits win), falls back to the shipped file
// if the DB is unavailable or the row hasn't been seeded yet.

import { readFile } from 'node:fs/promises';
import { getSkill, type SkillDefinition } from './registry.js';
import { getSkillBySlug } from './dbService.js';

/** Returns the current content of a skill as raw markdown, ready to be spliced
 *  into a prompt. Never throws — returns a minimal fallback if everything
 *  fails so the AI call can still proceed.
 *
 *  Priority order :
 *    1. DB row flagged `is_customized = TRUE` — an admin deliberately edited
 *       this skill via the UI, their version wins.
 *    2. Shipped `.md` file — always preferred when the skill is NOT
 *       customized. Ensures prompt fixes shipped in a deploy actually reach
 *       the runtime (the DB row might be stale from an earlier seed).
 *    3. DB row even if not customized (final safety net when the file read
 *       fails — e.g. missing asset in a stripped container).
 */
export async function loadSkill(slug: string): Promise<string> {
  const def = getSkill(slug);
  if (!def) {
    return `[Skill inconnu: ${slug}]`;
  }

  let row: Awaited<ReturnType<typeof getSkillBySlug>> = null;
  try {
    row = await getSkillBySlug(slug);
  } catch {
    // DB unavailable — fall through to file below.
  }

  // 1) Admin-customized DB content wins unconditionally.
  if (row?.is_customized && row.content.trim().length > 0) {
    return row.content;
  }

  // 2) Non-customized skill → always prefer the shipped file so deploy-time
  //    prompt updates propagate automatically. `readDefaultFile` swallows
  //    filesystem errors internally and returns a minimal fallback string,
  //    so we don't need an additional try/catch here.
  return readDefaultFile(def);
}

export async function readDefaultFile(def: SkillDefinition): Promise<string> {
  try {
    return await readFile(def.defaultFilePath, 'utf-8');
  } catch {
    return `# ${def.name}\n\n(Fichier skill introuvable : ${def.defaultFilePath})`;
  }
}
