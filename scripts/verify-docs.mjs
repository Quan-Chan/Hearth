// 文档事实对照：断言每条事实在归属文档与源码两侧都存在对应内容。
// 归属文档：软件介绍（README）、软件使用（docs/zh/使用/）、软件实现（docs/zh/实现/）。
import * as fs from 'fs';

const FACTS = [
  { fact: '轮询间隔默认 200ms', doc: ['docs/zh/使用/宿主集成接口.md', '| pollIntervalMs | 200 |'], src: ['src/core/ConnectCore.ts', 'pollIntervalMs ?? 200'] },
  { fact: '日志内存上限 20000', doc: ['docs/zh/使用/宿主集成接口.md', '| maxLogMemoryEntries | 20000 |'], src: ['src/core/ConnectCore.ts', 'DEFAULT_MAX_LOG_MEMORY_ENTRIES = 20000'] },
  { fact: '停机上限 20000', doc: ['docs/zh/使用/宿主集成接口.md', '| stopTimeoutMs | 20000 |'], src: ['src/core/ConnectCore.ts', 'DEFAULT_STOP_TIMEOUT_MS = 20000'] },
  { fact: '解锁途径五种', doc: ['docs/zh/使用/重启与状态.md', '可解除'], src: ['src/core/ModuleManager.ts', 'isManualishStart'] },
  { fact: '日志轮转 128KB', doc: ['docs/zh/使用/日志与命令行.md', '128KB'], src: ['src/core/EventStreamLog.ts', 'ROTATE_SIZE_LIMIT_BYTES = 128'] },
  { fact: '展示截断 2048 字符', doc: ['docs/zh/实现/日志体系.md', '2048'], src: ['src/core/logFormat.ts', 'DISPLAY_TRUNCATE_CHARS = 2048'] },
  { fact: '15 种日志类型', doc: ['docs/zh/使用/日志与命令行.md', 'module-skip、module-start-timeout'], src: ['src/core/logFormat.ts', "MODULE_RESTART: 'module-restart'"] },
  { fact: 'CLI 指令表含 exit', doc: ['docs/zh/使用/日志与命令行.md', '| exit |'], src: ['src/core/CliProtocol.ts', "cmd === 'exit'"] },
  { fact: '指令通道为定向指令', doc: ['docs/zh/实现/CLI协议.md', "sendTo('core', { cmd, args })"], src: ['src/core/CliProtocol.ts', 'handleDirected'] },
  { fact: '钩子签名两参数', doc: ['docs/zh/使用/模块程序.md', 'onEvent(ctx, event)'], src: ['src/types.ts', 'onEvent?(ctx: ModuleContext, event: CoreEvent)'] },
  { fact: '数组注册表规则', doc: ['docs/zh/实现/公共数组.md', 'removeOwner'], src: ['src/core/ArrayRegistry.ts', 'removeOwner(owner: string)'] },
  { fact: '启动事件名 core:startup', doc: ['docs/zh/实现/场景/cold-start.md', 'core:startup'], src: ['src/core/ConnectCore.ts', "sendEvent('startup'"] },
  { fact: '停机调用模块停止钩子', doc: ['docs/zh/实现/场景/shutdown.md', '调用 stop()'], src: ['src/core/ModuleManager.ts', 'def?.stop?.'] },
  { fact: '通配符规则', doc: ['docs/zh/使用/模块配置.md', '* 匹配任意字符序列'], src: ['src/core/EventMatcher.ts', 'patternToRegExp'] },
  { fact: '目录只收集两层', doc: ['docs/zh/实现/配置监听.md', '只收集两层'], src: ['src/core/ConfigWatcher.ts', 'collectYamlFiles'] },
];

let failed = 0;
for (const f of FACTS) {
  const docText = fs.readFileSync(f.doc[0], 'utf8');
  const srcText = fs.readFileSync(f.src[0], 'utf8');
  const docOk = docText.includes(f.doc[1]);
  const srcOk = srcText.includes(f.src[1]);
  if (!docOk || !srcOk) {
    failed++;
    console.log(`FAIL ${f.fact}: 文档${docOk ? 'OK' : '缺'} 源码${srcOk ? 'OK' : '缺'}`);
  } else {
    console.log(`ok   ${f.fact}`);
  }
}
if (failed > 0) { console.log(`事实对照失败 ${failed} 项`); process.exit(1); }
console.log('事实对照全部通过');