import type { CV, CVData, CVListItem, CVLogo, ImportPreviewResult, ProcessedImage, AdaptResponse, ModifyResponse, AtsRecommendations, ImprovementResult, CVAdaptation, CVAdaptationListItem } from '../types';

const API_BASE = '/mon-cv-api';

async function handleResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Erreur serveur (${response.status}) — réponse inattendue`);
  }
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Une erreur est survenue');
  }
  return data;
}

// ============ CV Management ============

export async function fetchDefaultCV(): Promise<CV> {
  const response = await fetch(`${API_BASE}/cv`, { credentials: 'include' });
  return handleResponse<CV>(response);
}

export async function updateDefaultCV(cvData: CVData, name?: string): Promise<CV> {
  const response = await fetch(`${API_BASE}/cv`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ cvData, name }),
  });
  return handleResponse<CV>(response);
}

export async function fetchAllCVs(): Promise<CVListItem[]> {
  const response = await fetch(`${API_BASE}/my-cvs`, { credentials: 'include' });
  return handleResponse<CVListItem[]>(response);
}

export async function createCV(name: string, cvData: CVData, isDefault?: boolean): Promise<CV> {
  const response = await fetch(`${API_BASE}/cvs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name, cvData, isDefault }),
  });
  return handleResponse<CV>(response);
}

export async function fetchCV(id: number): Promise<CV> {
  const response = await fetch(`${API_BASE}/cvs/${id}`, { credentials: 'include' });
  return handleResponse<CV>(response);
}

// Public embed access (no auth required)
export async function fetchCVEmbed(id: string): Promise<CV> {
  const response = await fetch(`${API_BASE}/embed/${id}`);
  return handleResponse<CV>(response);
}

// Public embed preview HTML (no auth required)
export async function fetchEmbedPreviewHTML(id: string): Promise<string> {
  const response = await fetch(`${API_BASE}/embed/${id}/preview`);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Erreur lors du chargement du preview');
  }
  return response.text();
}

export async function updateCV(id: number, updates: { name?: string; cvData?: CVData; isDefault?: boolean }): Promise<CV> {
  const response = await fetch(`${API_BASE}/cvs/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(updates),
  });
  return handleResponse<CV>(response);
}

export async function deleteCV(id: number): Promise<void> {
  const response = await fetch(`${API_BASE}/cvs/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Erreur lors de la suppression');
  }
}

export async function setDefaultCV(id: number): Promise<CV> {
  const response = await fetch(`${API_BASE}/cvs/${id}/default`, {
    method: 'PUT',
    credentials: 'include',
  });
  return handleResponse<CV>(response);
}

// ============ CV Import ============

export async function uploadCV(file: File): Promise<CV> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/upload-cv`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  return handleResponse<CV>(response);
}

export async function previewImport(file: File): Promise<ImportPreviewResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/import-cv-preview`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  return handleResponse<ImportPreviewResult>(response);
}

export async function mergeImport(sections: string[], parsedData: CVData): Promise<CV> {
  const response = await fetch(`${API_BASE}/import-cv-merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ sections, parsedData }),
  });
  return handleResponse<CV>(response);
}

// ============ Media Management ============

export async function uploadImage(file: File, type: 'profile' | 'screenshot' = 'screenshot'): Promise<ProcessedImage> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', type);

  const response = await fetch(`${API_BASE}/screenshots/upload`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  return handleResponse<ProcessedImage>(response);
}

export async function uploadLogo(file: File, companyName: string): Promise<CVLogo> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('companyName', companyName);

  const response = await fetch(`${API_BASE}/logos/upload`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  return handleResponse<CVLogo>(response);
}

export async function fetchLogos(): Promise<CVLogo[]> {
  const response = await fetch(`${API_BASE}/logos`, { credentials: 'include' });
  return handleResponse<CVLogo[]>(response);
}

export async function fetchLogoImage(id: number): Promise<{ image: string; mimeType: string }> {
  const response = await fetch(`${API_BASE}/logos/${id}/image`, { credentials: 'include' });
  return handleResponse<{ image: string; mimeType: string }>(response);
}

export async function fetchCompanyLogo(companyName: string): Promise<CVLogo> {
  const response = await fetch(`${API_BASE}/fetch-company-logo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ companyName }),
  });
  return handleResponse<CVLogo>(response);
}

export async function deleteLogo(id: number): Promise<void> {
  const response = await fetch(`${API_BASE}/logos/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Erreur lors de la suppression');
  }
}

// ============ CV Adaptation ============

export async function adaptCV(cvData: CVData, jobOffer: string, customInstructions?: string): Promise<AdaptResponse> {
  const response = await fetch(`${API_BASE}/adapt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ cvData, jobOffer, customInstructions }),
  });
  return handleResponse<AdaptResponse>(response);
}

export async function improveCV(
  cvData: CVData,
  jobOffer: string
): Promise<ImprovementResult> {
  const response = await fetch(`${API_BASE}/improve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ cvData, jobOffer }),
  });
  return handleResponse<ImprovementResult>(response);
}

export async function getAtsRecommendations(
  cvData: CVData,
  jobOffer: string
): Promise<AtsRecommendations> {
  const response = await fetch(`${API_BASE}/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ cvData, jobOffer }),
  });
  return handleResponse<AtsRecommendations>(response);
}

export async function modifyCV(cvData: CVData, modificationRequest: string): Promise<ModifyResponse> {
  const response = await fetch(`${API_BASE}/modify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ cvData, modificationRequest }),
  });
  return handleResponse<ModifyResponse>(response);
}

// ============ CV Preview & PDF ============

export async function getFullPreviewHTML(cvData: CVData): Promise<string> {
  const response = await fetch(`${API_BASE}/full-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ cvData }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Erreur lors de la generation du preview complet');
  }
  return response.text();
}

export async function generatePDF(cvData: CVData): Promise<Blob> {
  const response = await fetch(`${API_BASE}/generate-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ cvData }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Erreur lors de la generation du PDF');
  }
  return response.blob();
}

export function getPreviewPDFUrl(): string {
  return `${API_BASE}/preview-pdf`;
}

export async function downloadPDF(cvData: CVData, filename?: string): Promise<void> {
  const blob = await generatePDF(cvData);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'CV.pdf';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============ CV Adaptations History ============

export async function getAdaptations(cvId: number): Promise<CVAdaptationListItem[]> {
  const response = await fetch(`${API_BASE}/cvs/${cvId}/adaptations`, { credentials: 'include' });
  return handleResponse<CVAdaptationListItem[]>(response);
}

export async function getAdaptationsCount(cvId: number): Promise<number> {
  const response = await fetch(`${API_BASE}/cvs/${cvId}/adaptations/count`, { credentials: 'include' });
  const data = await handleResponse<{ count: number }>(response);
  return data.count;
}

export async function createAdaptation(
  cvId: number,
  payload: {
    jobOffer: string;
    adaptedCv: CVData;
    changes: CVAdaptation['changes'];
    atsBefore: CVAdaptation['atsBefore'];
    atsAfter: CVAdaptation['atsAfter'];
    jobAnalysis: CVAdaptation['jobAnalysis'];
    name?: string;
  }
): Promise<CVAdaptation> {
  const response = await fetch(`${API_BASE}/cvs/${cvId}/adaptations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  return handleResponse<CVAdaptation>(response);
}

export async function getAdaptation(id: number): Promise<CVAdaptation> {
  const response = await fetch(`${API_BASE}/adaptations/${id}`, { credentials: 'include' });
  return handleResponse<CVAdaptation>(response);
}

export async function updateAdaptation(
  id: number,
  updates: { adaptedCv?: CVData; name?: string }
): Promise<CVAdaptation> {
  const response = await fetch(`${API_BASE}/adaptations/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(updates),
  });
  return handleResponse<CVAdaptation>(response);
}

export async function deleteAdaptation(id: number): Promise<void> {
  const response = await fetch(`${API_BASE}/adaptations/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Erreur lors de la suppression');
  }
}

export async function downloadAdaptationPDF(id: number, filename?: string): Promise<void> {
  const response = await fetch(`${API_BASE}/adaptations/${id}/pdf`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Erreur lors de la génération du PDF');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'CV_adapte.pdf';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
