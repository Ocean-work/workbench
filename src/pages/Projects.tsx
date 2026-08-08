import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, Calendar, Folder } from 'lucide-react';
import type { Project, ProjectStatus } from '../types';
import {
  getProjects,
  addProject,
  updateProject,
  deleteProject,
  projectStatusLabels,
  projectStatusColors,
  getTasks,
} from '../store';
import Modal from '../components/Modal';

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    status: 'planning' as ProjectStatus,
    startDate: new Date().toISOString().split('T')[0],
    goal: '',
  });

  useEffect(() => {
    setProjects(getProjects());
  }, []);

  const resetForm = () => {
    setFormData({
      name: '',
      status: 'planning',
      startDate: new Date().toISOString().split('T')[0],
      goal: '',
    });
  };

  const handleOpenNew = () => {
    setEditingProject(null);
    resetForm();
    setModalOpen(true);
  };

  const handleEdit = (project: Project) => {
    setEditingProject(project);
    setFormData({
      name: project.name,
      status: project.status,
      startDate: project.startDate,
      goal: project.goal,
    });
    setModalOpen(true);
  };

  const handleDelete = (id: string) => {
    if (confirm('确定要删除这个项目吗？关联的任务不会被删除。')) {
      const updated = deleteProject(id);
      setProjects(updated);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    if (editingProject) {
      const updated = updateProject(editingProject.id, formData);
      setProjects(updated);
    } else {
      const newProject = addProject(formData);
      setProjects([...projects, newProject]);
    }
    setModalOpen(false);
  };

  const getTaskCount = (projectId: string) => {
    return getTasks().filter((t) => t.projectId === projectId).length;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">项目管理</h1>
          <p className="text-sm text-slate-500 mt-1">共 {projects.length} 个项目</p>
        </div>
        <button
          onClick={handleOpenNew}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-azure-600 text-white rounded-lg hover:bg-azure-700 transition-colors font-medium text-sm shadow-sm"
        >
          <Plus className="w-4 h-4" />
          新建项目
        </button>
      </div>

      {/* Project cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {projects.length === 0 ? (
          <div className="col-span-full bg-white rounded-xl shadow-sm border border-slate-100 p-12 text-center">
            <Folder className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-400">暂无项目，点击右上角新建吧</p>
          </div>
        ) : (
          projects.map((project) => {
            const taskCount = getTaskCount(project.id);
            return (
              <div
                key={project.id}
                className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 hover:shadow-md transition-all group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-azure-500 to-azure-600 flex items-center justify-center flex-shrink-0">
                    <Folder className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleEdit(project)}
                      className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-azure-600"
                      title="编辑"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(project.id)}
                      className="p-1.5 rounded-md hover:bg-red-50 text-slate-400 hover:text-red-500"
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <h3 className="text-base font-semibold text-slate-800 mb-1 line-clamp-1">
                  {project.name}
                </h3>

                <div className="flex items-center gap-2 mb-3">
                  <span
                    className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${projectStatusColors[project.status]}`}
                  >
                    {projectStatusLabels[project.status]}
                  </span>
                  <span className="text-xs text-slate-400">{taskCount} 个任务</span>
                </div>

                <p className="text-sm text-slate-500 line-clamp-3 mb-4 min-h-[3rem]">
                  {project.goal || '暂无目标描述'}
                </p>

                <div className="flex items-center gap-1.5 text-xs text-slate-400 pt-3 border-t border-slate-50">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>开始于 {project.startDate}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Project Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingProject ? '编辑项目' : '新建项目'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              项目名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-azure-500/30 focus:border-azure-500 transition-shadow"
              placeholder="请输入项目名称"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">状态</label>
              <select
                value={formData.status}
                onChange={(e) =>
                  setFormData({ ...formData, status: e.target.value as ProjectStatus })
                }
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-azure-500/30 focus:border-azure-500 transition-shadow bg-white"
              >
                <option value="planning">规划中</option>
                <option value="in-progress">进行中</option>
                <option value="completed">已完成</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">开始日期</label>
              <input
                type="date"
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-azure-500/30 focus:border-azure-500 transition-shadow"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">目标描述</label>
            <textarea
              value={formData.goal}
              onChange={(e) => setFormData({ ...formData, goal: e.target.value })}
              rows={4}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-azure-500/30 focus:border-azure-500 transition-shadow resize-none"
              placeholder="描述项目的目标和范围..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-azure-600 hover:bg-azure-700 rounded-lg transition-colors shadow-sm"
            >
              {editingProject ? '保存修改' : '创建项目'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
