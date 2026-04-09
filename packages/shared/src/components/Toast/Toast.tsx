import { useEffect } from 'react';
import styles from './Toast.module.css';

export interface ToastData {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  details?: string;
}

interface ToastProps {
  toast: ToastData;
  onClose: () => void;
  autoDismissMs?: number;
}

const ICONS: Record<ToastData['type'], string> = {
  success: '✓',
  error: '!',
  info: 'i',
  warning: '⚠',
};

export function Toast({ toast, onClose, autoDismissMs = 3500 }: ToastProps) {
  useEffect(() => {
    if (!autoDismissMs) return;
    const timer = setTimeout(onClose, autoDismissMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id]);

  return (
    <div className={`${styles.toast} ${styles[toast.type]}`}>
      <div className={styles.content}>
        <span className={styles.icon}>{ICONS[toast.type]}</span>
        <div className={styles.text}>
          <p className={styles.message}>{toast.message}</p>
          {toast.details && <p className={styles.details}>{toast.details}</p>}
        </div>
      </div>
      <button className={styles.close} onClick={onClose} type="button">
        &times;
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastData[];
  onClose?: (id: string) => void;
  /** Alias for onClose — accepted for backwards compatibility */
  onDismiss?: (id: string) => void;
}

export function ToastContainer({ toasts, onClose, onDismiss }: ToastContainerProps) {
  const handleClose = onClose ?? onDismiss ?? (() => {});
  // Deduplicate toasts by message + type (prevents visual duplicates from
  // rapid repeated calls to addToast or StrictMode double-invocations).
  const deduped: ToastData[] = [];
  const seen = new Set<string>();
  for (const t of toasts) {
    const key = `${t.type}::${t.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(t);
  }

  if (deduped.length === 0) return null;

  return (
    <div className={styles.container}>
      {deduped.map((toast) => (
        <Toast key={toast.id} toast={toast} onClose={() => handleClose(toast.id)} />
      ))}
    </div>
  );
}

export default Toast;
