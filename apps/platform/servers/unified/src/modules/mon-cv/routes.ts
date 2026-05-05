import { Router } from 'express';
import multer from 'multer';
import { route } from '../../gateway/index.js';
import { asyncHandler } from '@boilerplate/shared/server';
import * as db from './dbService.js';
import { createEmptyCV } from './types.js';
import type { CVData, MergeRequest } from './types.js';
import { parseCV, parseCVWithVision } from './parseService.js';
import { processImage } from './imageService.js';
// Adaptation now goes through the tile-by-tile flow at the bottom
// of this file. The legacy all-at-once / streaming pipelines were
// removed — see tileAdaptationService.ts. `recommendImprovements`
// is the only legacy adapt-* function still kept : it powers the
// "Recommandations ATS" panel on AdaptationDetailPage which the
// user opens AFTER the adaptation is done. No call site for the
// other legacy functions.
import { recommendImprovements } from './adaptService.js';
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

  // Public embed routes (NO AUTH REQUIRED). Mon-CV embeds pre-date
  // `resource_sharing` and don't enforce a visibility check — any CV
  // with a known numeric id is publicly viewable. Match that behaviour
  // with `tier: 'public'` (rate limit only) rather than `'embed'`
  // (which would query sharing and 404 everything).
  const cvEmbedGuard = route({ tier: 'public' });

  router.get('/embed/:id', ...cvEmbedGuard, asyncHandler(async (req, res) => {
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
  router.get('/embed/:id/preview', ...cvEmbedGuard, asyncHandler(async (req, res) => {
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

  // All other routes require authentication. Body limit is explicitly
  // disabled at the router level because four endpoints rely on multer
  // file uploads (up to 10 MB PDF/DOCX/image) — multer enforces its
  // own 10 MB cap and the global express.json 25 MB ceiling still
  // applies as a safety net. Individual JSON endpoints keep implicit
  // protection via that global cap.
  router.use(...route({ tier: 'authenticated', bodyLimit: false }));

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

    // For each selected section we trust the imported snapshot
    // entirely — no smart merge, no partial preservation. The user
    // explicitly asked for this : the import should replace whatever
    // was there with what's in the PDF, systematically.
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
  //
  // Old endpoints (`/adapt`, `/adapt-stream`, `/improve`, `/modify`,
  // `/apply-actions`, `/analyze-stream`) were removed in favour of
  // the tile-by-tile flow at the bottom of this file
  // (POST /cvs/:id/tile-adaptations + GET/PUT/POST on
  // /tile-adaptations/:id/tiles). See migration 28 +
  // tileAdaptationService.ts for the new pipeline.
  //
  // `/recommend` is kept : it's still used by AdaptationDetailPage's
  // "Recommandations ATS" panel — independent of the tile flow.
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

  // ==================== Tile-by-tile adaptation ====================
  //
  // Replaces the legacy `/adapt`, `/adapt-stream`, `/improve`,
  // `/recommend`, `/modify`, `/apply-actions`, `/analyze-stream`
  // pipeline. The user pastes a job offer, validates, and walks
  // through each AI proposal one tile at a time. Each tile carries
  // an originalText + proposedText + optional userEditedText. Edits
  // are merged into the adaptation's `adapted_cv` JSONB by walking
  // the tile's `path`.

  // POST /cvs/:id/tile-adaptations — body { jobOffer }
  // Pipeline : skill A (extract atomics) → skill B (adapt batch) →
  // create cv_adaptations row with adapted_cv = original cvData →
  // persist tiles. Returns { adaptationId, tiles[] }.
  router.post('/cvs/:id/tile-adaptations', asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    const userEmail = (req as any).user?.email ?? null;
    const cvId = parseInt(req.params.id, 10);
    if (isNaN(cvId)) return res.status(400).json({ error: 'Invalid CV id' });
    const { jobOffer } = (req.body || {}) as { jobOffer?: string };
    if (!jobOffer || !jobOffer.trim()) {
      return res.status(400).json({ error: 'jobOffer requis' });
    }

    try {
      const cv = await db.getCVById(cvId, userId);
      if (!cv) return res.status(404).json({ error: 'CV non trouvé' });

      // Dedup against an existing recent draft for the SAME
      // (user, cv, jobOffer). This catches :
      //  - React StrictMode double-mount in dev (effect fires twice
      //    before the cancel flag short-circuits the second call's
      //    state update — but the API call already went through)
      //  - User clicking "Valider" twice in quick succession
      //  - Idempotent retry from a flaky network
      // Window = 10 min : long enough to absorb the above, short
      // enough that a deliberate fresh attempt with the exact same
      // offer 30 min later still creates a new row.
      const { getRecentDraftForOffer } = await import('./adaptationDbService.js');
      const existingDraft = await getRecentDraftForOffer(cvId, userId, jobOffer);
      if (existingDraft) {
        const { getTilesByAdaptation } = await import('./adaptationDbService.js');
        const existingTiles = await getTilesByAdaptation(existingDraft.id, userId);
        return res.json({
          adaptationId: existingDraft.id,
          name: existingDraft.name,
          tiles: existingTiles,
          deduped: true,
        });
      }

      const { extractAtomicsFromCV, persistTilesForAdaptation } =
        await import('./tileAdaptationService.js');
      const { analyzeJobOffer, scoreCV } = await import('./adaptService.js');

      // Deterministic extraction — no AI call, the CV is already
      // structured in DB. Replaces the previous skill A which paid an
      // LLM round-trip to reconstruct what we already have. The user
      // then picks which atomics to adapt via /run-adapt below.
      const subjects = extractAtomicsFromCV(cv.cvData);
      if (subjects.length === 0) {
        return res.status(400).json({
          error: 'Aucun sujet atomique trouvé dans le CV. Vérifie qu\'il contient au moins un champ rempli (présentation, expériences, compétences…).',
        });
      }

      // Analyse the offer up-front so :
      //  - we have a real exactJobTitle for the auto-name
      //  - atsBefore/atsAfter reflect actual offer keywords (otherwise
      //    `requiredKeywords=[]` makes scoreCV always return 80%, which
      //    is what the user observed)
      // Failure here is non-fatal — fall back to empty analysis so
      // the modal still opens, score stays 0 instead of 80.
      let jobAnalysis;
      try {
        jobAnalysis = await analyzeJobOffer(jobOffer);
      } catch (analyseErr) {
        // eslint-disable-next-line no-console
        console.warn('[mon-cv] analyzeJobOffer failed, using empty analysis:', (analyseErr as Error).message);
        jobAnalysis = { requiredKeywords: [], preferredKeywords: [], exactJobTitle: '', technologies: [], keyResponsibilities: [], domain: '', atsHint: 'unknown' as const };
      }

      const atsBefore = scoreCV(cv.cvData, jobAnalysis);

      // Auto-name : "<CV name> · <Job title>" so the user always
      // recognises drafts in the AdaptCVPage list. Falls back to
      // generic labels when either piece is missing.
      const cvLabel = (cv.name || cv.cvData.name || '').trim() || `CV #${cvId}`;
      const jobLabel = (jobAnalysis.exactJobTitle || '').trim() || 'Adaptation en cours';
      const autoName = `${cvLabel} · ${jobLabel}`;

      const adaptation = await createAdaptation(cvId, userId, {
        jobOffer,
        adaptedCv: cv.cvData,
        changes: { newMissions: [], addedSkills: {} } as any,
        atsBefore,
        atsAfter: atsBefore, // identical until tiles are accepted
        jobAnalysis,
        name: autoName,
        status: 'draft',
      });

      // Persist the tiles with proposed_text = original_text and
      // proposal_ready = false. The user then picks which ones to
      // actually adapt via the next route.
      const tiles = await persistTilesForAdaptation(adaptation.id, subjects, []);
      res.json({ adaptationId: adaptation.id, name: autoName, tiles });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[mon-cv] tile-adaptations POST failed:', err);
      res.status(500).json({
        error: (err as Error).message || 'Erreur serveur',
        stack: process.env.NODE_ENV !== 'production' ? (err as Error).stack : undefined,
      });
    }
  }));

  // POST /tile-adaptations/:id/complete — flip the adaptation from
  // `draft` to `completed`. Called by the modal once the user reaches
  // the "done" phase. Idempotent.
  router.post('/tile-adaptations/:id/complete', asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    const adaptationId = parseInt(req.params.id, 10);
    if (isNaN(adaptationId)) return res.status(400).json({ error: 'Invalid adaptation id' });
    const { markAdaptationCompleted } = await import('./adaptationDbService.js');
    const updated = await markAdaptationCompleted(adaptationId, userId);
    if (!updated) return res.status(404).json({ error: 'Adaptation non trouvée' });
    res.json(updated);
  }));

  // DELETE /tile-adaptations/:id — discard a draft (or any
  // adaptation). Used by the AdaptCVPage to let the user clean up
  // drafts they no longer want to resume.
  router.delete('/tile-adaptations/:id', asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    const adaptationId = parseInt(req.params.id, 10);
    if (isNaN(adaptationId)) return res.status(400).json({ error: 'Invalid adaptation id' });
    const { deleteAdaptation } = await import('./adaptationDbService.js');
    const ok = await deleteAdaptation(adaptationId, userId);
    if (!ok) return res.status(404).json({ error: 'Adaptation non trouvée' });
    res.status(204).end();
  }));

  // POST /tile-adaptations/:id/run-adapt
  // Body : { tileIds: string[] }  — the subset selected by the user
  // in the modal's "Selection" phase. Runs skill B on those atomics
  // only and updates the matching tile rows. Saves tokens vs
  // adapting every atomic blindly. Returns a job receipt — the
  // frontend keeps polling /tiles to see results land.
  router.post('/tile-adaptations/:id/run-adapt', asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    const userEmail = (req as any).user?.email ?? null;
    const adaptationId = parseInt(req.params.id, 10);
    if (isNaN(adaptationId)) return res.status(400).json({ error: 'Invalid adaptation id' });
    const { tileIds, mode: rawMode } = (req.body || {}) as {
      tileIds?: string[];
      mode?: 'classic' | 'aggressive';
    };
    if (!Array.isArray(tileIds) || tileIds.length === 0) {
      return res.status(400).json({ error: 'tileIds requis' });
    }
    // Default to classic when missing/invalid — same behaviour as
    // before the mode option was added.
    const mode: 'classic' | 'aggressive' = rawMode === 'aggressive' ? 'aggressive' : 'classic';

    const adaptation = await getAdaptation(adaptationId, userId);
    if (!adaptation) return res.status(404).json({ error: 'Adaptation non trouvée' });

    const { getTilesByAdaptation } = await import('./adaptationDbService.js');
    const allTiles = await getTilesByAdaptation(adaptationId, userId);
    const selectedIdSet = new Set(tileIds);
    const selected = allTiles.filter(t => selectedIdSet.has(t.tileId));
    if (selected.length === 0) {
      return res.status(400).json({ error: 'Aucune tuile valide sélectionnée' });
    }

    res.json({ acceptedCount: selected.length, mode });

    // Background — skill B on the selected subset + write proposals
    // back via setTileProposal. In aggressive mode, also persist
    // suggested NEW competences as fresh tiles. Errors logged, partial
    // completion OK.
    setImmediate(async () => {
      try {
        const {
          adaptAllAtomics, buildSkillsSnapshot, buildAdditionAtomic,
        } = await import('./tileAdaptationService.js');
        const {
          setTileProposal, insertTilesForAdaptation,
        } = await import('./adaptationDbService.js');
        const atomics = selected.map(t => ({
          id: t.tileId,
          path: t.path,
          kind: t.kind,
          originalText: t.originalText,
          label: t.label ?? t.path,
        }));
        const snapshot = mode === 'aggressive'
          ? buildSkillsSnapshot(adaptation.adaptedCv)
          : null;
        const { proposals, additions, logId: adaptLogId } = await adaptAllAtomics(
          atomics, adaptation.jobOffer, userId, userEmail, mode, snapshot,
        );
        for (const a of atomics) {
          const proposal = proposals.find(p => p.id === a.id);
          const text = proposal?.proposedText && proposal.proposedText.trim().length > 0
            ? proposal.proposedText
            : a.originalText;
          const reasoning = proposal?.reasoning ?? null;
          await setTileProposal(adaptationId, a.id, text, reasoning, adaptLogId);
        }
        // Aggressive-mode additions → new tiles, already-ready
        // (proposal_ready=true) so the modal surfaces them
        // immediately alongside the rewritten ones.
        if (mode === 'aggressive' && additions.length > 0) {
          const additionRows = additions.map((add, i) => {
            const atom = buildAdditionAtomic(add, i);
            return {
              tileId: atom.id,
              path: atom.path,
              kind: atom.kind,
              originalText: atom.originalText,
              proposedText: add.proposedText,
              label: atom.label,
              proposalReady: true,
              reasoning: add.reasoning ?? null,
            };
          });
          await insertTilesForAdaptation(adaptationId, additionRows);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[mon-cv] background skill B failed for adaptation', adaptationId, err);
      }
    });
  }));

  // GET /tile-adaptations/:id/tiles — list tiles for an adaptation.
  router.get('/tile-adaptations/:id/tiles', asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    const adaptationId = parseInt(req.params.id, 10);
    if (isNaN(adaptationId)) return res.status(400).json({ error: 'Invalid adaptation id' });
    const { getTilesByAdaptation } = await import('./adaptationDbService.js');
    const tiles = await getTilesByAdaptation(adaptationId, userId);
    res.json(tiles);
  }));

  // PUT /tile-adaptations/:id/tiles/:tileId — accept / skip / edit
  // body : { status: 'accepted'|'skipped'|'edited'|'pending', userEditedText? }
  // When status is accepted/edited, the resolved final text is merged
  // into the adaptation's adapted_cv at the tile's `path`.
  router.put('/tile-adaptations/:id/tiles/:tileId', asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    const adaptationId = parseInt(req.params.id, 10);
    if (isNaN(adaptationId)) return res.status(400).json({ error: 'Invalid adaptation id' });
    const { tileId } = req.params;
    const { status, userEditedText } = (req.body || {}) as {
      status?: 'accepted' | 'skipped' | 'edited' | 'pending';
      userEditedText?: string | null;
    };
    if (!status || !['accepted', 'skipped', 'edited', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'status invalide' });
    }

    const { getTileById, updateTileStatus } = await import('./adaptationDbService.js');
    const existing = await getTileById(tileId, userId);
    if (!existing || existing.adaptationId !== adaptationId) {
      return res.status(404).json({ error: 'Tuile non trouvée' });
    }

    const updated = await updateTileStatus(tileId, userId, {
      status,
      userEditedText: userEditedText ?? null,
    });
    if (!updated) return res.status(404).json({ error: 'Tuile non trouvée' });

    // Merge into adapted_cv when the user accepts or edits.
    if (status === 'accepted' || status === 'edited') {
      const finalText = (status === 'edited' && updated.userEditedText)
        ? updated.userEditedText
        : updated.proposedText;
      const adaptation = await getAdaptation(adaptationId, userId);
      if (adaptation) {
        const { applyTextAtPath } = await import('./tileAdaptationService.js');
        const newCv = applyTextAtPath(adaptation.adaptedCv, updated.path, finalText);
        await updateAdaptation(adaptationId, userId, { adaptedCv: newCv });
      }
    }
    res.json(updated);
  }));

  // POST /tile-adaptations/:id/tiles/:tileId/regenerate — re-run skill B
  // on this single tile. Replaces proposed_text + resets user_edited_text
  // + sets status back to 'pending' so the user re-validates.
  router.post('/tile-adaptations/:id/tiles/:tileId/regenerate', asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    const userEmail = (req as any).user?.email ?? null;
    const adaptationId = parseInt(req.params.id, 10);
    if (isNaN(adaptationId)) return res.status(400).json({ error: 'Invalid adaptation id' });
    const { tileId } = req.params;
    const { mode: rawMode } = (req.body || {}) as { mode?: 'classic' | 'aggressive' };
    const mode: 'classic' | 'aggressive' = rawMode === 'aggressive' ? 'aggressive' : 'classic';

    const { getTileById, updateTileProposal } = await import('./adaptationDbService.js');
    const tile = await getTileById(tileId, userId);
    if (!tile || tile.adaptationId !== adaptationId) {
      return res.status(404).json({ error: 'Tuile non trouvée' });
    }

    const adaptation = await getAdaptation(adaptationId, userId);
    if (!adaptation) return res.status(404).json({ error: 'Adaptation non trouvée' });

    const { adaptOneAtomic } = await import('./tileAdaptationService.js');
    const { proposal, logId } = await adaptOneAtomic(
      { id: tile.tileId, path: tile.path, kind: tile.kind, originalText: tile.originalText, label: tile.label ?? tile.path },
      adaptation.jobOffer,
      userId,
      userEmail,
      mode,
    );
    const newText = proposal?.proposedText && proposal.proposedText.trim().length > 0
      ? proposal.proposedText
      : tile.originalText;
    const reasoning = proposal?.reasoning ?? null;
    const updated = await updateTileProposal(tileId, userId, newText, reasoning, logId);
    if (!updated) return res.status(404).json({ error: 'Tuile non trouvée' });
    res.json(updated);
  }));

  return router;
}
