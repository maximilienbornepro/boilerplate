import { useState, useRef, type DragEvent } from 'react';
import './FileDragDropZone.css';

export interface FileDragDropZoneProps {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  maxSizeMB?: number;
  label?: string;
  hint?: string;
  className?: string;
}

export function FileDragDropZone({ onFiles, accept, multiple, maxSizeMB = 10, label, hint, className }: FileDragDropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const validate = (files: File[]): File[] => {
    setError('');
    const maxBytes = maxSizeMB * 1024 * 1024;
    const valid = files.filter(f => {
      if (f.size > maxBytes) { setError(`Fichier trop volumineux (max ${maxSizeMB} Mo)`); return false; }
      if (accept) {
        const types = accept.split(',').map(t => t.trim());
        const ok = types.some(t => t.startsWith('.') ? f.name.endsWith(t) : f.type.match(new RegExp(t.replace('*', '.*'))));
        if (!ok) { setError('Type de fichier non accepte'); return false; }
      }
      return true;
    });
    return valid;
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = validate(Array.from(e.dataTransfer.files));
    if (files.length > 0) onFiles(multiple ? files : [files[0]]);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = validate(Array.from(e.target.files));
    if (files.length > 0) onFiles(multiple ? files : [files[0]]);
    e.target.value = '';
  };

  return (
    <div
      className={`shared-dropzone ${dragging ? 'shared-dropzone--dragging' : ''} ${className || ''}`}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={handleChange}
        style={{ display: 'none' }}
      />
      <div className="shared-dropzone-content">
        <span className="shared-dropzone-icon">{dragging ? '\u{1F4E5}' : '\u{1F4C1}'}</span>
        <span className="shared-dropzone-label">{label || 'Glisser-deposer ou cliquer'}</span>
        {hint && <span className="shared-dropzone-hint">{hint}</span>}
        {error && <span className="shared-dropzone-error">{error}</span>}
      </div>
    </div>
  );
}
