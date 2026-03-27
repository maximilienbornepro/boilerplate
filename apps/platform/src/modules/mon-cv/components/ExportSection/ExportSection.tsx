import { useState } from 'react';
import { LoadingSpinner } from '@boilerplate/shared/components';
import type { CVData } from '../../types';
import { getFullPreviewHTML, downloadPDF } from '../../services/api';
import './ExportSection.css';

interface ExportSectionProps {
  cvData: CVData;
}

export function ExportSection({ cvData }: ExportSectionProps) {
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingPDF, setLoadingPDF] = useState(false);
  const [error, setError] = useState('');

  const handlePreviewHTML = async () => {
    setLoadingPreview(true);
    setError('');

    try {
      const html = await getFullPreviewHTML(cvData);
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la generation de l\'apercu');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handlePreviewPDF = async () => {
    setLoadingPDF(true);
    setError('');

    try {
      // Generate PDF and open in new tab
      const response = await fetch('/mon-cv-api/preview-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cvData }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Erreur lors de la generation du PDF');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la generation du PDF');
    } finally {
      setLoadingPDF(false);
    }
  };

  const handleDownloadPDF = async () => {
    setLoadingPDF(true);
    setError('');

    try {
      const filename = cvData.name
        ? `CV_${cvData.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`
        : 'CV.pdf';
      await downloadPDF(cvData, filename);
    } catch (err: any) {
      setError(err.message || 'Erreur lors du telechargement du PDF');
    } finally {
      setLoadingPDF(false);
    }
  };

  return (
    <div className="export-section">
      <h3>Exporter le CV</h3>

      {error && <div className="export-error">{error}</div>}

      <div className="export-buttons">
        <button
          className="export-btn preview-html"
          onClick={handlePreviewHTML}
          disabled={loadingPreview || loadingPDF}
        >
          {loadingPreview ? (
            <LoadingSpinner size="small" />
          ) : (
            <span className="btn-icon">&#x1F441;</span>
          )}
          <span>Apercu</span>
        </button>

        <button
          className="export-btn preview-pdf"
          onClick={handlePreviewPDF}
          disabled={loadingPreview || loadingPDF}
        >
          {loadingPDF ? (
            <LoadingSpinner size="small" />
          ) : (
            <span className="btn-icon">&#x1F4C4;</span>
          )}
          <span>Apercu PDF</span>
        </button>

        <button
          className="export-btn download-pdf"
          onClick={handleDownloadPDF}
          disabled={loadingPreview || loadingPDF}
        >
          {loadingPDF ? (
            <LoadingSpinner size="small" />
          ) : (
            <span className="btn-icon">&#x2B07;</span>
          )}
          <span>Telecharger PDF</span>
        </button>
      </div>

      <p className="export-hint">
        L'apercu est instantane. La generation PDF peut prendre quelques secondes.
      </p>
    </div>
  );
}
