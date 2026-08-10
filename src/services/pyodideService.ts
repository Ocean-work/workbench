/**
 * Pyodide 服务 - 浏览器端运行 Python 文档自检逻辑
 * 
 * 使用 Pyodide (WebAssembly) 在浏览器中直接运行 Python 代码
 * 支持 python-docx、lxml 等库，无需后端服务
 */

import type { UploadedFile, CheckResult } from '../types';

let pyodideInstance: any = null;
let initPromise: Promise<void> | null = null;
let initError: Error | null = null;

// 规则库缓存
const rulesCache: Record<string, any> = {};

// 规则库列表（与 public/rules 目录对应）
const RULE_LIBRARIES = [
  '教案封皮',
  '教案内页',
  '授课计划',
  '教学进度表',
  '考核方案',
  '评分细则',
  '实验指导书',
  '理论实验',
  '全局检查规则',
];

/**
 * 初始化 Pyodide 运行时
 * 首次调用会下载 Pyodide 和 Python 依赖包，需要一定时间
 */
export async function initPyodide(): Promise<void> {
  if (pyodideInstance) return;
  if (initPromise) return initPromise;
  if (initError) throw initError;

  initPromise = (async () => {
    try {
      console.log('[Pyodide] 正在加载 Pyodide 运行时...');
      
      // 动态加载 Pyodide
      const { loadPyodide } = await import('pyodide');
      
      pyodideInstance = await loadPyodide({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/',
      });

      console.log('[Pyodide] 运行时加载完成，正在安装依赖包...');

      // 安装 python-docx 和 lxml
      await pyodideInstance.loadPackage(['python-docx', 'lxml']);

      console.log('[Pyodide] 依赖包安装完成，正在加载自检引擎...');

      // 加载 Python 自检引擎脚本
      const scriptUrl = new URL(
        '/pyodide/selfcheck_engine.py',
        window.location.origin + (import.meta.env.BASE_URL || './')
      ).href;
      
      const scriptResponse = await fetch(scriptUrl);
      if (!scriptResponse.ok) {
        throw new Error(`加载自检引擎失败: ${scriptResponse.status}`);
      }
      const scriptText = await scriptResponse.text();
      
      // 在 Pyodide 中执行脚本
      pyodideInstance.runPython(scriptText);

      console.log('[Pyodide] 自检引擎加载完成');
      
      // 预加载规则库
      await loadAllRules();
      
      console.log('[Pyodide] 初始化完成');
    } catch (err) {
      initError = err as Error;
      initPromise = null;
      console.error('[Pyodide] 初始化失败:', err);
      throw err;
    }
  })();

  return initPromise;
}

/**
 * 加载所有规则库
 */
async function loadAllRules(): Promise<void> {
  const baseUrl = import.meta.env.BASE_URL || './';
  
  const loadPromises = RULE_LIBRARIES.map(async (ruleName) => {
    try {
      const url = `${baseUrl}rules/规则库_${ruleName}/rules.json`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        rulesCache[ruleName] = data;
        console.log(`[Rules] 已加载规则库: ${ruleName}`);
      }
    } catch (err) {
      console.warn(`[Rules] 加载规则库失败: ${ruleName}`, err);
    }
  });

  await Promise.all(loadPromises);
}

/**
 * 获取初始化状态
 */
export function isPyodideReady(): boolean {
  return pyodideInstance !== null;
}

/**
 * 获取初始化错误（如果有）
 */
export function getPyodideError(): Error | null {
  return initError;
}

/**
 * 将 File 对象转换为 base64 字符串
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // 去掉 data:application/...;base64, 前缀
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * 将 base64 字符串转换为 Blob
 */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64);
  const byteArrays = [];
  
  for (let offset = 0; offset < byteCharacters.length; offset += 512) {
    const slice = byteCharacters.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    byteArrays.push(new Uint8Array(byteNumbers));
  }
  
  return new Blob(byteArrays, { type: mimeType });
}

export interface CheckOptions {
  files: UploadedFile[];
  course: string;
  grade: string;
  onProgress?: (step: string, status: 'loading' | 'completed') => void;
}

export interface CheckOutput {
  result: CheckResult;
  annotatedFiles: Array<{ filename: string; blob: Blob }>;
}

/**
 * 执行文档自检
 */
export async function runSelfCheck(options: CheckOptions): Promise<CheckOutput> {
  const { files, course, grade, onProgress } = options;

  // 确保 Pyodide 已初始化
  if (!pyodideInstance) {
    onProgress?.('integrity', 'loading');
    await initPyodide();
    onProgress?.('integrity', 'completed');
  }

  // 准备文件数据（转 base64）
  onProgress?.('integrity', 'loading');
  const filesData = await Promise.all(
    files.map(async (f) => ({
      filename: f.name,
      bytes_base64: await fileToBase64(f.file),
    }))
  );
  onProgress?.('integrity', 'completed');

  // 格式检查
  onProgress?.('format', 'loading');
  
  // 安全地将数据传递给 Python（通过 globals）
  const py = pyodideInstance;
  py.globals.set('_files_json', JSON.stringify(filesData));
  py.globals.set('_rules_json', JSON.stringify(rulesCache));
  py.globals.set('_course', course);
  py.globals.set('_grade', grade);
  
  const resultJson = py.runPython(`
import json
_files = json.loads(_files_json)
_rules = json.loads(_rules_json)
_result = run_check(_files, _rules, _course, _grade)
json.dumps(_result, ensure_ascii=False)
`);

  const result = JSON.parse(resultJson);
  onProgress?.('format', 'completed');

  // 一致性检查
  onProgress?.('consistency', 'loading');
  // 一致性检查已在 batch_check 中完成，这里模拟一下进度
  await new Promise((r) => setTimeout(r, 300));
  onProgress?.('consistency', 'completed');

  // 课程定位校验
  onProgress?.('course', 'loading');
  await new Promise((r) => setTimeout(r, 200));
  onProgress?.('course', 'completed');

  // 疑问确认
  onProgress?.('confirm', 'loading');
  await new Promise((r) => setTimeout(r, 200));
  onProgress?.('confirm', 'completed');

  // 生成报告
  onProgress?.('report', 'loading');
  
  // 处理批注文件
  const annotatedFiles: Array<{ filename: string; blob: Blob }> = [];
  if (result.annotatedFiles) {
    for (const af of result.annotatedFiles) {
      const blob = base64ToBlob(
        af.bytes_base64,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      annotatedFiles.push({ filename: af.filename, blob });
    }
  }
  
  onProgress?.('report', 'completed');

  // 清理全局变量
  try {
    py.globals.delete('_files_json');
    py.globals.delete('_rules_json');
    py.globals.delete('_course');
    py.globals.delete('_grade');
  } catch {
    // ignore
  }

  // 转换为前端需要的 CheckResult 格式
  const checkResult: CheckResult = {
    totalFiles: result.totalFiles || files.length,
    errors: result.errors || 0,
    warnings: result.warnings || 0,
    toConfirm: result.toConfirm || 0,
    consistencyIssues: result.consistencyIssues || [],
    courseMatches: result.courseMatches || [],
    formatIssues: result.formatIssues || [],
    toConfirmItems: result.toConfirmItems || [],
  };

  return {
    result: checkResult,
    annotatedFiles,
  };
}
