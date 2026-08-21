/**
 * 事件流水日志：一条"只记录核心自己干的事情"的连续时间线。
 * 每条记录三字段主结构：{ type, source, message }（见 logFormat.ts）+ 任意结构化附加字段。
 *
 * 双层存储：内存 entries 供进程内即时查询，JSONL 追加流负责持久化；
 * 写盘失败只吞掉、绝不影响核心主流程；数组操作不写日志（高频数据通道，逐条记会撑爆文件）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { categoryOf, formatLogEntry } from './logFormat';
import type { LogCategory } from './logFormat';
import type { LogEntry } from '../types';

export class EventStreamLog {
  private entries: LogEntry[] = [];
  private filePath?: string;
  private stream?: fs.WriteStream;
  private consoleOut: boolean;

  constructor(opts: { filePath?: string; logToConsole?: boolean } = {}) {
    this.filePath = opts.filePath;
    this.consoleOut = opts.logToConsole ?? false;
  }

  /** 追加一条记录（先落内存再到磁盘，顺序一致）。 */
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

  /** 惰性打开文件流（目录自动创建）：没配置路径或还没写过日志前，不建文件、零副作用。 */
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
