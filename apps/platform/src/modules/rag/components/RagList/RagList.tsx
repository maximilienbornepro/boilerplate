import { Card, Button } from '@boilerplate/shared/components';
import type { RagBot } from '../../types/index.js';
import styles from './RagList.module.css';

interface Props {
  bots: RagBot[];
  onOpen: (bot: RagBot) => void;
  onEdit: (bot: RagBot) => void;
  onDelete: (bot: RagBot) => void;
  onCreate?: () => void;
}

function BotIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v4" />
      <line x1="8" y1="16" x2="8" y2="16" strokeWidth="3" strokeLinecap="round" />
      <line x1="16" y1="16" x2="16" y2="16" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function RagList({ bots, onOpen, onEdit, onDelete, onCreate }: Props) {
  return (
    <div className={styles.container}>
      {bots.length === 0 ? (
        <Card className={styles.emptyCard}>
          <div className={styles.emptyContent}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="10" rx="2" />
              <circle cx="12" cy="5" r="2" />
              <path d="M12 7v4" />
            </svg>
            <p className={styles.emptyTitle}>Aucun assistant RAG</p>
            <p className={styles.emptyHint}>Créez votre premier assistant documentaire pour commencer</p>
            {onCreate && (
              <Button variant="primary" onClick={onCreate}>
                + Nouveau RAG
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <div className={styles.list}>
          {bots.map((bot) => (
            <Card
              key={bot.id}
              variant="interactive"
              onClick={() => onOpen(bot)}
              className={styles.docCard}
            >
              <div className="shared-card__icon">
                <BotIcon />
              </div>
              <div className="shared-card__content">
                <span className="shared-card__title">{bot.name}</span>
                {bot.description && <span className="shared-card__subtitle">{bot.description}</span>}
                <span className={styles.cardMeta}>
                  {bot.documentCount} doc{bot.documentCount !== 1 ? 's' : ''} · {bot.chunkCount} chunks
                </span>
              </div>
              <button
                className="shared-card__edit-btn"
                onClick={(e) => { e.stopPropagation(); onEdit(bot); }}
                title="Éditer"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
              <button
                className="shared-card__delete-btn"
                onClick={(e) => { e.stopPropagation(); onDelete(bot); }}
                title="Supprimer"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
              <div className="shared-card__arrow">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
