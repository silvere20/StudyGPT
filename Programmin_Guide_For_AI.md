# Programmin_Guide_For_AI

## Doel Van Dit Bestand
- Dit bestand is de centrale overdrachtsgids voor Codex en Claude.
- Werk dit bestand bij bij elke relevante codewijziging, runtime-bevinding, testuitkomst of architectuurbeslissing.
- Gebruik dit bestand als eerste bron voor context, huidige status, bekende risico's en open werk.

## Projectdoel
- **Projectnaam:** StudyFlow AI / Study Prep.
- **Doel:** studiemateriaal omzetten naar een bruikbaar studieplan en GPT-ready leerstructuur.
- **Gebruikerstaak:** documenten uploaden, laten verwerken, een studie-architectuur ontvangen en exports maken voor GPT/RAG-gebruik.
- **Belangrijkste output:**
  - hoofdstukken met weekindeling;
  - master study map;
  - GPT system instructions;
  - RAG-export in ZIP-vorm.

## Hoofdarchitectuur
- **Frontend:** React 19 + TypeScript + Vite.
- **Backend:** FastAPI.
- **Documentextractie:** `docling` voor tekstgebaseerde PDF/DOCX/PPTX/XLSX.
- **OCR:** lokale `tesseract` CLI voor afbeeldingen en gescande PDF's.
- **AI:** OpenAI via `backend/services/ai.py`.
- **Launcher:** `launcher.py` start backend en frontend voor lokale gebruikers.

## Datastroom
1. Frontend uploadt bestanden naar `/api/process` of `/api/process-simple`.
2. Backend beslist per request of single-file cache toegepast mag worden.
3. Bestanden worden lokaal geëxtraheerd:
   - tekstbestanden direct;
   - tekst-PDF via `docling`;
   - scan/image via `tesseract`.
4. De gecombineerde Markdown gaat naar OpenAI voor plan-generatie.
5. Frontend toont voortgang, resultaten en exportopties.

Bij grote AI-input probeert de backend eerst een directe GPT-call en schakelt daarna automatisch over op chunked batchverwerking als OpenAI de request afwijst wegens grootte of TPM-limieten.
De uiteindelijke weekindeling wordt nu in een aparte planningsstap bepaald op basis van hoofdstuktitels/samenvattingen, zodat weekgrenzen logischer en gelijkmatiger blijven.
Bij extreem grote scanpagina's splitst de OCR-laag PDF-pagina's en afbeeldingen automatisch in kleinere tiles voordat Tesseract wordt aangeroepen.

## Belangrijke Bestanden
- [src/App.tsx](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/src/App.tsx)
- [src/api/client.ts](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/src/api/client.ts)
- [src/components/LazyMarkdown.tsx](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/src/components/LazyMarkdown.tsx)
- [backend/main.py](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/backend/main.py)
- [backend/services/document.py](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/backend/services/document.py)
- [backend/services/ocr.py](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/backend/services/ocr.py)
- [backend/services/ai.py](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/backend/services/ai.py)
- [launcher.py](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/launcher.py)

## Werkafspraken Voor AI-Agents
- Werk nooit stilzwijgend langs dit bestand heen; noteer gedrag, rationale en testbewijs hier.
- Revert nooit zomaar bestaande gebruikerswijzigingen in de worktree.
- Documenteer niet alleen wat is aangepast, maar ook welke bug of trade-off daarmee is aangepakt.
- Als live-smokes extra runtimeproblemen blootleggen, voeg die meteen toe aan het wijzigingslog en de open risico's.
- Gebruik tests als regressiebewijs waar mogelijk; noem live-smokes expliciet apart van unit/regressietests.

## Wijzigingslog

### 2026-03-29 - Donkere modus basis toegevoegd
- **Bestanden:** `src/App.tsx`, `src/components/UploadSection.tsx`, `src/components/ProgressBar.tsx`, `src/index.css`
- **Doel:** dark-mode ondersteuning via systeemvoorkeur en handmatige toggle.
- **Wijzigingen:** `@custom-variant dark` toegevoegd aan `index.css` (Tailwind v4 class-strategie); `darkMode` state initialiseert vanuit `prefers-color-scheme`; `useEffect` plaatst/verwijdert `dark`-class op `<html>`; toggle-knop (Sun/Moon) in header; dark-varianten toegevoegd op hoofdlayout, uploadzone en progressbalk.
- **Gedragsimpact:** app volgt systeemvoorkeur bij eerste load; gebruiker kan handmatig wisselen.
- **Resterend risico:** ResultsSection en chapter-cards nog niet omgezet; dat is een volgende iteratie.

### 2026-03-29 - Tesseract startup-validatie en health-uitbreiding
- **Bestanden:** `backend/services/ocr.py`, `backend/main.py`, `src/api/client.ts`, `src/types.ts`, `src/App.tsx`, `src/components/UploadSection.tsx`
- **Doel:** vroeg detecteren van ontbrekende Tesseract-taaldata zodat gebruikers direct feedback krijgen.
- **Wijzigingen:** `check_tesseract_languages()` toegevoegd aan `ocr.py`; bij startup in `main.py` wordt de check uitgevoerd en gelogd; `/api/health` uitgebreid met `ocr_available` en `ocr_missing_langs`; frontend toont `'warning'` status (oranje) bij ontbrekende taaldata; genereren is nog steeds toegestaan bij `'warning'` (met toast).
- **Gedragsimpact:** ontbrekende taaldata leidt niet meer tot cryptische foutmelding mid-verwerking maar tot duidelijke waarschuwing bij upload.
- **Testbewijs:** `test_health_includes_ocr_status` groen.
- **Resterend risico:** check wordt eenmalig bij startup uitgevoerd; herstart nodig na installatie van taaldata.

### 2026-03-29 - ResultsContext toegevoegd, prop-drilling opgelost
- **Bestanden:** `src/context/ResultsContext.tsx` (nieuw), `src/App.tsx`, `src/components/ResultsSection.tsx`, `src/components/SetupPanel.tsx`
- **Doel:** prop-drilling van >15 callbacks elimineren via React Context.
- **Wijzigingen:** `ResultsContextValue` interface gecentraliseerd in `src/context/ResultsContext.tsx`; `ResultsSection` en `SetupPanel` consumeren context via `useResultsContext()`; `App.tsx` levert `ResultsContext.Provider`.
- **Gedragsimpact:** geen gedragswijziging; uitbreiden van ResultsSection vereist geen aanpassing in App.tsx meer.
- **Testbewijs:** `npm run lint` groen; vitest groen.
- **Resterend risico:** context re-rendert alle consumers bij elke state-update; bij performance-problemen kan `useMemo` worden toegevoegd op het value-object.

### 2026-03-29 - Rate limiting via asyncio.Semaphore
- **Bestand:** `backend/main.py`
- **Doel:** stapeling van OpenAI-calls voorkomen bij gelijktijdige uploads.
- **Wijzigingen:** `asyncio.Semaphore(3)` beschermt `/api/process`; client krijgt directe SSE `error` bij overschrijding via `asyncio.wait_for(..., timeout=0)`; semaphore wordt altijd vrijgegeven in `finally`-blok.
- **Gedragsimpact:** maximaal 3 uploads tegelijk; daarna direct afgewezen met herkenbare Nederlandse foutmelding.
- **Testbewijs:** `test_process_returns_error_when_semaphore_full` groen.
- **Resterend risico:** limiet van 3 is hardcoded; aanpassen via env-variabele is een volgende stap.

### 2026-03-29 - OCR parallellisatie via ProcessPoolExecutor
- **Bestand:** [backend/services/ocr.py](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/backend/services/ocr.py)
- **Doel:** OCR-verwerkingstijd reduceren bij multi-page gescande PDFs.
- **Wijzigingen:** `_ocr_executor = ProcessPoolExecutor(max_workers=4)` toegevoegd; nieuwe top-level worker `_ocr_page_worker(args)` verwerkt één pagina synchroon met alle lokale imports voor pickle-compatibiliteit; `ocr_pdf` gebruikt nu `loop.run_in_executor` per pagina en `asyncio.as_completed` voor parallelle uitvoering; volgorde gegarandeerd via `page_index`-sortering na completion.
- **Gedragsimpact:** verwerkingstijd schaalt nu sublineair met aantal pagina's bij multi-core hardware; GIL-vrij dankzij ProcessPool.
- **Testbewijs:** `test_ocr_pdf_respects_page_order` groen.
- **Resterend risico:** `max_workers=4` is hardcoded; bij zware servers kan dit omhoog; op systemen met `spawn` start-methode (macOS standaard) is de opstarttijd van workers hoger dan bij `fork`.

### 2026-03-29 - Per-bestand extractie-cache toegevoegd
- **Bestanden:** [backend/services/cache.py](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/backend/services/cache.py), [backend/main.py](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/backend/main.py), [backend/tests/test_main.py](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/backend/tests/test_main.py)
- **Doel:** herverwerking van al bekende bestanden vermijden bij multi-file uploads.
- **Wijzigingen:** `get_cached_markdown` / `save_markdown_to_cache` toegevoegd aan `cache.py` (slaan `md_{hash}.txt` op naast `{hash}.json`); in `event_stream()` wordt de bestandshash nu altijd berekend; vóór `process_document` wordt de markdown-cache geraadpleegd; bij een hit wordt een `step="cache"` SSE-event verstuurd en het bestand overgeslagen; bij een miss wordt na verwerking de markdown opgeslagen; de StudyPlan-cache voor single-file uploads blijft ongewijzigd als tweede laag.
- **Gedragsimpact:** repeat-bestanden slaan docling/OCR over en hergebruiken gecachte markdown, ook als ze samen met nieuwe bestanden worden geüpload.
- **Testbewijs:** nieuwe regressietest `test_multi_file_uses_markdown_cache` groen.
- **Resterend risico:** markdown-cache heeft geen TTL; handmatig de `backend/cache/` map legen bij structurele extractiewijzigingen.

### 2026-03-29 - CI/CD pipeline toegevoegd
- **Bestand:** [.github/workflows/ci.yml](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/.github/workflows/ci.yml)
- **Doel:** automatisch tests en lint afdwingen bij elke push en pull request.
- **Wijzigingen:** GitHub Actions workflow met Node 20, Python 3.11, Tesseract, frontend/backend test en lint; npm- en pip-cache toegevoegd voor snellere runs; dummy `OPENAI_API_KEY` zodat de app opstart zonder te crashen tijdens CI.
- **Gedragsimpact:** regressies worden automatisch gedetecteerd zonder handmatig `npm run test` te draaien.
- **Testbewijs:** workflow-syntax gevalideerd; lokale tests blijven groen.
- **Resterend risico:** CI draait geen live OCR-smoke of OpenAI-calls vanwege secrets.

### 2026-03-28 - Backend stabiliteitsronde
- **Bestanden:** [backend/main.py](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/backend/main.py)
- **Doel:** multi-file requests stabiel maken, progressie echt doorgeven en terminale states afdwingen.
- **Wijzigingen:**
  - cache is nu bewust `single-file-only`;
  - multi-file requests stoppen niet meer vroegtijdig bij een cache-hit;
  - `process_document(..., on_progress=...)` en `generate_study_plan(..., on_progress=...)` lopen nu echt door naar SSE;
  - tijdelijke bestanden worden veiliger opgeruimd;
  - streaming requests eindigen nu semantisch in één `result` of één `error`.
- **Gedragsimpact:** de frontend krijgt echte document- en AI-progressie en multi-file uploads leveren geen verkeerd cached single-file resultaat meer terug.
- **Testbewijs:** backend regressietests in `backend/tests/test_main.py` plus live multi-file API smoke buiten sandbox.
- **Resterend risico:** SSE blijft afhankelijk van lange server-side bewerkingen; disconnects worden gelogd maar niet hervat.

### 2026-03-28 - Frontend requestflow en UX-hardening
- **Bestanden:** [src/App.tsx](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/src/App.tsx), [src/api/client.ts](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/src/api/client.ts), [src/components/LazyMarkdown.tsx](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/src/components/LazyMarkdown.tsx)
- **Doel:** cancel correct laten werken, health-status zichtbaar maken en zware clientcode uit de initiële bundle halen.
- **Wijzigingen:**
  - `processDocuments` ondersteunt nu een optionele `AbortSignal`;
  - streamparser behandelt gefragmenteerde SSE-events robuuster;
  - stream-einde zonder `result` of `error` wordt als fout behandeld;
  - App gebruikt nu echte fetch-abort bij annuleren;
  - backend/OpenAI health-status wordt zichtbaar vóór genereren;
  - Markdown-rendering wordt lazy geladen;
  - `jszip` wordt dynamisch geïmporteerd bij export.
- **Gedragsimpact:** minder hangende loading-states, betere foutcommunicatie, lagere initiële bundle.
- **Testbewijs:** frontendtests in `src/api/client.test.ts` en `src/App.test.tsx`, plus productiebouw.
- **Resterend risico:** health-check valideert beschikbaarheid en API key, maar niet de kwaliteit van downstream OCR/docling tijdens runtime.

### 2026-03-28 - Launcher robuuster gemaakt
- **Bestand:** [launcher.py](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/launcher.py)
- **Doel:** lokale startfouten zichtbaar maken en half-opgestarte toestand voorkomen.
- **Wijzigingen:**
  - controle op ontbrekende `backend/.venv`;
  - logcapturing voor backend/frontend;
  - foutdetails zichtbaar in GUI;
  - backend wordt opgeruimd als frontend-start mislukt;
  - processen worden netter beëindigd.
- **Gedragsimpact:** betere diagnose bij lokale setupfouten.
- **Testbewijs:** Python compile-check; functionele launcher-validatie blijft handmatig.
- **Resterend risico:** launcher houdt geen actieve health-polling na startup.

### 2026-03-28 - Testinfrastructuur toegevoegd
- **Bestanden:** [package.json](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/package.json), [vitest.config.ts](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/vitest.config.ts), [src/test/setup.ts](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/src/test/setup.ts), [src/api/client.test.ts](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/src/api/client.test.ts), [src/App.test.tsx](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/src/App.test.tsx), [backend/tests/test_main.py](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/backend/tests/test_main.py), [backend/tests/test_ocr.py](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/backend/tests/test_ocr.py), [backend/requirements-dev.txt](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/backend/requirements-dev.txt), [pytest.ini](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/pytest.ini)
- **Doel:** regressies detecteerbaar maken in frontend en backend.
- **Wijzigingen:**
  - `vitest` + `jsdom` + `@testing-library/react` toegevoegd;
  - `pytest` toegevoegd aan backend dev requirements;
  - root test scripts toegevoegd;
  - regressietests voor cache/SSE/errorflow/OCR heuristiek/client abort/rendering toegevoegd.
- **Gedragsimpact:** wijzigingen zijn reproduceerbaar te valideren.
- **Testbewijs:** `npm run test` en afzonderlijke runs bevestigd groen.
- **Resterend risico:** er is nog geen CI-pipeline die deze tests automatisch afdwingt.

### 2026-03-28 - Runtime compatibiliteitsfixes uit live smoke-tests
- **Bestanden:** [backend/services/ocr.py](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/backend/services/ocr.py), [backend/services/document.py](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/backend/services/document.py), [README.md](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/README.md)
- **Doel:** code laten aansluiten op de werkelijk geïnstalleerde lokale dependencies.
- **Bevestigde problemen:**
  - de eerdere `myocr.pipelines` import bestond niet in de geïnstalleerde `myocr` package;
  - `ocrmac` gaf in deze omgeving geen bruikbare OCR-output terug op synthetische testbeelden;
  - de bestaande `docling` tabelconfig gebruikte een verouderde API-vorm;
  - de scan-detectie classificeerde korte tekst-PDF's foutief als gescand.
- **Wijzigingen:**
  - OCR volledig omgezet naar lokale `tesseract` CLI;
  - `docling` gebruikt nu `TableStructureOptions(...)` in plaats van een verouderde dict-config;
  - `docling` OCR staat uit voor tekst-PDF flow omdat scan/image al apart wordt afgehandeld;
  - scan-detectie kijkt nu naar tekstdichtheid én tekstdekking per pagina.
- **Gedragsimpact:** live smokes voor TXT, tekst-PDF, afbeelding en gescande PDF leveren nu bruikbare content op.
- **Testbewijs:** live document smoke met synthetische fixtures; extra regressietests in `backend/tests/test_ocr.py`.
- **Resterend risico:** OCR-kwaliteit blijft afhankelijk van lokale Tesseract taaldata en inputkwaliteit.

### 2026-03-28 - Dashboard startconfig gecorrigeerd
- **Bestanden:** [package.json](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/package.json), [.claude/launch.json](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/.claude/launch.json), [vite.config.ts](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/vite.config.ts), [launcher.py](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/launcher.py), [README.md](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/README.md)
- **Doel:** StudyFlow weer startbaar maken vanuit dashboard/launch-configs.
- **Bevestigde problemen:**
  - de oude backend startte via systeem-`python3` in plaats van `backend/.venv/bin/python`;
  - `.claude/launch.json` wees daardoor naar een backendconfig die in deze repo direct faalde;
  - `npm run dev:backend` was om dezelfde reden ook stuk;
  - frontendstart liep via `localhost`/IPv6, wat in beperkte omgevingen sneller stuk kan gaan.
- **Wijzigingen:**
  - `dev:backend` gebruikt nu de backend venv;
  - nieuwe `dashboard`, `dashboard:frontend` en `dashboard:backend` scripts toegevoegd;
  - dashboardbackend start nu zonder `--reload` en met `--app-dir backend`;
  - `.claude/launch.json` heeft nu een expliciete `StudyFlow AI (Dashboard)` full-stack config;
  - frontend bindt nu expliciet aan `127.0.0.1`;
  - launcher opent nu `http://127.0.0.1:3000`;
  - README-startinstructies wijzen nu ook naar de backend venv en `127.0.0.1`.
- **Gedragsimpact:** dashboardstarts gebruiken nu een pad dat niet afhankelijk is van systeem-Python of reload-watchers.
- **Testbewijs:** gereproduceerd dat de oude backendstart faalde met `No module named uvicorn`; nieuwe `npm run dashboard:backend` startte wel door; lint/tests/build bleven groen.
- **Resterend risico:** `npm run dev:backend` gebruikt bewust nog `--reload` voor lokale ontwikkeling en kan in gesandboxte omgevingen alsnog op watcher-permissies stuiten.

### 2026-03-28 - Dashboard cwd-afhankelijkheid opgelost
- **Bestanden:** [.claude/launch.json](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/.claude/launch.json), [Programmin_Guide_For_AI.md](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/Programmin_Guide_For_AI.md)
- **Doel:** dashboardstart ook laten werken wanneer de launcher niet exact vanuit de repo-root wordt uitgevoerd.
- **Bevestigd probleem:**
  - de repo-launchconfig gebruikte relatieve commando's zoals `npm run dashboard` en `./backend/.venv/bin/python`;
  - die werken alleen wanneer de huidige working directory exact `/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google` is;
  - gereproduceerd vanuit `/Users/silvereoosterlen/Desktop/Projecten`: `npm run dashboard` faalde met `ENOENT` op ontbrekende `package.json`, en `./backend/.venv/bin/python` faalde met `no such file or directory`.
- **Wijzigingen:**
  - `.claude/launch.json` gebruikt nu `npm --prefix /Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google ...` voor frontend en full-stack dashboardstart;
  - de backendlaunch gebruikt nu een absoluut pad naar `backend/.venv/bin/python`;
  - `--app-dir` wijst nu ook expliciet naar de absolute backendmap;
  - de parent-workspaceconfig op `/Users/silvereoosterlen/Desktop/Projecten/.claude/launch.json` is gesynchroniseerd met dezelfde werkende startconfig.
- **Gedragsimpact:** de repo-launchconfig is niet langer afhankelijk van de startmap van Dashboard en blijft werken wanneer Dashboard de app vanaf een bovenliggende workspace of algemene projectmap uitvoert.
- **Testbewijs:** frontend en backend waren tegelijk bereikbaar via `http://127.0.0.1:3000` en `http://127.0.0.1:8000/api/health` terwijl `npm run dashboard` draaide; de oude relatieve launchcommando's zijn bewust vanaf de parent-map gereproduceerd en faalden daar direct.
- **Resterend risico:** deze absolute paden zijn bewust machine-specifiek; als de repo wordt verplaatst, moeten de launch-configs opnieuw worden gesynchroniseerd.

### 2026-03-28 - Automatische AI-batchverwerking bij te grote uploads
- **Bestanden:** [backend/services/ai.py](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/backend/services/ai.py), [backend/tests/test_ai.py](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/backend/tests/test_ai.py), [README.md](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/README.md), [Programmin_Guide_For_AI.md](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/Programmin_Guide_For_AI.md)
- **Doel:** voorkomen dat grote multi-file uploads stuklopen op OpenAI `429`/`request too large` fouten.
- **Bevestigd probleem:**
  - de backend stuurde alle gecombineerde documentinhoud in één GPT-4o request;
  - bij grote OCR-PDF's liep dat tegen TPM- of requestgrootte-limieten aan;
  - de gebruiker kreeg dan alleen een harde fout terug in plaats van automatische opsplitsing.
- **Wijzigingen:**
  - `generate_study_plan(...)` probeert nog steeds eerst de directe GPT-flow;
  - bij bekende grootte-/TPM-fouten schakelt de backend nu automatisch over op chunked batchverwerking;
  - grote markdown wordt semantisch opgesplitst op documentgrenzen, headings en paragrafen;
  - als een batch nog steeds te groot is, wordt die recursief verder opgesplitst;
  - deelhoofdstukken worden lokaal samengevoegd tot een definitief studieplan met hernummerde weken/hoofdstukken, een gegenereerde master study map en standaard GPT-instructies;
  - regressietests dekken fallback-triggering, chunksize-limieten en het samenvoegen van deelhoofdstukken.
- **Gedragsimpact:** de app kan grote uploads nu zelfstandig in batches verwerken in plaats van de gebruiker te dwingen bestanden handmatig op te splitsen.
- **Testbewijs:** `backend/.venv/bin/python -m pytest backend/tests` groen met nieuwe `backend/tests/test_ai.py`; `npm run lint` blijft groen.
- **Resterend risico:** de chunked fallback levert een robuust eindplan op, maar de globale weekindeling en master study map werden in eerste instantie nog te lokaal samengesteld en moesten daarom verder worden aangescherpt.

### 2026-03-28 - Weekverdeling losgetrokken van vaste lokale regel
- **Bestanden:** [backend/services/ai.py](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/backend/services/ai.py), [backend/tests/test_ai.py](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/backend/tests/test_ai.py), [README.md](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/README.md), [Programmin_Guide_For_AI.md](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/Programmin_Guide_For_AI.md)
- **Doel:** voorkomen dat weekverdeling ontspoort door een vaste lokale hoofdstukken-per-week regel.
- **Bevestigd probleem:**
  - de eerdere fallback kende weken lokaal toe met een vaste `3 hoofdstukken per week` benadering;
  - dat gaf onnatuurlijke weekgrenzen en sloot niet aan op logische onderwerpsovergangen;
  - de gebruiker wilde expliciet geen autonome lokale weekverdeling meer, maar een gelijkmatige indeling die door OpenAI logisch wordt gekozen.
- **Wijzigingen:**
  - directe én chunked planflows lopen nu door een aparte weekplanner;
  - die weekplanner gebruikt alleen hoofdstukmetadata, houdt de hoofdstukvolgorde vast en vraagt OpenAI om een logische maar gelijkmatige weekindeling;
  - IDs en master study map worden pas daarna lokaal opgebouwd op basis van die planner-uitkomst;
  - alleen als die lichte planner-call zelf faalt, valt de backend terug op een simpele gelijkmatige lokale verdeling.
- **Gedragsimpact:** weekgrenzen zijn niet langer gebaseerd op een harde lokale `3 chapters per week` regel, maar op een OpenAI-gestuurde planning die balans en logische topicgrenzen combineert.
- **Testbewijs:** `backend/.venv/bin/python -m pytest backend/tests` groen; nieuwe tests dekken evenwichtige fallback-verdeling, ID-hernummering en de OpenAI-weekplannerintegratie.
- **Resterend risico:** als de aparte weekplanner-call faalt, blijft er bewust nog een eenvoudige lokale evenredige fallback bestaan om de run niet te blokkeren.

### 2026-03-28 - OCR beveiligd tegen gigantische scanrenders
- **Bestanden:** [backend/services/ocr.py](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/backend/services/ocr.py), [backend/tests/test_ocr.py](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/backend/tests/test_ocr.py), [README.md](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/README.md), [Programmin_Guide_For_AI.md](/Users/silvereoosterlen/Desktop/Projecten/Study-GPT-Google/Programmin_Guide_For_AI.md)
- **Doel:** voorkomen dat Tesseract/Leptonica crasht op extreem grote PDF-scanpagina's of afbeeldingen.
- **Bevestigd probleem:**
  - sommige OCR-PDF's leverden bij 300 DPI absurd grote renderafmetingen op, zoals ongeveer `14250 x 60000` pixels;
  - Tesseract faalde daarop met `pixCreateHeader` / `requested bytes >= 2^31`;
  - de volledige run stopte daardoor al vóór de AI-stap.
- **Wijzigingen:**
  - PDF-OCR rendert grote pagina's nu in meerdere kleinere tiles in plaats van één gigantische PNG;
  - image-OCR gebruikt dezelfde tile-logica voor extreme afbeeldingsafmetingen;
  - tilegroottes worden begrensd op breedte, hoogte en totaal aantal pixels zodat Tesseract een veilige input krijgt;
  - nieuwe regressietest valideert dat extreme afmetingen automatisch in meerdere veilige tiles worden opgesplitst.
- **Gedragsimpact:** zeer grote scanpagina's kunnen nu nog steeds OCR krijgen zonder Leptonica/Tesseract overflow door één monsterafbeelding.
- **Testbewijs:** `backend/.venv/bin/python -m pytest backend/tests` groen met extra `test_build_tile_boxes_splits_extremely_large_images`; `npm run lint` groen.
- **Resterend risico:** bij uitzonderlijk exotische paginaformaten kan OCR nog steeds traag zijn, omdat de backend dan meerdere tiles sequentieel moet verwerken.

## Componentstructuur Frontend (na refactor 2026-03-29)

### Overzicht nieuwe bestanden
De monolithische `src/App.tsx` (±1200 regels) is opgesplitst in kleinere, herbruikbare bestanden.

### Gedeelde types en utilities
| Bestand | Inhoud |
|---------|--------|
| `src/types.ts` | `UploadedFile`, `FileProgressInfo`, `HealthStatus`, `HealthSnapshot` — gedeelde TypeScript-types voor upload- en health-state. |
| `src/utils.ts` | `cn()` (Tailwind merge), `formatFileSize()`, `countWords()`, `sanitizeFilename()` — puur functionele helpers zonder React-afhankelijkheden. |

### Hooks
| Bestand | Verantwoordelijkheid |
|---------|----------------------|
| `src/hooks/useDocumentProcessor.ts` | Beheert de volledige upload-verwerking: bestandslijst, drop-deduplicatie, SSE-streaming voortgang per bestand, annuleren via `AbortController`, en succes/fout-callbacks. App.tsx geeft `onSuccess` en `onBeforeGenerate` door; de hook beheert alle eigen state en refs. |

### Componenten
| Bestand | Toont | Ontvangt van App.tsx |
|---------|-------|----------------------|
| `src/components/ProgressBar.tsx` | Verwerkingsscherm: globale voortgangsbalk, per-bestand status (wachtend/bezig/klaar/fout) én `SkeletonLoader` als preview. | `progressMessage`, `progressPercent`, `files`, `fileProgress`, `onCancel` |
| `src/components/SkeletonLoader.tsx` | Geanimeerde skeletskeleton van de toekomstige resultatenkaarten: stats-balk, onderwerpssidebar en drie hoofdstukkaarten. Geeft gebruikers visuele feedback over de eindvorm. | — (geen props) |
| `src/components/UploadSection.tsx` | Uploadscherm: dropzone (inclusief eigen `useDropzone`), health-status banner, bestandslijst met verwijderknop, genereer-knop en de drie instructiestappen onderaan. | `files`, `onDrop`, `healthStatus`, `healthMessage`, `onRefreshHealth`, `onRemoveFile`, `onGenerate` |
| `src/components/SetupPanel.tsx` | Geanimeerd GPT-instellingenpaneel: RAG ZIP download, Master Map preview, System Instructions kopiëren. Verschijnt boven de resultatenkaarten na genereren. | `plan`, `zipFileCount`, `zipGenerating`, `showMapPreview`, `copiedId`, diverse callbacks |
| `src/components/ResultsSection.tsx` | Volledig resultatenweergave: stats-balk, GPT Setup Guide toggle, onderwerpssidebar met scroll-navigatie, zoekbalk, collapse/expand all en hoofdstukkaarten per onderwerp. Rendert `SetupPanel` intern. | `plan`, `files`, `filteredChapters`, `expandedChapters`, `filterQuery`, `zipFileCount`, `totalWords`, `zipGenerating`, `copiedId`, `showSetup`, `showMapPreview`, `topicRefs`, diverse callbacks |
| `src/components/LazyMarkdown.tsx` | Lazy-loaded Markdown renderer voor zware content in chapter-cards en Master Map preview. | `children`, `loadingLabel` |

### Wat App.tsx nog beheert
- Alle React state (`plan`, `copiedId`, `showSetup`, `showMapPreview`, `expandedChapters`, `healthStatus`, `filterQuery`, `zipGenerating`)
- Health-check logica (`refreshHealth`, `applyHealthSnapshot`)
- Plan-state reset (`resetPlanState`, `onSuccess`)
- Download-functies (`downloadStudyMap`, `downloadAllPrompts`, `downloadOptimizedRagZip`)
- Prompt-formatting (`formatPrompt`, `copyAllPrompts`)
- Navigatie (`scrollToTopic`, `toggleChapter`)
- Afgeleide waarden (`filteredChapters`, `totalWords`, `zipFileCount`)
- Header-JSX en de `<style>` tag voor de custom scrollbar

## Prestatiebevindingen
- Initiële frontendbundle is teruggebracht van ongeveer **737 kB** naar ongeveer **486 kB** voor het grootste chunkbestand.
- De eerdere Vite chunk warning is verdwenen na lazy-loading van Markdown en ZIP-export.
- Grootste resterende clientchunk zit nog steeds rond 486 kB; verdere opsplitsing kan later nog winst geven.

## Live Smoke Resultaten
- **TXT verwerking:** geslaagd.
- **Tekst-PDF verwerking:** geslaagd na scan-heuristiek/docling-fix.
- **Afbeelding OCR:** geslaagd met lokale `tesseract`.
- **Gescande PDF OCR:** geslaagd met lokale `tesseract`.
- **Directe OpenAI-plan generatie:** geslaagd buiten sandbox.
- **Echte multi-file API route (`/api/process-simple`):** geslaagd buiten sandbox.

## Huidige Teststatus
- `npm run lint`: geslaagd.
- `npm run test`: geslaagd.
- `npm run build`: geslaagd.
- `py_compile` op gewijzigde Pythonbestanden: geslaagd.

### 2026-03-30 - Bestandsvolgorde bevestigd en SSE result uitgebreid
- **Bestanden:** `backend/main.py`, `backend/tests/test_main.py`
- **Doel:** transparantie over de volgorde waarin bestanden zijn verwerkt.
- **Bevinding:** FastAPI bewaart de volgorde van multipart-uploadbestanden als de volgorde van het `files: list[UploadFile]` argument; `asyncio.gather` in de verwerkingsloop behoudt die volgorde. De frontend-bestandsvolgorde (na drag-and-drop herschikking) komt dus correct aan bij de backend.
- **Wijziging:** het SSE `result`-event bevat nu een extra veld `file_order: list[str]` met de bestandsnamen in de volgorde waarin ze zijn verwerkt. Dit stelt de frontend in staat om de volgorde te verifiëren.
- **Testbewijs:** `test_result_event_contains_file_order` groen.

### 2026-03-30 - Backend health-polling na startup
- **Bestanden:** `src/App.tsx`
- **Doel:** gebruikers direct waarschuwen als de backend crasht tijdens een actieve sessie.
- **Wijziging:** `setInterval` van 30 seconden roept `refreshHealth(false)` aan (stille poll — geen "Backend controleren..."-flits). Bij overgang `healthy/warning → backend-offline` verschijnt een persistente error-toast (duration: Infinity). Bij herstel (`backend-offline → healthy/warning`) wordt die toast gesloten en verschijnt een korte success-toast. De polling slaat een tick over als `loading === true` (actieve verwerking). Interval wordt gecleard bij component-unmount.
- **Gedragsimpact:** offline-backend binnen ~30 seconden zichtbaar voor de gebruiker, zonder dat zij een nieuwe actie hoeven te ondernemen.

## Bekende Risico's En Verbeterideeën
- Voeg CI toe zodat frontend- en backendtests niet handmatig hoeven te worden bewaakt.
- Voeg een expliciete health-indicator toe in de results-view of launcher voor backend/OpenAI-status na startup.
- Onderzoek verdere code-splitting van de grootste resterende frontendchunk.
- Overweeg gestructureerde observability/logging voor lange documentverwerking in productie.
- Overweeg een expliciete dependency-check bij appstart voor `tesseract`.
- `index.html` gebruikt nog een generieke titeltekst en kan functioneel/netter worden bijgewerkt.
- Als dashboardstart nog hapert, gebruik eerst `npm run dashboard` in plaats van `npm run dev`; de dashboardroute vermijdt watcher-problemen.
- De chunked AI-fallback is nu functioneel, maar kan later nog slimmer worden gemaakt met modelgestuurde eindconsolidatie zodra daar budget/rate headroom voor is.
- De aparte weekplanner gebruikt alleen hoofdstukmetadata; als semantische grenzen nóg nauwkeuriger moeten, kan later een rijkere planner-input worden toegevoegd.
- Bij zeer lange gescande pagina's is stabiliteit nu beter, maar verwerkingstijd kan oplopen doordat OCR tile-voor-tile gebeurt.

## Handoff Status
- **Afgerond:** stabiliteitsfixes backend/frontend, launcher-hardening, testinfrastructuur, runtime compatibiliteitsfixes, automatische AI-batchfallback, logische OpenAI-weekplanner, tile-based OCR voor extreme scans, centrale AI-handleiding.
- **Bevestigd werkend:** mock-regressies en live lokale document/AI smokes.
- **Aannames:** lokale machine heeft `tesseract` beschikbaar; OpenAI live-checks vereisen netwerktoegang buiten sandbox.
- **Volgende logische stap:** CI toevoegen en eventueel de laatste zware frontendchunk verder opsplitsen.
