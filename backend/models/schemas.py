from pydantic import BaseModel


class Chapter(BaseModel):
    id: str
    title: str
    summary: str
    topic: str
    content: str


class StudyPlan(BaseModel):
    chapters: list[Chapter]
    topics: list[str]
    masterStudyMap: str
    gptSystemInstructions: str


class ProcessingUpdate(BaseModel):
    step: str
    progress: int  # 0-100
    message: str
    fileIndex: int | None = None
    fileName: str | None = None


class ProcessingResult(BaseModel):
    success: bool
    plan: StudyPlan | None = None
    error: str | None = None
