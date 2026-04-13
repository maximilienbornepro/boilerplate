import { useState, useEffect } from 'react';
import { Modal, Button } from '@boilerplate/shared/components';
import styles from './EmailPreviewModal.module.css';

const TEMPLATES = [
  { id: 'listing', label: 'Listing', desc: 'Bullet points par section' },
  { id: 'situation-cible', label: 'Situation / Cible', desc: 'État actuel vs objectif' },
  { id: 'actions', label: 'Actions', desc: 'Tâches + responsables' },
  { id: 'executive', label: 'Résumé exécutif', desc: 'Synthèse management' },
];

const AI_LABELS: Record<string, string> = {
  anthropic: 'Claude', openai: 'OpenAI', mistral: 'Mistral', scaleway: 'Scaleway',
};

interface Props {
  documentId: string;
  subjectId?: string; // optional — if set, single subject email
  onClose: () => void;
}

const API_BASE = '/suivitess-api';

export function EmailPreviewModal({ documentId, subjectId, onClose }: Props) {
  const [template, setTemplate] = useState('listing');
  const [connectedAIs, setConnectedAIs] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedAI, setSelectedAI] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Load AI connectors
  useEffect(() => {
    fetch('/api/connectors', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((connectors: Array<{ service: string; isActive: boolean }>) => {
        const ais = connectors
          .filter(c => c.isActive && AI_LABELS[c.service])
          .map(c => ({ id: c.service, label: AI_LABELS[c.service] }));
        setConnectedAIs(ais);
        if (ais.length > 0) setSelectedAI(ais[0].id);
      })
      .catch(() => {});
  }, []);

  // Generate email when template or AI changes
  useEffect(() => {
    if (!selectedAI) return;
    generateEmail();
  }, [template, selectedAI]);

  const generateEmail = async () => {
    setLoading(true);
    setError('');
    setCopied(false);
    try {
      const res = await fetch(`${API_BASE}/email-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          documentId,
          subjectId: subjectId || undefined,
          template,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const data = await res.json();
      setEmailBody(data.email || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de génération');
      setEmailBody('');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    // Use textarea fallback first — navigator.clipboard.writeText fails
    // in modals because the document loses focus to the modal overlay.
    const ta = document.createElement('textarea');
    ta.value = emailBody;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal title={subjectId ? 'Email — Sujet' : 'Email — Document complet'} onClose={onClose}>
      <div className={styles.body}>
        {/* Controls row */}
        <div className={styles.controls}>
          <div className={styles.field}>
            <label>Format</label>
            <div className={styles.templateTabs}>
              {TEMPLATES.map(t => (
                <button
                  key={t.id}
                  className={`${styles.templateTab} ${template === t.id ? styles.active : ''}`}
                  onClick={() => setTemplate(t.id)}
                  title={t.desc}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <label>IA</label>
            <select
              className={styles.aiSelect}
              value={selectedAI}
              onChange={e => setSelectedAI(e.target.value)}
            >
              {connectedAIs.map(ai => (
                <option key={ai.id} value={ai.id}>{ai.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Preview */}
        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.preview}>
          {loading ? (
            <div className={styles.loading}>Génération en cours...</div>
          ) : emailBody ? (
            <pre className={styles.emailText}>{emailBody}</pre>
          ) : (
            <div className={styles.placeholder}>Sélectionnez un format pour générer l'email</div>
          )}
        </div>

        {/* Actions */}
        <div className={styles.footer}>
          <Button variant="secondary" onClick={onClose}>Fermer</Button>
          <Button variant="secondary" onClick={generateEmail} disabled={loading || !selectedAI}>
            {loading ? 'Génération...' : 'Régénérer'}
          </Button>
          <Button variant="primary" onClick={handleCopy} disabled={!emailBody || loading}>
            {copied ? 'Copié !' : 'Copier'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
