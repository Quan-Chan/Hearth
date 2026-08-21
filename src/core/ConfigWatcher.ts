/**
 * 模块文件夹监听器：框架核心始终监听模块文件夹（**不递归** —— 只识别模块目录本层与
 * 『每个模块一个子文件夹』层；不深入子目录，避免把模块内部嵌套的子核心/子模块配置
 * 文件误认成本核心的模块，造成不可预测的文件冲突）。
 * 模块布局约定：每个模块一个文件夹，文件夹内放 <name>.yaml + <name>.cjs；
 * 也支持把 <name>.yaml 直接放在模块目录顶层（扁平，测试常用）。
 *  - 新的 YAML 配置文件出现   -> onLoad
 *  - 已有 YAML 文件内容变化   -> onUpdate
 *  - YAML 文件被删除          -> onRemove
 * 检测策略（性能）：稳态每轮只 statSync（mtimeMs+size+ctimeMs 指纹），指纹不变的文件
 * 直接跳过、不读内容；指纹变化才 readFileSync + sha1 二次确认（同内容只改 mtime 的
 * touch 不触发 onUpdate）；哈希真变才解析 YAML。解析失败不更新指纹 -> 下轮重试（自愈）。
 * 为什么轮询而不是 fs.watch：fs.watch 在 Windows/macOS 上的事件丢失与语义差异问题
 * 多（保存中间态、编辑器原子替换都可能漏报/误报），轮询 + 内容哈希每帧给出确定的结论，
 * 换来的是跨平台一致可靠；代价只是一个 200ms 的 stat 心跳，稳态开销可忽略。
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { parse as parseYaml } from 'yaml';
import type { ModuleConfig } from '../types';

export interface WatcherCallbacks {
  onLoad(config: ModuleConfig, yamlPath: string): void | Promise<void>;
  onUpdate(config: ModuleConfig, yamlPath: string): void | Promise<void>;
  onRemove(name: string): void | Promise<void>;
  onError?(name: string, message: string): void;
}

/** 文件指纹：stat 快照（任何写入都会改变 ctime，配合 mtime+size 消除碰撞漏报）。 */
interface StatFingerprint {
  name: string;
  mtimeMs: number;
  size: number;
  ctimeMs: number;
}

function sameFingerprint(a: StatFingerprint, b: fs.Stats): boolean {
  return a.mtimeMs === b.mtimeMs && a.size === b.size && a.ctimeMs === b.ctimeMs;
}

export class ConfigWatcher {
  private dir: string;
  private callbacks: WatcherCallbacks;
  private pollIntervalMs: number;
  private enabled: boolean;
  private timer?: NodeJS.Timeout;
  /** 已知配置：模块名 -> 文件信息 */
  private known = new Map<string, { yamlPath: string; hash: string }>();
  /** stat 指纹缓存：yamlPath -> 上次 stat 快照（+该文件声明的模块名，稳态跳过读文件用） */
  private stats = new Map<string, StatFingerprint>();
  private scanning = false;

  constructor(opts: {
    dir: string;
    callbacks: WatcherCallbacks;
    pollIntervalMs?: number;
    watch?: boolean;
  }) {
    this.dir = path.resolve(opts.dir);
    this.callbacks = opts.callbacks;
    this.pollIntervalMs = opts.pollIntervalMs ?? 200;
    this.enabled = opts.watch !== false;
  }

  /** 初始扫描 + 启动轮询监听。 */
  async start(): Promise<void> {
    fs.mkdirSync(this.dir, { recursive: true });
    await this.rescan();
    if (this.enabled) {
      this.timer = setInterval(() => {
        void this.rescan();
      }, this.pollIntervalMs);
      this.timer.unref();
    }
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** 全量扫描目录，与已知状态比对并触发回调。 */
  async rescan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const files = collectYamlFiles(this.dir);
      const seen = new Set<string>();
      for (const yamlPath of files) {
        // 1) 稳态快路径：仅 stat，指纹与上次一致则跳过（文件没变，不读内容）
        let stat: fs.Stats;
        try {
          stat = fs.statSync(yamlPath);
        } catch {
          continue;
        }
        const prevStat = this.stats.get(yamlPath);
        if (prevStat && sameFingerprint(prevStat, stat)) {
          seen.add(prevStat.name);
          continue;
        }
        // 2) 指纹变了：读内容 + 哈希二次确认（touch 只改 mtime 时哈希相同 -> 跳过）
        let text: string;
        try {
          text = fs.readFileSync(yamlPath, 'utf8');
        } catch {
          continue;
        }
        const hash = createHash('sha1').update(text).digest('hex');
        let cfgName = prevStat?.name;
        if (cfgName !== undefined) {
          const prev = this.known.get(cfgName);
          if (prev && prev.hash === hash) {
            // 内容没变：只更新指纹（不触发 onUpdate）
            this.stats.set(yamlPath, { name: cfgName, mtimeMs: stat.mtimeMs, size: stat.size, ctimeMs: stat.ctimeMs });
            seen.add(cfgName);
            continue;
          }
        }
        // 3) 哈希真变（或新文件）：解析 YAML 确定模块名并触发回调
        let cfg: ModuleConfig;
        try {
          cfg = parseModuleConfig(text, path.dirname(yamlPath));
        } catch (err) {
          this.callbacks.onError?.(
            path.basename(yamlPath, path.extname(yamlPath)),
            err instanceof Error ? err.message : String(err),
          );
          continue; // 不更新指纹 -> 下轮重试（自愈）
        }
        this.stats.set(yamlPath, { name: cfg.name, mtimeMs: stat.mtimeMs, size: stat.size, ctimeMs: stat.ctimeMs });
        seen.add(cfg.name);
        const prev = this.known.get(cfg.name);
        if (!prev) {
          this.known.set(cfg.name, { yamlPath, hash });
          await this.callbacks.onLoad(cfg, yamlPath);
        } else if (prev.hash !== hash) {
          this.known.set(cfg.name, { yamlPath, hash });
          await this.callbacks.onUpdate(cfg, yamlPath);
        }
      }
      for (const [name, info] of [...this.known]) {
        if (!seen.has(name)) {
          this.known.delete(name);
          this.stats.delete(info.yamlPath);
          await this.callbacks.onRemove(name);
        }
      }
    } finally {
      this.scanning = false;
    }
  }

  listNames(): string[] {
    return [...this.known.keys()];
  }
}

/** 收集模块 YAML（不递归）：只识别两层——模块目录顶层直接放的 YAML，以及『每个模块
 * 一个子文件夹』（modules/<name>/）里直接放的 YAML。不再递归深入任意子目录：
 * 递归会把模块内部嵌套的子核心/子模块配置文件误认成本核心的模块，造成不可预测的文件冲突。
 * 确定性顺序，跳过 node_modules 与隐藏目录。 */
function collectYamlFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch {
    return out;
  }
  const isYaml = (name: string): boolean => /\.ya?ml$/i.test(name);
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      // 模块子文件夹：只取其中直接放的 YAML，不再进入更深层
      if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
      let sub: fs.Dirent[];
      try {
        sub = fs.readdirSync(p, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      } catch {
        continue;
      }
      for (const s of sub) {
        if (s.isFile() && isYaml(s.name)) out.push(path.join(p, s.name));
      }
    } else if (isYaml(ent.name)) {
      out.push(p);
    }
  }
  return out;
}

/** 解析模块 YAML 文本为 ModuleConfig。file 相对路径基于 baseDir 解析。 */
export function parseModuleConfig(text: string, baseDir: string): ModuleConfig {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new Error(`YAML 解析失败: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('YAML 顶层必须是映射对象');
  }
  const obj = raw as Record<string, unknown>;
  const name = obj.name;
  if (typeof name !== 'string' || name.length === 0) throw new Error('缺少 name（模块名）');
  const file = obj.file;
  if (typeof file !== 'string' || file.length === 0) {
    throw new Error(`模块 ${name} 缺少 file（模块程序路径）`);
  }
  return {
    name,
    file: path.resolve(baseDir, file),
    startEvents: normalizeStringArray(obj.startEvents),
    listen: normalizeStringArray(obj.listen),
    enabled: obj.enabled !== false,
    config:
      typeof obj.config === 'object' && obj.config !== null && !Array.isArray(obj.config)
        ? (obj.config as Record<string, unknown>)
        : {},
  };
}

function normalizeStringArray(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return [v];
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[];
  return undefined;
}
