/**
 * 定向消息（信息直达）通道测试：点对点直通，不经事件比对、不进公共数组。
 *  1. 模块->模块直发：接收方 onMessage 收到 { source, data }，可回发；sendTo 返回送达凭据
 *  2. 接收 opt-in：未实现 onMessage 的模块收不到；目标不存在时 sendTo 返回 false
 *  3. 核心可寻址：sendTo('core', {cmd}) 执行指令处理器，并把结果直接回传给发起方
 *  4. 多模块同时向核心请求：各收各的结果，互不串扰（直回复不落共享信箱）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ConnectCore } from '../../src/core/ConnectCore';
import { mkTmpDir, rmDir, waitFor, arr, yamlFor } from '../helpers';

// ---------------- 夹具模块 ----------------

// hub：接收定向消息，记录谁发的与内容；若消息里带 ping 就回发 echo
const HUB_CJS = `module.exports = {
  name: 'hub',
  start(ctx) { ctx.exposeArray('got', []); },
  onMessage(ctx, message) {
    ctx.array('got').push({ from: message.source, data: message.data });
    if (message.data && message.data.ping) {
      void ctx.sendTo(message.source, { echo: message.data.ping });
    }
  },
};
`;

// sender：收到 go1 后向 hub 直发并回 ghost 探测（验证送达凭据）
const SENDER_CJS = `module.exports = {
  name: 'sender',
  start(ctx) { ctx.exposeArray('receipt', []); ctx.exposeArray('echo', []); },
  async onEvent(ctx, event) {
    if (!event.name.endsWith(':go1')) return;
    const ok = await ctx.sendTo('hub', { ping: 'hello' });
    ctx.array('receipt').push(ok);
    const miss = await ctx.sendTo('ghost', { ping: 'x' });
    ctx.array('receipt').push(miss);
  },
  onMessage(ctx, message) { ctx.array('echo').push(message.data); },
};
`;

// deaf：没有 onMessage，定向消息对它不可达
const DEAF_CJS = `module.exports = {
  name: 'deaf',
  start(ctx) { ctx.exposeArray('marks', ['up']); },
};
`;

// commander：收到 ask-state/ask-bad 后 sendTo('core', ...)，把回传结果记下
const COMMANDER_CJS = `module.exports = {
  name: 'commander',
  start(ctx) { ctx.exposeArray('replies', []); },
  onEvent(ctx, event) {
    if (event.name.endsWith(':ask-state')) void ctx.sendTo('core', { cmd: 'state' });
    if (event.name.endsWith(':ask-bad')) void ctx.sendTo('core', { cmd: 'frobnicate' });
  },
  onMessage(ctx, message) { ctx.array('replies').push(message.data); },
};
`;

// alpha / beta：共同收到 both-fire 后同时向核心要 event 指令（并发请求核心）
const ALPHA_CJS = `module.exports = {
  name: 'alpha',
  start(ctx) { ctx.exposeArray('replies', []); },
  onEvent(ctx, event) {
    if (!event.name.endsWith(':both-fire')) return;
    void ctx.sendTo('core', { cmd: 'event', args: { name: 'alpha-fire', data: { who: 'alpha' } } });
  },
  onMessage(ctx, message) { ctx.array('replies').push(message.data); },
};
`;
const BETA_CJS = `module.exports = {
  name: 'beta',
  start(ctx) { ctx.exposeArray('replies', []); },
  onEvent(ctx, event) {
    if (!event.name.endsWith(':both-fire')) return;
    void ctx.sendTo('core', { cmd: 'event', args: { name: 'beta-fire', data: { who: 'beta' } } });
  },
  onMessage(ctx, message) { ctx.array('replies').push(message.data); },
};
`;
const SINK_CJS = `module.exports = {
  name: 'sink',
  start(ctx) { ctx.exposeArray('events', []); },
  onEvent(ctx, event) { ctx.array('events').push(event.name); },
};
`;

// ---------------- 测试 1 + 2：模块->模块直发 / opt-in / 送达凭据 ----------------

test('定向消息：模块直发模块，onMessage 收 head+内容，可回发；无接收方时 sendTo 返回 false', async () => {
  const dir = mkTmpDir('dmsg');
  try {
    fs.writeFileSync(path.join(dir, 'hub.cjs'), HUB_CJS);
    fs.writeFileSync(path.join(dir, 'hub.yaml'), yamlFor('hub', { startEvents: ['core:startup'] }));
    fs.writeFileSync(path.join(dir, 'sender.cjs'), SENDER_CJS);
    fs.writeFileSync(path.join(dir, 'sender.yaml'), yamlFor('sender', { startEvents: ['core:startup'], listen: ['*:go1'] }));
    fs.writeFileSync(path.join(dir, 'deaf.cjs'), DEAF_CJS);
    fs.writeFileSync(path.join(dir, 'deaf.yaml'), yamlFor('deaf', { startEvents: ['core:startup'] }));
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();

    await core.sendEvent('go1');
    // 送达凭据：hub 收到（true），ghost 不存在（false）
    assert.deepEqual(arr(core as any, 'public:sender:receipt'), [true, false]);
    // hub 收到：消息带基础头（from=sender）与内容
    assert.deepEqual(arr(core as any, 'public:hub:got'), [{ from: 'sender', data: { ping: 'hello' } }]);
    // hub 回发的 echo 直达 sender
    await waitFor(() => arr(core as any, 'public:sender:echo').length === 1);
    assert.deepEqual(arr(core as any, 'public:sender:echo'), [{ echo: 'hello' }]);

    // 直发核心 API：目标未实现 onMessage -> false；目标不存在 -> false
    assert.equal(await core.sendTo('deaf', { x: 1 }, 'tester'), false);
    assert.equal(await core.sendTo('no-such-module', { x: 1 }, 'tester'), false);
    await core.stop();
  } finally { rmDir(dir); }
});

// ---------------- 测试 3：核心可寻址，结果直接回传发起方 ----------------

test('核心可寻址：sendTo(' + "'" + 'core' + "'" + ', {cmd}) 执行并通过 onMessage 直接回传结果', async () => {
  const dir = mkTmpDir('dcmd');
  try {
    fs.writeFileSync(path.join(dir, 'commander.cjs'), COMMANDER_CJS);
    fs.writeFileSync(path.join(dir, 'commander.yaml'), yamlFor('commander', { startEvents: ['core:startup'], listen: ['*:ask-state', '*:ask-bad'] }));
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();

    await core.sendEvent('ask-state');
    await waitFor(() => arr(core as any, 'public:commander:replies').length === 1);
    const reply = arr(core as any, 'public:commander:replies')[0] as any;
    assert.equal(reply.cmd, 'state');
    assert.equal(reply.ok, true);
    assert.ok(Array.isArray(reply.result.modules)); // result 直接回传给了发起方

    // 未知指令：ok:false + error，核心继续可用
    await core.sendEvent('ask-bad');
    await waitFor(() => arr(core as any, 'public:commander:replies').length === 2);
    const bad = arr(core as any, 'public:commander:replies')[1] as any;
    assert.equal(bad.ok, false);
    assert.ok(String(bad.error).includes('未知 CLI 指令'));
    await core.stop();
  } finally { rmDir(dir); }
});

// ---------------- 测试 4：多模块并发请求核心不串扰 ----------------

test('多模块同时请求核心：各收各的结果，互不串扰（直回复不落共享信箱）', async () => {
  const dir = mkTmpDir('dfire');
  try {
    fs.writeFileSync(path.join(dir, 'alpha.cjs'), ALPHA_CJS);
    fs.writeFileSync(path.join(dir, 'alpha.yaml'), yamlFor('alpha', { startEvents: ['core:startup'], listen: ['*:both-fire'] }));
    fs.writeFileSync(path.join(dir, 'beta.cjs'), BETA_CJS);
    fs.writeFileSync(path.join(dir, 'beta.yaml'), yamlFor('beta', { startEvents: ['core:startup'], listen: ['*:both-fire'] }));
    fs.writeFileSync(path.join(dir, 'sink.cjs'), SINK_CJS);
    fs.writeFileSync(path.join(dir, 'sink.yaml'), yamlFor('sink', { startEvents: ['core:startup'], listen: ['*:alpha-fire', '*:beta-fire'] }));
    const core = new ConnectCore({ moduleDir: dir, watch: false });
    await core.start();

    await core.sendEvent('both-fire');
    await waitFor(() => arr(core as any, 'public:alpha:replies').length === 1 && arr(core as any, 'public:beta:replies').length === 1);

    // 各自只收到自己的结果（不回别人的）
    const a = arr(core as any, 'public:alpha:replies')[0] as any;
    const b = arr(core as any, 'public:beta:replies')[0] as any;
    assert.equal(a.cmd, 'event');
    assert.equal(a.ok, true);
    assert.deepEqual(a.result, { delivered: 'alpha:alpha-fire' });
    assert.equal(b.cmd, 'event');
    assert.equal(b.ok, true);
    assert.deepEqual(b.result, { delivered: 'beta:beta-fire' });
    // 两条事件确实都被发出来了（核心替请求方执行了指令）
    await waitFor(() => arr(core as any, 'public:sink:events').length === 2);
    assert.deepEqual(arr(core as any, 'public:sink:events').slice().sort(), ['alpha:alpha-fire', 'beta:beta-fire']);
    await core.stop();
  } finally { rmDir(dir); }
});
