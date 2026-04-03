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

// Button
export { Button } from './Button/Button.js';
export type { ButtonProps, ButtonVariant } from './Button/Button.js';
export type { BadgeProps, BadgeType } from './Badge/Badge.js';

// Card
export { Card } from './Card/Card.js';
export type { CardProps } from './Card/Card.js';

// FormField
export { FormField } from './FormField/FormField.js';
export type { FormFieldProps } from './FormField/FormField.js';

// ToggleGroup
export { ToggleGroup } from './ToggleGroup/ToggleGroup.js';
export type { ToggleGroupProps, ToggleOption } from './ToggleGroup/ToggleGroup.js';

// ProjectEditor
export { ProjectEditor } from './ProjectEditor/ProjectEditor.js';
export type { ProjectItem, ProjectEditorProps } from './ProjectEditor/ProjectEditor.js';

// MenuDropdown
export { MenuDropdown } from './MenuDropdown/MenuDropdown.js';
export type { MenuDropdownItem, MenuDropdownProps } from './MenuDropdown/MenuDropdown.js';

// InlineEdit
export { InlineEdit } from './InlineEdit/InlineEdit.js';
export type { InlineEditProps } from './InlineEdit/InlineEdit.js';

// FileDragDropZone
export { FileDragDropZone } from './FileDragDropZone/FileDragDropZone.js';
export type { FileDragDropZoneProps } from './FileDragDropZone/FileDragDropZone.js';

// ScoreBlock
export { ScoreBlock } from './ScoreBlock/ScoreBlock.js';
export type { ScoreBlockProps, ScoreMetric } from './ScoreBlock/ScoreBlock.js';

// ActionCard
export { ActionCard } from './ActionCard/ActionCard.js';
export type { ActionCardProps } from './ActionCard/ActionCard.js';

// RecommendationItem
export { RecommendationItem } from './RecommendationItem/RecommendationItem.js';
export type { RecommendationItemProps } from './RecommendationItem/RecommendationItem.js';

// SectionTitle
export { SectionTitle } from './SectionTitle/SectionTitle.js';
export type { SectionTitleProps } from './SectionTitle/SectionTitle.js';

// Tabs
export { Tabs } from './Tabs/Tabs.js';
export type { TabsProps, TabItem } from './Tabs/Tabs.js';

// Hooks
export { useAutoResize, autoResizeElement } from '../hooks/useAutoResize.js';

// Auth hooks
export { useGatewayAuth, AuthGuard, useGatewayUser, GatewayAuthProvider } from '../hooks/useGatewayAuth.js';
