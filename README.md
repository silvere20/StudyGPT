# StudyFlow AI

Verander je documenten in een interactieve AI tutor. Upload PDF's, slides, Word-documenten en meer, en ontvang een gestructureerd studieplan met GPT-instructies.

Bij zeer grote uploads schakelt de backend automatisch over op batchverwerking, zodat OpenAI TPM-/request-limieten minder snel de hele run blokkeren.
De weekindeling wordt daarna apart logisch en zo gelijkmatig mogelijk gepland op basis van de gegenereerde hoofdstukken, in plaats van via een vaste lokale hoofdstukken-per-week regel.
Extreem grote scanpagina's worden daarnaast automatisch in kleinere OCR-tegels verwerkt, zodat Tesseract niet crasht op gigantische tussenafbeeldingen.

## Vereisten

- **Node.js** 18+
- **Python** 3.11+
- **Tesseract OCR** 5+
- **OpenAI API key** ([verkrijg hier](https://platform.openai.com/api-keys))

## Installatie

### 1. Frontend dependencies

```bash
npm install
```

### 2. Python backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Installeer daarnaast lokaal Tesseract als die nog niet aanwezig is:

```bash
brew install tesseract
```

### 3. API key instellen

Maak een `.env` bestand in de `backend/` map:

```bash
cp backend/.env.example backend/.env
```

Vul je OpenAI API key in het `.env` bestand in.

## Starten

Start beide servers tegelijk:

```bash
npm run dev
```

Voor dashboard-/launcherachtige omgevingen zonder file watchers:

```bash
npm run dashboard
```

Of apart:

```bash
# Terminal 1: Frontend
npm run dev:frontend

# Terminal 2: Backend
./backend/.venv/bin/python -m uvicorn --app-dir backend main:app --reload --port 8000
```

Open http://127.0.0.1:3000 in je browser.

## Architectuur

- **Frontend**: React + TypeScript + Vite (poort 3000)
- **Backend**: Python FastAPI (poort 8000)
- **OCR**: lokale `tesseract` CLI (300 DPI voor gescande PDF's en afbeeldingen)
- **Documentverwerking**: docling (IBM) - PDF, DOCX, PPTX, XLSX
- **AI**: OpenAI GPT-4o

## Testen

```bash
npm run test:frontend
npm run test:backend
```

## Belangrijke Bestanden

- `src/App.tsx` - Hoofdcomponent (UI)
- `src/api/client.ts` - API client voor backend communicatie
- `backend/main.py` - FastAPI server met endpoints
- `backend/services/document.py` - docling documentverwerking
- `backend/services/ocr.py` - Tesseract OCR integratie (300 DPI)
- `backend/services/ai.py` - OpenAI GPT-4o integratie
- `backend/services/cache.py` - SHA-256 file-hash caching
