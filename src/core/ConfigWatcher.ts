/**
 * 模块文件夹监听器：框架核心始终监听模块文件夹。
 *  - 新的 YAML 配置文件出现   -> onLoad
 *  - 已有 YAML 文件内容变化   -> onUpdate
 *  - YAML 文件被删除          -> onRemove
 * 通过内容哈希比对实现，轮询（默认 200ms）跨平台可靠。
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

export class ConfigWatcher {
  private dir: string;
  private callbacks: WatcherCallbacks;
  private pollIntervalMs: number;
  private enabled: boolean;
  private timer?: NodeJS.Timeout;
  /** 已知配置：模块名 -> 文件信息 */
  private known = new Map<string, { yamlPath: string; hash: string }>();
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
      const files = fs
        .readdirSync(this.dir)
        .filter((f) => /\.ya?ml$/i.test(f))
        .sort();
      const seen = new Set<string>();
      for (const f of files) {
        const yamlPath = path.join(this.dir, f);
        let text: string;
        try {
          text = fs.readFileSync(yamlPath, 'utf8');
        } catch {
          continue;
        }
        const hash = createHash('sha1').update(text).digest('hex');
        let cfg: ModuleConfig;
        try {
          cfg = parseModuleConfig(text, this.dir);
        } catch (err) {
          this.callbacks.onError?.(
            path.basename(f, path.extname(f)),
            err instanceof Error ? err.message : String(err),
          );
          continue;
        }
        const prev = this.known.get(cfg.name);
        if (!prev) {
          this.known.set(cfg.name, { yamlPath, hash });
          await this.callbacks.onLoad(cfg, yamlPath);
        } else if (prev.hash !== hash) {
          this.known.set(cfg.name, { yamlPath, hash });
          await this.callbacks.onUpdate(cfg, yamlPath);
        }
        seen.add(cfg.name);
      }
      for (const [name, info] of [...this.known]) {
        if (!seen.has(name)) {
          this.known.delete(name);
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
