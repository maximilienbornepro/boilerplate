import { type FormEvent, useCallback } from 'react';
import './ProjectEditor.css';

export interface ProjectItem {
  title: string;
  description?: string;
}

export interface ProjectEditorProps {
  label: string;
  projects: ProjectItem[];
  onChange: (projects: ProjectItem[]) => void;
  placeholder?: string;
}

function autoResizeEl(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

export function ProjectEditor({ label, projects, onChange, placeholder }: ProjectEditorProps) {
  const handleTextareaInput = useCallback((e: FormEvent<HTMLTextAreaElement>) => {
    autoResizeEl(e.currentTarget);
  }, []);
  const handleAdd = () => {
    onChange([...projects, { title: '', description: '' }]);
  };

  const handleRemove = (index: number) => {
    onChange(projects.filter((_, i) => i !== index));
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const newProjects = [...projects];
    [newProjects[index - 1], newProjects[index]] = [newProjects[index], newProjects[index - 1]];
    onChange(newProjects);
  };

  const handleMoveDown = (index: number) => {
    if (index === projects.length - 1) return;
    const newProjects = [...projects];
    [newProjects[index], newProjects[index + 1]] = [newProjects[index + 1], newProjects[index]];
    onChange(newProjects);
  };

  const handleChange = (index: number, field: 'title' | 'description', value: string) => {
    const updated = [...projects];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  return (
    <div className="project-editor">
      <label className="project-editor-label">{label}</label>
      <div className="project-editor-list">
        {projects.map((project, index) => (
          <div key={index} className="project-editor-item">
            <div className="project-editor-fields">
              <input
                type="text"
                className="project-editor-title"
                value={project.title}
                onChange={(e) => handleChange(index, 'title', e.target.value)}
                placeholder={placeholder || 'Titre du projet'}
              />
              <textarea
                className="project-editor-description"
                value={project.description || ''}
                onChange={(e) => handleChange(index, 'description', e.target.value)}
                onInput={handleTextareaInput}
                ref={(el) => { if (el) requestAnimationFrame(() => autoResizeEl(el)); }}
                placeholder="Description (technologies, details...)"
                rows={2}
              />
            </div>
            <div className="project-editor-actions">
              <button
                type="button"
                className="project-editor-move"
                onClick={() => handleMoveUp(index)}
                disabled={index === 0}
                title="Monter"
              >
                ↑
              </button>
              <button
                type="button"
                className="project-editor-move"
                onClick={() => handleMoveDown(index)}
                disabled={index === projects.length - 1}
                title="Descendre"
              >
                ↓
              </button>
              <button
                type="button"
                className="project-editor-remove"
                onClick={() => handleRemove(index)}
                title="Supprimer"
              >
                x
              </button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="project-editor-add" onClick={handleAdd}>
        + Ajouter
      </button>
    </div>
  );
}
