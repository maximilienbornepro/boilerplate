/**
 * Module-specific loaders for the left <AppSidebar>. Each loader fetches
 * the elements listed under its module (plannings / boards / documents…)
 * and returns them in the shape expected by the shared component.
 *
 * Loaders are only invoked when the user expands a module, so this file
 * is essentially free on pages that don't display the sidebar or don't
 * expand any module.
 */
import type { ModuleLoader } from '@boilerplate/shared/components';
import { fetchPlannings } from '../modules/roadmap/services/api';
import { fetchBoards } from '../modules/delivery/services/api';
import { fetchDocuments } from '../modules/suivitess/services/api';

/** Sorted asc by label — alphabetical. */
function sortByLabel<T extends { label: string }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }),
  );
}

export const sidebarLoaders: Record<string, ModuleLoader> = {
  roadmap: async () => {
    const plannings = await fetchPlannings();
    return sortByLabel(plannings.map(p => ({
      id: p.id,
      label: p.name,
      path: `/roadmap/${p.id}`,
    })));
  },

  delivery: async () => {
    const boards = await fetchBoards();
    return sortByLabel(boards.map(b => ({
      id: b.id,
      label: b.name,
      path: `/delivery/${b.id}`,
    })));
  },

  suivitess: async () => {
    const docs = await fetchDocuments();
    return sortByLabel(docs.map(d => ({
      id: d.id,
      label: d.title,
      path: `/suivitess/${d.id}`,
    })));
  },
};
