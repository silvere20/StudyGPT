from typing import Literal

from pydantic import BaseModel, Field


class Chapter(BaseModel):
    id: str
    title: str
    summary: str
    topic: str
    content: str
    key_concepts: list[str] = Field(default_factory=list)
    related_sections: list[str] = Field(default_factory=list)


class VerificationReport(BaseModel):
    status: Literal["OK", "WARNING", "CRITICAL"]
    word_ratio: float
    missing_keywords: list[str] = Field(default_factory=list)
    exercise_count_original: int
    exercise_count_generated: int
    issues: list[str] = Field(default_factory=list)


class CourseMetadata(BaseModel):
    has_formulas: bool = False
    has_exercises: bool = False
    has_code: bool = False
    primary_language: str = "nl"
    exercise_types: list[str] = Field(default_factory=list)
    total_exercises: int = 0
    detected_tools: list[str] = Field(default_factory=list)
    difficulty_keywords: list[str] = Field(default_factory=list)


class StudyPlan(BaseModel):
    chapters: list[Chapter]
    topics: list[str]
    masterStudyMap: str
    gptSystemInstructions: str
    verificationReport: VerificationReport | None = None
    courseMetadata: CourseMetadata | None = None


class SectionAnalysis(BaseModel):
    start_marker: str
    section_type: str
    suggested_topic: str
    suggested_chapter_title: str
    related_sections: list[str]


class StructureAnalysis(BaseModel):
    sections: list[SectionAnalysis]
    suggested_topics: list[str]
    document_type: str


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
