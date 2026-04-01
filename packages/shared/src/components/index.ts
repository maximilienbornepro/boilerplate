// SharedNav
export { SharedNav } from './SharedNav/SharedNav.js';
export type { SharedNavProps } from './SharedNav/SharedNav.js';
export { useSharedTheme } from './SharedNav/useSharedTheme.js';
export { APPS, CATEGORIES, NAV_HEIGHT, THEME_STORAGE_KEY, getAppUrl, getAppsByCategory, getCategoryForApp } from './SharedNav/constants.js';
export type { AppInfo, AppCategory, CategoryInfo } from './SharedNav/constants.js';

// Layout
export { Layout } from './Layout/Layout.js';
export type { LayoutProps, LayoutVariant } from './Layout/Layout.js';

// Modal
export { Modal } from './Modal/Modal.js';
export type { ModalProps } from './Modal/Modal.js';

// ConfirmModal
export { ConfirmModal } from './ConfirmModal/ConfirmModal.js';

// Toast
export { Toast, ToastContainer } from './Toast/Toast.js';
export type { ToastData } from './Toast/Toast.js';

// LoadingSpinner
export { LoadingSpinner } from './LoadingSpinner/LoadingSpinner.js';

// ModuleHeader
export { ModuleHeader } from './ModuleHeader/ModuleHeader.js';
export type { ModuleHeaderProps } from './ModuleHeader/ModuleHeader.js';

// Auth hooks
export { useGatewayAuth, AuthGuard, useGatewayUser, GatewayAuthProvider } from '../hooks/useGatewayAuth.js';
