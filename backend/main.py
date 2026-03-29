import asyncio
import json
import logging
import os
import tempfile
from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path
from typing import TypeVar

from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from models.schemas import ProcessingResult
from services.ai import generate_study_plan
from services.cache import (
    get_cached_markdown,
    get_cached_result,
    get_file_hash,
    save_markdown_to_cache,
    save_to_cache,
)
from services.document import process_document

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

T = TypeVar("T")
ProgressCallback = Callable[[str, int, str], Awaitable[None]]

app = FastAPI(title="Study-GPT Backend", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    has_key = bool(os.getenv("OPENAI_API_KEY"))
    return {"status": "ok", "openai_configured": has_key}


@app.post("/api/process")
async def process_files(files: list[UploadFile] = File(...)):
    """
    Process uploaded documents and return a structured StudyPlan.
    Uses SSE (Server-Sent Events) for real-time progress updates.
    Sends per-file progress with fileIndex and fileName fields.
    """

    async def event_stream():
        try:
            all_markdown = []
            total_files = len(files)
            use_cache = total_files == 1
            file_hash: str | None = None

            for idx, upload_file in enumerate(files):
                file_num = idx + 1
                filename = upload_file.filename or f"document_{file_num}"

                # Read file bytes
                file_bytes = await upload_file.read()

                # Always compute hash — used by both cache layers
                file_hash = get_file_hash(file_bytes)

                # Layer 1: StudyPlan cache (single-file uploads only)
                if use_cache:
                    cached = get_cached_result(file_hash)
                    if cached:
                        yield _sse_event(
                            "progress",
                            {
                                "step": "cache",
                                "progress": 100,
                                "message": "Bestand gevonden in cache!",
                                "fileIndex": idx,
                                "fileName": filename,
                            },
                        )
                        yield _sse_event("result", cached.model_dump())
                        return

                # Layer 2: Markdown extraction cache (all uploads)
                cached_markdown = get_cached_markdown(file_hash)
                if cached_markdown is not None:
                    yield _sse_event(
                        "progress",
                        {
                            "step": "cache",
                            "progress": 100,
                            "message": f"Extractie uit cache: {filename}",
                            "fileIndex": idx,
                            "fileName": filename,
                        },
                    )
                    all_markdown.append(
                        f"# Document: {filename}\n\n{cached_markdown}"
                    )
                    continue

                # Save to temp file for processing
                suffix = Path(filename).suffix
                with tempfile.NamedTemporaryFile(
                    delete=False, suffix=suffix
                ) as tmp:
                    tmp.write(file_bytes)
                    tmp_path = tmp.name

                try:
                    progress_queue: asyncio.Queue[str] = asyncio.Queue()
                    on_progress = _build_progress_callback(
                        progress_queue,
                        file_index=idx,
                        file_name=filename,
                        total_files=total_files,
                    )

                    # Process document (docling + OCR)
                    yield _sse_event(
                        "progress",
                        {
                            "step": "document",
                            "progress": 0,
                            "message": f"Bestand verwerken: {filename}...",
                            "fileIndex": idx,
                            "fileName": filename,
                        },
                    )

                    document_task = asyncio.create_task(
                        process_document(
                            tmp_path,
                            filename,
                            on_progress=on_progress,
                        )
                    )
                    async for progress_event in _drain_progress_queue(
                        document_task, progress_queue
                    ):
                        yield progress_event

                    markdown = await document_task
                    save_markdown_to_cache(file_hash, markdown)
                    all_markdown.append(
                        f"# Document: {filename}\n\n{markdown}"
                    )

                    yield _sse_event(
                        "progress",
                        {
                            "step": "document",
                            "progress": 100,
                            "message": f"Document verwerkt.",
                            "fileIndex": idx,
                            "fileName": filename,
                        },
                    )

                finally:
                    Path(tmp_path).unlink(missing_ok=True)

            # Combine all documents and generate study plan
            combined_content = "\n\n---\n\n".join(all_markdown)
            ai_progress_queue: asyncio.Queue[str] = asyncio.Queue()
            ai_on_progress = _build_progress_callback(ai_progress_queue)

            yield _sse_event(
                "progress",
                {
                    "step": "ai",
                    "progress": 0,
                    "message": "Studieplan genereren met GPT-4.1...",
                },
            )

            ai_task = asyncio.create_task(
                generate_study_plan(
                    combined_content,
                    on_progress=ai_on_progress,
                )
            )
            async for progress_event in _drain_progress_queue(
                ai_task, ai_progress_queue
            ):
                yield progress_event

            plan = await ai_task

            if use_cache and file_hash:
                save_to_cache(file_hash, plan)

            yield _sse_event(
                "progress",
                {
                    "step": "done",
                    "progress": 100,
                    "message": "Studieplan succesvol gegenereerd!",
                },
            )
            yield _sse_event("result", plan.model_dump())

        except asyncio.CancelledError:
            logger.info("Client disconnected during /api/process stream")
            raise
        except Exception as e:
            logger.exception("Error processing documents")
            yield _sse_event(
                "error",
                {"message": f"Er is een fout opgetreden: {str(e)}"},
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/process-simple")
async def process_files_simple(files: list[UploadFile] = File(...)):
    """Simple non-streaming endpoint for compatibility."""
    try:
        all_markdown = []
        use_cache = len(files) == 1
        cached_file_hash: str | None = None

        for upload_file in files:
            file_bytes = await upload_file.read()

            if use_cache:
                cached_file_hash = get_file_hash(file_bytes)
                cached = get_cached_result(cached_file_hash)
                if cached:
                    return ProcessingResult(success=True, plan=cached).model_dump()

            suffix = Path(upload_file.filename or "file").suffix
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(file_bytes)
                tmp_path = tmp.name

            try:
                markdown = await process_document(
                    tmp_path, upload_file.filename or "document"
                )
                all_markdown.append(
                    f"# Document: {upload_file.filename}\n\n{markdown}"
                )
            finally:
                Path(tmp_path).unlink(missing_ok=True)

        combined = "\n\n---\n\n".join(all_markdown)
        plan = await generate_study_plan(combined)

        if use_cache and cached_file_hash:
            save_to_cache(cached_file_hash, plan)

        return ProcessingResult(success=True, plan=plan).model_dump()

    except Exception as e:
        logger.exception("Error processing documents")
        return ProcessingResult(success=False, error=str(e)).model_dump()


def _sse_event(event_type: str, data: dict) -> str:
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"


def _build_progress_callback(
    queue: asyncio.Queue[str],
    *,
    file_index: int | None = None,
    file_name: str | None = None,
    total_files: int | None = None,
) -> ProgressCallback:
    prefix = (
        f"[{file_index + 1}/{total_files}] "
        if file_index is not None and total_files is not None
        else ""
    )

    async def on_progress(step: str, progress: int, message: str) -> None:
        event_data: dict = {
            "step": step,
            "progress": progress,
            "message": f"{prefix}{message}",
        }
        if file_index is not None:
            event_data["fileIndex"] = file_index
        if file_name is not None:
            event_data["fileName"] = file_name

        await queue.put(_sse_event("progress", event_data))

    return on_progress


async def _drain_progress_queue(
    task: "asyncio.Task[T]", queue: asyncio.Queue[str]
) -> AsyncIterator[str]:
    while True:
        if task.done() and queue.empty():
            break

        try:
            progress_event = await asyncio.wait_for(queue.get(), timeout=0.1)
        except asyncio.TimeoutError:
            continue

        yield progress_event
