/**
 * 事件流水日志：一条"只记录核心自己干的事情"的连续时间线。
 * 每条记录三字段主结构：{ type, source, message }（见 logFormat.ts）+ 任意结构化附加字段。
 *
 * 内容完整性约定（重要）：日志内容永远完整保存，框架不在存储层做任何截断——
 * 过长的 data 只在展示层（formatLogEntry / CLI 渲染）缩短显示并标注原始长度，
 * 查阅者永远能从落盘文件里拿到完整信息。
 *
 * 双层存储：内存 entries 供进程内即时查询（条数有上限，超出丢最旧；内容同样不截断），
 * JSONL 追加流负责持久化；写盘失败只吞掉、绝不影响核心主流程。
 * 数组操作不写日志（高频数据通道，逐条记会撑爆文件）。
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

/** 由 ISO 时间戳取 UTC 日份（与条目 t 同源，保证文件名与内容时间一致）。 */
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

export class EventStreamLog {
  private entries: LogEntry[] = [];
  private filePath?: string;
  private stream?: fs.WriteStream;
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
  }

  /** 追加一条记录（先落内存再到磁盘，顺序一致）。内容永远完整，不做任何截断。 */
  record(entry: LogEntry): void {
    const full: LogEntry = { t: new Date().toISOString(), ...entry };
    this.entries.push(full);
    if (this.maxMemoryEntries !== undefined && this.entries.length > this.maxMemoryEntries) {
      this.entries.splice(0, this.entries.length - this.maxMemoryEntries);
    }
    this.ensureStream(full);
    if (this.consoleOut) {
      // 控制台输出人类可读格式（文件保持 JSONL 原样）；过长 data 在 formatLogEntry 里做展示级缩短
      console.log(formatLogEntry(full));
    }
    if (this.stream) {
      const line = JSON.stringify(full) + '\n';
      this.stream.write(line);
      this.activeBytes += Buffer.byteLength(line, 'utf8');
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
    const old = this.stream;
    if (old) old.end();
    this.stream = fs.createWriteStream(fileNameFor(dir, base, day, seq, ext), { flags: 'a', encoding: 'utf8' });
    this.stream.on('error', () => {
      /* 日志写入失败不影响核心运行 */
    });
    this.activeDay = day;
    this.activeSeq = seq;
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
    if (!this.stream) return;
    await new Promise<void>((resolve) => {
      this.stream!.end(() => resolve());
    });
    this.stream = undefined;
  }
}