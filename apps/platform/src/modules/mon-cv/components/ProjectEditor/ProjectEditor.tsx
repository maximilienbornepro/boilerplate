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
                placeholder="Description (technologies, details...)"
              />
            </div>
            <button
              type="button"
              className="project-editor-remove"
              onClick={() => handleRemove(index)}
              title="Supprimer"
            >
              x
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="project-editor-add" onClick={handleAdd}>
        + Ajouter
      </button>
    </div>
  );
}
