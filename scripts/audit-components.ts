#!/usr/bin/env npx tsx
/**
 * Audit components usage across the boilerplate — single source of truth
 * feeding the /design-system page.
 *
 * SCOPE (user-scoped — intentionally narrow to the modules we actively ship) :
 *   - Landing (gateway LandingPage)
 *   - Roadmap / Congés / Delivery / SuiviTess modules
 *
 * WHAT IT DOES :
 *   1. Parse every .tsx/.ts file in the scope.
 *   2. Extract imports from `@boilerplate/shared/components` → the shared
 *      components actually pulled in (not just available).
 *   3. Count JSX usages per shared component per module.
 *   4. Discover local components : any file matching
 *      `<module>/components/<Name>/<Name>.tsx` or
 *      `<module>/components/<Name>.tsx`.
 *   5. Detect local components whose name hints at a generic pattern
 *      already shared (Dropdown, Modal, …) — potential duplicates.
 *   6. Read shared exports from `packages/shared/src/components/index.ts`
 *      and flag the ones with 0 usage in scope (archivable).
 *
 * OUTPUT : `design-system.data.json` at the repo root, consumed by
 * `apps/platform/src/modules/design-system/App.tsx`.
 *
 * RUN : `npm run audit:components` (added to package.json).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Paths ────────────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(ROOT, 'apps/platform/src/modules');
const SHARED_INDEX = path.join(ROOT, 'packages/shared/src/components/index.ts');
const OUTPUT = path.join(ROOT, 'design-system.data.json');

// ── Audit scope ──────────────────────────────────────────────────────────────
interface ModuleScope {
  id: string;
  label: string;
  /** Module colour — used as accent in the design-system grouping. */
  color: string;
  /** Root folder (relative to SRC_ROOT). */
  root: string;
  /** Optional : restrict to a single file (for Landing which isn't a full module). */
  file?: string;
}

const SCOPE: ModuleScope[] = [
  { id: 'landing',   label: 'Landing (accueil)', color: '#00bcd4', root: 'gateway',   file: 'components/LandingPage.tsx' },
  { id: 'conges',    label: 'Congés',            color: '#ec4899', root: 'conges' },
  { id: 'roadmap',   label: 'Roadmap',           color: '#8b5cf6', root: 'roadmap' },
  { id: 'delivery',  label: 'Delivery',          color: '#ff9800', root: 'delivery' },
  { id: 'suivitess', label: 'SuiviTess',         color: '#10b981', root: 'suivitess' },
];

// ── Types ────────────────────────────────────────────────────────────────────
interface FileInfo {
  absPath: string;
  relPath: string;    // relative to SRC_ROOT
  moduleId: string;
}

interface SharedImportUsage {
  /** Shared component name (e.g. "Button") */
  name: string;
  /** How many JSX usages we found for this component, per module. */
  usagesByModule: Record<string, number>;
  /** Modules that import this component. */
  modules: string[];
  /** Total usages across all in-scope modules. */
  total: number;
}

interface LocalComponent {
  name: string;
  moduleId: string;
  /** Relative file path (from repo root). */
  file: string;
  /** JSX usages of this component across the codebase. */
  usages: number;
  /** Set when the name hints at a generic pattern (Dropdown, Modal, …). */
  possibleDuplicateOf: string | null;
}

interface AuditResult {
  generatedAt: string;
  scope: Array<{ id: string; label: string; color: string }>;
  shared: {
    /** Every component exported by `packages/shared/src/components/index.ts`. */
    exported: string[];
    /** Components actually imported somewhere in-scope. */
    used: SharedImportUsage[];
    /** Components exported but never imported in-scope → archivable. */
    unused: string[];
  };
  localByModule: Record<string, LocalComponent[]>;
  /** Components in 2+ modules whose names are variations of the same pattern.
   *  Hints at refactor-to-shared candidates. */
  duplicates: Array<{
    pattern: string;
    implementations: Array<{ module: string; name: string; file: string }>;
  }>;
  /** Per-module totals. */
  stats: Array<{
    moduleId: string;
    fileCount: number;
    sharedImportsCount: number;
    localComponentsCount: number;
  }>;
}

// ── File walker ──────────────────────────────────────────────────────────────
function walk(dir: string, filter: (p: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    const entries = fs.readdirSync(cur, { withFileTypes: true });
    for (const entry of entries) {
      const p = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        // skip common noise
        if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue;
        stack.push(p);
      } else if (entry.isFile() && filter(p)) {
        out.push(p);
      }
    }
  }
  return out;
}

function isSourceFile(p: string): boolean {
  return (p.endsWith('.tsx') || p.endsWith('.ts')) && !p.endsWith('.d.ts') && !p.endsWith('.test.ts') && !p.endsWith('.test.tsx');
}

// ── Collect files per module ─────────────────────────────────────────────────
function collectFiles(): FileInfo[] {
  const files: FileInfo[] = [];
  for (const mod of SCOPE) {
    const moduleRoot = path.join(SRC_ROOT, mod.root);
    if (mod.file) {
      const abs = path.join(moduleRoot, mod.file);
      if (fs.existsSync(abs)) {
        files.push({ absPath: abs, relPath: path.relative(SRC_ROOT, abs), moduleId: mod.id });
      }
    } else {
      const found = walk(moduleRoot, isSourceFile);
      for (const abs of found) {
        files.push({ absPath: abs, relPath: path.relative(SRC_ROOT, abs), moduleId: mod.id });
      }
    }
  }
  return files;
}

// ── Parsing helpers ──────────────────────────────────────────────────────────
/**
 * Extract all named imports from a given source module spec.
 * Handles multi-line `import { A, B, type C } from 'module'` blocks.
 */
function extractImports(src: string, fromSpec: RegExp): string[] {
  const names = new Set<string>();
  // Match `import { ... } from '<fromSpec>'` — allow multi-line.
  const re = new RegExp(
    `import\\s+(?:type\\s+)?\\{([^}]+)\\}\\s+from\\s+['\"]([^'\"]+)['\"]`,
    'g',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const [, namesBlock, spec] = m;
    if (!fromSpec.test(spec)) continue;
    for (const raw of namesBlock.split(',')) {
      const clean = raw.replace(/\btype\s+/, '').trim().split(/\s+as\s+/)[0].trim();
      if (clean && /^[A-Z]/.test(clean)) {
        names.add(clean);
      }
    }
  }
  return [...names];
}

/** Count JSX usages (`<Component`) of each name in src. */
function countJsxUsages(src: string, names: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const name of names) {
    // `<Name` followed by space, newline, slash, or `>`. Avoids matching
    // substrings like `<NameSubPart>`.
    const re = new RegExp(`<${name}(?:[\\s/>])`, 'g');
    const matches = src.match(re);
    counts[name] = matches ? matches.length : 0;
  }
  return counts;
}

// ── Local components discovery ───────────────────────────────────────────────
/**
 * Patterns we consider as "clearly shareable" when duplicated across modules.
 * Intentionally omits patterns that ALREADY exist in `packages/shared/`
 * (Modal, Card, Tabs, LoadingSpinner, FormField, Badge) — local components
 * whose name contains those words are typically *users* of the shared one
 * (e.g. `BulkTranscriptionImportModal` wraps `<Modal>`), not duplicates.
 *
 * Each hint uses word-boundary matching so `DropdownMenu` matches `Dropdown`
 * but `DocumentSelector` doesn't match `Select` (capital-S boundary).
 */
const SHAREABLE_PATTERN_HINTS: Array<{ pattern: string; regex: RegExp }> = [
  { pattern: 'Dropdown',         regex: /Dropdown/ },
  { pattern: 'EmptyState',       regex: /EmptyState/ },
  { pattern: 'SegmentedControl', regex: /Segment(ed)?(Control|Button|Bar)?$/ },
  { pattern: 'Tooltip',          regex: /Tooltip/ },
  { pattern: 'Banner',           regex: /Banner/ },
  { pattern: 'CodeBlock',        regex: /CodeBlock/ },
  { pattern: 'StepsIndicator',   regex: /(Steps|Progress)(Indicator|Bar)?$/ },
  { pattern: 'HeaderMenu',       regex: /(Header|Actions?)Menu$/ },
  { pattern: 'InlineEditor',     regex: /Inline[A-Z][a-z]+Editor$/ },
];

function detectPatternHint(componentName: string): string | null {
  for (const { pattern, regex } of SHAREABLE_PATTERN_HINTS) {
    if (regex.test(componentName)) return pattern;
  }
  return null;
}

/**
 * Discover local components per module : files matching `components/<Name>/<Name>.tsx`
 * or `components/<Name>.tsx`.
 */
function discoverLocals(files: FileInfo[]): Record<string, LocalComponent[]> {
  const out: Record<string, LocalComponent[]> = {};
  for (const mod of SCOPE) out[mod.id] = [];

  for (const f of files) {
    // Accept `components/X/X.tsx` (nested folder) or `components/X.tsx`
    const nested = f.relPath.match(/components\/([A-Z][A-Za-z0-9]+)\/\1\.tsx$/);
    const flat   = f.relPath.match(/components\/([A-Z][A-Za-z0-9]+)\.tsx$/);
    const match = nested || flat;
    if (!match) continue;
    const name = match[1];
    // Skip helper files by nothing — the regex already filters by PascalCase.

    out[f.moduleId].push({
      name,
      moduleId: f.moduleId,
      file: path.relative(ROOT, f.absPath),
      usages: 0, // filled later
      possibleDuplicateOf: detectPatternHint(name),
    });
  }
  return out;
}

// ── Shared index parsing ─────────────────────────────────────────────────────
function parseSharedExports(): string[] {
  if (!fs.existsSync(SHARED_INDEX)) return [];
  const src = fs.readFileSync(SHARED_INDEX, 'utf-8');
  const names = new Set<string>();
  // Match `export { A, B, C } from '...'` and `export { A } from '...'`
  // BUT skip `export type { ... } from` — those are TypeScript types, not
  // runtime components.
  const re = /export\s+(type\s+)?\{([^}]+)\}\s+from/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const isTypeOnly = !!m[1];
    if (isTypeOnly) continue; // whole block is type exports — skip entirely
    for (const raw of m[2].split(',')) {
      // Per-name `type` prefix (mixed value/type export) — drop those.
      if (/\btype\s+/.test(raw)) continue;
      const clean = raw.trim().split(/\s+as\s+/)[0].trim();
      // Component = PascalCase identifier.
      if (clean && /^[A-Z][A-Za-z0-9]*$/.test(clean)) {
        names.add(clean);
      }
    }
  }
  // Remove enum/constant/provider exports heuristically :
  //   - ends with Props/Variant/Size/Type/Handle/Config/Item/Link/Group/Info/Data/Category
  //   - fully upper-case (constants like APPS, CATEGORIES, NAV_HEIGHT)
  //   - ends with Provider (React provider, not a UI primitive)
  const TYPE_SUFFIXES = /(Props|Variant|Size|Type|Handle|Config|Item|Link|Group|Info|Data|Category|Provider)$/;
  const ALL_CAPS = /^[A-Z][A-Z0-9_]*$/;
  return [...names].filter(n => !TYPE_SUFFIXES.test(n) && !ALL_CAPS.test(n));
}

// ── Main audit ───────────────────────────────────────────────────────────────
function audit(): AuditResult {
  const files = collectFiles();
  const sharedExported = parseSharedExports();
  const sharedExportedSet = new Set(sharedExported);

  // shared import map: name → { modules: Set, usagesByModule: Record }
  const sharedMap = new Map<string, { modules: Set<string>; usagesByModule: Record<string, number>; total: number }>();

  // Build local components map first so we can count their usages too.
  const localByModule = discoverLocals(files);
  const localNamesByModule = new Map<string, Set<string>>();
  for (const [mod, list] of Object.entries(localByModule)) {
    localNamesByModule.set(mod, new Set(list.map(l => l.name)));
  }

  // Per-file pass.
  for (const f of files) {
    const src = fs.readFileSync(f.absPath, 'utf-8');

    // 1. Shared imports used in this file.
    const sharedNames = extractImports(src, /@boilerplate\/shared\/components/)
      .filter(n => sharedExportedSet.has(n));
    const sharedCounts = countJsxUsages(src, sharedNames);

    for (const name of sharedNames) {
      let entry = sharedMap.get(name);
      if (!entry) {
        entry = { modules: new Set(), usagesByModule: {}, total: 0 };
        sharedMap.set(name, entry);
      }
      entry.modules.add(f.moduleId);
      const count = sharedCounts[name] ?? 0;
      entry.usagesByModule[f.moduleId] = (entry.usagesByModule[f.moduleId] || 0) + count;
      entry.total += count;
    }

    // 2. Local component usages — only count in the module they belong to.
    const localNames = [...(localNamesByModule.get(f.moduleId) ?? [])];
    if (localNames.length > 0) {
      const counts = countJsxUsages(src, localNames);
      for (const [name, count] of Object.entries(counts)) {
        if (count <= 0) continue;
        const entry = localByModule[f.moduleId].find(l => l.name === name);
        if (entry) entry.usages += count;
      }
    }
  }

  // Build `used` array, sorted by total usages desc.
  const used: SharedImportUsage[] = [...sharedMap.entries()]
    .map(([name, { modules, usagesByModule, total }]) => ({
      name,
      modules: [...modules].sort(),
      usagesByModule,
      total,
    }))
    .sort((a, b) => b.total - a.total);

  const unused = sharedExported.filter(n => !sharedMap.has(n)).sort();

  // Detect duplicates : same pattern hint appearing in ≥2 modules.
  const byPattern = new Map<string, Array<{ module: string; name: string; file: string }>>();
  for (const [modId, comps] of Object.entries(localByModule)) {
    for (const c of comps) {
      if (!c.possibleDuplicateOf) continue;
      const arr = byPattern.get(c.possibleDuplicateOf) ?? [];
      arr.push({ module: modId, name: c.name, file: c.file });
      byPattern.set(c.possibleDuplicateOf, arr);
    }
  }
  const duplicates = [...byPattern.entries()]
    .filter(([, list]) => new Set(list.map(l => l.module)).size >= 2)
    .map(([pattern, list]) => ({ pattern, implementations: list.sort((a, b) => a.module.localeCompare(b.module)) }));

  // Drop local components with 0 usages (dead files) — they're noise.
  for (const modId of Object.keys(localByModule)) {
    localByModule[modId] = localByModule[modId]
      .filter(c => c.usages > 0)
      .sort((a, b) => b.usages - a.usages);
  }

  // Per-module stats.
  const stats = SCOPE.map(mod => ({
    moduleId: mod.id,
    fileCount: files.filter(f => f.moduleId === mod.id).length,
    sharedImportsCount: used.filter(u => u.modules.includes(mod.id)).length,
    localComponentsCount: localByModule[mod.id].length,
  }));

  return {
    generatedAt: new Date().toISOString(),
    scope: SCOPE.map(({ id, label, color }) => ({ id, label, color })),
    shared: {
      exported: sharedExported.sort(),
      used,
      unused,
    },
    localByModule,
    duplicates,
    stats,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main(): void {
  console.log('▶ Auditing components in scope:');
  for (const m of SCOPE) console.log(`  · ${m.label}`);

  const result = audit();

  fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2) + '\n');
  console.log(`\n✓ Written: ${path.relative(ROOT, OUTPUT)}`);
  console.log(`  Shared components in scope:  ${result.shared.used.length} used / ${result.shared.exported.length} exported`);
  console.log(`  Unused shared exports:       ${result.shared.unused.length} (${result.shared.unused.join(', ') || '—'})`);
  console.log(`  Local components:            ${Object.values(result.localByModule).flat().length}`);
  console.log(`  Detected duplicates:         ${result.duplicates.length}`);
  for (const d of result.duplicates) {
    console.log(`    · ${d.pattern}: ${d.implementations.map(i => `${i.module}/${i.name}`).join(', ')}`);
  }
}

main();
