import type { RagBot } from '../../types/index.js';
import styles from './RagList.module.css';

interface Props {
  bots: RagBot[];
  onOpen: (bot: RagBot) => void;
  onEdit: (bot: RagBot) => void;
  onDelete: (bot: RagBot) => void;
}

export function RagList({ bots, onOpen, onEdit, onDelete }: Props) {
  return (
    <div className={styles.container}>
      {bots.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Aucun RAG créé</p>
          <p>Créez votre premier assistant documentaire pour commencer à indexer des contenus et discuter avec eux.</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {bots.map((bot) => (
            <div key={bot.id} className={styles.card}>
              <div className={styles.cardMain}>
                <p className={styles.cardName}>{bot.name}</p>
                {bot.description && <p className={styles.cardDesc}>{bot.description}</p>}
                <span className={styles.cardMeta}>
                  {bot.documentCount} doc{bot.documentCount !== 1 ? 's' : ''} · {bot.chunkCount} chunks
                </span>
              </div>
              <div className={styles.cardActions}>
                <button className={styles.actionBtnPrimary} onClick={() => onOpen(bot)}>Ouvrir</button>
                <button className={styles.actionBtn} onClick={() => onEdit(bot)}>Éditer</button>
                <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={() => onDelete(bot)}>Supprimer</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
