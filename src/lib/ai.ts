import { GoogleGenAI, Type } from "@google/genai";
import OpenAI from 'openai';
import * as pdfjsLib from 'pdfjs-dist';

const API_KEY = process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey: API_KEY });

export interface Chapter {
  id: string;
  title: string;
  summary: string;
  week: number;
  content: string;
}

export interface StudyPlan {
  chapters: Chapter[];
  totalWeeks: number;
  masterStudyMap: string;
  gptSystemInstructions: string;
}

async function uploadFileToGemini(file: File, apiKey: string): Promise<string> {
  // 1. Start resumable upload
  const initRes = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': file.size.toString(),
      'X-Goog-Upload-Header-Content-Type': file.type,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: file.name } })
  });

  if (!initRes.ok) {
    throw new Error(`Failed to initialize upload: ${await initRes.text()}`);
  }

  const uploadUrl = initRes.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) {
    throw new Error('No upload URL returned');
  }

  // 2. Upload the file bytes
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
    },
    body: file
  });

  if (!uploadRes.ok) {
    throw new Error(`Failed to upload file: ${await uploadRes.text()}`);
  }

  const fileInfo = await uploadRes.json();
  return fileInfo.file.uri;
}

async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item: any) => item.str).join(' ') + '\n';
  }
  return text;
}

async function processDocumentOpenAI(file: File, documentType: string, prompt: string): Promise<StudyPlan> {
  const openaiApiKey = import.meta.env.VITE_OPENAI_API_KEY || "";
  if (!openaiApiKey) throw new Error("OpenAI API key is missing. Please add VITE_OPENAI_API_KEY to your .env file.");

  const openai = new OpenAI({ apiKey: openaiApiKey, dangerouslyAllowBrowser: true });
  
  let contentToSend: any = [];

  // For OpenAI, we need to extract text if it's a PDF, or send base64 if it's an image
  if (file.type === 'application/pdf') {
    const text = await extractTextFromPdf(file);
    contentToSend.push({ type: "text", text: `Document Content:\n\n${text}` });
  } else if (file.type.startsWith('image/')) {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    contentToSend.push({ type: "image_url", image_url: { url: base64 } });
  } else {
    // Fallback to text reading for other files (txt, md, etc.)
    const text = await file.text();
    contentToSend.push({ type: "text", text: `Document Content:\n\n${text}` });
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: contentToSend }
    ],
    response_format: { type: "json_object" },
    temperature: 0.1
  });

  const textResponse = response.choices[0].message.content;
  if (!textResponse) throw new Error("No response from OpenAI");
  
  // OpenAI might wrap the response in a root object if we didn't specify the exact schema structure in the prompt well enough,
  // but our prompt asks for a specific JSON structure. Let's parse it.
  const parsed = JSON.parse(textResponse);
  
  // Sometimes OpenAI wraps the result in a property if it thinks it's a generic JSON object
  if (parsed.chapters && parsed.totalWeeks) {
    return parsed as StudyPlan;
  } else if (parsed.studyPlan) {
    return parsed.studyPlan as StudyPlan;
  }
  
  return parsed as StudyPlan;
}

export async function processDocument(file: File, documentType: string = "auto", provider: 'gemini' | 'openai' = 'gemini'): Promise<StudyPlan> {
  const model = "gemini-3.1-pro-preview";

  const prompt = `
    You are an expert educational content architect and document extraction specialist. Analyze this document (Type: ${documentType}).
    
    CRITICAL OBJECTIVE: Create a "Master Study Architecture" that allows a custom GPT to guide a student from start to finish without losing context.
    
    EXTRACTION RULES (CRITICAL - ZERO DATA LOSS POLICY):
    - TEXT: You must extract the content PERFECTLY and LITERALLY. Do not summarize the core text. Preserve the original tone, detail, and structure.
    - TABLES: Extract ALL tables with 100% accuracy. Format them strictly as Markdown tables. Ensure headers, rows, and columns are perfectly aligned and no data cells are skipped.
    - MATH & FORMULAS: Extract all mathematical text, equations, and formulas perfectly. You MUST use LaTeX formatting. Use inline LaTeX (e.g., $x^2$) for math within sentences, and block LaTeX (e.g., $$E=mc^2$$) for standalone equations. Pay special attention to fractions, integrals, matrices, and special symbols.
    - HANDWRITING: Carefully read, decipher, and transcribe ALL handwritten notes, annotations, marginalia, or teacher feedback. If handwriting is partially illegible, transcribe what you can and indicate the rest with [Illegible handwriting].
    - IMAGES/DIAGRAMS: Describe any important images, graphs, charts, or diagrams in high detail. Include data points, axis labels, and the overall conclusion of the visual so the student doesn't miss visual information.
    - EXERCISES & SOLUTIONS: Extract all assignments, practice questions, and their worked-out solutions exactly as written, step-by-step.
    
    TASKS:
    1. Identify the logical structure (Chapters, Weeks, or Modules).
    2. For each section:
       - Extract the full detailed content following the EXTRACTION RULES above. **Format this content using Markdown** for readability.
       - Include embedded exercises as "Interactive Exercises".
       - Provide a clear, descriptive title.
       - Write a brief summary of the section.
       - Assign a 'week' number.
       - Assign a unique ID (e.g., "W1-C1").
    3. If the document is a "Website Summary", synthesize the key takeaways and structure them logically.
    4. Generate a "Master Study Map" (Markdown format). This is a table of contents mapping every chapter to its week, core concepts, and exercises.
    5. Generate "GPT System Instructions" for the user to paste into their custom GPT. It should tell the GPT:
       - How to use the Master Study Map.
       - To track progress and guide the user sequentially.
       - To prioritize testing the user on the extracted interactive exercises.
       - To be an interactive tutor.
    
    CRITICAL JSON SAFETY: Your response MUST be a valid, complete JSON object. If the document is extremely long and you are approaching your output token limit, you MUST gracefully summarize the remaining content to ensure the JSON is properly closed and valid. Never output truncated JSON.
    
    Return the data in a structured JSON format.
  `;

  if (provider === 'openai') {
    return processDocumentOpenAI(file, documentType, prompt);
  }

  let filePart;
  
  try {
    const isOfficeFile = file.type.includes('officedocument') || file.type.includes('msword') || file.type.includes('ms-excel') || file.type.includes('ms-powerpoint');
    
    // Use direct REST API upload for large files OR for Office files (which are not supported by inlineData)
    if (file.size > 15 * 1024 * 1024 || isOfficeFile) {
      const fileUri = await uploadFileToGemini(file, API_KEY);
      filePart = {
        fileData: {
          fileUri: fileUri,
          mimeType: file.type || 'application/octet-stream',
        }
      };
    } else {
      throw new Error("Use inline data for small files");
    }
  } catch (e) {
    console.warn("Direct upload failed or skipped, falling back to inlineData", e);
    // Fallback to inlineData using FileReader (safe for small files, PDFs, text, images)
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    
    filePart = {
      inlineData: {
        data: base64,
        mimeType: file.type || 'text/plain',
      }
    };
  }

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        parts: [
          { text: prompt },
          filePart
        ]
      }
    ],
    config: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          chapters: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                title: { type: Type.STRING },
                summary: { type: Type.STRING },
                week: { type: Type.INTEGER },
                content: { type: Type.STRING, description: "The detailed content of the chapter to be used for ChatGPT prompts, formatted in Markdown" }
              },
              required: ["id", "title", "summary", "week", "content"]
            }
          },
          totalWeeks: { type: Type.INTEGER },
          masterStudyMap: { type: Type.STRING, description: "Markdown formatted master study map" },
          gptSystemInstructions: { type: Type.STRING, description: "System instructions for the custom GPT" }
        },
        required: ["chapters", "totalWeeks", "masterStudyMap", "gptSystemInstructions"]
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("No response from AI");
  return JSON.parse(text) as StudyPlan;
}
