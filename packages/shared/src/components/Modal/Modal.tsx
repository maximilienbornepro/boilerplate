import type { ReactNode } from 'react';
import { useEffect } from 'react';
import styles from './Modal.module.css';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ModalProps {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  size?: ModalSize;
}

const SIZE_MAX_WIDTH: Record<ModalSize, string> = {
  sm: '420px',
  md: '600px',
  lg: '800px',
  xl: '1100px',
};

export function Modal({ title, children, onClose, size = 'sm' }: ModalProps) {
  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: SIZE_MAX_WIDTH[size] }}
      >
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <button className={styles.close} onClick={onClose} type="button">
            &times;
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default Modal;
