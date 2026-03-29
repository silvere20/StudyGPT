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
