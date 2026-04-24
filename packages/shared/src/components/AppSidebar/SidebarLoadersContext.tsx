/**
 * Context bridge for module loaders used by <AppSidebar>.
 *
 * The shared <Layout> reads the loaders from this context when the
 * consumer doesn't pass `sidebarLoaders` explicitly. Apps can wire the
 * loaders once at the top level (main.tsx / App.tsx) and every Layout
 * instance below picks them up automatically — no need to touch every
 * module that renders its own <Layout>.
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { ModuleLoader } from './AppSidebar.js';

const SidebarLoadersContext = createContext<Record<string, ModuleLoader> | null>(null);

export interface SidebarLoadersProviderProps {
  loaders: Record<string, ModuleLoader>;
  children: ReactNode;
}

export function SidebarLoadersProvider({ loaders, children }: SidebarLoadersProviderProps) {
  return (
    <SidebarLoadersContext.Provider value={loaders}>{children}</SidebarLoadersContext.Provider>
  );
}

export function useSidebarLoaders(): Record<string, ModuleLoader> | null {
  return useContext(SidebarLoadersContext);
}
