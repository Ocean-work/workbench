import { useState, useRef, useCallback, useMemo } from 'react';
import {
  Upload,
  X,
  FileText,
  CheckCircle2,
  Loader2,
  AlertCircle,
  HelpCircle,
  Download,
  Search,
  ChevronDown,
  Archive,
} from 'lucide-react';
import JSZip from 'jszip';
import type { UploadedFile, CheckStep, StepStatus, CheckResult, CheckResultItem } from '../types';
import coursesData from '../data/courses.json';

const stepNames: CheckStep[] = [
  'integrity',
  'format',
  'consistency',
  'course',
  'confirm',
  'report',
];

const stepLabels: Record<CheckStep, string> = {
  integrity: '文件完整性',
  format: '逐文件格式',
  consistency: '跨文件一致性',
  course: '课程定位校验',
  confirm: '疑问确认',
  report: '生成报告',
};

// 根据上传的文件生成更真实的模拟检查结果
function generateMockResult(files: UploadedFile[], course: string, grade: string): CheckResult {
  const fileNames = files.map((f) => f.name);
  const formatIssues: CheckResultItem[] = [];
  const consistencyIssues: CheckResultItem[] = [];
  const courseMatches: CheckResultItem[] = [];
  const toConfirmItems: CheckResultItem[] = [];

  // 每个文件生成 1-3 个格式问题
  const formatTemplates = [
    { category: '格式-字体', desc: '正文使用了宋体小四，规范要求为宋体五号' },
    { category: '格式-页码', desc: '页码位置在页脚右侧，规范要求在页脚居中' },
    { category: '格式-标题', desc: '三级标题编号格式不统一，有的用"1.1.1"，有的用"（1）"' },
    { category: '格式-行距', desc: '参考文献部分行距为1.5倍，规范要求为固定值20磅' },
    { category: '格式-缩进', desc: '正文首行缩进为2字符中的0.85cm，在允许范围内' },
    { category: '格式-对齐', desc: '表格内文字居中对齐，规范要求为左对齐' },
  ];

  fileNames.forEach((fname, idx) => {
    const count = 1 + (idx % 3); // 1-3个问题
    for (let i = 0; i < count; i++) {
      const t = formatTemplates[(idx + i) % formatTemplates.length];
      formatIssues.push({
        id: `fi-${idx}-${i}`,
        category: t.category,
        description: t.desc,
        location: `${fname} · 第${(i + 1) * 2}页`,
      });
    }
  });

  // 跨文件一致性问题（2-3个）
  const consistencyTemplates = [
    {
      category: '内容-数据',
      desc: `各文件中"${course}"的学时数存在不一致，大纲为48学时，授课计划小计为64学时`,
      loc: '课程大纲 · 学时分配 / 授课计划 · 合计',
    },
    {
      category: '逻辑-结构',
      desc: '考核方式在大纲和进度表中表述不一致，大纲写"平时成绩40%+期末60%"，进度表写"平时30%+期末70%"',
      loc: '考核方案 · 第2节 / 教学进度表',
    },
    {
      category: '内容-数据',
      desc: '课程目标中"能力目标"第3条与毕业要求对应关系不明确',
      loc: '课程大纲 · 课程目标部分',
    },
  ];

  const consCount = Math.min(2 + Math.floor(fileNames.length / 3), 3);
  for (let i = 0; i < consCount; i++) {
    const t = consistencyTemplates[i];
    consistencyIssues.push({
      id: `ci-${i}`,
      category: t.category,
      description: t.desc,
      location: t.loc,
    });
  }

  // 课程定位匹配
  courseMatches.push({
    id: 'cm-1',
    category: '课程-定位',
    description: `"${course}"在${grade}级培养方案中已收录，课程定位匹配`,
    location: `${grade}级课程总表`,
  });
  if (fileNames.length >= 3) {
    courseMatches.push({
      id: 'cm-2',
      category: '课程-前置',
      description: '已识别到先修课程为"动画概论"，课程衔接关系合理',
      location: '课程体系对照',
    });
  }

  // 待确认项
  if (fileNames.length >= 2) {
    toConfirmItems.push({
      id: 'tc-1',
      category: '内容-争议',
      description: `实践环节占比是否合理？当前约为30%，同类院校${course}课程通常为40-50%`,
      location: '教学进度表',
    });
  }
  toConfirmItems.push({
    id: 'tc-2',
    category: '逻辑-确认',
    description: `${course}是否需要补充线上学习资源链接？当前大纲未列出`,
    location: '课程大纲 · 资源部分',
  });

  const errors = consistencyIssues.length + Math.floor(formatIssues.length / 2);
  const warnings = formatIssues.length - Math.floor(formatIssues.length / 2);

  return {
    totalFiles: files.length,
    errors,
    warnings,
    toConfirm: toConfirmItems.length,
    consistencyIssues,
    courseMatches,
    formatIssues,
    toConfirmItems,
  };
}

export default function DocSelfCheck() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [grade, setGrade] = useState('2025');
  const [course, setCourse] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [stepStatus, setStepStatus] = useState<Record<CheckStep, StepStatus>>({
    integrity: 'idle',
    format: 'idle',
    consistency: 'idle',
    course: 'idle',
    confirm: 'idle',
    report: 'idle',
  });
  const [result, setResult] = useState<CheckResult | null>(null);
  const [activeTab, setActiveTab] = useState<'consistency' | 'course' | 'format' | 'confirm'>('consistency');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const suggestionRef = useRef<HTMLDivElement>(null);

  const filteredSuggestions = useMemo(() => {
    const courseList = (coursesData as Record<string, string[]>)[grade] || [];
    if (!course.trim()) return courseList.slice(0, 30);
    const q = course.toLowerCase();
    return courseList.filter((s) => s.toLowerCase().includes(q)).slice(0, 30);
  }, [course, grade]);

  // 判断当前输入的课程是否在课程总表中
  const courseInList = useMemo(() => {
    const courseList = (coursesData as Record<string, string[]>)[grade] || [];
    return courseList.some((c) => c === course.trim());
  }, [course, grade]);

  // 判断是否模糊匹配（输入了部分但未完全匹配）
  const courseFuzzyMatch = useMemo(() => {
    if (!course.trim()) return null;
    const courseList = (coursesData as Record<string, string[]>)[grade] || [];
    const q = course.trim().toLowerCase();
    const match = courseList.find((c) => c.toLowerCase() === q);
    if (match) return null;
    const similar = courseList.find((c) => c.toLowerCase().includes(q) || q.includes(c.toLowerCase()));
    return similar || null;
  }, [course, grade]);

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList) return;
    const newFiles: UploadedFile[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      // zip 包：解压后提取其中的 docx 文件
      if (f.name.toLowerCase().endsWith('.zip')) {
        try {
          const zip = await JSZip.loadAsync(f);
          const zipFiles = Object.values(zip.files);
          for (const zf of zipFiles) {
            if (zf.dir) continue;
            const name = zf.name.split('/').pop() || '';
            if (!name || name.startsWith('~$') || name.startsWith('.')) continue;
            if (name.toLowerCase().endsWith('.docx')) {
              const blob = await zf.async('blob');
              const docFile = new File([blob], name, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
              newFiles.push({
                id: 'file-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
                name: name,
                size: blob.size,
                file: docFile,
                fromZip: f.name,
              });
            }
          }
        } catch (e) {
          console.warn('zip 解压失败:', f.name, e);
        }
      } else if (f.name.toLowerCase().endsWith('.docx')) {
        newFiles.push({
          id: 'file-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          name: f.name,
          size: f.size,
          file: f,
        });
      }
    }

    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const runCheck = async () => {
    if (files.length === 0) {
      alert('请先上传 docx 或 zip 文件');
      return;
    }
    if (!course.trim()) {
      alert('请输入课程名称');
      return;
    }

    setIsChecking(true);
    setResult(null);
    const initial: Record<CheckStep, StepStatus> = {
      integrity: 'idle',
      format: 'idle',
      consistency: 'idle',
      course: 'idle',
      confirm: 'idle',
      report: 'idle',
    };
    setStepStatus(initial);

    // 模拟逐步检查（耗时与文件数相关，看起来更真实）
    const baseDelays: Record<CheckStep, number> = {
      integrity: 500,
      format: 800 + files.length * 200,
      consistency: 1000 + files.length * 150,
      course: 600,
      confirm: 400,
      report: 700,
    };
    for (let i = 0; i < stepNames.length; i++) {
      const step = stepNames[i];
      setStepStatus((prev) => ({ ...prev, [step]: 'loading' }));
      await new Promise((resolve) => setTimeout(resolve, baseDelays[step]));
      setStepStatus((prev) => ({ ...prev, [step]: 'completed' }));
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
    setResult(generateMockResult(files, course, grade));
    setIsChecking(false);
  };

  const handleDownloadZip = async () => {
    const zip = new JSZip();
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const zipName = `${grade}级《${course}》课程档案_v001_${dateStr}_自检结果.zip`;

    // ===== 1. 检查报告（完整Markdown）=====
    const allIssues = [...(result?.consistencyIssues || []), ...(result?.formatIssues || [])];
    const errorCount = result?.errors || 0;
    const warningCount = result?.warnings || 0;

    const reportMd = `# ${grade}级《${course}》教学档案自检报告

> 生成时间：${now.toLocaleString('zh-CN')}
> 年级：${grade}级
> 课程名称：${course}
> 上传文件数：${files.length} 个

---

## 一、文件完整性检查

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 上传文件数 | ${files.length} 个 | - |
| 文件完整性 | ⚠️ 待确认 | 请核对是否包含所有必备文件 |

### 已上传文件清单
${files.map((f, i) => `${i + 1}. ${f.name}（${formatSize(f.size)}）`).join('\n')}

---

## 二、错误信息汇总

### 摘要
- **总问题数**：${errorCount + warningCount} 个
- **错误**：${errorCount} 个
- **警告**：${warningCount} 个
- **待确认**：${result?.toConfirm || 0} 个

### 跨文件一致性问题
${(result?.consistencyIssues || []).length > 0
  ? (result?.consistencyIssues || []).map((item, idx) =>
      `#### ${idx + 1}. [${item.category}] ${item.description}\n\n- **位置**：${item.location}`
    ).join('\n\n')
  : '暂无'
}

### 文件格式问题
${(result?.formatIssues || []).length > 0
  ? (result?.formatIssues || []).map((item, idx) =>
      `#### ${idx + 1}. [${item.category}] ${item.description}\n\n- **位置**：${item.location}`
    ).join('\n\n')
  : '暂无'
}

### 课程定位匹配
${(result?.courseMatches || []).length > 0
  ? (result?.courseMatches || []).map((item, idx) =>
      `#### ${idx + 1}. [${item.category}] ${item.description}\n\n- **依据**：${item.location}`
    ).join('\n\n')
  : '暂无'
}

### 待确认疑问
${(result?.toConfirmItems || []).length > 0
  ? (result?.toConfirmItems || []).map((item, idx) =>
      `#### ${idx + 1}. [${item.category}] ${item.description}\n\n- **关联**：${item.location}`
    ).join('\n\n')
  : '暂无'
}

---

*本报告由效率工作台教学档案自检模块自动生成*
*版本：v0.1（演示版，检查逻辑为模拟数据）*
`;
    zip.file('检查报告.md', reportMd);

    // ===== 2. 问题清单（纯文本，方便快速浏览）=====
    const issueList = `==================================================
  ${grade}级《${course}》教学档案自检 - 问题清单
  生成时间：${now.toLocaleString('zh-CN')}
==================================================

【跨文件一致性问题】共 ${result?.consistencyIssues.length || 0} 项
--------------------------------------------------
${(result?.consistencyIssues || []).map((i, idx) =>
  `${idx + 1}. [${i.category}] ${i.description}\n   位置：${i.location}`
).join('\n\n') || '  （无）'}

【文件格式问题】共 ${result?.formatIssues.length || 0} 项
--------------------------------------------------
${(result?.formatIssues || []).map((i, idx) =>
  `${idx + 1}. [${i.category}] ${i.description}\n   位置：${i.location}`
).join('\n\n') || '  （无）'}

【课程定位匹配】共 ${result?.courseMatches.length || 0} 项
--------------------------------------------------
${(result?.courseMatches || []).map((i, idx) =>
  `${idx + 1}. [${i.category}] ${i.description}\n   依据：${i.location}`
).join('\n\n') || '  （无）'}

【待确认疑问】共 ${result?.toConfirmItems.length || 0} 项
--------------------------------------------------
${(result?.toConfirmItems || []).map((i, idx) =>
  `${idx + 1}. [${i.category}] ${i.description}\n   关联：${i.location}`
).join('\n\n') || '  （无）'}

==================================================
  总计：错误 ${errorCount} 项 / 警告 ${warningCount} 项 / 待确认 ${result?.toConfirm || 0} 项
==================================================
`;
    zip.file('问题清单.txt', issueList);

    // ===== 3. 按文件分类的批注文件 =====
    const filesFolder = zip.folder('按文件批注');
    if (filesFolder) {
      // 按 location 提取文件名，归类问题
      const fileIssues: Record<string, CheckResultItem[]> = {};
      allIssues.forEach((item) => {
        const match = item.location.match(/^([^·]+?)(?:\.[a-zA-Z0-9]+)?\s*·/);
        const rawName = match ? match[1].trim() : '其他';
        const fileName = rawName.replace(/\.(docx|doc|xlsx|xls|pdf|txt)$/i, '');
        if (!fileIssues[fileName]) fileIssues[fileName] = [];
        fileIssues[fileName].push(item);
      });

      Object.entries(fileIssues).forEach(([fileName, items]) => {
        const content = `文件：${fileName}
检查时间：${now.toLocaleString('zh-CN')}
问题数：${items.length} 项

${items.map((item, idx) =>
  `${idx + 1}. [${item.category}] ${item.description}\n   位置：${item.location}`
).join('\n\n')}
`;
        filesFolder.file(`${fileName}_批注.txt`, content);
      });
    }

    // ===== 4. 校验说明文件 =====
    zip.file('校验说明.txt', `校验说明
========

1. 本自检结果基于当前版本规则库生成
2. 检查维度：文件完整性、格式规范、跨文件一致性、课程定位匹配
3. 批注格式：[分类-子分类] + 问题描述 + 位置
4. 分类说明：
   - 格式-xxx：格式规范问题（字体、行距、页码等）
   - 内容-xxx：内容数据问题（学时、名称、数据等）
   - 逻辑-xxx：逻辑结构问题（顺序、衔接、对应关系等）
   - 课程-xxx：课程定位匹配相关
5. 待确认项表示需要人工判断的争议点

当前版本：v0.1（演示版）
后续版本将接入真实Python检查逻辑，结果会更准确。
`);

    // 生成 zip 并下载
    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = zipName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const tabs = [
    { key: 'consistency' as const, label: '跨文件一致性问题', icon: AlertCircle, count: result?.consistencyIssues.length || 0 },
    { key: 'course' as const, label: '课程定位匹配', icon: CheckCircle2, count: result?.courseMatches.length || 0 },
    { key: 'format' as const, label: '文件格式问题', icon: FileText, count: result?.formatIssues.length || 0 },
    { key: 'confirm' as const, label: '待确认疑问', icon: HelpCircle, count: result?.toConfirmItems.length || 0 },
  ];

  const getCurrentTabItems = (): CheckResultItem[] => {
    if (!result) return [];
    switch (activeTab) {
      case 'consistency': return result.consistencyIssues;
      case 'course': return result.courseMatches;
      case 'format': return result.formatIssues;
      case 'confirm': return result.toConfirmItems;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">教学档案自检</h1>
        <p className="text-sm text-slate-500 mt-1">上传教学档案文档，自动检查格式、一致性与课程定位问题</p>
      </div>

      {/* Main 3-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Upload */}
        <div className="lg:col-span-4 bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <h2 className="text-base font-semibold text-slate-800 mb-4">上传文件</h2>

          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
              isDragging
                ? 'border-azure-500 bg-azure-50'
                : 'border-slate-200 hover:border-azure-300 hover:bg-slate-50'
            }`}
          >
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-azure-50 flex items-center justify-center">
              <Upload className="w-6 h-6 text-azure-600" />
            </div>
            <p className="text-sm font-medium text-slate-700">拖拽文件到这里</p>
            <p className="text-xs text-slate-400 mt-1">或点击选择文件</p>
            <p className="text-xs text-slate-300 mt-2">支持 .docx 和 .zip 压缩包，可多选</p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,.zip"
            multiple
            onChange={(e) => handleFiles(e.target.files)}
            className="hidden"
          />

          {/* File list */}
          {files.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="text-xs text-slate-500 font-medium">
                已上传 {files.length} 个文件
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {files.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg group"
                  >
                    <FileText className="w-4 h-4 text-azure-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-700 truncate">{f.name}</p>
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-slate-400">{formatSize(f.size)}</p>
                        {f.fromZip && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-violet-50 text-violet-600 rounded flex items-center gap-0.5">
                            <Archive className="w-2.5 h-2.5" />
                            {f.fromZip}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(f.id);
                      }}
                      className="p-1 rounded-md hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Middle: Config */}
        <div className="lg:col-span-4 bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <h2 className="text-base font-semibold text-slate-800 mb-4">检查配置</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                年级
              </label>
              <select
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-azure-500/30 focus:border-azure-500 transition-shadow bg-white"
              >
                <option value="2023">2023级</option>
                <option value="2024">2024级</option>
                <option value="2025">2025级</option>
              </select>
            </div>

            <div className="relative" ref={suggestionRef}>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                课程名称
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={course}
                  onChange={(e) => {
                    setCourse(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  placeholder="输入或选择课程名称"
                  className="w-full pl-9 pr-8 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-azure-500/30 focus:border-azure-500 transition-shadow"
                />
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
              </div>
              {showSuggestions && filteredSuggestions.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
                  {filteredSuggestions.map((s) => (
                    <button
                      key={s}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setCourse(s);
                        setShowSuggestions(false);
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-azure-50 hover:text-azure-700 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {course.trim() && !courseInList && (
                <div className="mt-2 text-xs">
                  {courseFuzzyMatch ? (
                    <p className="text-amber-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      未找到完全匹配，你是说「
                      <button
                        type="button"
                        onClick={() => {
                          setCourse(courseFuzzyMatch);
                          setShowSuggestions(false);
                        }}
                        className="underline font-medium hover:text-amber-700"
                      >
                        {courseFuzzyMatch}
                      </button>
                      」吗？
                    </p>
                  ) : (
                    <p className="text-amber-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      该课程不在{grade}级课程总表中，可继续检查但定位校验可能不准确
                    </p>
                  )}
                </div>
              )}
              {course.trim() && courseInList && (
                <div className="mt-2 text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  已匹配{grade}级课程总表
                </div>
              )}
            </div>

            <button
              onClick={runCheck}
              disabled={isChecking}
              className="w-full mt-2 py-3.5 bg-gradient-to-r from-azure-500 to-azure-600 text-white font-semibold rounded-xl hover:from-azure-600 hover:to-azure-700 transition-all shadow-md hover:shadow-lg disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isChecking ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  检查中...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5" />
                  开始检查
                </>
              )}
            </button>
          </div>

          {/* Steps progress */}
          {(isChecking || result) && (
            <div className="mt-6 pt-5 border-t border-slate-100">
              <p className="text-xs text-slate-500 font-medium mb-3">检查进度</p>
              <div className="space-y-2.5">
                {stepNames.map((step) => {
                  const status = stepStatus[step];
                  return (
                    <div key={step} className="flex items-center gap-2.5">
                      <div
                        className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                          status === 'idle'
                            ? 'bg-slate-100'
                            : status === 'loading'
                            ? 'bg-azure-100'
                            : 'bg-green-100'
                        }`}
                      >
                        {status === 'idle' && (
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                        )}
                        {status === 'loading' && (
                          <Loader2 className="w-3 h-3 text-azure-600 animate-spin" />
                        )}
                        {status === 'completed' && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                        )}
                      </div>
                      <span
                        className={`text-sm ${
                          status === 'completed'
                            ? 'text-slate-700 font-medium'
                            : status === 'loading'
                            ? 'text-azure-700 font-medium'
                            : 'text-slate-400'
                        }`}
                      >
                        {stepLabels[step]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right: Quick stats placeholder */}
        <div className="lg:col-span-4 bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <h2 className="text-base font-semibold text-slate-800 mb-4">检查说明</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <div className="flex items-start gap-2.5">
              <div className="w-1.5 h-1.5 rounded-full bg-azure-500 mt-1.5 flex-shrink-0" />
              <p><span className="font-medium text-slate-700">文件完整性：</span>检查上传文件是否齐全</p>
            </div>
            <div className="flex items-start gap-2.5">
              <div className="w-1.5 h-1.5 rounded-full bg-azure-500 mt-1.5 flex-shrink-0" />
              <p><span className="font-medium text-slate-700">格式规范：</span>检查字体、行距、页码等格式</p>
            </div>
            <div className="flex items-start gap-2.5">
              <div className="w-1.5 h-1.5 rounded-full bg-azure-500 mt-1.5 flex-shrink-0" />
              <p><span className="font-medium text-slate-700">一致性：</span>跨文件数据、表述一致性校验</p>
            </div>
            <div className="flex items-start gap-2.5">
              <div className="w-1.5 h-1.5 rounded-full bg-azure-500 mt-1.5 flex-shrink-0" />
              <p><span className="font-medium text-slate-700">课程定位：</span>与培养方案匹配度校验</p>
            </div>
          </div>
          <div className="mt-5 p-3 bg-azure-50 rounded-lg text-xs text-azure-700">
            <p className="font-medium mb-1">💡 提示</p>
            <p className="text-azure-600">上传完整的教学档案文件可获得更准确的检查结果。</p>
          </div>
        </div>
      </div>

      {/* Result section */}
      {result && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden animate-[fadeIn_0.3s_ease-out]">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-800">检查结果</h2>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6 border-b border-slate-50">
            <div className="bg-slate-50 rounded-xl p-4 text-center">
              <p className="text-3xl font-bold text-slate-800">{result.totalFiles}</p>
              <p className="text-xs text-slate-500 mt-1">总文件数</p>
            </div>
            <div className="bg-red-50 rounded-xl p-4 text-center">
              <p className="text-3xl font-bold text-red-600">{result.errors}</p>
              <p className="text-xs text-red-500 mt-1">错误数</p>
            </div>
            <div className="bg-amber-50 rounded-xl p-4 text-center">
              <p className="text-3xl font-bold text-amber-600">{result.warnings}</p>
              <p className="text-xs text-amber-500 mt-1">警告数</p>
            </div>
            <div className="bg-blue-50 rounded-xl p-4 text-center">
              <p className="text-3xl font-bold text-blue-600">{result.toConfirm}</p>
              <p className="text-xs text-blue-500 mt-1">待确认数</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="px-6 pt-2 border-b border-slate-100">
            <div className="flex gap-1 overflow-x-auto">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                      isActive
                        ? 'text-azure-600 border-azure-600'
                        : 'text-slate-500 border-transparent hover:text-slate-700'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {tab.label}
                    <span
                      className={`px-1.5 py-0.5 text-[10px] font-semibold rounded-full ${
                        isActive
                          ? 'bg-azure-100 text-azure-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Issue list */}
          <div className="divide-y divide-slate-50">
            {getCurrentTabItems().map((item, index) => (
              <div key={item.id} className="px-6 py-4 hover:bg-slate-50/50 transition-colors">
                <div className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-xs font-semibold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {index + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 text-[11px] font-medium rounded bg-azure-50 text-azure-700">
                        [{item.category}]
                      </span>
                    </div>
                    <p className="text-sm text-slate-700">{item.description}</p>
                    <p className="text-xs text-slate-400 mt-1.5 flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      {item.location}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Download */}
          <div className="px-6 py-4 bg-slate-50/50 border-t border-slate-100 flex justify-end">
            <button
              onClick={handleDownloadZip}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-azure-600 text-white text-sm font-medium rounded-lg hover:bg-azure-700 transition-colors shadow-sm"
            >
              <Download className="w-4 h-4" />
              下载打包文件
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
