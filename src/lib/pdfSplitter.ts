import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { GoogleGenAI, Type } from '@google/genai';
import OpenAI from 'openai';

// Set worker source for pdfjs-dist
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export interface PdfChunk {
  file: File;
  startPage: number;
  endPage: number;
}

export async function splitPdfIntoChunks(file: File, maxSizeBytes: number = 45 * 1024 * 1024, apiKey?: string, aiProvider: 'gemini' | 'openai' = 'gemini'): Promise<PdfChunk[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  const totalPages = pdfDoc.getPageCount();
  
  // Extract text and analyze density
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  
  interface PageInfo {
    pageNumber: number;
    textLength: number;
    endsWithSentence: boolean;
    estimatedBytes: number;
    previewText: string;
  }
  
  const pageInfos: PageInfo[] = [];
  let totalTextLength = 0;

  for (let i = 1; i <= totalPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const text = textContent.items.map((item: any) => item.str).join(' ');
      const textLength = text.length;
      totalTextLength += textLength;
      
      const trimmed = text.trim();
      const endsWithSentence = trimmed.length === 0 || /[\.\!\?]$/.test(trimmed);

      pageInfos.push({
        pageNumber: i,
        textLength,
        endsWithSentence,
        estimatedBytes: 0,
        previewText: trimmed.substring(0, 250)
      });
    } catch (e) {
      console.warn(`Could not extract text from page ${i}`);
      pageInfos.push({
        pageNumber: i,
        textLength: 0,
        endsWithSentence: true,
        estimatedBytes: 0,
        previewText: ""
      });
    }
  }

  const baseOverhead = file.size * 0.1 / totalPages;
  const remainingSize = file.size * 0.9;
  
  for (const info of pageInfos) {
    info.estimatedBytes = baseOverhead + (totalTextLength > 0 ? (info.textLength / totalTextLength) * remainingSize : remainingSize / totalPages);
  }

  // 1. Try to get semantic split points if API key is provided
  let semanticSplitPoints: number[] = [];
  if (apiKey) {
    try {
      const previews = pageInfos.filter(p => p.previewText.length > 0).map(p => ({ page: p.pageNumber, text: p.previewText }));
      semanticSplitPoints = await getSemanticSplitPoints(previews, apiKey, totalPages, aiProvider);
      console.log("Semantic split points identified:", semanticSplitPoints);
    } catch (err) {
      console.warn("Failed to get semantic split points, falling back to dynamic chunking", err);
    }
  }

  // Ensure the last page is always included as a split point to close the final chunk
  if (semanticSplitPoints.length === 0 || semanticSplitPoints[semanticSplitPoints.length - 1] !== totalPages) {
    semanticSplitPoints.push(totalPages);
  }

  semanticSplitPoints = Array.from(new Set(semanticSplitPoints)).sort((a, b) => a - b);

  function splitByDensity(startPage: number, endPage: number, maxBytes: number): number[] {
    const points: number[] = [];
    let currentChunkBytes = 0;
    let lastValidSplit = -1;
    let chunkStart = startPage;

    for (let i = startPage; i <= endPage; i++) {
      const info = pageInfos[i - 1];
      currentChunkBytes += info.estimatedBytes;

      if (info.endsWithSentence) {
        lastValidSplit = i;
      }

      if (currentChunkBytes > maxBytes && i > chunkStart) {
        let splitPoint = i - 1;
        
        if (lastValidSplit !== -1 && lastValidSplit >= chunkStart && lastValidSplit < i) {
          splitPoint = lastValidSplit;
        }

        points.push(splitPoint);
        
        chunkStart = splitPoint + 1;
        currentChunkBytes = 0;
        for (let j = chunkStart; j <= i; j++) {
          currentChunkBytes += pageInfos[j - 1].estimatedBytes;
        }
        lastValidSplit = info.endsWithSentence ? i : -1;
      }
    }
    
    return points;
  }

  let finalSplitPoints: number[] = [];
  let currentStart = 1;

  for (const endPage of semanticSplitPoints) {
    if (currentStart > endPage) continue;

    let chunkBytes = 0;
    for (let i = currentStart; i <= endPage; i++) {
      chunkBytes += pageInfos[i - 1].estimatedBytes;
    }

    if (chunkBytes > maxSizeBytes) {
      const subSplits = splitByDensity(currentStart, endPage, maxSizeBytes);
      finalSplitPoints.push(...subSplits);
    }
    
    finalSplitPoints.push(endPage);
    currentStart = endPage + 1;
  }

  finalSplitPoints = Array.from(new Set(finalSplitPoints)).sort((a, b) => a - b);

  const chunks: PdfChunk[] = [];
  let startPage = 1;

  for (const endPage of finalSplitPoints) {
    if (startPage > endPage) continue;

    const newPdf = await PDFDocument.create();
    const pageIndices = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage - 1 + i);
    const copiedPages = await newPdf.copyPages(pdfDoc, pageIndices);
    copiedPages.forEach((page) => newPdf.addPage(page));

    const pdfBytes = await newPdf.save();
    const chunkFile = new File([pdfBytes], `${file.name.replace(/\.[^/.]+$/, "")}_part${chunks.length + 1}.pdf`, { type: 'application/pdf' });
    
    chunks.push({
      file: chunkFile,
      startPage,
      endPage
    });

    startPage = endPage + 1;
  }

  return chunks;
}

async function getSemanticSplitPoints(pagePreviews: { page: number, text: string }[], apiKey: string, totalPages: number, aiProvider: 'gemini' | 'openai'): Promise<number[]> {
  if (pagePreviews.length === 0) return [];

  const prompt = `
You are a document structure analyzer. I am providing you with the first 250 characters of text from each page of a PDF document.
Your task is to identify the page numbers that represent the START of a new logical section, chapter, or week.
Look for headings like "Chapter X", "Week Y", "Introduction", "Conclusion", or large font sizes (implied by short, capitalized lines).

Here is the page data:
${JSON.stringify(pagePreviews, null, 2)}

Return ONLY a JSON array of integers representing the page numbers where a new section begins. Do not include page 1.
Example: [15, 32, 45, 60]
`;

  let responseText = "";

  if (aiProvider === 'openai') {
    const openaiApiKey = import.meta.env.VITE_OPENAI_API_KEY || "";
    if (!openaiApiKey) throw new Error("OpenAI API key is missing");
    
    const openai = new OpenAI({ apiKey: openaiApiKey, dangerouslyAllowBrowser: true });
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.1
    });
    
    const content = response.choices[0].message.content || "{}";
    // OpenAI might wrap it in an object if we use json_object, so we need to handle that
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        responseText = content;
      } else {
        // Find the first array in the object
        const firstArray = Object.values(parsed).find(val => Array.isArray(val));
        if (firstArray) {
          responseText = JSON.stringify(firstArray);
        } else {
          responseText = "[]";
        }
      }
    } catch (e) {
      responseText = "[]";
    }
  } else {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.INTEGER
          },
          description: "An array of page numbers where new chapters or sections begin."
        }
      }
    });
    responseText = response.text || "[]";
  }

  if (responseText) {
    try {
      const points = JSON.parse(responseText) as number[];
      // Ensure points are within bounds and sorted
      return points.filter(p => p > 1 && p <= totalPages).sort((a, b) => a - b);
    } catch (e) {
      console.error("Failed to parse LLM response for split points", e);
    }
  }
  
  return [];
}
