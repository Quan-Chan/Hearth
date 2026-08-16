/**
 * 事件流水日志：原样记录所有发生的事情。
 * 每条记录一行 JSON（JSONL 格式），可落盘、可内存读取，写入顺序有保证。
 * 示例：核心刚打开时记录 "core:startup" 事件，以及哪些模块因此启动。
 */
import * as fs from 'fs';
import * as path from 'path';

export interface LogEntry {
  /** ISO 时间戳（由 record 自动填充） */
  t?: string;
  type: string;
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
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(full));
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

  /** 所有内存中的条目（含未落盘部分）。 */
  all(): LogEntry[] {
    return this.entries;
  }

  /** 按类型过滤。 */
  byType(type: string): LogEntry[] {
    return this.entries.filter((e) => e.type === type);
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
