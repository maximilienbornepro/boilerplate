import { useEffect, useState, type ReactNode } from 'react';
import { timeAgo } from './timeAgo';
import styles from './Dashboard.module.css';

interface Item {
  id: string | number;
  title: string;
  date: string;
  href: string;
  meta?: string;
}

interface Props<T> {
  appId: string;
  title: string;
  color: string;
  icon: ReactNode;
  fetchItems: () => Promise<T[]>;
  mapItem: (item: T) => Item;
  seeAllHref: string;
  emptyMessage?: string;
  /** Label of the "create new" button shown next to "Voir tout" */
  createLabel?: string;
  /** Where the create button navigates (defaults to seeAllHref) */
  createHref?: string;
  onNavigate?: (path: string) => void;
}

export function ModuleRecentBlock<T>({
  title,
  color,
  icon,
  fetchItems,
  mapItem,
  seeAllHref,
  emptyMessage = 'Aucun element pour le moment.',
  createLabel,
  createHref,
  onNavigate,
}: Props<T>) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState(false);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    fetchItems()
      .then(rawItems => {
        const mapped = rawItems.map(mapItem)
          .filter(i => i.date)
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setTotal(mapped.length);
        setItems(mapped.slice(0, 3));
      })
      .catch(() => setError(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const navigate = (path: string) => {
    if (onNavigate) onNavigate(path);
    else window.location.href = path;
  };

  return (
    <div className={styles.moduleBlock}>
      <div className={styles.moduleHeader} style={{ borderColor: color }}>
        <span className={styles.moduleIcon} style={{ background: color, color: '#fff' }}>{icon}</span>
        <h3 className={styles.moduleTitle}>{title}</h3>
        <div className={styles.moduleActions}>
          {createLabel && (
            <button
              className={styles.createBtn}
              onClick={() => navigate(createHref || seeAllHref)}
              style={{ color, borderColor: color }}
              title={createLabel}
            >
              {createLabel}
            </button>
          )}
          {total > 3 && (
            <button className={styles.seeAllLink} onClick={() => navigate(seeAllHref)}>
              Voir tout ({total})
            </button>
          )}
        </div>
      </div>

      <div className={styles.moduleBody}>
        {error ? (
          <p className={styles.moduleEmpty}>Indisponible.</p>
        ) : items === null ? (
          <p className={styles.moduleLoading}>Chargement...</p>
        ) : items.length === 0 ? (
          <p className={styles.moduleEmpty}>{emptyMessage}</p>
        ) : (
          <ul className={styles.itemList}>
            {items.map(item => (
              <li key={item.id} className={styles.item}>
                <button className={styles.itemBtn} onClick={() => navigate(item.href)}>
                  <span className={styles.itemTitle}>{item.title}</span>
                  <span className={styles.itemMeta}>
                    {item.meta && <span>{item.meta} · </span>}
                    {timeAgo(item.date)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
