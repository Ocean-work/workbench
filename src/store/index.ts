import type { Task, Project, Priority, TaskStatus, ProjectStatus } from '../types';

const TASKS_KEY = 'workbench_tasks';
const PROJECTS_KEY = 'workbench_projects';
const INITIALIZED_KEY = 'workbench_initialized';

const sampleProjects: Project[] = [
  {
    id: 'proj-1',
    name: '2025届毕业设计',
    status: 'in-progress',
    startDate: '2025-03-01',
    goal: '完成2025届动画专业毕业设计指导工作，包括选题、开题、中期检查、答辩等环节。',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'proj-2',
    name: '动画专业课程建设',
    status: 'planning',
    startDate: '2025-06-01',
    goal: '优化动画专业核心课程体系，更新教学大纲和实训项目。',
    createdAt: new Date().toISOString(),
  },
];

const sampleTasks: Task[] = [
  {
    id: 'task-1',
    name: '审阅开题报告',
    projectId: 'proj-1',
    projectName: '2025届毕业设计',
    dueDate: new Date().toISOString().split('T')[0],
    priority: 'P0',
    status: 'in-progress',
    notes: '共15份开题报告，需要在本周内完成全部审阅并给出修改意见。',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'task-2',
    name: '准备中期检查材料',
    projectId: 'proj-1',
    projectName: '2025届毕业设计',
    dueDate: '2025-06-15',
    priority: 'P1',
    status: 'pending',
    notes: '整理中期检查评分表、检查清单和流程安排。',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'task-3',
    name: '角色设计课程大纲更新',
    projectId: 'proj-2',
    projectName: '动画专业课程建设',
    dueDate: new Date().toISOString().split('T')[0],
    priority: 'P2',
    status: 'completed',
    notes: '已完成角色设计课程大纲更新，新增AI辅助设计内容。',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'task-4',
    name: '三维建模实训项目设计',
    projectId: 'proj-2',
    projectName: '动画专业课程建设',
    dueDate: '2025-07-01',
    priority: 'P1',
    status: 'in-progress',
    notes: '设计一个完整的三维建模实训项目，涵盖从建模到渲染的全流程。',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'task-5',
    name: '答辩委员会组建',
    projectId: 'proj-1',
    projectName: '2025届毕业设计',
    dueDate: '2025-05-20',
    priority: 'P3',
    status: 'on-hold',
    notes: '等待院系最终确定答辩时间后再组建。',
    createdAt: new Date().toISOString(),
  },
];

export function initializeData() {
  if (!localStorage.getItem(INITIALIZED_KEY)) {
    localStorage.setItem(TASKS_KEY, JSON.stringify(sampleTasks));
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(sampleProjects));
    localStorage.setItem(INITIALIZED_KEY, 'true');
  }
}

// Tasks
export function getTasks(): Task[] {
  const data = localStorage.getItem(TASKS_KEY);
  return data ? JSON.parse(data) : [];
}

export function saveTasks(tasks: Task[]) {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

export function addTask(task: Omit<Task, 'id' | 'createdAt'>): Task {
  const tasks = getTasks();
  const newTask: Task = {
    ...task,
    id: 'task-' + Date.now(),
    createdAt: new Date().toISOString(),
  };
  tasks.push(newTask);
  saveTasks(tasks);
  return newTask;
}

export function updateTask(id: string, updates: Partial<Task>) {
  const tasks = getTasks();
  const index = tasks.findIndex(t => t.id === id);
  if (index !== -1) {
    tasks[index] = { ...tasks[index], ...updates };
    saveTasks(tasks);
  }
  return tasks;
}

export function deleteTask(id: string): Task[] {
  const tasks = getTasks().filter(t => t.id !== id);
  saveTasks(tasks);
  return tasks;
}

// Projects
export function getProjects(): Project[] {
  const data = localStorage.getItem(PROJECTS_KEY);
  return data ? JSON.parse(data) : [];
}

export function saveProjects(projects: Project[]) {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

export function addProject(project: Omit<Project, 'id' | 'createdAt'>): Project {
  const projects = getProjects();
  const newProject: Project = {
    ...project,
    id: 'proj-' + Date.now(),
    createdAt: new Date().toISOString(),
  };
  projects.push(newProject);
  saveProjects(projects);
  return newProject;
}

export function updateProject(id: string, updates: Partial<Project>) {
  const projects = getProjects();
  const index = projects.findIndex(p => p.id === id);
  if (index !== -1) {
    projects[index] = { ...projects[index], ...updates };
    saveProjects(projects);
  }
  return projects;
}

export function deleteProject(id: string): Project[] {
  const projects = getProjects().filter(p => p.id !== id);
  saveProjects(projects);
  return projects;
}

// Utility
export const priorityLabels: Record<Priority, string> = {
  'P0': '紧急',
  'P1': '高',
  'P2': '中',
  'P3': '低',
};

export const taskStatusLabels: Record<TaskStatus, string> = {
  'pending': '待启动',
  'in-progress': '进行中',
  'completed': '已完成',
  'on-hold': '已搁置',
};

export const projectStatusLabels: Record<ProjectStatus, string> = {
  'planning': '规划中',
  'in-progress': '进行中',
  'completed': '已完成',
};

export const priorityColors: Record<Priority, string> = {
  'P0': 'bg-red-100 text-red-700 border-red-200',
  'P1': 'bg-orange-100 text-orange-700 border-orange-200',
  'P2': 'bg-yellow-100 text-yellow-700 border-yellow-200',
  'P3': 'bg-gray-100 text-gray-600 border-gray-200',
};

export const taskStatusColors: Record<TaskStatus, string> = {
  'pending': 'bg-slate-100 text-slate-600',
  'in-progress': 'bg-azure-100 text-azure-700',
  'completed': 'bg-green-100 text-green-700',
  'on-hold': 'bg-amber-100 text-amber-700',
};

export const projectStatusColors: Record<ProjectStatus, string> = {
  'planning': 'bg-purple-100 text-purple-700',
  'in-progress': 'bg-azure-100 text-azure-700',
  'completed': 'bg-green-100 text-green-700',
};
