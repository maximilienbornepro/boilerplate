import { useState, useRef, useEffect } from 'react';
import './InlineEdit.css';

export interface InlineEditProps {
  value: string;
  onSave: (value: string) => void;
  onCancel?: () => void;
  placeholder?: string;
  className?: string;
}

export function InlineEdit({ value, onSave, onCancel, placeholder, className }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => { setDraft(value); }, [value]);

  const handleSave = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(value);
    setEditing(false);
    onCancel?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') handleCancel();
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`shared-inline-edit-input ${className || ''}`}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />
    );
  }

  return (
    <span
      className={`shared-inline-edit-text ${className || ''}`}
      onClick={() => setEditing(true)}
      title="Cliquer pour modifier"
    >
      {value || placeholder}
    </span>
  );
}
