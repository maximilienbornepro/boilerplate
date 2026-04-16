import { useEffect, useState, type ReactNode } from 'react';
import styles from './Dashboard.module.css';

interface Item {
  id: string | number;
  title: string;
  date: string;
  href: string;
  meta?: string;
  metaTag?: boolean;
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
  /** Optional: compute a dynamic meta string (e.g. "3 en cours") after items load */
  computeMeta?: (item: Item) => Promise<string | null>;
  /** Sort direction for the `date` field. Defaults to 'desc' (most recent first). */
  sortDirection?: 'desc' | 'asc';
  onNavigate?: (path: string) => void;
}

const MAX_VISIBLE = 5;

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
  computeMeta,
  sortDirection = 'desc',
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
            // Items with no date always go to the bottom
            if (!a.date && !b.date) return 0;
            if (!a.date) return 1;
            if (!b.date) return -1;
            const delta = new Date(a.date).getTime() - new Date(b.date).getTime();
            return sortDirection === 'asc' ? delta : -delta;
          });
        setTotal(mapped.length);
        const top = mapped.slice(0, MAX_VISIBLE);
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

        // Compute dynamic meta (e.g. "3 en cours") for each visible item
        if (computeMeta && top.length > 0) {
          Promise.all(
            top.map(item =>
              computeMeta(item)
                .then(meta => ({ id: String(item.id), meta }))
                .catch(() => ({ id: String(item.id), meta: null as string | null }))
            )
          ).then(results => {
            setItems(prev => {
              if (!prev) return prev;
              const metaById = new Map(results.map(r => [r.id, r.meta] as const));
              return prev.map(it => {
                const m = metaById.get(String(it.id));
                return m ? { ...it, meta: m } : it;
              });
            });
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
    <div
      className={styles.moduleBlock}
      style={{ ['--module-color' as string]: color }}
    >
      <div className={styles.moduleHeader}>
        <span className={styles.moduleIcon} style={{ background: color, color: '#fff' }}>{icon}</span>
        <div className={styles.moduleTitleGroup}>
          <h3 className={styles.moduleTitle}>{title}</h3>
        </div>
        <div className={styles.moduleActions}>
          {createLabel && (
            <button
              className={styles.createBtn}
              onClick={() => navigate(createHref || seeAllHref)}
              style={{ backgroundColor: color, color: 'white' }}
              title={createLabel}
            >
              {createLabel}
            </button>
          )}
          {items !== null && (
            <button
              className={styles.seeAllLink}
              onClick={() => navigate(seeAllHref)}
            >
              Voir tout
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
                  <button className={`${styles.itemBtn} ${item.metaTag ? styles.itemBtnRow : ''}`} onClick={() => navigate(item.href)}>
                    <span className={styles.itemTitle}>{item.title}</span>
                    {item.meta && <span className={item.metaTag ? styles.itemMetaTag : styles.itemMeta} style={item.metaTag ? { color, borderColor: color } : undefined}>{item.meta}</span>}
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
