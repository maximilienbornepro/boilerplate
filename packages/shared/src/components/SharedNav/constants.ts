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
    id: 'conges',
    name: 'Congés',
    description: 'Gestion des congés et absences',
    color: '#ec4899',
    gradientEnd: '#db2777',
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
  {
    id: 'suivitess',
    name: 'SuiviTess',
    description: 'Suivi et revue de documents',
    color: '#10b981',
    gradientEnd: '#059669',
    path: '/suivitess',
    category: 'main',
  },
  {
    id: 'delivery',
    name: 'Delivery',
    description: 'Planification de sprint et suivi de livraison',
    color: '#ff9800',
    gradientEnd: '#f57c00',
    path: '/delivery',
    category: 'main',
  },
  {
    id: 'mon-cv',
    name: 'Mon CV',
    description: 'Gestion et adaptation de CV avec IA',
    color: '#6366f1',
    gradientEnd: '#4f46e5',
    path: '/mon-cv',
    category: 'main',
  },
  {
    id: 'rag',
    name: 'Assistant RAG',
    description: 'Chat intelligent sur vos documents et Confluence',
    color: '#f59e0b',
    gradientEnd: '#d97706',
    path: '/rag',
    category: 'main',
  },
  {
    id: 'design-system',
    name: 'Design System',
    description: 'Tokens, couleurs, typographie et composants',
    color: '#00bcd4',
    gradientEnd: '#0097a7',
    path: '/design-system',
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
