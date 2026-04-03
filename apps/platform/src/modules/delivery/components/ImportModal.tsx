import { useState } from 'react';
import type { ActiveConnector } from '../services/api';
import { JiraImportModal } from './JiraImportModal';
import styles from './ImportModal.module.css';

const CONNECTOR_META: Record<string, { name: string; color: string; icon: JSX.Element }> = {
  jira: { name: 'Jira', color: '#0052CC', icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.94 4.34 4.34 4.35V2.84a.84.84 0 0 0-.84-.84H11.53zM6.77 6.8a4.362 4.362 0 0 0 4.34 4.34h1.8v1.72a4.362 4.362 0 0 0 4.34 4.34V7.63a.84.84 0 0 0-.83-.83H6.77zM2 11.6a4.362 4.362 0 0 0 4.34 4.34h1.8v1.72A4.362 4.362 0 0 0 12.48 22V12.43a.84.84 0 0 0-.83-.83H2z"/></svg> },
  notion: { name: 'Notion', color: '#000000', icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466l1.823 1.447zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.84-.046.933-.56.933-1.167V6.354c0-.606-.233-.933-.746-.886l-15.177.887c-.56.046-.747.326-.747.933z"/></svg> },
  clickup: { name: 'ClickUp', color: '#7B68EE', icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.986 11.072l2.142 1.736a6.26 6.26 0 0 0 5.872 3.87 6.26 6.26 0 0 0 5.872-3.87l2.142-1.736C18.858 14.725 15.742 17.45 12 17.45c-3.742 0-6.858-2.725-8.014-6.378z"/><path d="M12 6.556l-3.672 3.332-2.142-1.736L12 2.856l5.814 5.296-2.142 1.736L12 6.556z"/></svg> },
};

interface ImportModalProps {
  incrementId: string;
  activeConnectors: ActiveConnector[];
  onImported: () => void;
  onClose: () => void;
}

export function ImportModal({ incrementId, activeConnectors, onImported, onClose }: ImportModalProps) {
  const [selectedService, setSelectedService] = useState<string | null>(
    activeConnectors.length === 1 ? activeConnectors[0].service : null
  );

  const handleImported = () => { onImported(); onClose(); };

  if (selectedService === 'jira') {
    return <JiraImportModal incrementId={incrementId} onImported={handleImported} onClose={activeConnectors.length > 1 ? () => setSelectedService(null) : onClose} />;
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {!selectedService && (
          <>
            <div className={styles.header}>
              <h3 className={styles.title}>Importer des taches</h3>
              <button className={styles.closeBtn} onClick={onClose} type="button">&times;</button>
            </div>
            <div className={styles.connectorList}>
              {activeConnectors.map(c => {
                const meta = CONNECTOR_META[c.service];
                if (!meta) return null;
                return (
                  <button key={c.service} className={styles.connectorItem} onClick={() => setSelectedService(c.service)}>
                    <div className={styles.connectorIcon} style={{ background: meta.color }}>{meta.icon}</div>
                    <span className={styles.connectorName}>{meta.name}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {selectedService && selectedService !== 'jira' && (
          <>
            <div className={styles.header}>
              <h3 className={styles.title}>{CONNECTOR_META[selectedService]?.name ?? selectedService}</h3>
              <button className={styles.closeBtn} onClick={onClose} type="button">&times;</button>
            </div>
            <div style={{ padding: 'var(--spacing-lg)', color: 'var(--text-muted)', fontFamily: 'var(--font-family-mono)', fontSize: 'var(--font-size-sm)' }}>
              Import non disponible pour ce connecteur.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
