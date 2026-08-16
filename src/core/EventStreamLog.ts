/**
 * 事件流水日志：原样记录"核心框架干的事情"（JSONL 落盘 + 内存读取，顺序保证）。
 * 每条记录三字段主结构：{ type, source, message }（详见 logFormat.ts）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { categoryOf, formatLogEntry } from './logFormat';
import type { LogCategory } from './logFormat';

export interface LogEntry {
  /** ISO 时间戳（record 自动填充） */
  t?: string;
  /** ① 日志类型：核心的动作（event / module-start / ...） */
  type: string;
  /** ② 日志来源：动作涉及的对象（core / external / 模块名） */
  source: string;
  /** ③ 日志信息：人类可读的具体内容 */
  message: string;
  [key: string]: unknown;
}

export class EventStreamLog {
  private entries: LogEntry[] = [];
  private filePath?: string;
  private stream?: fs.WriteStream;
  private consoleOut: boolean;

  constructor(opts: { filePath?: string; logToConsole?: boolean } = {}) {
    this.filePath = opts.filePath;
    this.consoleOut = opts.logToConsole ?? false;
  }

  /** 追加一条记录（同步写内存，异步落盘，顺序保证）。 */
  record(entry: LogEntry): void {
    const full: LogEntry = { t: new Date().toISOString(), ...entry };
    this.entries.push(full);
    this.ensureStream();
    if (this.consoleOut) {
      // 控制台输出人类可读格式（文件保持 JSONL 原样）
      // eslint-disable-next-line no-console
      console.log(formatLogEntry(full));
    }
    if (this.stream) {
      this.stream.write(JSON.stringify(full) + '\n');
    }
  }

  /** 惰性打开文件流（目录自动创建）。 */
  private ensureStream(): void {
    if (this.stream || !this.filePath) return;
    fs.mkdirSync(path.dirname(path.resolve(this.filePath)), { recursive: true });
    this.stream = fs.createWriteStream(this.filePath, { flags: 'a', encoding: 'utf8' });
    this.stream.on('error', () => {
      /* 日志写入失败不影响核心运行 */
    });
  }

  /** 所有内存中的条目。 */
  all(): LogEntry[] {
    return this.entries;
  }

  /** 按类型过滤。 */
  byType(type: string): LogEntry[] {
    return this.entries.filter((e) => e.type === type);
  }

  /** 按类别过滤（core/event/module/config/log/error）。 */
  byCategory(category: LogCategory): LogEntry[] {
    return this.entries.filter((e) => categoryOf(String(e.type)) === category);
  }

  /** 读取已落盘文件的所有行（测试用）。 */
  readFileLines(): string[] {
    if (!this.filePath || !fs.existsSync(this.filePath)) return [];
    return fs
      .readFileSync(this.filePath, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.length > 0);
  }

  async close(): Promise<void> {
    if (!this.stream) return;
    await new Promise<void>((resolve) => {
      this.stream!.end(() => resolve());
    });
    this.stream = undefined;
  }
}
