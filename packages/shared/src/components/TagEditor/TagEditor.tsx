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
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragCounter = useRef(0);

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

  // Drag-and-drop handlers
  const handleDragStart = (e: DragEvent<HTMLSpanElement>, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragEnter = (e: DragEvent<HTMLSpanElement>, index: number) => {
    e.preventDefault();
    dragCounter.current++;
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragOverIndex(null);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: DragEvent<HTMLSpanElement>, dropIndex: number) => {
    e.preventDefault();
    dragCounter.current = 0;
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    const newTags = [...tags];
    const [moved] = newTags.splice(dragIndex, 1);
    newTags.splice(dropIndex, 0, moved);
    onChange(newTags);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
    dragCounter.current = 0;
  };

  return (
    <div className="tag-editor">
      {label && <label className="tag-editor-label">{label}</label>}
      <div className="tag-editor-container">
        <div className="tag-editor-tags">
          {tags.map((tag, index) => (
            <span
              key={index}
              className={`tag-editor-tag${dragIndex === index ? ' tag-dragging' : ''}${dragOverIndex === index && dragIndex !== index ? ' tag-drag-over' : ''}`}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragEnter={(e) => handleDragEnter(e, index)}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
            >
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
