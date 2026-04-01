import { useState, useRef, type DragEvent, type ChangeEvent } from 'react';
import './ImageUploader.css';

interface ImageUploaderProps {
  image?: string;
  onChange: (image: string | null) => void;
  onUpload?: (file: File) => Promise<string>;
  label?: string;
  size?: 'small' | 'medium' | 'large';
  accept?: string;
}

export function ImageUploader({
  image,
  onChange,
  onUpload,
  label,
  size = 'medium',
  accept = 'image/jpeg,image/png,image/webp',
}: ImageUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      await processFile(file);
    }
  };

  const handleChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await processFile(file);
    }
  };

  const processFile = async (file: File) => {
    setError(null);

    if (!file.type.startsWith('image/')) {
      setError('Le fichier doit etre une image');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('L\'image ne doit pas depasser 5 Mo');
      return;
    }

    try {
      setIsUploading(true);

      if (onUpload) {
        const result = await onUpload(file);
        onChange(result);
      } else {
        // Read as base64 locally
        const reader = new FileReader();
        reader.onload = () => {
          onChange(reader.result as string);
        };
        reader.readAsDataURL(file);
      }
    } catch (err: any) {
      setError(err.message || 'Erreur lors de l\'upload');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = () => {
    onChange(null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const handleClick = () => {
    inputRef.current?.click();
  };

  return (
    <div className={`image-uploader image-uploader-${size}`}>
      {label && <label className="image-uploader-label">{label}</label>}

      <div
        className={`image-uploader-dropzone ${isDragging ? 'dragging' : ''} ${image ? 'has-image' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={!image ? handleClick : undefined}
      >
        {isUploading ? (
          <div className="image-uploader-loading">Chargement...</div>
        ) : image ? (
          <div className="image-uploader-preview">
            <img src={image} alt="Preview" />
            <button
              type="button"
              className="image-uploader-remove"
              onClick={(e) => {
                e.stopPropagation();
                handleRemove();
              }}
            >
              ×
            </button>
          </div>
        ) : (
          <div className="image-uploader-placeholder">
            <span className="image-uploader-icon">📷</span>
            <span className="image-uploader-text">
              Glisser-deposer ou cliquer
            </span>
          </div>
        )}
      </div>

      {error && <div className="image-uploader-error">{error}</div>}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        style={{ display: 'none' }}
      />
    </div>
  );
}
