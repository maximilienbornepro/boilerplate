import puppeteer from 'puppeteer';
import type { CVData, Experience, Formation, Award } from './types.js';

// PDF Configuration
export interface PDFConfig {
  format: 'A4';
  marginTop: string;
  marginBottom: string;
  marginLeft: string;
  marginRight: string;
}

const DEFAULT_CONFIG: PDFConfig = {
  format: 'A4',
  marginTop: '0',
  marginBottom: '0',
  marginLeft: '0',
  marginRight: '0',
};

/**
 * Convert image URL or path to base64 data URL
 */
export async function imageToBase64(imageSource: string): Promise<string> {
  // Already base64
  if (imageSource.startsWith('data:')) {
    return imageSource;
  }

  // URL - fetch and convert
  if (imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
    try {
      const response = await fetch(imageSource);
      if (!response.ok) return '';
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      const contentType = response.headers.get('content-type') || 'image/png';
      return `data:${contentType};base64,${base64}`;
    } catch {
      return '';
    }
  }

  // Already a data URL or empty
  return imageSource || '';
}

/**
 * Generate filename from CV name
 */
export function generateFilename(cvData: CVData): string {
  const name = cvData.name?.trim();
  if (!name) {
    return 'CV.pdf';
  }
  const sanitized = name
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);
  return `CV_${sanitized}.pdf`;
}

/**
 * Generate sidebar HTML (photo, contact, skills)
 */
function generateSidebarHTML(cvData: CVData): string {
  const photo = cvData.profilePhoto
    ? `<div class="profile-photo">
        <img src="${cvData.profilePhoto}" alt="Photo de profil" />
      </div>`
    : '';

  const contact = cvData.contact
    ? `<div class="section contact">
        <h3>Contact</h3>
        ${cvData.contact.email ? `<p><span class="icon">✉</span> ${cvData.contact.email}</p>` : ''}
        ${cvData.contact.phone ? `<p><span class="icon">☎</span> ${cvData.contact.phone}</p>` : ''}
        ${cvData.contact.city ? `<p><span class="icon">📍</span> ${cvData.contact.city}</p>` : ''}
        ${cvData.contact.address ? `<p>${cvData.contact.address}</p>` : ''}
      </div>`
    : '';

  const languages =
    cvData.languages && cvData.languages.length > 0
      ? `<div class="section">
          <h3>Langues</h3>
          <div class="tags">${cvData.languages.map(l => `<span class="tag">${l}</span>`).join('')}</div>
        </div>`
      : '';

  const skillSections = [
    { title: 'Competences', items: cvData.competences },
    { title: 'Outils', items: cvData.outils },
    { title: 'Developpement', items: cvData.dev },
    { title: 'Frameworks', items: cvData.frameworks },
    { title: 'Solutions', items: cvData.solutions },
  ]
    .filter(s => s.items && s.items.length > 0)
    .map(
      s => `<div class="section">
        <h3>${s.title}</h3>
        <div class="tags">${s.items!.map(i => `<span class="tag">${i}</span>`).join('')}</div>
      </div>`
    )
    .join('');

  return `
    <aside class="sidebar">
      ${contact}
      ${languages}
      ${skillSections}
    </aside>
  `;
}

/**
 * Generate experience HTML
 */
function generateExperienceHTML(exp: Experience): string {
  const logo = exp.logo
    ? `<img src="${exp.logo}" alt="${exp.company}" class="company-logo" />`
    : '';

  const missions =
    exp.missions && exp.missions.length > 0
      ? `<ul class="missions">${exp.missions.map(m => `<li>${m}</li>`).join('')}</ul>`
      : '';

  const projects =
    exp.projects && exp.projects.length > 0
      ? `<div class="projects">
          <h4>Projets</h4>
          ${exp.projects
            .map(
              p => `<div class="project">
              <strong>${p.title}</strong>
              ${p.description ? `<p>${p.description}</p>` : ''}
            </div>`
            )
            .join('')}
        </div>`
      : '';

  const technologies =
    exp.technologies && exp.technologies.length > 0
      ? `<div class="technologies">
          <span class="tech-label">Technologies:</span>
          ${exp.technologies.map(t => `<span class="tech-tag">${t}</span>`).join('')}
        </div>`
      : '';

  return `
    <div class="experience">
      <div class="exp-header">
        ${logo}
        <div class="exp-info">
          <h3>${exp.title}</h3>
          <p class="company">${exp.company}</p>
          <p class="period-location">${exp.period}${exp.location ? ` • ${exp.location}` : ''}</p>
        </div>
      </div>
      ${exp.description ? `<p class="description">${exp.description}</p>` : ''}
      ${missions}
      ${projects}
      ${technologies}
    </div>
  `;
}

/**
 * Generate formations section HTML
 */
function generateFormationsHTML(formations: Formation[]): string {
  if (!formations || formations.length === 0) return '';

  return `
    <section class="main-section">
      <h2>Formation</h2>
      ${formations
        .map(
          f => `<div class="formation">
          <h3>${f.title}</h3>
          <p class="school">${f.school}</p>
          <p class="period-location">${f.period}${f.location ? ` • ${f.location}` : ''}</p>
        </div>`
        )
        .join('')}
    </section>
  `;
}

/**
 * Generate side projects section HTML
 */
function generateSideProjectsHTML(sideProjects: CVData['sideProjects']): string {
  if (!sideProjects || !sideProjects.items || sideProjects.items.length === 0) return '';

  return `
    <section class="main-section">
      <h2>${sideProjects.title || 'Projets Personnels'}</h2>
      ${sideProjects.description ? `<p class="side-description">${sideProjects.description}</p>` : ''}
      ${sideProjects.items
        .map(
          item => `<div class="side-project-item">
          <h4>${item.category}</h4>
          <ul>${item.projects.map(p => `<li>${p}</li>`).join('')}</ul>
        </div>`
        )
        .join('')}
      ${
        sideProjects.technologies && sideProjects.technologies.length > 0
          ? `<div class="technologies">
            <span class="tech-label">Technologies:</span>
            ${sideProjects.technologies.map(t => `<span class="tech-tag">${t}</span>`).join('')}
          </div>`
          : ''
      }
    </section>
  `;
}

/**
 * Generate awards section HTML
 */
function generateAwardsHTML(awards: Award[]): string {
  if (!awards || awards.length === 0) return '';

  return `
    <section class="main-section">
      <h2>Distinctions</h2>
      ${awards
        .map(
          a => `<div class="award">
          <span class="award-type">${a.type}</span>
          <strong>${a.title}</strong>
          <span class="award-year">${a.year}</span>
          ${a.location ? `<span class="award-location">• ${a.location}</span>` : ''}
        </div>`
        )
        .join('')}
    </section>
  `;
}

/**
 * Generate main content HTML
 */
function generateMainHTML(cvData: CVData): string {
  return `
    <main class="main-content">
      <h2 class="main-section-title">Experiences Professionnelles</h2>
      ${(cvData.experiences || []).map(exp => generateExperienceHTML(exp)).join('')}
      ${generateFormationsHTML(cvData.formations || [])}
      ${generateSideProjectsHTML(cvData.sideProjects)}
      ${generateAwardsHTML(cvData.awards || [])}
    </main>
  `;
}

/**
 * Generate complete HTML for CV
 */
function generateTopHeaderHTML(cvData: CVData): string {
  const photo = cvData.profilePhoto
    ? `<img src="${cvData.profilePhoto}" alt="Photo" class="top-photo" />`
    : '';

  return `
    <header class="top-header">
      ${photo}
      <div class="top-info">
        <h1>${cvData.name || 'CV'}</h1>
        ${cvData.title ? `<p class="top-title">${cvData.title}</p>` : ''}
        ${cvData.summary ? `<p class="top-summary">${cvData.summary}</p>` : ''}
      </div>
    </header>
  `;
}

export function generateCVHTML(cvData: CVData): string {
  const topHeader = generateTopHeaderHTML(cvData);
  const sidebar = generateSidebarHTML(cvData);
  const main = generateMainHTML(cvData);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CV - ${cvData.name || 'CV'}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    @page {
      size: A4;
      margin: 0;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    html, body {
      height: 100%;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      line-height: 1.5;
      color: #e5e5e5;
      background: #1a1a1a;
    }

    /* Top header - full width */
    .top-header {
      display: flex;
      align-items: center;
      gap: 15px;
      padding: 20px 25px;
      background: #111;
      border-bottom: 2px solid #06b6d4;
    }

    .top-photo {
      width: 70px;
      height: 70px;
      border-radius: 50%;
      object-fit: cover;
      border: 2px solid #06b6d4;
      flex-shrink: 0;
    }

    .top-info h1 {
      font-family: 'Playfair Display', serif;
      font-size: 22px;
      font-weight: 700;
      color: #e5e5e5;
      margin-bottom: 2px;
    }

    .top-info .top-title {
      font-size: 11px;
      color: #06b6d4;
      font-weight: 500;
      margin-bottom: 4px;
    }

    .top-info .top-summary {
      font-size: 8px;
      color: #a3a3a3;
      line-height: 1.4;
    }

    .cv-container {
      display: flex;
      min-height: calc(100% - 110px);
      max-width: 100%;
      margin: 0;
    }

    /* Sidebar */
    .sidebar {
      width: 280px;
      background: #1a1a1a;
      padding: 20px;
      flex-shrink: 0;
    }

    .sidebar .section {
      margin-bottom: 20px;
      padding-bottom: 15px;
      border-bottom: 1px solid #333;
    }

    .sidebar .section:last-child {
      border-bottom: none;
    }

    .sidebar h3 {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      font-weight: 500;
      color: #06b6d4;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 10px;
    }

    .sidebar p {
      font-size: 9px;
      margin-bottom: 5px;
      color: #a3a3a3;
    }

    .sidebar .icon {
      margin-right: 5px;
    }

    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .tag {
      background: #262626;
      color: #e5e5e5;
      padding: 2px 6px;
      font-size: 8px;
      border: 1px solid #404040;
    }

    /* Main content */
    .main-content {
      flex: 1;
      background: #fafafa;
      color: #171717;
      padding: 20px;
      min-height: 100%;
    }

    .main-section-title {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      font-weight: 500;
      color: #171717;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 12px;
      padding-bottom: 5px;
      border-bottom: 1px solid #e5e5e5;
    }

    .main-section {
      margin-bottom: 12px;
    }

    .main-section h2 {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      font-weight: 500;
      color: #171717;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 15px;
      padding-bottom: 5px;
      border-bottom: 1px solid #e5e5e5;
    }

    /* Experience */
    .experience {
      margin-bottom: 15px;
    }

    .exp-header {
      display: flex;
      gap: 10px;
      margin-bottom: 10px;
    }

    .company-logo {
      width: 40px;
      height: 40px;
      object-fit: contain;
      flex-shrink: 0;
    }

    .exp-info h3 {
      font-size: 11px;
      font-weight: 500;
      color: #171717;
    }

    .exp-info .company {
      font-size: 10px;
      color: #06b6d4;
      font-weight: 500;
    }

    .exp-info .period-location {
      font-size: 9px;
      color: #737373;
    }

    .experience .description {
      font-size: 9px;
      color: #525252;
      margin-bottom: 10px;
    }

    .missions {
      list-style: none;
      padding-left: 0;
      margin-bottom: 10px;
    }

    .missions li {
      font-size: 9px;
      color: #404040;
      padding-left: 12px;
      position: relative;
      margin-bottom: 3px;
    }

    .missions li:before {
      content: '›';
      position: absolute;
      left: 0;
      color: #06b6d4;
    }

    .projects {
      margin-top: 10px;
      padding-left: 10px;
      border-left: 2px solid #e5e5e5;
    }

    .projects h4 {
      font-size: 9px;
      font-weight: 500;
      color: #737373;
      margin-bottom: 5px;
    }

    .project {
      margin-bottom: 8px;
    }

    .project strong {
      font-size: 9px;
      color: #171717;
    }

    .project p {
      font-size: 8px;
      color: #525252;
    }

    .technologies {
      margin-top: 8px;
    }

    .tech-label {
      font-size: 8px;
      color: #737373;
      margin-right: 5px;
    }

    .tech-tag {
      display: inline-block;
      background: #e5e5e5;
      color: #404040;
      padding: 1px 4px;
      font-size: 7px;
      margin-right: 3px;
      margin-bottom: 3px;
    }

    /* Formation */
    .formation {
      margin-bottom: 12px;
    }

    .formation h3 {
      font-size: 10px;
      font-weight: 500;
      color: #171717;
    }

    .formation .school {
      font-size: 9px;
      color: #06b6d4;
    }

    .formation .period-location {
      font-size: 8px;
      color: #737373;
    }

    /* Side projects */
    .side-description {
      font-size: 9px;
      color: #525252;
      margin-bottom: 10px;
    }

    .side-project-item {
      margin-bottom: 10px;
    }

    .side-project-item h4 {
      font-size: 9px;
      font-weight: 500;
      color: #171717;
      margin-bottom: 5px;
    }

    .side-project-item ul {
      list-style: none;
      padding-left: 10px;
    }

    .side-project-item li {
      font-size: 8px;
      color: #525252;
      margin-bottom: 2px;
    }

    /* Awards */
    .award {
      margin-bottom: 8px;
      font-size: 9px;
    }

    .award-type {
      background: #06b6d4;
      color: white;
      padding: 1px 4px;
      font-size: 7px;
      margin-right: 5px;
    }

    .award-year {
      color: #737373;
      margin-left: 5px;
    }

    .award-location {
      color: #737373;
      font-size: 8px;
    }

    /* Print styles */
    @media print {
      body {
        background: #1a1a1a;
      }

      .cv-container {
        max-width: none;
      }
    }
  </style>
</head>
<body>
  ${topHeader}
  <div class="cv-container">
    ${sidebar}
    ${main}
  </div>
</body>
</html>`;
}

/**
 * Generate full preview HTML with all data displayed
 */
export function getFullPreviewHTML(cvData: CVData): string {
  return generateCVHTML(cvData);
}

/**
 * Generate PDF from CV data using Puppeteer
 */
export async function generatePDF(
  cvData: CVData,
  config: Partial<PDFConfig> = {}
): Promise<Buffer> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  // Generate HTML
  const html = generateCVHTML(cvData);

  // Launch Puppeteer (use system Chromium in production via PUPPETEER_EXECUTABLE_PATH)
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    ...(process.env.PUPPETEER_EXECUTABLE_PATH && {
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    }),
  });

  try {
    const page = await browser.newPage();

    // Set content
    await page.setContent(html, {
      waitUntil: 'networkidle0',
    });

    // Generate PDF
    const pdf = await page.pdf({
      format: finalConfig.format,
      margin: {
        top: finalConfig.marginTop,
        bottom: finalConfig.marginBottom,
        left: finalConfig.marginLeft,
        right: finalConfig.marginRight,
      },
      printBackground: true,
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
