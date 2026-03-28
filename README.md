# Document Processor & Study Plan Generator

Hallo Claude! De gebruiker wil deze applicatie lokaal installeren, configureren en verder ontwikkelen met jouw hulp. Hier is een overzicht van het project en instructies voor de setup.

## Overzicht van de Applicatie

Dit is een React + Vite applicatie (geschreven in TypeScript) die grote documenten (PDF, DOCX, PPTX, XLSX, TXT, MD) verwerkt en analyseert met behulp van AI om een "Master Study Plan" te genereren. 

De applicatie heeft de volgende kernfunctionaliteiten:
1. **Bestandsverwerking & Chunking:** Grote PDF's worden slim opgesplitst in kleinere "chunks" op basis van semantische grenzen (hoofdstukken) en bestandsgrootte, zodat ze binnen de limieten van de AI API's passen (`src/lib/pdfSplitter.ts`).
2. **Geavanceerde OCR Preprocessing:** Scans en afbeeldingen in PDF's kunnen worden verbeterd met contrast, grayscale, ruisreductie, verscherping en adaptieve drempelwaarden (`src/lib/pdfPreprocessor.ts`).
3. **AI Model Provider Switch:** De gebruiker kan kiezen tussen **Google Gemini** (standaard) en **OpenAI (GPT-4o)** voor de analyse (`src/lib/ai.ts`).
4. **UI:** Een moderne, responsieve interface gebouwd met Tailwind CSS en Framer Motion (`src/App.tsx`).

## Installatie Instructies (Voor Claude & Gebruiker)

Volg deze stappen om het project lokaal te draaien:

### 1. Vereisten
- Node.js (v18 of hoger aanbevolen)
- npm of yarn

### 2. Afhankelijkheden Installeren
Open een terminal in de root van het project en run:
```bash
npm install
```

### 3. Omgevingsvariabelen (Environment Variables) Instellen
De applicatie maakt gebruik van AI API's. Je moet de API keys instellen in een `.env` bestand.

1. Kopieer het `.env.example` bestand naar een nieuw bestand genaamd `.env`:
   ```bash
   cp .env.example .env
   ```
2. Open het `.env` bestand en vul de volgende keys in:
   - `VITE_GEMINI_API_KEY`: Jouw Google Gemini API key (vereist voor de Gemini provider en voor semantische PDF splitsing).
   - `VITE_OPENAI_API_KEY`: Jouw OpenAI API key (vereist als je de OpenAI provider selecteert in de UI).

*Let op: Omdat dit een Vite applicatie is die lokaal draait, moeten de variabelen beginnen met `VITE_` om toegankelijk te zijn in de browser via `import.meta.env`.*

### 4. Applicatie Starten
Start de development server:
```bash
npm run dev
```
De applicatie is nu lokaal beschikbaar (meestal op `http://localhost:3000` of `http://localhost:5173`).

## Architectuur & Belangrijke Bestanden

- **`src/App.tsx`**: De hoofdcomponent. Bevat de UI, state management (inclusief de toggle voor `aiProvider`), en de verwerkingswachtrij (queue).
- **`src/lib/ai.ts`**: Bevat de logica voor de AI API calls. Hierin staan de functies `processDocument` (voor Gemini) en `processDocumentOpenAI` (voor OpenAI).
- **`src/lib/pdfSplitter.ts`**: Bevat de logica om grote PDF's op te splitsen. Gebruikt `pdf-lib` en `pdfjs-dist`.
- **`src/lib/pdfPreprocessor.ts`**: Bevat de geavanceerde OCR preprocessing functionaliteit (canvas manipulatie).

## Opmerking over OpenAI Integratie
De OpenAI integratie in `src/lib/ai.ts` is momenteel geïmplementeerd door tekst uit PDF's te extraheren via `pdfjs-dist` en dit als tekst naar `gpt-4o` te sturen, of door afbeeldingen als base64 te sturen. Dit is omdat de OpenAI Chat Completions API geen directe PDF-bestanden accepteert in de `messages` array (in tegenstelling tot Gemini's File API). Als de gebruiker de OpenAI integratie verder wil verbeteren (bijv. via de OpenAI Assistants API met File Search), kun jij (Claude) hen daar verder bij helpen!

Succes met het verder ontwikkelen van deze applicatie!
