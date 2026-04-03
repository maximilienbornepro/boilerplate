import { useState } from 'react';
import { Modal, FormField, Button } from '@boilerplate/shared/components';
import type { RagBot } from '../../types/index.js';
import styles from './RagForm.module.css';

interface Props {
  bot?: RagBot;
  onSubmit: (name: string, description: string) => Promise<void>;
  onClose: () => void;
}

export function RagForm({ bot, onSubmit, onClose }: Props) {
  const [name, setName] = useState(bot?.name ?? '');
  const [description, setDescription] = useState(bot?.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!name.trim()) { setError('Le nom est obligatoire'); return; }
    setLoading(true);
    setError(null);
    try {
      await onSubmit(name.trim(), description.trim());
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal onClose={onClose} title={bot ? 'Modifier le RAG' : 'Nouveau RAG'}>
      <div className={styles.modalBody}>
        <FormField label="Nom" required error={error || undefined}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mon assistant documentaire"
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            autoFocus
          />
        </FormField>
        <FormField label="Description (optionnel)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="À quoi sert ce RAG ?"
            rows={3}
          />
        </FormField>
        <div className={styles.modalActions}>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Enregistrement…' : bot ? 'Enregistrer' : 'Créer'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
