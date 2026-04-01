import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../../middleware/index.js';
import { asyncHandler } from '@boilerplate/shared/server';
import * as db from './dbService.js';
import { createEmptyCV } from './types.js';
import type { CVData, MergeRequest } from './types.js';
import { parseCV, parseCVWithVision } from './parseService.js';
import { processImage } from './imageService.js';
import { adaptCVPipeline, adaptCVPipelineStream, modifyCV, recommendImprovements, applyImprovements, analyzeCVStream, applySelectedActions } from './adaptService.js';
import type { PipelineLogEvent, AnalysisResult } from './adaptService.js';
import {
  createAdaptation,
  getAdaptationsByCV,
  getAdaptation,
  updateAdaptation,
  deleteAdaptation,
  countAdaptationsByCV,
} from './adaptationDbService.js';
import { generatePDF, getFullPreviewHTML, generateFilename } from './pdfService.js';
import { autofillForm } from './autofillService.js';

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/webp',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non supporte'));
    }
  },
});

export function createMonCvRoutes(): Router {
  const router = Router();

  // Public embed routes (NO AUTH REQUIRED)
  router.get('/embed/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'ID invalide' });
      return;
    }

    const cv = await db.getCVByIdPublic(id);
    if (!cv) {
      res.status(404).json({ error: 'CV non trouve' });
      return;
    }

    res.json(cv);
  }));

  // Public HTML preview for embed (NO AUTH REQUIRED)
  router.get('/embed/:id/preview', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'ID invalide' });
      return;
    }

    const cv = await db.getCVByIdPublic(id);
    if (!cv) {
      res.status(404).json({ error: 'CV non trouve' });
      return;
    }

    const html = getFullPreviewHTML(cv.cvData);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  }));

  // All other routes require authentication
  router.use(authMiddleware);

  // ============ CV Management ============

  // GET /cv - Get default CV (or create one if none exists)
  router.get('/cv', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const cv = await db.getOrCreateDefaultCV(userId, createEmptyCV());
    res.json(cv);
  }));

  // PUT /cv - Update default CV
  router.put('/cv', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { name, cvData } = req.body;

    // Get or create default CV
    let cv = await db.getDefaultCV(userId);
    if (!cv) {
      cv = await db.createCV(userId, name || 'Mon CV', cvData || createEmptyCV(), true);
    } else {
      const updates: { name?: string; cvData?: CVData } = {};
      if (name !== undefined) updates.name = name;
      if (cvData !== undefined) updates.cvData = cvData;
      cv = await db.updateCV(cv.id, userId, updates);
    }

    res.json(cv);
  }));

  // GET /my-cvs - List all user's CVs
  router.get('/my-cvs', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const cvs = await db.getAllCVs(userId);
    res.json(cvs);
  }));

  // POST /cvs - Create a new CV
  router.post('/cvs', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { name, cvData, isDefault } = req.body;

    const cv = await db.createCV(
      userId,
      name || 'Nouveau CV',
      cvData || createEmptyCV(),
      isDefault === true
    );

    res.status(201).json(cv);
  }));

  // GET /cvs/:id - Get specific CV
  router.get('/cvs/:id', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);

    const cv = await db.getCVById(id, userId);
    if (!cv) {
      res.status(404).json({ error: 'CV non trouve' });
      return;
    }

    res.json(cv);
  }));

  // PUT /cvs/:id - Update specific CV
  router.put('/cvs/:id', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    const { name, cvData, isDefault } = req.body;

    const updates: { name?: string; cvData?: CVData; isDefault?: boolean } = {};
    if (name !== undefined) updates.name = name;
    if (cvData !== undefined) updates.cvData = cvData;
    if (isDefault !== undefined) updates.isDefault = isDefault;

    const cv = await db.updateCV(id, userId, updates);
    if (!cv) {
      res.status(404).json({ error: 'CV non trouve' });
      return;
    }

    res.json(cv);
  }));

  // DELETE /cvs/:id - Delete a CV (cannot delete default)
  router.delete('/cvs/:id', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);

    // Check if it's the default CV
    const cv = await db.getCVById(id, userId);
    if (!cv) {
      res.status(404).json({ error: 'CV non trouve' });
      return;
    }

    if (cv.isDefault) {
      res.status(400).json({ error: 'Impossible de supprimer le CV par defaut' });
      return;
    }

    await db.deleteCV(id, userId);
    res.status(204).send();
  }));

  // PUT /cvs/:id/default - Set CV as default
  router.put('/cvs/:id/default', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);

    const cv = await db.updateCV(id, userId, { isDefault: true });
    if (!cv) {
      res.status(404).json({ error: 'CV non trouve' });
      return;
    }

    res.json(cv);
  }));

  // ============ CV Import ============

  // POST /upload-cv - Import CV from PDF/DOCX (direct import)
  router.post('/upload-cv', upload.single('file'), asyncHandler(async (req, res) => {
    const userId = req.user!.id;

    if (!req.file) {
      res.status(400).json({ error: 'Aucun fichier fourni' });
      return;
    }

    try {
      let parsedData: CVData;

      if (req.file.mimetype === 'application/pdf') {
        // Try text extraction first, fallback to vision
        parsedData = await parseCV(req.file.buffer, 'pdf');
      } else {
        // DOCX
        parsedData = await parseCV(req.file.buffer, 'docx');
      }

      // Get or create default CV and merge
      let cv = await db.getDefaultCV(userId);
      if (!cv) {
        cv = await db.createCV(userId, 'Mon CV', parsedData, true);
      } else {
        cv = await db.updateCV(cv.id, userId, { cvData: parsedData });
      }

      res.json(cv);
    } catch (err: any) {
      console.error('[Mon-CV] Import error:', err);
      res.status(500).json({ error: err.message || 'Erreur lors de l\'import du CV' });
    }
  }));

  // POST /import-cv-preview - Preview import before merge
  router.post('/import-cv-preview', upload.single('file'), asyncHandler(async (req, res) => {
    const userId = req.user!.id;

    if (!req.file) {
      res.status(400).json({ error: 'Aucun fichier fourni' });
      return;
    }

    try {
      let parsedData: CVData;

      if (req.file.mimetype === 'application/pdf') {
        parsedData = await parseCV(req.file.buffer, 'pdf');
      } else {
        parsedData = await parseCV(req.file.buffer, 'docx');
      }

      // Get current CV for comparison — use cvId from form field if provided
      const cvIdParam = req.body?.cvId ? parseInt(req.body.cvId, 10) : null;
      const currentCV = cvIdParam
        ? await db.getCVById(cvIdParam, userId)
        : await db.getDefaultCV(userId);
      const currentData = currentCV?.cvData || createEmptyCV();

      // Calculate diff
      const sections = [
        'name', 'title', 'summary', 'contact',
        'languages', 'competences', 'outils', 'dev', 'frameworks', 'solutions',
        'experiences', 'formations', 'awards', 'sideProjects'
      ];

      const diff = [
        // Photo de profil : impossible à extraire depuis un PDF/DOCX
        {
          section: 'profilePhoto',
          hasChanges: false,
          isNew: false,
          cannotImport: true,
        },
        ...sections.map(section => {
          const parsedValue = (parsedData as any)[section];
          const currentValue = (currentData as any)[section];

          const hasContent = Array.isArray(parsedValue)
            ? parsedValue.length > 0
            : typeof parsedValue === 'object'
              ? Object.keys(parsedValue || {}).length > 0
              : !!parsedValue;

          const currentHasContent = Array.isArray(currentValue)
            ? currentValue.length > 0
            : typeof currentValue === 'object'
              ? Object.keys(currentValue || {}).length > 0
              : !!currentValue;

          return {
            section,
            hasChanges: hasContent,
            isNew: hasContent && !currentHasContent,
            cannotImport: false,
          };
        }),
      ];

      res.json({
        parsed: parsedData,
        diff,
      });
    } catch (err: any) {
      console.error('[Mon-CV] Preview error:', err);
      res.status(500).json({ error: err.message || 'Erreur lors de l\'analyse du CV' });
    }
  }));

  // POST /import-cv-merge - Merge selected sections
  router.post('/import-cv-merge', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { sections, parsedData, cvId } = req.body as MergeRequest & { cvId?: number };

    if (!sections || !Array.isArray(sections) || !parsedData) {
      res.status(400).json({ error: 'Donnees de merge invalides' });
      return;
    }

    // Get current CV — use the specific cvId if provided, otherwise fall back to default
    let cv = cvId
      ? await db.getCVById(cvId, userId)
      : await db.getDefaultCV(userId);
    const currentData = cv?.cvData || createEmptyCV();

    // Merge only selected sections
    const mergedData: CVData = { ...currentData };
    for (const section of sections) {
      if ((parsedData as any)[section] !== undefined) {
        (mergedData as any)[section] = (parsedData as any)[section];
      }
    }

    // Save
    if (!cv) {
      cv = await db.createCV(userId, 'Mon CV', mergedData, true);
    } else {
      cv = await db.updateCV(cv.id, userId, { cvData: mergedData });
    }

    res.json(cv);
  }));

  // ============ Media Management ============

  // POST /screenshots/upload - Upload image (profile photo or screenshot)
  router.post('/screenshots/upload', upload.single('file'), asyncHandler(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Aucun fichier fourni' });
      return;
    }

    const { type, maxWidth, maxHeight, quality } = req.body;

    try {
      const processed = await processImage(req.file.buffer, {
        maxWidth: parseInt(maxWidth) || (type === 'profile' ? 120 : 800),
        maxHeight: parseInt(maxHeight) || (type === 'profile' ? 120 : 600),
        quality: parseInt(quality) || 80,
      });

      res.json({
        image: processed.base64,
        mimeType: processed.mimeType,
        width: processed.width,
        height: processed.height,
      });
    } catch (err: any) {
      console.error('[Mon-CV] Image processing error:', err);
      res.status(500).json({ error: err.message || 'Erreur lors du traitement de l\'image' });
    }
  }));

  // POST /logos/upload - Upload company logo
  router.post('/logos/upload', upload.single('file'), asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { companyName } = req.body;

    if (!req.file) {
      res.status(400).json({ error: 'Aucun fichier fourni' });
      return;
    }

    if (!companyName) {
      res.status(400).json({ error: 'Nom de l\'entreprise requis' });
      return;
    }

    try {
      const processed = await processImage(req.file.buffer, {
        maxWidth: 80,
        maxHeight: 80,
        quality: 90,
      });

      const logo = await db.createLogo(userId, companyName, processed.base64, processed.mimeType);
      res.status(201).json(logo);
    } catch (err: any) {
      console.error('[Mon-CV] Logo upload error:', err);
      res.status(500).json({ error: err.message || 'Erreur lors de l\'upload du logo' });
    }
  }));

  // GET /logos - List user's logos
  router.get('/logos', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const logos = await db.getAllLogos(userId);

    // Return without image data for listing
    res.json(logos.map(l => ({
      id: l.id,
      companyName: l.companyName,
      mimeType: l.mimeType,
      createdAt: l.createdAt,
    })));
  }));

  // GET /logos/:id/image - Get logo image
  router.get('/logos/:id/image', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);

    const logo = await db.getLogoById(id, userId);
    if (!logo) {
      res.status(404).json({ error: 'Logo non trouve' });
      return;
    }

    // Return base64 data
    res.json({
      image: logo.imageData,
      mimeType: logo.mimeType,
    });
  }));

  // POST /fetch-company-logo - Auto-fetch logo from web
  router.post('/fetch-company-logo', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { companyName } = req.body;

    if (!companyName) {
      res.status(400).json({ error: 'Nom de l\'entreprise requis' });
      return;
    }

    // Check if we already have this logo
    const existing = await db.getLogoByCompany(userId, companyName);
    if (existing) {
      res.json(existing);
      return;
    }

    try {
      // Try to fetch from Clearbit
      const domain = companyName.toLowerCase().replace(/\s+/g, '') + '.com';
      const logoUrl = `https://logo.clearbit.com/${domain}`;

      const response = await fetch(logoUrl);
      if (!response.ok) {
        res.status(404).json({ error: 'Logo non trouve' });
        return;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const processed = await processImage(buffer, {
        maxWidth: 80,
        maxHeight: 80,
        quality: 90,
      });

      const logo = await db.createLogo(userId, companyName, processed.base64, processed.mimeType);
      res.json(logo);
    } catch (err: any) {
      console.error('[Mon-CV] Logo fetch error:', err);
      res.status(404).json({ error: 'Logo non trouve' });
    }
  }));

  // DELETE /logos/:id - Delete logo
  router.delete('/logos/:id', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);

    const deleted = await db.deleteLogo(id, userId);
    if (!deleted) {
      res.status(404).json({ error: 'Logo non trouve' });
      return;
    }

    res.status(204).send();
  }));

  // ============ CV Adaptation ============

  // POST /analyze-stream — SSE: analyze CV vs offer without modifying
  router.post('/analyze-stream', asyncHandler(async (req, res) => {
    const { cvData, jobOffer } = req.body;
    if (!jobOffer || typeof jobOffer !== 'string' || jobOffer.trim() === '') {
      res.status(400).json({ error: 'Job offer text is required' });
      return;
    }
    if (!cvData) {
      res.status(400).json({ error: 'CV data is required' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const stream = analyzeCVStream(cvData, jobOffer);
      for await (const event of stream) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (err: any) {
      console.error('[Mon-CV] Analysis stream error:', err);
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message || 'Erreur analyse' })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }));

  // POST /apply-actions — Apply selected adaptation actions to CV
  router.post('/apply-actions', asyncHandler(async (req, res) => {
    const { cvData, actions, jobAnalysis } = req.body;
    if (!cvData || !actions || !jobAnalysis) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }
    try {
      const result = await applySelectedActions(cvData, actions, jobAnalysis);
      res.json(result);
    } catch (err: any) {
      console.error('[Mon-CV] Apply actions error:', err);
      res.status(500).json({ error: err.message || 'Erreur lors de l\'application' });
    }
  }));

  // POST /recommend - Get ATS improvement recommendations (no generation, analysis only)
  router.post('/recommend', asyncHandler(async (req, res) => {
    const { cvData, jobOffer } = req.body;

    if (!jobOffer || typeof jobOffer !== 'string' || jobOffer.trim() === '') {
      res.status(400).json({ error: 'Job offer text is required' });
      return;
    }

    if (!cvData) {
      res.status(400).json({ error: 'CV data is required' });
      return;
    }

    try {
      const result = await recommendImprovements(cvData, jobOffer);
      res.json(result);
    } catch (err: any) {
      console.error('[Mon-CV] Recommend error:', err);
      res.status(500).json({ error: err.message || 'Erreur lors de la génération des recommandations' });
    }
  }));

  // POST /improve - Apply targeted improvements to an already-adapted CV
  router.post('/improve', asyncHandler(async (req, res) => {
    const { cvData, jobOffer } = req.body;

    if (!jobOffer || typeof jobOffer !== 'string' || jobOffer.trim() === '') {
      res.status(400).json({ error: 'Job offer text is required' });
      return;
    }

    if (!cvData) {
      res.status(400).json({ error: 'CV data is required' });
      return;
    }

    try {
      const result = await applyImprovements(cvData, jobOffer);
      res.json(result);
    } catch (err: any) {
      console.error('[Mon-CV] Improve error:', err);
      res.status(500).json({ error: err.message || 'Erreur lors de l\'amélioration du CV' });
    }
  }));

  // POST /adapt-stream - SSE endpoint for pipeline with logs
  router.post('/adapt-stream', asyncHandler(async (req, res) => {
    const { cvData, jobOffer, customInstructions } = req.body;

    if (!jobOffer || typeof jobOffer !== 'string' || jobOffer.trim() === '') {
      res.status(400).json({ error: 'Job offer text is required' });
      return;
    }
    if (!cvData) {
      res.status(400).json({ error: 'CV data is required' });
      return;
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const pipeline = adaptCVPipelineStream({ cvData, jobOffer, customInstructions });

      for await (const event of pipeline) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (err: any) {
      console.error('[Mon-CV] Pipeline stream error:', err);
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message || 'Erreur pipeline' })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  }));

  // POST /adapt - Adapt CV to job offer
  router.post('/adapt', asyncHandler(async (req, res) => {
    const { cvData, jobOffer, customInstructions } = req.body;

    if (!jobOffer || typeof jobOffer !== 'string' || jobOffer.trim() === '') {
      res.status(400).json({ error: 'Job offer text is required' });
      return;
    }

    if (!cvData) {
      res.status(400).json({ error: 'CV data is required' });
      return;
    }

    try {
      const result = await adaptCVPipeline({ cvData, jobOffer, customInstructions });
      res.json(result);
    } catch (err: any) {
      console.error('[Mon-CV] Adaptation error:', err);
      res.status(500).json({ error: err.message || 'Erreur lors de l\'adaptation du CV' });
    }
  }));

  // POST /modify - Modify CV with custom request
  router.post('/modify', asyncHandler(async (req, res) => {
    const { cvData, modificationRequest } = req.body;

    if (!modificationRequest || typeof modificationRequest !== 'string' || modificationRequest.trim() === '') {
      res.status(400).json({ error: 'Modification request is required' });
      return;
    }

    if (!cvData) {
      res.status(400).json({ error: 'CV data is required' });
      return;
    }

    try {
      const result = await modifyCV({ cvData, modificationRequest });
      res.json(result);
    } catch (err: any) {
      console.error('[Mon-CV] Modification error:', err);
      res.status(500).json({ error: err.message || 'Erreur lors de la modification du CV' });
    }
  }));

  // ============ CV Preview & PDF Generation ============

  // POST /full-preview - Get complete HTML preview of CV
  router.post('/full-preview', asyncHandler(async (req, res) => {
    const { cvData } = req.body;

    if (!cvData) {
      res.status(400).json({ error: 'CV data is required' });
      return;
    }

    const html = getFullPreviewHTML(cvData);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  }));

  // POST /preview-pdf - Get inline PDF preview
  router.post('/preview-pdf', asyncHandler(async (req, res) => {
    const { cvData } = req.body;

    if (!cvData) {
      res.status(400).json({ error: 'CV data is required' });
      return;
    }

    try {
      const pdf = await generatePDF(cvData);
      const filename = generateFilename(cvData);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      res.send(pdf);
    } catch (err: any) {
      console.error('[Mon-CV] PDF preview error:', err);
      res.status(500).json({ error: err.message || 'Erreur lors de la generation du PDF' });
    }
  }));

  // POST /generate-pdf - Generate and download PDF
  router.post('/generate-pdf', asyncHandler(async (req, res) => {
    const { cvData } = req.body;

    if (!cvData) {
      res.status(400).json({ error: 'CV data is required' });
      return;
    }

    try {
      const pdf = await generatePDF(cvData);
      const filename = generateFilename(cvData);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(pdf);
    } catch (err: any) {
      console.error('[Mon-CV] PDF generation error:', err);
      res.status(500).json({ error: err.message || 'Erreur lors de la generation du PDF' });
    }
  }));

  // ============ Autofill API ============

  // POST /autofill-form - Generate values for form fields
  router.post('/autofill-form', asyncHandler(async (req, res) => {
    const { cvData, fields, pageUrl, pageTitle } = req.body;

    if (!cvData) {
      res.status(400).json({ error: 'CV data is required' });
      return;
    }

    if (!fields || !Array.isArray(fields) || fields.length === 0) {
      res.status(400).json({ error: 'Fields description is required' });
      return;
    }

    try {
      const result = await autofillForm({ cvData, fields, pageUrl, pageTitle });
      res.json(result);
    } catch (err: any) {
      console.error('[Mon-CV] Autofill error:', err);
      res.status(500).json({ error: err.message || 'Erreur lors du remplissage automatique' });
    }
  }));

  // ============ CV Adaptations History ============

  // GET /cvs/:id/adaptations — list all adaptations for a CV
  router.get('/cvs/:id/adaptations', asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    const cvId = parseInt(req.params.id, 10);
    if (isNaN(cvId)) return res.status(400).json({ error: 'Invalid CV id' });
    const adaptations = await getAdaptationsByCV(cvId, userId);
    res.json(adaptations);
  }));

  // GET /cvs/:id/adaptations/count — count adaptations for a CV
  router.get('/cvs/:id/adaptations/count', asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    const cvId = parseInt(req.params.id, 10);
    if (isNaN(cvId)) return res.status(400).json({ error: 'Invalid CV id' });
    const count = await countAdaptationsByCV(cvId, userId);
    res.json({ count });
  }));

  // POST /cvs/:id/adaptations — save a new adaptation
  router.post('/cvs/:id/adaptations', asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    const cvId = parseInt(req.params.id, 10);
    if (isNaN(cvId)) return res.status(400).json({ error: 'Invalid CV id' });
    const { jobOffer, adaptedCv, changes, atsBefore, atsAfter, jobAnalysis, name } = req.body;
    if (!jobOffer || !adaptedCv || !changes || !atsBefore || !atsAfter || !jobAnalysis) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const adaptation = await createAdaptation(cvId, userId, {
      jobOffer,
      adaptedCv,
      changes,
      atsBefore,
      atsAfter,
      jobAnalysis,
      name,
    });
    res.status(201).json(adaptation);
  }));

  // GET /adaptations/:id — get a single adaptation (full detail)
  router.get('/adaptations/:id', asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid adaptation id' });
    const adaptation = await getAdaptation(id, userId);
    if (!adaptation) return res.status(404).json({ error: 'Adaptation not found' });
    res.json(adaptation);
  }));

  // PUT /adaptations/:id — update adapted CV content (name and/or adaptedCv)
  router.put('/adaptations/:id', asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid adaptation id' });
    const { adaptedCv, name, changes } = req.body;
    const updated = await updateAdaptation(id, userId, { adaptedCv, name, changes });
    if (!updated) return res.status(404).json({ error: 'Adaptation not found' });
    res.json(updated);
  }));

  // DELETE /adaptations/:id — delete an adaptation
  router.delete('/adaptations/:id', asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid adaptation id' });
    const deleted = await deleteAdaptation(id, userId);
    if (!deleted) return res.status(404).json({ error: 'Adaptation not found' });
    res.status(204).send();
  }));

  // POST /adaptations/:id/pdf — generate and return PDF for a saved adaptation
  router.post('/adaptations/:id/pdf', asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid adaptation id' });
    const adaptation = await getAdaptation(id, userId);
    if (!adaptation) return res.status(404).json({ error: 'Adaptation not found' });
    const pdfBuffer = await generatePDF(adaptation.adaptedCv);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="CV_adapte.pdf"`);
    res.send(pdfBuffer);
  }));

  return router;
}
