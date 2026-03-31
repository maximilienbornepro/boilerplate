import type { Project } from '../../types';
import './ProjectEditor.css';

interface ProjectEditorProps {
  label: string;
  projects: Project[];
  onChange: (projects: Project[]) => void;
  placeholder?: string;
}

export function ProjectEditor({ label, projects, onChange, placeholder }: ProjectEditorProps) {
  const handleAdd = () => {
    onChange([...projects, { title: '', description: '' }]);
  };

  const handleRemove = (index: number) => {
    onChange(projects.filter((_, i) => i !== index));
  };

  const handleChange = (index: number, field: 'title' | 'description', value: string) => {
    const updated = [...projects];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    const updated = [...projects];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    onChange(updated);
  };

  const handleMoveDown = (index: number) => {
    if (index >= projects.length - 1) return;
    const updated = [...projects];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
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
              <input
                type="text"
                className="project-editor-description"
                value={project.description || ''}
                onChange={(e) => handleChange(index, 'description', e.target.value)}
                placeholder="Description (technologies, détails...)"
              />
            </div>
            <div className="project-editor-actions">
              <button
                type="button"
                className="project-editor-move"
                onClick={() => handleMoveUp(index)}
                disabled={index === 0}
                title="Déplacer vers le haut"
              >
                ↑
              </button>
              <button
                type="button"
                className="project-editor-move"
                onClick={() => handleMoveDown(index)}
                disabled={index === projects.length - 1}
                title="Déplacer vers le bas"
              >
                ↓
              </button>
              <button
                type="button"
                className="project-editor-remove"
                onClick={() => handleRemove(index)}
                title="Supprimer"
              >
                ×
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
