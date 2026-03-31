import { useState, useCallback, useEffect } from 'react';
import type { Course } from '../types';
import type { StudyPlan } from '../api/client';

const STORAGE_KEY_COURSES = 'studyflow_courses';
const STORAGE_KEY_ACTIVE = 'studyflow_active_course';

function generateId(): string {
  return `course_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function loadCourses(): Course[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_COURSES);
    return saved ? (JSON.parse(saved) as Course[]) : [];
  } catch {
    return [];
  }
}

function loadActiveId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_ACTIVE);
  } catch {
    return null;
  }
}

export function useCourses() {
  const [courses, setCourses] = useState<Course[]>(loadCourses);
  const [activeId, setActiveId] = useState<string | null>(loadActiveId);

  // Persist courses
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_COURSES, JSON.stringify(courses));
    } catch { /* storage unavailable */ }
  }, [courses]);

  // Persist active id
  useEffect(() => {
    try {
      if (activeId) {
        localStorage.setItem(STORAGE_KEY_ACTIVE, activeId);
      } else {
        localStorage.removeItem(STORAGE_KEY_ACTIVE);
      }
    } catch { /* storage unavailable */ }
  }, [activeId]);

  const activeCourse = courses.find(c => c.id === activeId) ?? null;

  const createCourse = useCallback((name: string): Course => {
    const now = new Date().toISOString();
    const course: Course = {
      id: generateId(),
      name,
      createdAt: now,
      updatedAt: now,
      plan: null,
      studiedChapters: [],
      topicOrder: [],
      editedChapterIds: [],
      sourceFileNames: [],
    };
    setCourses(prev => [...prev, course]);
    setActiveId(course.id);
    return course;
  }, []);

  const renameCourse = useCallback((id: string, name: string) => {
    setCourses(prev => prev.map(c =>
      c.id === id ? { ...c, name, updatedAt: new Date().toISOString() } : c
    ));
  }, []);

  const deleteCourse = useCallback((id: string) => {
    setCourses(prev => prev.filter(c => c.id !== id));
    setActiveId(prev => (prev === id ? null : prev));
  }, []);

  const openCourse = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const closeCourse = useCallback(() => {
    setActiveId(null);
  }, []);

  const updateCoursePlan = useCallback((plan: StudyPlan, sourceFileNames: string[]) => {
    if (!activeId) return;
    setCourses(prev => prev.map(c =>
      c.id === activeId
        ? {
            ...c,
            plan,
            topicOrder: plan.topics,
            editedChapterIds: [],
            studiedChapters: [],
            sourceFileNames,
            updatedAt: new Date().toISOString(),
          }
        : c
    ));
  }, [activeId]);

  const updateCourseProgress = useCallback((studiedChapters: string[]) => {
    if (!activeId) return;
    setCourses(prev => prev.map(c =>
      c.id === activeId ? { ...c, studiedChapters, updatedAt: new Date().toISOString() } : c
    ));
  }, [activeId]);

  const updateCourseTopicOrder = useCallback((topicOrder: string[]) => {
    if (!activeId) return;
    setCourses(prev => prev.map(c =>
      c.id === activeId ? { ...c, topicOrder, updatedAt: new Date().toISOString() } : c
    ));
  }, [activeId]);

  const updateCourseChapter = useCallback((
    chapterId: string,
    edits: { title: string; summary: string; content: string }
  ) => {
    if (!activeId) return;
    setCourses(prev => prev.map(c => {
      if (c.id !== activeId || !c.plan) return c;
      const chapters = c.plan.chapters.map(ch =>
        ch.id === chapterId ? { ...ch, ...edits } : ch
      );
      return {
        ...c,
        plan: { ...c.plan, chapters },
        editedChapterIds: [...new Set([...c.editedChapterIds, chapterId])],
        updatedAt: new Date().toISOString(),
      };
    }));
  }, [activeId]);

  const clearCoursePlan = useCallback((id: string) => {
    setCourses(prev => prev.map(c =>
      c.id === id
        ? { ...c, plan: null, studiedChapters: [], topicOrder: [], editedChapterIds: [], updatedAt: new Date().toISOString() }
        : c
    ));
  }, []);

  return {
    courses,
    activeCourse,
    activeId,
    createCourse,
    renameCourse,
    deleteCourse,
    openCourse,
    closeCourse,
    updateCoursePlan,
    updateCourseProgress,
    updateCourseTopicOrder,
    updateCourseChapter,
    clearCoursePlan,
  };
}
