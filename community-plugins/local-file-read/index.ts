/**
 * FlashClaw 插件 - 本地文件读取
 * 读取本地文件内容，带安全限制（目录白名单、文件大小限制）
 */

import { ToolPlugin, ToolContext, ToolResult, PluginConfig } from '../../src/plugins/types.js';
import { readFileSync, statSync, existsSync, readdirSync } from 'fs';
import { resolve, normalize, extname, basename, join } from 'path';
import { homedir } from 'os';

interface ReadFileParams {
  /** 文件路径（绝对路径或相对于用户主目录的路径） */
  path: string;
  /** 读取编码（默认 utf-8） */
  encoding?: string;
  /** 起始行号（1 起始，可选） */
  startLine?: number;
  /** 读取行数（可选，默认全部） */
  lineCount?: number;
}

interface ListDirParams {
  /** 目录路径 */
  path: string;
}

// 安全配置
let maxFileSizeBytes = 1024 * 1024; // 1MB
let allowedDirs: string[] = [];

// 不允许读取的文件扩展名
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
  '.key', '.pem', '.p12', '.pfx', '.keystore',
  '.sqlite', '.db', '.sqlite3',
]);

// 不允许读取的文件名
const BLOCKED_FILENAMES = new Set([
  '.env', '.env.local', '.env.production',
  'id_rsa', 'id_ed25519', 'id_ecdsa',
  '.npmrc', '.pypirc',
]);

/**
 * 检查路径是否在允许的目录内
 */
function isPathAllowed(filePath: string): boolean {
  const normalized = normalize(resolve(filePath));

  // 如果配置了白名单，严格检查
  if (allowedDirs.length > 0) {
    return allowedDirs.some(dir => normalized.startsWith(normalize(resolve(dir))));
  }

  // 默认：允许用户主目录下的文件（不包括敏感子目录）
  const home = homedir();
  if (!normalized.startsWith(home)) {
    return false;
  }

  // 禁止访问敏感目录
  const blockedSubdirs = ['.ssh', '.gnupg', '.aws', '.config/gcloud', '.kube'];
  for (const blocked of blockedSubdirs) {
    if (normalized.startsWith(join(home, blocked))) {
      return false;
    }
  }

  return true;
}

/**
 * 检查文件是否可安全读取
 */
function isFileAllowed(filePath: string): { allowed: boolean; reason?: string } {
  const ext = extname(filePath).toLowerCase();
  const name = basename(filePath);

  if (BLOCKED_EXTENSIONS.has(ext)) {
    return { allowed: false, reason: `不允许读取 ${ext} 类型的文件` };
  }

  if (BLOCKED_FILENAMES.has(name)) {
    return { allowed: false, reason: `不允许读取敏感文件 ${name}` };
  }

  if (!isPathAllowed(filePath)) {
    return { allowed: false, reason: '文件路径不在允许范围内' };
  }

  return { allowed: true };
}

const plugin: ToolPlugin = {
  name: 'local-file-read',
  version: '1.0.0',
  description: '读取本地文件内容和列出目录',

  tools: [
    {
      name: 'local_file_read',
      description: `读取本地文件内容。适用场景：
- 读取配置文件、日志文件、文档
- 查看代码文件内容
- 分析 CSV、JSON、文本数据

安全限制：只能读取用户主目录下的文件，不能读取密钥、数据库等敏感文件。

示例：local_file_read({ path: "~/Documents/notes.txt" })`,
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '文件路径。支持绝对路径或 ~ 开头的路径（如 ~/Documents/file.txt）'
          },
          encoding: {
            type: 'string',
            description: '文件编码（默认 utf-8）'
          },
          startLine: {
            type: 'number',
            description: '起始行号（1 起始），用于读取大文件的特定部分'
          },
          lineCount: {
            type: 'number',
            description: '读取行数，配合 startLine 使用'
          }
        },
        required: ['path']
      }
    },
    {
      name: 'local_list_dir',
      description: `列出目录中的文件和子目录。适用场景：
- 浏览文件夹结构
- 查找特定文件

示例：local_list_dir({ path: "~/Documents" })`,
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '目录路径。支持绝对路径或 ~ 开头的路径'
          }
        },
        required: ['path']
      }
    }
  ],

  async init(config: PluginConfig): Promise<void> {
    if (config.maxFileSizeBytes) {
      maxFileSizeBytes = Number(config.maxFileSizeBytes);
    }
    if (config.allowedDirs && Array.isArray(config.allowedDirs)) {
      allowedDirs = (config.allowedDirs as string[]).map(d =>
        d.startsWith('~') ? d.replace('~', homedir()) : d
      );
    }
  },

  async execute(toolName: unknown, paramsOrContext?: unknown, maybeContext?: ToolContext): Promise<ToolResult> {
    // 多工具模式：execute(toolName, params, context)
    const name = toolName as string;
    const params = paramsOrContext;

    if (name === 'local_list_dir') {
      return executeListDir(params as ListDirParams);
    }
    return executeReadFile(params as ReadFileParams);
  }
};

function resolvePath(inputPath: string): string {
  let p = inputPath;
  if (p.startsWith('~')) {
    p = p.replace('~', homedir());
  }
  return resolve(p);
}

function executeReadFile(params: ReadFileParams): ToolResult {
  const { path: inputPath, encoding = 'utf-8', startLine, lineCount } = params;

  if (!inputPath || typeof inputPath !== 'string') {
    return { success: false, error: '文件路径不能为空' };
  }

  const filePath = resolvePath(inputPath);

  // 安全检查
  const check = isFileAllowed(filePath);
  if (!check.allowed) {
    return { success: false, error: check.reason! };
  }

  if (!existsSync(filePath)) {
    return { success: false, error: `文件不存在: ${inputPath}` };
  }

  try {
    const stat = statSync(filePath);

    if (stat.isDirectory()) {
      return { success: false, error: '指定路径是目录，请使用 local_list_dir 工具' };
    }

    if (stat.size > maxFileSizeBytes) {
      return {
        success: false,
        error: `文件过大 (${(stat.size / 1024 / 1024).toFixed(2)} MB)，最大 ${(maxFileSizeBytes / 1024 / 1024).toFixed(2)} MB`
      };
    }

    const content = readFileSync(filePath, encoding as BufferEncoding);

    // 支持行范围读取
    if (startLine && startLine > 0) {
      const lines = content.split('\n');
      const start = startLine - 1;
      const count = lineCount || lines.length - start;
      const selectedLines = lines.slice(start, start + count);

      return {
        success: true,
        data: {
          path: inputPath,
          totalLines: lines.length,
          startLine,
          lineCount: selectedLines.length,
          content: selectedLines.join('\n')
        }
      };
    }

    return {
      success: true,
      data: {
        path: inputPath,
        size: stat.size,
        content
      }
    };
  } catch (error) {
    return {
      success: false,
      error: `读取文件失败: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function executeListDir(params: ListDirParams): ToolResult {
  const { path: inputPath } = params;

  if (!inputPath || typeof inputPath !== 'string') {
    return { success: false, error: '目录路径不能为空' };
  }

  const dirPath = resolvePath(inputPath);

  if (!isPathAllowed(dirPath)) {
    return { success: false, error: '目录路径不在允许范围内' };
  }

  if (!existsSync(dirPath)) {
    return { success: false, error: `目录不存在: ${inputPath}` };
  }

  try {
    const stat = statSync(dirPath);
    if (!stat.isDirectory()) {
      return { success: false, error: '指定路径不是目录' };
    }

    const entries = readdirSync(dirPath, { withFileTypes: true });
    const items = entries
      .filter(e => !e.name.startsWith('.')) // 隐藏文件默认不显示
      .slice(0, 100) // 最多 100 个条目
      .map(e => {
        const item: { name: string; type: string; size?: number } = {
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
        };
        if (e.isFile()) {
          try { item.size = statSync(join(dirPath, e.name)).size; } catch { /* symlink or permission error */ }
        }
        return item;
      });

    return {
      success: true,
      data: {
        path: inputPath,
        itemCount: items.length,
        items
      }
    };
  } catch (error) {
    return {
      success: false,
      error: `列出目录失败: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export default plugin;
