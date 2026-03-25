export const NAV_HEIGHT = 50;
export const THEME_STORAGE_KEY = 'boilerplate-theme';

export type AppCategory = 'main';

export interface CategoryInfo {
  id: AppCategory;
  name: string;
  icon: string;
  description: string;
}

export interface AppInfo {
  id: string;
  name: string;
  description: string;
  color: string;
  gradientEnd: string;
  path: string;
  category: AppCategory;
}

export const CATEGORIES: CategoryInfo[] = [
  { id: 'main', name: 'Applications', icon: '📦', description: 'Modules principaux' },
];

export const APPS: AppInfo[] = [
  {
    id: 'products',
    name: 'Products',
    description: 'Gestion des produits',
    color: '#6366f1',
    gradientEnd: '#8b5cf6',
    path: '/products',
    category: 'main',
  },
  {
    id: 'conges',
    name: 'Conges',
    description: 'Gestion des conges et absences',
    color: '#00bcd4',
    gradientEnd: '#0097a7',
    path: '/conges',
    category: 'main',
  },
  {
    id: 'roadmap',
    name: 'Roadmap',
    description: 'Planification et suivi de projets',
    color: '#8b5cf6',
    gradientEnd: '#6366f1',
    path: '/roadmap',
    category: 'main',
  },
];

export function getAppUrl(appId: string): string {
  const app = APPS.find((a) => a.id === appId);
  if (!app) return '/';
  return app.path;
}

export function getAppsByCategory(category: AppCategory): AppInfo[] {
  return APPS.filter((app) => app.category === category);
}

export function getCategoryForApp(appId: string): CategoryInfo | undefined {
  const app = APPS.find((a) => a.id === appId);
  if (!app) return undefined;
  return CATEGORIES.find((c) => c.id === app.category);
}
