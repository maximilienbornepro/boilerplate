import { useState } from 'react';
import { ModuleHeader, Card, SectionTitle } from '@boilerplate/shared/components';
import { useSharedTheme } from '@boilerplate/shared/components';
import { AdminPage } from '../AdminPage';
import { ConnectorsPage } from '../ConnectorsPage';
import './SettingsPage.css';

interface SettingsUser {
  isAdmin: boolean;
}

interface SettingsPageProps {
  onBack: () => void;
  user?: SettingsUser | null;
}

export function SettingsPage({ onBack, user }: SettingsPageProps) {
  const { theme, setTheme } = useSharedTheme();
  const [activeSection, setActiveSection] = useState<'theme' | 'admin' | 'connectors' | null>(null);

  if (activeSection === 'admin') {
    return <AdminPage onBack={() => setActiveSection(null)} />;
  }

  if (activeSection === 'connectors') {
    return <ConnectorsPage onBack={() => setActiveSection(null)} />;
  }

  return (
    <>
      <ModuleHeader title="Réglages" onBack={onBack} />

      <div className="settings-page">
        {/* Theme */}
        <section className="settings-section">
          <SectionTitle>Apparence</SectionTitle>
          <div className="settings-theme-cards">
            <Card
              variant="interactive"
              selected={theme === 'dark'}
              onClick={() => setTheme('dark')}
              className="settings-theme-card"
            >
              <div className="settings-theme-preview settings-theme-preview--dark">
                <div className="settings-theme-bar" />
                <div className="settings-theme-content">
                  <div className="settings-theme-line" />
                  <div className="settings-theme-line settings-theme-line--short" />
                </div>
              </div>
              <span className="settings-theme-label">Sombre</span>
            </Card>
            <Card
              variant="interactive"
              selected={theme === 'light'}
              onClick={() => setTheme('light')}
              className="settings-theme-card"
            >
              <div className="settings-theme-preview settings-theme-preview--light">
                <div className="settings-theme-bar" />
                <div className="settings-theme-content">
                  <div className="settings-theme-line" />
                  <div className="settings-theme-line settings-theme-line--short" />
                </div>
              </div>
              <span className="settings-theme-label">Clair</span>
            </Card>
          </div>
        </section>

        {/* Admin & Connectors */}
        <section className="settings-section">
          <SectionTitle>Configuration</SectionTitle>
          <div className="settings-list">
            {user?.isAdmin && (
              <Card variant="interactive" onClick={() => setActiveSection('admin')} className="settings-item-card">
                <div className="shared-card__icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </div>
                <div className="shared-card__content">
                  <span className="shared-card__title">Administration</span>
                  <span className="shared-card__subtitle">Gestion des utilisateurs et permissions</span>
                </div>
                <div className="shared-card__arrow">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </Card>
            )}

            <Card variant="interactive" onClick={() => setActiveSection('connectors')} className="settings-item-card">
              <div className="shared-card__icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </div>
              <div className="shared-card__content">
                <span className="shared-card__title">Connecteurs</span>
                <span className="shared-card__subtitle">Configuration des services externes (Jira, Notion...)</span>
              </div>
              <div className="shared-card__arrow">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </Card>
          </div>
        </section>
      </div>
    </>
  );
}
