import { useEffect, useState, type ReactNode } from 'react';
import styles from './Dashboard.module.css';

interface Item {
  id: string | number;
  title: string;
  date: string;
  href: string;
  meta?: string;
}

export interface SubItem {
  label: string;
  date?: string;
  href?: string;
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
  /** Optional: fetch sub-items for each top-level item (e.g. recent subjects per doc) */
  fetchSubItems?: (item: Item) => Promise<SubItem[]>;
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
  fetchSubItems,
  onNavigate,
}: Props<T>) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState(false);
  const [total, setTotal] = useState(0);
  const [subItemsMap, setSubItemsMap] = useState<Record<string, SubItem[]>>({});

  useEffect(() => {
    fetchItems()
      .then(rawItems => {
        const mapped = rawItems.map(mapItem)
          .sort((a, b) => {
            // Items with no date go to the bottom
            if (!a.date && !b.date) return 0;
            if (!a.date) return 1;
            if (!b.date) return -1;
            return new Date(b.date).getTime() - new Date(a.date).getTime();
          });
        setTotal(mapped.length);
        const top = mapped.slice(0, 3);
        setItems(top);

        // Fetch sub-items for the top items in parallel
        if (fetchSubItems && top.length > 0) {
          Promise.all(
            top.map(item =>
              fetchSubItems(item)
                .then(subs => ({ id: String(item.id), subs }))
                .catch(() => ({ id: String(item.id), subs: [] as SubItem[] }))
            )
          ).then(results => {
            const map: Record<string, SubItem[]> = {};
            for (const r of results) map[r.id] = r.subs;
            setSubItemsMap(map);
          });
        }
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
        <div className={styles.moduleTitleGroup}>
          <h3 className={styles.moduleTitle}>{title}</h3>
          <span className={styles.moduleSubtitle}>Modifications récentes</span>
        </div>
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
          {items !== null && (
            <button className={styles.seeAllLink} onClick={() => navigate(seeAllHref)}>
              {total > 3 ? `Voir tout (${total})` : 'Voir tout'}
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
            {items.map(item => {
              const subs = subItemsMap[String(item.id)] || [];
              return (
                <li key={item.id} className={styles.item}>
                  <button className={styles.itemBtn} onClick={() => navigate(item.href)}>
                    <span className={styles.itemTitle}>{item.title}</span>
                    {item.meta && <span className={styles.itemMeta}>{item.meta}</span>}
                  </button>
                  {subs.length > 0 && (
                    <ul className={styles.subList}>
                      {subs.slice(0, 3).map((sub, idx) => (
                        <li key={idx} className={styles.subItem}>
                          {sub.href ? (
                            <button className={styles.subBtn} onClick={() => navigate(sub.href!)}>
                              <span className={styles.subBullet} style={{ color }}>›</span>
                              <span className={styles.subLabel}>{sub.label}</span>
                            </button>
                          ) : (
                            <div className={styles.subBtn}>
                              <span className={styles.subBullet} style={{ color }}>›</span>
                              <span className={styles.subLabel}>{sub.label}</span>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
