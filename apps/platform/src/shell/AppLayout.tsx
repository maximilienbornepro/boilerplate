/**
 * App-level wrapper around the shared <Layout>. Injects the sidebar
 * loaders automatically so every module gets the left navigation
 * without having to repeat the wiring.
 *
 * Modules should import this instead of `@boilerplate/shared/components`'s
 * Layout when they want the full app chrome (top nav + left sidebar).
 * Pages that explicitly opt out (landing, login, embed) can keep using
 * the bare <Layout> and pass `sidebarLoaders={false}`.
 */
import { Layout, type LayoutProps } from '@boilerplate/shared/components';
import { sidebarLoaders } from './sidebarLoaders';

export function AppLayout(props: Omit<LayoutProps, 'sidebarLoaders'> & { sidebarLoaders?: LayoutProps['sidebarLoaders'] }) {
  const effectiveLoaders = props.sidebarLoaders === undefined ? sidebarLoaders : props.sidebarLoaders;
  return <Layout {...props} sidebarLoaders={effectiveLoaders} />;
}
