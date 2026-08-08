import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarClock,
  Clock,
  PlayCircle,
  CheckCircle2,
  Plus,
  ArrowRight,
  ListTodo,
} from 'lucide-react';
import type { Task } from '../types';
import { getTasks, priorityColors, taskStatusColors, taskStatusLabels } from '../store';

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    setTasks(getTasks());
  }, []);

  const today = new Date().toISOString().split('T')[0];

  const todayTasks = tasks.filter((t) => t.dueDate === today);
  const weekTasks = tasks.filter((t) => {
    const due = new Date(t.dueDate);
    const now = new Date();
    const diff = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 7;
  });
  const inProgressTasks = tasks.filter((t) => t.status === 'in-progress');
  const completedTasks = tasks.filter((t) => t.status === 'completed');

  const todaySorted = [...todayTasks].sort((a, b) => {
    const pOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
    return pOrder[a.priority] - pOrder[b.priority];
  });

  const stats = [
    { label: '今日待办', value: todayTasks.length, icon: CalendarClock, color: 'from-azure-500 to-azure-600', bg: 'bg-azure-50', text: 'text-azure-600' },
    { label: '本周到期', value: weekTasks.length, icon: Clock, color: 'from-orange-500 to-orange-600', bg: 'bg-orange-50', text: 'text-orange-600' },
    { label: '进行中', value: inProgressTasks.length, icon: PlayCircle, color: 'from-purple-500 to-purple-600', bg: 'bg-purple-50', text: 'text-purple-600' },
    { label: '已完成', value: completedTasks.length, icon: CheckCircle2, color: 'from-green-500 to-green-600', bg: 'bg-green-50', text: 'text-green-600' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">仪表盘</h1>
        <p className="text-sm text-slate-500 mt-1">欢迎回来，今天也要高效工作哦！</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-slate-500 font-medium">{stat.label}</p>
                  <p className="text-3xl font-bold text-slate-800 mt-2">{stat.value}</p>
                </div>
                <div className={`w-11 h-11 rounded-xl ${stat.bg} flex items-center justify-center`}>
                  <Icon className={`w-5 h-5 ${stat.text}`} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          to="/tasks"
          state={{ openNew: true }}
          className="group bg-gradient-to-br from-azure-500 to-azure-600 rounded-xl p-6 text-white shadow-md hover:shadow-lg transition-all hover:-translate-y-0.5"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
              <Plus className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">新建任务</h3>
              <p className="text-sm text-azure-100">快速添加一项新任务</p>
            </div>
          </div>
          <div className="mt-4 flex items-center text-sm text-azure-100 group-hover:text-white transition-colors">
            立即开始
            <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </Link>

        <Link
          to="/tasks"
          className="group bg-white rounded-xl p-6 shadow-sm border border-slate-100 hover:shadow-md transition-all hover:-translate-y-0.5"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center">
              <ListTodo className="w-6 h-6 text-slate-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-800">查看全部任务</h3>
              <p className="text-sm text-slate-500">管理和查看所有任务</p>
            </div>
          </div>
          <div className="mt-4 flex items-center text-sm text-slate-500 group-hover:text-azure-600 transition-colors">
            进入任务中心
            <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </Link>
      </div>

      {/* Today's tasks */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">今日任务概览</h2>
          <Link to="/tasks" className="text-sm text-azure-600 hover:text-azure-700 font-medium">
            查看全部
          </Link>
        </div>
        <div className="divide-y divide-slate-50">
          {todaySorted.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" />
              <p className="text-slate-500">今天没有待办任务，休息一下吧！</p>
            </div>
          ) : (
            todaySorted.map((task) => (
              <div key={task.id} className="px-6 py-4 flex items-center gap-4 hover:bg-slate-50 transition-colors">
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
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
