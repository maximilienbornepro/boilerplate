import { useState, useRef, type KeyboardEvent, type DragEvent } from 'react';
import './TagEditor.css';

interface TagEditorProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  label?: string;
}

export function TagEditor({ tags, onChange, placeholder = 'Ajouter...', label }: TagEditorProps) {
  const [input, setInput] = useState('');
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault();
      if (!tags.includes(input.trim())) {
        onChange([...tags, input.trim()]);
      }
      setInput('');
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  const removeTag = (index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  // Drag and drop reorder
  const handleDragStart = (e: DragEvent, index: number) => {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = 'move';
    (e.currentTarget as HTMLElement).classList.add('tag-dragging');
  };

  const handleDragEnd = (e: DragEvent) => {
    dragIndexRef.current = null;
    setDragOverIndex(null);
    (e.currentTarget as HTMLElement).classList.remove('tag-dragging');
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragEnter = (_e: DragEvent, index: number) => {
    if (dragIndexRef.current !== null && dragIndexRef.current !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (e: DragEvent, dropIndex: number) => {
    e.preventDefault();
    const dragIndex = dragIndexRef.current;
    if (dragIndex === null || dragIndex === dropIndex) return;

    const newTags = [...tags];
    const [dragged] = newTags.splice(dragIndex, 1);
    newTags.splice(dropIndex, 0, dragged);
    onChange(newTags);

    dragIndexRef.current = null;
    setDragOverIndex(null);
  };

  return (
    <div className="tag-editor">
      {label && <label className="tag-editor-label">{label}</label>}
      <div className="tag-editor-container">
        <div className="tag-editor-tags">
          {tags.map((tag, index) => (
            <span
              key={index}
              className={`tag-editor-tag${dragOverIndex === index ? ' tag-drag-over' : ''}`}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              onDragEnter={(e) => handleDragEnter(e, index)}
              onDrop={(e) => handleDrop(e, index)}
            >
              <span className="tag-editor-drag-handle">⠿</span>
              {tag}
              <button
                type="button"
                className="tag-editor-remove"
                onClick={() => removeTag(index)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <input
          type="text"
          className="tag-editor-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}
