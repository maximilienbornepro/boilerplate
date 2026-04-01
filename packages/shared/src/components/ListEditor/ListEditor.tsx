import { useState, type KeyboardEvent } from 'react';
import './ListEditor.css';

interface ListEditorProps {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  label?: string;
}

export function ListEditor({ items, onChange, placeholder = 'Ajouter un element...', label }: ListEditorProps) {
  const [input, setInput] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleAdd = () => {
    if (input.trim()) {
      onChange([...items, input.trim()]);
      setInput('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const newItems = [...items];
    [newItems[index - 1], newItems[index]] = [newItems[index], newItems[index - 1]];
    onChange(newItems);
  };

  const handleMoveDown = (index: number) => {
    if (index === items.length - 1) return;
    const newItems = [...items];
    [newItems[index], newItems[index + 1]] = [newItems[index + 1], newItems[index]];
    onChange(newItems);
  };

  const startEdit = (index: number) => {
    setEditingIndex(index);
    setEditValue(items[index]);
  };

  const saveEdit = () => {
    if (editingIndex !== null && editValue.trim()) {
      const newItems = [...items];
      newItems[editingIndex] = editValue.trim();
      onChange(newItems);
    }
    setEditingIndex(null);
    setEditValue('');
  };

  const handleEditKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      setEditingIndex(null);
      setEditValue('');
    }
  };

  return (
    <div className="list-editor">
      {label && <label className="list-editor-label">{label}</label>}

      <div className="list-editor-items">
        {items.map((item, index) => (
          <div key={index} className="list-editor-item">
            {editingIndex === index ? (
              <input
                type="text"
                className="list-editor-edit-input"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleEditKeyDown}
                onBlur={saveEdit}
                autoFocus
              />
            ) : (
              <>
                <span className="list-editor-item-text" onDoubleClick={() => startEdit(index)}>
                  {item}
                </span>
                <div className="list-editor-item-actions">
                  <button
                    type="button"
                    className="list-editor-btn"
                    onClick={() => handleMoveUp(index)}
                    disabled={index === 0}
                    title="Monter"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="list-editor-btn"
                    onClick={() => handleMoveDown(index)}
                    disabled={index === items.length - 1}
                    title="Descendre"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="list-editor-btn list-editor-btn-danger"
                    onClick={() => handleRemove(index)}
                    title="Supprimer"
                  >
                    ×
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="list-editor-add">
        <input
          type="text"
          className="list-editor-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="list-editor-add-btn"
          onClick={handleAdd}
          disabled={!input.trim()}
        >
          +
        </button>
      </div>
    </div>
  );
}
