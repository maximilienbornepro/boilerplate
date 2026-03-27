import { useState, type KeyboardEvent } from 'react';
import './TagEditor.css';

interface TagEditorProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  label?: string;
}

export function TagEditor({ tags, onChange, placeholder = 'Ajouter...', label }: TagEditorProps) {
  const [input, setInput] = useState('');

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

  return (
    <div className="tag-editor">
      {label && <label className="tag-editor-label">{label}</label>}
      <div className="tag-editor-container">
        <div className="tag-editor-tags">
          {tags.map((tag, index) => (
            <span key={index} className="tag-editor-tag">
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
