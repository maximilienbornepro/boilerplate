import sharp from 'sharp';

export interface ProcessImageOptions {
  maxWidth: number;
  maxHeight: number;
  quality?: number;
}

export interface ProcessedImage {
  base64: string;
  mimeType: string;
  width: number;
  height: number;
}

export async function processImage(
  buffer: Buffer,
  options: ProcessImageOptions
): Promise<ProcessedImage> {
  const { maxWidth, maxHeight, quality = 80 } = options;

  // Get metadata
  const metadata = await sharp(buffer).metadata();

  // Calculate new dimensions while maintaining aspect ratio
  let width = metadata.width || maxWidth;
  let height = metadata.height || maxHeight;

  if (width > maxWidth || height > maxHeight) {
    const ratio = Math.min(maxWidth / width, maxHeight / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  // Process image
  const processed = await sharp(buffer)
    .resize(width, height, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality })
    .toBuffer();

  // Check if still too large, compress more if needed
  let finalBuffer = processed;
  let currentQuality = quality;

  while (finalBuffer.length > 500 * 1024 && currentQuality > 20) {
    currentQuality -= 10;
    finalBuffer = await sharp(buffer)
      .resize(width, height, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: currentQuality })
      .toBuffer();
  }

  const base64 = finalBuffer.toString('base64');
  const mimeType = 'image/jpeg';

  return {
    base64: `data:${mimeType};base64,${base64}`,
    mimeType,
    width,
    height,
  };
}

export async function processLogo(buffer: Buffer): Promise<ProcessedImage> {
  return processImage(buffer, {
    maxWidth: 80,
    maxHeight: 80,
    quality: 90,
  });
}

export async function processProfilePhoto(buffer: Buffer): Promise<ProcessedImage> {
  return processImage(buffer, {
    maxWidth: 120,
    maxHeight: 120,
    quality: 85,
  });
}

export async function processScreenshot(buffer: Buffer): Promise<ProcessedImage> {
  return processImage(buffer, {
    maxWidth: 800,
    maxHeight: 600,
    quality: 80,
  });
}
