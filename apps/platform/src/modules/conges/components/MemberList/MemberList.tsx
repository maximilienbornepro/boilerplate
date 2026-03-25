import { useState } from 'react';
import { Modal } from '@boilerplate/shared/components';
import type { Member } from '../../types';
import styles from './MemberList.module.css';

const COLORS = [
  '#00bcd4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#ec4899', '#6366f1', '#14b8a6',
];

interface MemberListProps {
  members: Member[];
  onUpdate: (id: number, data: Partial<{ color: string; sortOrder: number }>) => void;
  onClose: () => void;
}

export function MemberList({ members, onUpdate, onClose }: MemberListProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editColor, setEditColor] = useState('');

  const startEdit = (m: Member) => {
    setEditingId(m.id);
    setEditColor(m.color);
  };

  const saveEdit = () => {
    if (editingId === null) return;
    onUpdate(editingId, { color: editColor });
    setEditingId(null);
  };

  return (
    <Modal title="Equipe" onClose={onClose} maxWidth={520}>
      <div className={styles.content}>
        <div className={styles.list}>
          {members.map((m) => (
            <div key={m.id} className={styles.item}>
              {editingId === m.id ? (
                <div className={styles.editRow}>
                  <div className={styles.editInfo}>
                    <span className={styles.dot} style={{ backgroundColor: editColor }} />
                    <span className={styles.name}>{m.email}</span>
                  </div>
                  <div className={styles.colorPicker}>
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`${styles.colorDot} ${editColor === c ? styles.colorDotActive : ''}`}
                        style={{ backgroundColor: c }}
                        onClick={() => setEditColor(c)}
                      />
                    ))}
                  </div>
                  <div className={styles.editActions}>
                    <button className={styles.saveBtn} onClick={saveEdit}>Enregistrer</button>
                    <button className={styles.cancelEditBtn} onClick={() => setEditingId(null)}>Annuler</button>
                  </div>
                </div>
              ) : (
                <div className={styles.viewRow}>
                  <span className={styles.dot} style={{ backgroundColor: m.color }} />
                  <span className={styles.name}>{m.email}</span>
                  <div className={styles.itemActions}>
                    <button className={styles.editBtn} onClick={() => startEdit(m)}>Couleur</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {members.length === 0 && (
            <div className={styles.empty}>Aucun membre avec la permission &quot;conges&quot;</div>
          )}
        </div>
        <div className={styles.hint}>
          Les membres sont geres via les permissions dans l&apos;administration du gateway.
        </div>
      </div>
    </Modal>
  );
}
