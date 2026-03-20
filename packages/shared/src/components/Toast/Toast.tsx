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
}

const ICONS: Record<ToastData['type'], string> = {
  success: '✓',
  error: '!',
  info: 'i',
  warning: '⚠',
};

export function Toast({ toast, onClose }: ToastProps) {
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
  onClose: (id: string) => void;
}

export function ToastContainer({ toasts, onClose }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className={styles.container}>
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onClose={() => onClose(toast.id)} />
      ))}
    </div>
  );
}

export default Toast;
