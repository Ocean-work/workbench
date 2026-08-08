export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export type TaskStatus = 'pending' | 'in-progress' | 'completed' | 'on-hold';

export interface Task {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  dueDate: string;
  priority: Priority;
  status: TaskStatus;
  notes: string;
  createdAt: string;
}

export type ProjectStatus = 'planning' | 'in-progress' | 'completed';

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  startDate: string;
  goal: string;
  createdAt: string;
}

// DocSelfCheck types
export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  file: File;
  fromZip?: string;
}

export type CheckStep = 'integrity' | 'format' | 'consistency' | 'course' | 'confirm' | 'report';

export type StepStatus = 'idle' | 'loading' | 'completed' | 'error';

export interface CheckResultItem {
  id: string;
  category: string;
  description: string;
  location: string;
}

export interface CheckResult {
  totalFiles: number;
  errors: number;
  warnings: number;
  toConfirm: number;
  consistencyIssues: CheckResultItem[];
  courseMatches: CheckResultItem[];
  formatIssues: CheckResultItem[];
  toConfirmItems: CheckResultItem[];
}
