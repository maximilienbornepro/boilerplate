import { useState, useEffect } from 'react';
import { fetchEmbedPreviewHTML } from '../../services/api';
import './EmbedView.css';

interface EmbedViewProps {
  itemId: string;
}

export function EmbedView({ itemId }: EmbedViewProps) {
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadPreview() {
      try {
        setLoading(true);
        setError(null);
        // Fetch HTML preview directly (public endpoint, no auth)
        const html = await fetchEmbedPreviewHTML(itemId);
        setPreviewHtml(html);
      } catch (err: any) {
        setError(err.message || 'Erreur lors du chargement');
      } finally {
        setLoading(false);
      }
    }
    loadPreview();
  }, [itemId]);

  if (loading) {
    return <div className="cv-embed-loading">Chargement...</div>;
  }

  if (error) {
    return <div className="cv-embed-error">{error}</div>;
  }

  if (!previewHtml) {
    return <div className="cv-embed-error">CV non trouve</div>;
  }

  return (
    <div className="cv-embed-app">
      <iframe
        className="cv-embed-iframe"
        srcDoc={previewHtml}
        title="CV Preview"
      />
    </div>
  );
}
