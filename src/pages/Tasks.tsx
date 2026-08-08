import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Plus,
  LayoutList,
  Kanban,
  Target,
  Pencil,
  Trash2,
  GripVertical,
} from 'lucide-react';
import type { Task, Priority, TaskStatus } from '../types';
import {
  getTasks,
  addTask,
  updateTask,
  deleteTask,
  getProjects,
  priorityLabels,
  taskStatusLabels,
  priorityColors,
  taskStatusColors,
} from '../store';
import Modal from '../components/Modal';

type ViewMode = 'table' | 'kanban' | 'week';

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<ViewMode>('table');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const location = useLocation();

  // 表单状态
  const [formData, setFormData] = useState({
    name: '',
    projectId: '',
    projectName: '',
    dueDate: '',
    priority: 'P2' as Priority,
    status: 'pending' as TaskStatus,
    notes: '',
  });

  useEffect(() => {
    setTasks(getTasks());
    // 从 state 判断是否打开新建弹窗
    if (location.state && (location.state as any).openNew) {
      setModalOpen(true);
      setEditingTask(null);
      resetForm();
    }
  }, [location.state]);

  const projects = getProjects();

  const resetForm = () => {
    setFormData({
      name: '',
      projectId: projects[0]?.id || '',
      projectName: projects[0]?.name || '',
      dueDate: new Date().toISOString().split('T')[0],
      priority: 'P2',
      status: 'pending',
      notes: '',
    });
  };

  const handleOpenNew = () => {
    setEditingTask(null);
    resetForm();
    setModalOpen(true);
  };

  const handleEdit = (task: Task) => {
    setEditingTask(task);
    setFormData({
      name: task.name,
      projectId: task.projectId,
      projectName: task.projectName,
      dueDate: task.dueDate,
      priority: task.priority,
      status: task.status,
      notes: task.notes,
    });
    setModalOpen(true);
  };

  const handleDelete = (id: string) => {
    if (confirm('确定要删除这个任务吗？')) {
      const updated = deleteTask(id);
      setTasks(updated);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    if (editingTask) {
      const updated = updateTask(editingTask.id, formData);
      setTasks(updated);
    } else {
      const newTask = addTask(formData);
      setTasks([...tasks, newTask]);
    }
    setModalOpen(false);
  };

  // 看板视图拖拽
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);

  const handleDragStart = (task: Task) => {
    setDraggedTask(task);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (status: TaskStatus) => {
    if (draggedTask && draggedTask.status !== status) {
      const updated = updateTask(draggedTask.id, { status });
      setTasks(updated);
    }
    setDraggedTask(null);
  };

  const statusOrder: TaskStatus[] = ['pending', 'in-progress', 'completed', 'on-hold'];

  const kanbanColumns = useMemo(() => {
    const cols: Record<TaskStatus, Task[]> = {
      'pending': [],
      'in-progress': [],
      'completed': [],
      'on-hold': [],
    };
    tasks.forEach((t) => cols[t.status].push(t));
    return cols;
  }, [tasks]);

  const weekTasks = useMemo(() => {
    return tasks
      .filter((t) => {
        const due = new Date(t.dueDate);
        const now = new Date();
        const diff = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        return diff >= -2 && diff <= 7;
      })
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  }, [tasks]);

  const getWeekDay = (dateStr: string) => {
    const d = new Date(dateStr);
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return days[d.getDay()];
  };

  const viewOptions = [
    { value: 'table' as ViewMode, label: '表格视图', icon: LayoutList },
    { value: 'kanban' as ViewMode, label: '看板视图', icon: Kanban },
    { value: 'week' as ViewMode, label: '本周焦点', icon: Target },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">任务中心</h1>
          <p className="text-sm text-slate-500 mt-1">共 {tasks.length} 个任务</p>
        </div>
        <button
          onClick={handleOpenNew}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-azure-600 text-white rounded-lg hover:bg-azure-700 transition-colors font-medium text-sm shadow-sm"
        >
          <Plus className="w-4 h-4" />
          新建任务
        </button>
      </div>

      {/* View tabs */}
      <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200 shadow-sm w-fit">
        {viewOptions.map((opt) => {
          const Icon = opt.icon;
          const isActive = view === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => setView(opt.value)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-azure-50 text-azure-700'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Table view */}
      {view === 'table' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    任务名称
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    所属项目
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    截止日期
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    优先级
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    状态
                  </th>
                  <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {tasks.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                      暂无任务，点击右上角新建吧
                    </td>
                  </tr>
                ) : (
                  tasks.map((task) => (
                    <tr key={task.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-slate-800">{task.name}</div>
                        {task.notes && (
                          <div className="text-xs text-slate-400 mt-1 truncate max-w-xs">{task.notes}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">{task.projectName}</td>
                      <td className="px-6 py-4 text-sm text-slate-600">{task.dueDate}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-2 py-0.5 text-xs font-semibold rounded-full border ${priorityColors[task.priority]}`}
                        >
                          {task.priority} · {priorityLabels[task.priority]}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-2.5 py-1 text-xs font-medium rounded-full ${taskStatusColors[task.status]}`}
                        >
                          {taskStatusLabels[task.status]}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => handleEdit(task)}
                            className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-azure-600 transition-colors"
                            title="编辑"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(task.id)}
                            className="p-1.5 rounded-md hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                            title="删除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Kanban view */}
      {view === 'kanban' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {statusOrder.map((status) => (
            <div
              key={status}
              className="bg-slate-50 rounded-xl p-3 min-h-[200px]"
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(status)}
            >
              <div className="px-2 py-2 mb-3 flex items-center justify-between">
                <span
                  className={`px-2.5 py-1 text-xs font-semibold rounded-full ${taskStatusColors[status]}`}
                >
                  {taskStatusLabels[status]}
                </span>
                <span className="text-xs text-slate-400 font-medium">
                  {kanbanColumns[status].length}
                </span>
              </div>
              <div className="space-y-2">
                {kanbanColumns[status].map((task) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={() => handleDragStart(task)}
                    className="bg-white rounded-lg p-3 shadow-sm border border-slate-100 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow group"
                  >
                    <div className="flex items-start gap-2">
                      <GripVertical className="w-4 h-4 text-slate-300 group-hover:text-slate-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span
                            className={`px-1.5 py-0.5 text-[10px] font-bold rounded border ${priorityColors[task.priority]}`}
                          >
                            {task.priority}
                          </span>
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEdit(task);
                              }}
                              className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-azure-600"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(task.id);
                              }}
                              className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        <p className="text-sm font-medium text-slate-800 line-clamp-2">
                          {task.name}
                        </p>
                        <p className="text-xs text-slate-400 mt-2">{task.dueDate}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{task.projectName}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Week view */}
      {view === 'week' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-800">本周焦点任务</h2>
            <p className="text-xs text-slate-400 mt-1">展示近 7 天内到期的任务，按日期排序</p>
          </div>
          <div className="divide-y divide-slate-50">
            {weekTasks.length === 0 ? (
              <div className="px-6 py-12 text-center text-slate-400">
                本周暂无待办任务
              </div>
            ) : (
              weekTasks.map((task) => {
                const isOverdue =
                  new Date(task.dueDate) < new Date(new Date().toDateString()) &&
                  task.status !== 'completed';
                return (
                  <div key={task.id} className="px-6 py-4 flex items-center gap-4 hover:bg-slate-50 transition-colors">
                    <div className="w-14 text-center flex-shrink-0">
                      <p className="text-lg font-bold text-slate-700">
                        {task.dueDate.split('-')[2]}
                      </p>
                      <p className={`text-xs ${isOverdue ? 'text-red-500' : 'text-slate-400'}`}>
                        {getWeekDay(task.dueDate)}
                      </p>
                    </div>
                    <span
                      className={`px-2 py-0.5 text-xs font-semibold rounded-full border ${priorityColors[task.priority]}`}
                    >
                      {task.priority}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{task.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{task.projectName}</p>
                    </div>
                    <span
                      className={`px-2.5 py-1 text-xs font-medium rounded-full ${taskStatusColors[task.status]}`}
                    >
                      {taskStatusLabels[task.status]}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleEdit(task)}
                        className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-azure-600"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Task Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingTask ? '编辑任务' : '新建任务'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              任务名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-azure-500/30 focus:border-azure-500 transition-shadow"
              placeholder="请输入任务名称"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">所属项目</label>
            <select
              value={formData.projectId}
              onChange={(e) => {
                const p = projects.find((pr) => pr.id === e.target.value);
                setFormData({
                  ...formData,
                  projectId: e.target.value,
                  projectName: p?.name || '',
                });
              }}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-azure-500/30 focus:border-azure-500 transition-shadow bg-white"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">截止日期</label>
              <input
                type="date"
                value={formData.dueDate}
                onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-azure-500/30 focus:border-azure-500 transition-shadow"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">优先级</label>
              <select
                value={formData.priority}
                onChange={(e) =>
                  setFormData({ ...formData, priority: e.target.value as Priority })
                }
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-azure-500/30 focus:border-azure-500 transition-shadow bg-white"
              >
                <option value="P0">P0 · 紧急</option>
                <option value="P1">P1 · 高</option>
                <option value="P2">P2 · 中</option>
                <option value="P3">P3 · 低</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">状态</label>
            <select
              value={formData.status}
              onChange={(e) =>
                setFormData({ ...formData, status: e.target.value as TaskStatus })
              }
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-azure-500/30 focus:border-azure-500 transition-shadow bg-white"
            >
              <option value="pending">待启动</option>
              <option value="in-progress">进行中</option>
              <option value="completed">已完成</option>
              <option value="on-hold">已搁置</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">备注</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-azure-500/30 focus:border-azure-500 transition-shadow resize-none"
              placeholder="添加任务备注..."
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
              {editingTask ? '保存修改' : '创建任务'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
