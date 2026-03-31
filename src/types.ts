import type { StudyPlan } from './api/client';

export type UploadedFile = {
  file: File;
  type: string;
};

export type FileProgressInfo = {
  status: 'waiting' | 'processing' | 'done' | 'error';
  progress: number;
  message: string;
};

export type HealthStatus = 'checking' | 'healthy' | 'backend-offline' | 'missing-key' | 'warning';

export type HealthSnapshot = {
  status: Exclude<HealthStatus, 'checking'>;
  message: string;
};

export type Course = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  plan: StudyPlan | null;
  studiedChapters: string[];
  topicOrder: string[];
  editedChapterIds: string[];
  sourceFileNames: string[];
};
