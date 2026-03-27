import Anthropic from '@anthropic-ai/sdk';
import type { CVData } from './types.js';

const MODEL = 'claude-opus-4-5-20251101';

// Types for autofill
export interface FormField {
  selector: string;
  type: 'text' | 'email' | 'tel' | 'url' | 'textarea' | 'select' | 'contenteditable';
  label?: string;
  placeholder?: string;
  name?: string;
  id?: string;
  options?: string[]; // For select fields
  context?: string; // Surrounding text/context
}

export interface AutofillRequest {
  cvData: CVData;
  fields: FormField[];
  pageUrl?: string;
  pageTitle?: string;
}

export interface AutofillResponse {
  fields: Record<string, string>; // selector -> value
}

// Initialize Anthropic client
function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }
  return new Anthropic({ apiKey });
}

/**
 * Detect field type from field info
 */
export function detectFieldType(field: FormField): 'direct' | 'generated' {
  // Direct mappings for simple fields
  const directTypes = ['email', 'tel'];
  if (directTypes.includes(field.type)) {
    return 'direct';
  }

  // Check label/name for direct fields
  const labelLower = (field.label || '').toLowerCase();
  const nameLower = (field.name || '').toLowerCase();
  const placeholderLower = (field.placeholder || '').toLowerCase();
  const combined = `${labelLower} ${nameLower} ${placeholderLower}`;

  const directPatterns = [
    /^(full\s*)?name$/,
    /^nom(\s+complet)?$/,
    /^pr[eé]nom$/,
    /^email$/,
    /^e-mail$/,
    /^t[eé]l[eé]phone?$/,
    /^phone$/,
    /^city$/,
    /^ville$/,
    /^address$/,
    /^adresse$/,
  ];

  for (const pattern of directPatterns) {
    if (pattern.test(labelLower) || pattern.test(nameLower)) {
      return 'direct';
    }
  }

  // Everything else needs generation
  return 'generated';
}

/**
 * Get direct value from CV for simple fields
 */
export function getDirectValue(field: FormField, cvData: CVData): string | null {
  const labelLower = (field.label || '').toLowerCase();
  const nameLower = (field.name || '').toLowerCase();
  const combined = `${labelLower} ${nameLower}`;

  // Email
  if (field.type === 'email' || /email|e-mail|courriel/.test(combined)) {
    return cvData.contact?.email || null;
  }

  // Phone
  if (field.type === 'tel' || /phone|t[eé]l[eé]phone|mobile/.test(combined)) {
    return cvData.contact?.phone || null;
  }

  // Name
  if (/^(full\s*)?name$|^nom(\s+complet)?$/.test(labelLower) || /^(full\s*)?name$|^nom(\s+complet)?$/.test(nameLower)) {
    return cvData.name || null;
  }

  // First name (if we can extract from full name)
  if (/pr[eé]nom|first\s*name/.test(combined)) {
    const names = (cvData.name || '').split(' ');
    return names[0] || null;
  }

  // Last name
  if (/nom\s*de\s*famille|last\s*name|surname/.test(combined)) {
    const names = (cvData.name || '').split(' ');
    return names.slice(1).join(' ') || null;
  }

  // City
  if (/city|ville/.test(combined)) {
    return cvData.contact?.city || null;
  }

  // Address
  if (/address|adresse/.test(combined)) {
    return cvData.contact?.address || null;
  }

  // Title/Position
  if (/title|titre|poste|position/.test(combined)) {
    return cvData.title || null;
  }

  return null;
}

/**
 * Generate CSS selector for a field
 */
export function generateSelector(field: FormField): string {
  // If we already have a good selector, use it
  if (field.selector && field.selector !== '') {
    return field.selector;
  }

  // Prefer ID
  if (field.id) {
    return `#${field.id}`;
  }

  // Use name attribute
  if (field.name) {
    return `[name="${field.name}"]`;
  }

  // Fallback to complex selector
  const tag = field.type === 'contenteditable' ? 'div' :
              field.type === 'textarea' ? 'textarea' :
              field.type === 'select' ? 'select' : 'input';

  const attrs: string[] = [];
  if (field.placeholder) {
    attrs.push(`[placeholder="${field.placeholder}"]`);
  }

  return attrs.length > 0 ? `${tag}${attrs.join('')}` : tag;
}

/**
 * Generate values for complex fields using Claude
 */
async function generateFieldValues(
  fields: FormField[],
  cvData: CVData,
  pageContext?: { url?: string; title?: string }
): Promise<Record<string, string>> {
  if (fields.length === 0) {
    return {};
  }

  const client = getAnthropicClient();

  const fieldsDescription = fields.map(f => {
    const parts = [`- Field: ${f.label || f.name || f.placeholder || 'Unknown'}`];
    if (f.type) parts.push(`  Type: ${f.type}`);
    if (f.context) parts.push(`  Context: ${f.context}`);
    if (f.options) parts.push(`  Options: ${f.options.join(', ')}`);
    parts.push(`  Selector: ${f.selector}`);
    return parts.join('\n');
  }).join('\n\n');

  const cvSummary = `
Name: ${cvData.name || 'N/A'}
Title: ${cvData.title || 'N/A'}
Summary: ${cvData.summary || 'N/A'}

Contact:
- Email: ${cvData.contact?.email || 'N/A'}
- Phone: ${cvData.contact?.phone || 'N/A'}
- City: ${cvData.contact?.city || 'N/A'}

Skills:
- Languages: ${cvData.languages?.join(', ') || 'N/A'}
- Competences: ${cvData.competences?.join(', ') || 'N/A'}
- Tools: ${cvData.outils?.join(', ') || 'N/A'}
- Dev: ${cvData.dev?.join(', ') || 'N/A'}
- Frameworks: ${cvData.frameworks?.join(', ') || 'N/A'}

Recent Experience:
${cvData.experiences?.slice(0, 2).map(exp =>
  `- ${exp.title} at ${exp.company} (${exp.period})\n  ${exp.missions.slice(0, 3).join('; ')}`
).join('\n') || 'N/A'}

Education:
${cvData.formations?.slice(0, 2).map(f =>
  `- ${f.title} at ${f.school} (${f.period})`
).join('\n') || 'N/A'}
`;

  const prompt = `You are helping fill out a job application form. Based on the candidate's CV, generate appropriate responses for each form field.

CV Information:
${cvSummary}

Page Context:
- URL: ${pageContext?.url || 'Unknown'}
- Title: ${pageContext?.title || 'Unknown'}

Form Fields to Fill:
${fieldsDescription}

Generate a response for each field. Return ONLY a JSON object where:
- Keys are the field selectors (exactly as provided)
- Values are the appropriate text to fill in

Guidelines:
- Keep responses professional and relevant
- For select fields, choose the best matching option
- For textarea/contenteditable with motivation/cover letter questions, write 2-3 relevant sentences
- For short text fields, be concise
- Use French if the form appears to be in French, otherwise use English

Return ONLY valid JSON, no explanations:`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    console.error('[Autofill] Failed to parse Claude response:', text);
    return {};
  }

  try {
    return JSON.parse(jsonMatch[0]) as Record<string, string>;
  } catch (err) {
    console.error('[Autofill] JSON parse error:', err);
    return {};
  }
}

/**
 * Main autofill function
 */
export async function autofillForm(request: AutofillRequest): Promise<AutofillResponse> {
  const { cvData, fields, pageUrl, pageTitle } = request;
  const result: Record<string, string> = {};

  // Separate fields into direct and generated
  const directFields: FormField[] = [];
  const generatedFields: FormField[] = [];

  for (const field of fields) {
    // Ensure selector exists
    const selector = generateSelector(field);
    const fieldWithSelector = { ...field, selector };

    const fieldType = detectFieldType(fieldWithSelector);

    if (fieldType === 'direct') {
      const value = getDirectValue(fieldWithSelector, cvData);
      if (value) {
        result[selector] = value;
      } else {
        // If direct mapping fails, try generation
        generatedFields.push(fieldWithSelector);
      }
    } else {
      generatedFields.push(fieldWithSelector);
    }
  }

  // Generate values for complex fields
  if (generatedFields.length > 0) {
    const generated = await generateFieldValues(
      generatedFields,
      cvData,
      { url: pageUrl, title: pageTitle }
    );

    Object.assign(result, generated);
  }

  return { fields: result };
}
