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

// ListEditor
export { ListEditor } from './ListEditor/ListEditor.js';

// TagEditor
export { TagEditor } from './TagEditor/TagEditor.js';

// ExpandableSection
export { ExpandableSection } from './ExpandableSection/ExpandableSection.js';

// ImageUploader
export { ImageUploader } from './ImageUploader/ImageUploader.js';

// Badge
export { Badge } from './Badge/Badge.js';
export type { BadgeProps, BadgeType } from './Badge/Badge.js';

// Button
export { Button } from './Button/Button.js';
export type { ButtonProps, ButtonVariant } from './Button/Button.js';

// Card
export { Card } from './Card/Card.js';
export type { CardProps } from './Card/Card.js';

// FormField
export { FormField } from './FormField/FormField.js';
export type { FormFieldProps } from './FormField/FormField.js';

// ProjectEditor
export { ProjectEditor } from './ProjectEditor/ProjectEditor.js';
export type { ProjectItem, ProjectEditorProps } from './ProjectEditor/ProjectEditor.js';

// Hero
export { Hero } from './Hero/Hero.js';
export type { HeroProps } from './Hero/Hero.js';

// StatCounter
export { StatCounter } from './StatCounter/StatCounter.js';
export type { StatCounterProps, StatItem } from './StatCounter/StatCounter.js';

// Footer
export { Footer } from './Footer/Footer.js';
export type { FooterProps, FooterLinkGroup } from './Footer/Footer.js';

// SectionTitle
export { SectionTitle } from './SectionTitle/SectionTitle.js';
export type { SectionTitleProps } from './SectionTitle/SectionTitle.js';

// Tabs
export { Tabs } from './Tabs/Tabs.js';
export type { TabsProps, TabItem } from './Tabs/Tabs.js';

// Auth hooks
export { useGatewayUser, GatewayAuthProvider } from '../hooks/useGatewayAuth.js';
