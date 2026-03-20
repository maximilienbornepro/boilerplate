export type AppCategory = 'main';

export interface CategoryInfo {
  id: AppCategory;
  name: string;
  icon: string;
  description: string;
}

export interface GatewayApp {
  id: string;
  name: string;
  description: string;
  color: string;
  gradientEnd: string;
  path: string;
  category: AppCategory;
}

export const CATEGORIES: CategoryInfo[] = [
  { id: 'main', name: 'Applications', icon: '📦', description: 'Modules principaux de la plateforme' },
];

export const APPS: GatewayApp[] = [
  {
    id: 'products',
    name: 'Products',
    description: 'Gestion des produits avec CRUD complet',
    color: '#6366f1',
    gradientEnd: '#8b5cf6',
    path: '/products',
    category: 'main',
  },
];

export function getAppUrl(appId: string): string {
  const app = APPS.find(a => a.id === appId);
  if (!app) return '/';
  return `${app.path}/`;
}
