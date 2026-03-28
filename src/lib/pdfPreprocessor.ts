import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { PDFDocument } from 'pdf-lib';

// Set worker source for pdfjs-dist
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export interface PreprocessOptions {
  sharpen?: boolean;
  noiseReduction?: boolean;
  adaptiveThreshold?: boolean;
}

function applySharpen(data: Uint8ClampedArray, width: number, height: number) {
  const copy = new Uint8ClampedArray(data);
  const w = width;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * w + x) * 4;
      const up = ((y - 1) * w + x) * 4;
      const down = ((y + 1) * w + x) * 4;
      const left = (y * w + (x - 1)) * 4;
      const right = (y * w + (x + 1)) * 4;

      for (let c = 0; c < 3; c++) {
        const val = 5 * copy[i + c] - copy[up + c] - copy[down + c] - copy[left + c] - copy[right + c];
        data[i + c] = Math.min(255, Math.max(0, val));
      }
    }
  }
}

function applyAdaptiveThreshold(data: Uint8ClampedArray, width: number, height: number) {
  const intImg = new Uint32Array(width * height);
  const s = Math.max(2, Math.floor(width / 16)); // Window size
  const t = 0.15; // Threshold percentage

  // 1. Calculate integral image
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const pixelVal = data[idx * 4]; // Grayscale, so R is enough
      sum += pixelVal;
      if (y === 0) {
        intImg[idx] = sum;
      } else {
        intImg[idx] = intImg[(y - 1) * width + x] + sum;
      }
    }
  }

  // 2. Apply threshold
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x1 = Math.max(x - s, 0);
      const x2 = Math.min(x + s, width - 1);
      const y1 = Math.max(y - s, 0);
      const y2 = Math.min(y + s, height - 1);

      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      
      const sum = intImg[y2 * width + x2] 
                - (y1 > 0 ? intImg[(y1 - 1) * width + x2] : 0) 
                - (x1 > 0 ? intImg[y2 * width + (x1 - 1)] : 0) 
                + (x1 > 0 && y1 > 0 ? intImg[(y1 - 1) * width + (x1 - 1)] : 0);

      const idx = (y * width + x) * 4;
      if (data[idx] * count < sum * (1.0 - t)) {
        data[idx] = 0;
        data[idx+1] = 0;
        data[idx+2] = 0;
      } else {
        data[idx] = 255;
        data[idx+1] = 255;
        data[idx+2] = 255;
      }
    }
  }
}

export async function preprocessPdf(file: File, onProgress?: (progress: number) => void, options: PreprocessOptions = {}): Promise<File> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

  const newPdf = await PDFDocument.create();

  // Determine scale based on document size to prevent OOM
  // For very large documents, use a smaller scale
  const scale = totalPages > 50 ? 1.0 : (totalPages > 20 ? 1.25 : 1.5);

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    let viewport = page.getViewport({ scale });

    // Cap dimensions to prevent canvas allocation errors (e.g., iOS Safari limit is 4096)
    const MAX_DIMENSION = 4000;
    if (viewport.width > MAX_DIMENSION || viewport.height > MAX_DIMENSION) {
      const scaleFactor = Math.min(MAX_DIMENSION / viewport.width, MAX_DIMENSION / viewport.height);
      viewport = page.getViewport({ scale: scale * scaleFactor });
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      page.cleanup();
      continue;
    }

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // Render PDF page to canvas
    await page.render({ canvasContext: ctx, viewport, canvasFactory: undefined } as any).promise;

    // Apply hardware-accelerated image processing (much faster and less memory than manual pixel manipulation)
    const processedCanvas = document.createElement('canvas');
    processedCanvas.width = canvas.width;
    processedCanvas.height = canvas.height;
    const pCtx = processedCanvas.getContext('2d');
    
    if (pCtx) {
      // White background
      pCtx.fillStyle = 'white';
      pCtx.fillRect(0, 0, processedCanvas.width, processedCanvas.height);
      
      // Apply contrast and grayscale filters
      let filterStr = 'contrast(140%) grayscale(100%)';
      if (options.noiseReduction) {
        filterStr += ' blur(0.5px)';
      }
      pCtx.filter = filterStr;
      pCtx.drawImage(canvas, 0, 0);
      
      // Apply advanced pixel manipulation if requested
      if (options.sharpen || options.adaptiveThreshold) {
        const imageData = pCtx.getImageData(0, 0, processedCanvas.width, processedCanvas.height);
        const data = imageData.data;
        
        if (options.sharpen) {
          applySharpen(data, processedCanvas.width, processedCanvas.height);
        }
        
        if (options.adaptiveThreshold) {
          applyAdaptiveThreshold(data, processedCanvas.width, processedCanvas.height);
        }
        
        pCtx.putImageData(imageData, 0, 0);
      }
      
      // Convert processed canvas to image bytes efficiently using toBlob
      // Lower quality slightly to save memory in pdf-lib for large documents
      const jpegQuality = totalPages > 50 ? 0.6 : 0.75;
      const blob = await new Promise<Blob | null>((resolve) => processedCanvas.toBlob(resolve, 'image/jpeg', jpegQuality));
      
      if (blob) {
        const imgBytes = await blob.arrayBuffer();
        const image = await newPdf.embedJpg(imgBytes);
        const newPage = newPdf.addPage([viewport.width, viewport.height]);
        newPage.drawImage(image, {
          x: 0,
          y: 0,
          width: viewport.width,
          height: viewport.height,
        });
      }
      
      processedCanvas.width = 0;
      processedCanvas.height = 0;
    }

    // Free memory
    page.cleanup();
    canvas.width = 0;
    canvas.height = 0;

    if (onProgress) {
      onProgress(Math.round((i / totalPages) * 100));
    }

    // Yield to main thread to prevent UI freezing and allow garbage collection
    await new Promise(resolve => setTimeout(resolve, 15));
  }

  // Free pdfjs memory
  await pdf.destroy();

  const pdfBytes = await newPdf.save();
  return new File([pdfBytes], `preprocessed_${file.name}`, { type: 'application/pdf' });
}
