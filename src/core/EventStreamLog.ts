/**
 * 核心日志：一条"只记录核心自己干的事情"的连续时间线。
 * 每条记录三字段主结构：{ type, source, message }（见 logFormat.ts）+ 任意结构化附加字段。
 *
 * 内容完整性规则：日志内容完整保存，框架不在存储层做任何截断——
 * 过长的 data 只在展示层（formatLogEntry / CLI 渲染）缩短显示并标注原始长度，
 * 落盘文件里保留完整信息。
 *
 * 双层存储：内存 entries 供进程内即时查询（条数有上限，超出丢最旧；内容同样不截断），
 * JSONL 追加流负责持久化。
 * 落盘失败与序列化失败都不影响核心主流程：写盘失败（目录不可建、文件不可写）静默跳过；
 * 序列化失败（data 含循环引用等）落一条去掉 data 并标注 dataDropped 的记录，不截断记录本身。
 * 公共对象操作不写日志（高频数据通道，逐条记会快速占满文件）。
 *
 * 分文件策略（按天 + 按大小轮转）：配置的 filePath 是"基础路径"，实际文件为
 *   <目录>/<基础名>.<YYYY-MM-DD>.<三位序号><扩展名>（日期取自条目时间戳的 UTC 日份，与内容时间一致）。
 * 当天文件超过 128KB 后，下一条记录写入新序号文件——压线的那条保持完整、不搬家不截断；
 * 进程重启自动续写：当天最后一个文件未超限就接着追加，超限则开新序号。
 */
import * as fs from 'fs';
import * as path from 'path';
import { categoryOf, formatLogEntry } from './logFormat';
import type { LogCategory } from './logFormat';
import type { LogEntry } from '../types';

/** 单日单文件的软上限：超过后"下一条"记录启用新文件（本条不截断、不搬家）。 */
const ROTATE_SIZE_LIMIT_BYTES = 128 * 1024;

/** 由 ISO 时间戳取 UTC 日份（与条目 t 同源，文件名与内容时间一致）。 */
function dayOf(iso: string | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

/** 把配置的基础路径拆成 基础名 + 扩展名（扩展名可为空串）。 */
function splitBasePath(filePath: string): { base: string; ext: string } {
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  return { base, ext };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fileNameFor(dir: string, base: string, day: string, seq: number, ext: string): string {
  return path.join(dir, base + '.' + day + '.' + pad3(seq) + ext);
}

/** 序列化一条记录为一行 JSONL。data 无法序列化（循环引用等）时去掉 data 并标注原因，
 *  其余字段照常落盘，记录本身不丢失。 */
function serializeLine(full: LogEntry): string {
  try {
    return JSON.stringify(full) + '\n';
  } catch {
    const rest: Record<string, unknown> = { ...full };
    delete rest.data;
    rest.dataDropped = 'unserializable';
    return JSON.stringify(rest) + '\n';
  }
}

/** 等一个落盘流关闭：没发过关闭请求的先发，已发过的只等 'close'（重复 end 会报 already finished）。 */
function closeStream(s: fs.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    if (s.closed) return resolve();
    s.once('close', () => resolve());
    s.once('error', () => resolve());
    if (!s.writableEnded) s.end();
  });
}

/** 已占用的日志文件路径：同一路径只允许一个 EventStreamLog 实例（多核心共享日志文件
 *  会导致轮转序号竞争与互相覆盖）。实例 close() 后释放占用。 */
const takenLogFiles = new Set<string>();

export class EventStreamLog {
  private entries: LogEntry[] = [];
  private filePath?: string;
  private stream?: fs.WriteStream;
  /** 已开过、尚未收尾的落盘流：轮转换文件时旧流可能还有未刷入磁盘的缓冲，
   *  收尾要等全部流关闭，不能只等当前那一个。 */
  private openStreams = new Set<fs.WriteStream>();
  private consoleOut: boolean;
  /** 内存里最多保留的条数（超出丢最旧的）；不配 = 不限。落盘文件不受影响。 */
  private maxMemoryEntries?: number;
  /** 当前活动文件状态：日期 / 序号 / 已写字节数。 */
  private activeDay?: string;
  private activeSeq = 0;
  private activeBytes = 0;

  constructor(opts: { filePath?: string; logToConsole?: boolean; maxMemoryEntries?: number } = {}) {
    this.filePath = opts.filePath;
    this.consoleOut = opts.logToConsole ?? false;
    this.maxMemoryEntries = opts.maxMemoryEntries;
    if (this.filePath) {
      const abs = path.resolve(this.filePath);
      if (takenLogFiles.has(abs)) {
        throw new Error('log file already in use by another core instance: ' + abs);
      }
      takenLogFiles.add(abs);
    }
  }

  /** 追加一条记录（先落内存再到磁盘，顺序一致）。内容完整，不做任何截断。 */
  record(entry: LogEntry): void {
    const full: LogEntry = { t: new Date().toISOString(), ...entry };
    this.entries.push(full);
    if (this.maxMemoryEntries !== undefined && this.entries.length > this.maxMemoryEntries) {
      this.entries.splice(0, this.entries.length - this.maxMemoryEntries);
    }
    this.appendToDisk(full);
    if (this.consoleOut) {
      // 控制台输出单行格式（文件保持 JSONL 原样）；过长 data 在 formatLogEntry 里做展示级缩短
      try {
        console.log(formatLogEntry(full));
      } catch {
        /* 展示失败不影响记录与落盘 */
      }
    }
  }

  /** 写入落盘流：建目录、建流、序列化、写入整体不向调用方抛错。
   *  写盘失败只跳过这一条，内存副本与后续记录不受影响。 */
  private appendToDisk(full: LogEntry): void {
    try {
      // 换文件同步完成：本条写入按字节数算出的文件，同一 tick 内的后续记录接着算新文件
      this.ensureStream(full);
      if (!this.stream) return;
      const line = serializeLine(full);
      this.stream.write(line);
      this.activeBytes += Buffer.byteLength(line, 'utf8');
    } catch {
      /* 写盘失败不影响核心运行 */
    }
  }

  /** 打开/切换到正确的分文件（惰性：没写过日志前不建文件、零副作用）。
   *  需要换文件的三种情况：首次写入 / 跨天 / 当前文件已超限（下一条启用新文件）。 */
  private ensureStream(entry: LogEntry): void {
    if (!this.filePath) return;
    const day = dayOf(entry.t);
    if (this.stream && day === this.activeDay && this.activeBytes <= ROTATE_SIZE_LIMIT_BYTES) return;
    const abs = path.resolve(this.filePath);
    const dir = path.dirname(abs);
    const { base, ext } = splitBasePath(abs);
    let seq: number;
    if (this.stream && day === this.activeDay) {
      // 同一天内超限轮转：直接用下一个序号（压线那条已完整落在上一个文件里）
      seq = this.activeSeq + 1;
      this.activeBytes = 0;
    } else {
      // 首次写入或跨天：扫描磁盘续写——当天最后一个文件未超限就接着追加
      let maxSeq = -1;
      try {
        const re = new RegExp('^' + escapeRegExp(base) + '\\.' + day + '\\.(\\d{3})' + escapeRegExp(ext) + '$');
        for (const name of fs.readdirSync(dir)) {
          const m = name.match(re);
          if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
        }
      } catch { /* 目录不存在按无历史处理 */ }
      if (maxSeq >= 0) {
        seq = maxSeq;
        try { this.activeBytes = fs.statSync(fileNameFor(dir, base, day, seq, ext)).size; } catch { this.activeBytes = 0; }
        if (this.activeBytes > ROTATE_SIZE_LIMIT_BYTES) {
          seq = maxSeq + 1;
          this.activeBytes = 0;
        }
      } else {
        seq = 0;
        this.activeBytes = 0;
      }
    }
    fs.mkdirSync(dir, { recursive: true });
    // 换文件同步完成：旧流只发关闭请求并留在 openStreams 里，由 close() 统一等待关闭
    // （旧流可能还有未刷入磁盘的缓冲，等到它关闭才不会在磁盘上留下空文件）。
    const old = this.stream;
    if (old) old.end();
    this.stream = fs.createWriteStream(fileNameFor(dir, base, day, seq, ext), { flags: 'a', encoding: 'utf8' });
    this.openStreams.add(this.stream);
    this.stream.on('error', () => {
      /* 日志写入失败不影响核心运行 */
    });
    this.activeDay = day;
    this.activeSeq = seq;
  }

  all(): LogEntry[] {
    return this.entries;
  }

  byType(type: string): LogEntry[] {
    return this.entries.filter((e) => e.type === type);
  }

  /** 按类别过滤（core/event/module/config/log/error）。 */
  byCategory(category: LogCategory): LogEntry[] {
    return this.entries.filter((e) => categoryOf(String(e.type)) === category);
  }

  /** 磁盘上属于本基础路径的全部轮转文件，按 天→序号 排序（查阅用）。 */
  listFiles(): string[] {
    if (!this.filePath) return [];
    const abs = path.resolve(this.filePath);
    const dir = path.dirname(abs);
    const { base, ext } = splitBasePath(abs);
    const re = new RegExp('^' + escapeRegExp(base) + '\\.(\\d{4}-\\d{2}-\\d{2})\\.(\\d{3})' + escapeRegExp(ext) + '$');
    const marked: { name: string; day: string; seq: number }[] = [];
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch { return []; }
    for (const name of names) {
      const m = name.match(re);
      if (m) marked.push({ name, day: m[1], seq: parseInt(m[2], 10) });
    }
    marked.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.seq - b.seq));
    return marked.map((x) => path.join(dir, x.name));
  }

  /** 读取已落盘的全部轮转文件（按 天→序号 排序拼接；测试与查阅用）。 */
  readFileLines(): string[] {
    const out: string[] = [];
    for (const f of this.listFiles()) {
      try {
        out.push(...fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.length > 0));
      } catch { /* 单个文件读失败跳过 */ }
    }
    return out;
  }

  async close(): Promise<void> {
    // 没有写过日志时也要释放路径占用：否则同一个路径在本进程内再也无法使用。
    // 收尾等全部开过的流关闭：轮转换掉的旧流可能还有未刷入磁盘的缓冲。
    const streams = [...this.openStreams];
    this.openStreams.clear();
    for (const s of streams) {
      await closeStream(s);
    }
    this.stream = undefined;
    if (this.filePath) {
      takenLogFiles.delete(path.resolve(this.filePath));
    }
  }
}