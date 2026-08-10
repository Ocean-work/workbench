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
  AlertTriangle,
} from 'lucide-react';
import JSZip from 'jszip';
import type { UploadedFile, CheckStep, StepStatus, CheckResult, CheckResultItem } from '../types';
import coursesData from '../data/courses.json';
import { runSelfCheck, isPyodideReady, initPyodide } from '../services/pyodideService';

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

// ============================================================
// 自动识别：从文件名提取年级和课程名称
// ============================================================

/** 常见文件类型关键词（识别时需剔除） */
const FILE_TYPE_KEYWORDS = [
  '教案', '授课计划', '教学大纲', '大纲', '考核方案', '评分细则',
  '教学进度表', '进度表', '实验指导书', '封面', '封皮', '内页',
  '成绩', '试卷', '试题', '答案', '参考答案', '课程标准',
  '教学日历', '教学日志', '说课稿', '教学设计', '教学方案',
  '课程思政', '教学反思', '课程总结', '教学总结',
];

/** 常见版本/编号关键词（识别时需剔除） */
const VERSION_PATTERNS = [
  /v\d+\.?\d*/gi,           // v1, v1.0, V001
  /版本\d*\.?\d*/g,         // 版本1.0
  /第[一二三四五六七八九十\d]+版/g, // 第一版
  /_final$/gi,
  /_new$/gi,
  /_old$/gi,
  /_draft$/gi,
  /初稿|终稿|定稿|修订版|修改版|最新版/g,
];

/** 分隔符列表 */
const SEPARATORS = /[_\-\s《》【】\[\]()（）「」『』、，,。.]+/g;

/**
 * 从文件名列表中识别年级
 * @returns 识别到的年级（如 "2025"），未识别到返回 null
 */
function detectGrade(fileNames: string[]): string | null {
  const gradeCounts: Record<string, number> = {};
  const gradeRegex = /20\d{2}级/g;

  for (const name of fileNames) {
    const matches = name.match(gradeRegex);
    if (matches) {
      for (const m of matches) {
        const year = m.replace('级', '');
        gradeCounts[year] = (gradeCounts[year] || 0) + 1;
      }
    }
  }

  if (Object.keys(gradeCounts).length === 0) return null;

  // 取出现频率最高的
  return Object.entries(gradeCounts)
    .sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * 从文件名中提取课程名称关键词
 * 去掉：文件后缀、年级信息、文件类型关键词、版本号、分隔符等
 */
function extractCourseKeywords(fileName: string): string {
  let name = fileName;

  // 去掉文件后缀
  name = name.replace(/\.(docx|doc|zip|pdf)$/i, '');

  // 去掉路径部分（zip 解压的可能有路径）
  name = name.split('/').pop() || name;
  name = name.split('\\').pop() || name;

  // 去掉年级信息
  name = name.replace(/20\d{2}级/g, '');
  name = name.replace(/20\d{2}学年/g, '');
  name = name.replace(/\d{4}\s*-\s*\d{4}学年/g, '');

  // 去掉学期信息
  name = name.replace(/第[一二三四1234]\s*学期/g, '');
  name = name.replace(/[上中下]学期/g, '');
  name = name.replace(/春季学期|秋季学期/g, '');

  // 去掉版本号相关
  for (const pattern of VERSION_PATTERNS) {
    name = name.replace(pattern, '');
  }

  // 去掉文件类型关键词（从长到短匹配，避免短词先匹配）
  const sortedKeywords = [...FILE_TYPE_KEYWORDS].sort((a, b) => b.length - a.length);
  for (const kw of sortedKeywords) {
    name = name.replace(new RegExp(kw, 'g'), '');
  }

  // 去掉班级相关
  name = name.replace(/\d{4}班/g, '');

  // 去掉分隔符
  name = name.replace(SEPARATORS, ' ').trim();

  // 压缩多余空格
  name = name.replace(/\s+/g, ' ').trim();

  return name;
}

/**
 * 计算两个字符串的相似度（基于字符重合度）
 * 返回 0-1 之间的数值，越大越相似
 */
function stringSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const setA = new Set(a.split(''));
  const setB = new Set(b.split(''));

  let common = 0;
  for (const char of setA) {
    if (setB.has(char)) common++;
  }

  // 字符重合度 + 长度差异惩罚
  const charSimilarity = common / Math.max(setA.size, setB.size);
  const lenRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);

  // 额外奖励：关键词包含关系
  const containsBonus = a.includes(b) || b.includes(a) ? 0.2 : 0;

  return Math.min(1, charSimilarity * 0.5 + lenRatio * 0.3 + containsBonus);
}

/**
 * 从文件名列表中识别课程名称
 * @param fileNames 文件名列表
 * @param grade 年级
 * @param courseTable 课程总表
 * @returns 识别结果 { course: string, matchType: 'exact' | 'fuzzy' | 'none' }
 */
function detectCourseName(
  fileNames: string[],
  grade: string,
  courseTable: Record<string, string[]>
): { course: string; matchType: 'exact' | 'fuzzy' | 'none' } {
  const courseList = courseTable[grade] || [];
  if (courseList.length === 0) return { course: '', matchType: 'none' };

  // 从每个文件名提取关键词
  const keywords = fileNames
    .map((name) => extractCourseKeywords(name))
    .filter((k) => k.length >= 2); // 至少2个字才算有效关键词

  if (keywords.length === 0) return { course: '', matchType: 'none' };

  let bestMatch = '';
  let bestScore = 0;
  let isExact = false;

  for (const keyword of keywords) {
    // 先尝试精确匹配
    const exactMatch = courseList.find((c) => c === keyword);
    if (exactMatch) {
      return { course: exactMatch, matchType: 'exact' };
    }

    // 再尝试包含匹配
    const includeMatch = courseList.find((c) => c.includes(keyword) || keyword.includes(c));
    if (includeMatch) {
      const score = stringSimilarity(keyword, includeMatch);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = includeMatch;
        isExact = false;
      }
      continue;
    }

    // 最后模糊匹配
    for (const course of courseList) {
      const score = stringSimilarity(keyword, course);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = course;
        isExact = false;
      }
    }
  }

  // 匹配度阈值：至少 0.4 才算匹配成功
  if (bestScore >= 0.4 && bestMatch) {
    return { course: bestMatch, matchType: isExact ? 'exact' : 'fuzzy' };
  }

  return { course: '', matchType: 'none' };
}

export default function DocSelfCheck() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [grade, setGrade] = useState('2025');
  const [course, setCourse] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [initLoading, setInitLoading] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  // 自动识别状态
  const [autoDetectInfo, setAutoDetectInfo] = useState<{
    gradeDetected: boolean;
    courseMatchType: 'exact' | 'fuzzy' | 'none' | 'idle';
  }>({ gradeDetected: false, courseMatchType: 'idle' });
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
  const [annotatedFiles, setAnnotatedFiles] = useState<Array<{ filename: string; blob: Blob }>>([]);
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

    if (newFiles.length === 0) return;

    setFiles((prev) => {
      const allFiles = [...prev, ...newFiles];
      const allNames = allFiles.map((f) => f.name);

      // ---- 自动识别年级 ----
      const detectedGrade = detectGrade(allNames);
      if (detectedGrade && detectedGrade !== grade) {
        setGrade(detectedGrade);
        setAutoDetectInfo((prev) => ({ ...prev, gradeDetected: true }));
      }

      // ---- 自动识别课程名称 ----
      const gradeToUse = detectedGrade || grade;
      const courseResult = detectCourseName(
        allNames,
        gradeToUse,
        coursesData as Record<string, string[]>
      );

      if (courseResult.course && courseResult.course !== course) {
        setCourse(courseResult.course);
        setAutoDetectInfo((prev) => ({ ...prev, courseMatchType: courseResult.matchType }));
      } else if (!courseResult.course) {
        setAutoDetectInfo((prev) => ({ ...prev, courseMatchType: 'none' }));
      }

      return allFiles;
    });
  }, [grade, course]);

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
    setFiles((prev) => {
      const newFiles = prev.filter((f) => f.id !== id);
      // 如果删完了，重置自动识别状态
      if (newFiles.length === 0) {
        setAutoDetectInfo({ gradeDetected: false, courseMatchType: 'idle' });
      }
      return newFiles;
    });
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
    setAnnotatedFiles([]);
    setInitError(null);
    const initial: Record<CheckStep, StepStatus> = {
      integrity: 'idle',
      format: 'idle',
      consistency: 'idle',
      course: 'idle',
      confirm: 'idle',
      report: 'idle',
    };
    setStepStatus(initial);

    // 如果 Pyodide 还没初始化，先初始化（显示在 integrity 步骤）
    if (!isPyodideReady()) {
      setInitLoading(true);
      setStepStatus((prev) => ({ ...prev, integrity: 'loading' }));
      try {
        await initPyodide();
        setStepStatus((prev) => ({ ...prev, integrity: 'completed' }));
      } catch (err: any) {
        setInitError(err?.message || 'Pyodide 初始化失败');
        setStepStatus((prev) => ({ ...prev, integrity: 'error' }));
        setIsChecking(false);
        setInitLoading(false);
        return;
      }
      setInitLoading(false);
    }

    try {
      const output = await runSelfCheck({
        files,
        course,
        grade,
        onProgress: (step, status) => {
          setStepStatus((prev) => ({
            ...prev,
            [step]: status,
          }));
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 300));
      setResult(output.result);
      setAnnotatedFiles(output.annotatedFiles);
    } catch (err: any) {
      console.error('检查失败:', err);
      alert(`检查失败：${err?.message || '未知错误'}`);
    }

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
> 检查引擎：Python (Pyodide 浏览器端运行)

---

## 一、文件完整性检查

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 上传文件数 | ${files.length} 个 | - |
| 文件完整性 | ✅ 已完成 | Python 引擎已对每个文件进行格式检查 |

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
*版本：v1.0（基于 Pyodide 的 Python 真实检查引擎）*
`;
    zip.file('检查报告.md', reportMd);

    // ===== 2. 问题清单（纯文本，方便快速浏览）=====
    const issueList = `==================================================
  ${grade}级《${course}》教学档案自检 - 问题清单
  生成时间：${now.toLocaleString('zh-CN')}
  检查引擎：Python (Pyodide)
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

    // ===== 4. 批注版 docx 文件 =====
    if (annotatedFiles.length > 0) {
      const annotatedFolder = zip.folder('批注版文档');
      if (annotatedFolder) {
        for (const af of annotatedFiles) {
          const arrayBuffer = await af.blob.arrayBuffer();
          annotatedFolder.file(af.filename, arrayBuffer);
        }
      }
    }

    // ===== 5. 校验说明文件 =====
    zip.file('校验说明.txt', `校验说明
========

1. 本自检结果基于 Pyodide (Python WebAssembly) 引擎在浏览器端运行
2. 使用 python-docx 库解析 docx 文件，lxml 库生成 Word 批注
3. 检查维度：文件完整性、格式规范、跨文件一致性、课程定位匹配
4. 批注格式：[分类-子分类] + 问题描述 + 位置
5. 分类说明：
   - 格式-xxx：格式规范问题（字体、行距、页码等）
   - 内容-xxx：内容数据问题（占位符、信息一致性等）
   - 逻辑-xxx：逻辑结构问题（编号连续性等）
   - 课程-xxx：课程定位匹配相关
6. 待确认项表示需要人工判断的争议点

当前版本：v1.0（真实 Python 检查引擎）
规则库：共 ${Object.keys(annotatedFiles).length > 0 ? '9' : '多'} 套模板规则
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

      {/* Pyodide 初始化错误提示 */}
      {initError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-800">检查引擎初始化失败</p>
            <p className="text-xs text-red-600 mt-1">{initError}</p>
            <p className="text-xs text-red-500 mt-1">请检查网络连接，或刷新页面重试。Pyodide 需要从 CDN 下载 Python 运行时（约20MB）。</p>
          </div>
        </div>
      )}

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
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-slate-700">
                  年级
                </label>
                {autoDetectInfo.gradeDetected && (
                  <span className="text-[11px] text-green-600 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    自动识别
                  </span>
                )}
              </div>
              <select
                value={grade}
                onChange={(e) => {
                  setGrade(e.target.value);
                  // 用户手动修改时，清除自动识别状态
                  if (autoDetectInfo.gradeDetected) {
                    setAutoDetectInfo((prev) => ({ ...prev, gradeDetected: false }));
                  }
                }}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-azure-500/30 focus:border-azure-500 transition-shadow bg-white"
              >
                <option value="2023">2023级</option>
                <option value="2024">2024级</option>
                <option value="2025">2025级</option>
              </select>
            </div>

            <div className="relative" ref={suggestionRef}>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-slate-700">
                  课程名称
                </label>
                {autoDetectInfo.courseMatchType === 'exact' && (
                  <span className="text-[11px] text-green-600 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    精确匹配
                  </span>
                )}
                {autoDetectInfo.courseMatchType === 'fuzzy' && (
                  <span className="text-[11px] text-amber-600 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    近似匹配
                  </span>
                )}
                {autoDetectInfo.courseMatchType === 'none' && files.length > 0 && (
                  <span className="text-[11px] text-slate-400 flex items-center gap-1">
                    <HelpCircle className="w-3 h-3" />
                    未识别
                  </span>
                )}
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={course}
                  onChange={(e) => {
                    setCourse(e.target.value);
                    setShowSuggestions(true);
                    // 用户手动修改时，清除自动识别状态
                    if (autoDetectInfo.courseMatchType !== 'idle') {
                      setAutoDetectInfo((prev) => ({ ...prev, courseMatchType: 'idle' }));
                    }
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
                  {initLoading ? '初始化引擎中...' : '检查中...'}
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
                            : status === 'error'
                            ? 'bg-red-100'
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
                        {status === 'error' && (
                          <X className="w-3 h-3 text-red-600" />
                        )}
                      </div>
                      <span
                        className={`text-sm ${
                          status === 'completed'
                            ? 'text-slate-700 font-medium'
                            : status === 'loading'
                            ? 'text-azure-700 font-medium'
                            : status === 'error'
                            ? 'text-red-600 font-medium'
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
            <p className="font-medium mb-1">💡 技术说明</p>
            <p className="text-azure-600">
              本模块使用 Pyodide (Python WebAssembly) 在浏览器端直接运行 Python 检查逻辑，
              无需后端服务。首次使用需加载 Python 运行时（约13MB），请耐心等待。
            </p>
          </div>
          {annotatedFiles.length > 0 && (
            <div className="mt-3 p-3 bg-green-50 rounded-lg text-xs text-green-700">
              <p className="font-medium mb-1">✅ 批注文档已生成</p>
              <p className="text-green-600">
                共生成 {annotatedFiles.length} 个批注版 docx 文件，已包含在下载包中。
              </p>
            </div>
          )}
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
            {getCurrentTabItems().length === 0 ? (
              <div className="px-6 py-12 text-center">
                <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" />
                <p className="text-sm text-slate-500">暂无相关问题</p>
              </div>
            ) : (
              getCurrentTabItems().map((item, index) => (
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
              ))
            )}
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
