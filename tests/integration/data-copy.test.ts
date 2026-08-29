import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ConnectCore } from '../../src/core/ConnectCore';
import { mkTmpDir, rmDir, waitFor, arr, yamlFor } from '../helpers';

/**
 * 事件 data 拷贝：每个监听者收到独立副本，修改自己的副本不影响其他监听者。
 */

const MUTATOR_CJS = `module.exports = {
  name: 'mutator',
  start(ctx) { ctx.exposeArray('seen', []); },
  onEvent(ctx, event) {
    ctx.array('seen').push({ before: event.data.count });
    event.data.count = 999;
    ctx.array('seen').push({ after: event.data.count });
  },
};
`;

const OBSERVER_CJS = `module.exports = {
  name: 'observer',
  start(ctx) { ctx.exposeArray('seen', []); },
  onEvent(ctx, event) {
    ctx.array('seen').push(event.data.count);
  },
};
`;

test('data 按接收者独立拷贝：监听者修改自己的 data 不影响其他监听者', async () => {
  const dir = mkTmpDir('datacopy');
  try {
    fs.writeFileSync(path.join(dir, 'mutator.cjs'), MUTATOR_CJS);
    fs.writeFileSync(path.join(dir, 'mutator.yaml'), yamlFor('mutator', { startEvents: ['core:startup'], listen: ['*:go'] }));
    fs.writeFileSync(path.join(dir, 'observer.cjs'), OBSERVER_CJS);
    fs.writeFileSync(path.join(dir, 'observer.yaml'), yamlFor('observer', { startEvents: ['core:startup'], listen: ['*:go'] }));
    const core = new ConnectCore({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    await core.sendEvent('go', { count: 1 });
    await waitFor(() => arr(core as any, 'public:mutator:seen').length === 2 && arr(core as any, 'public:observer:seen').length === 1);
    const mut = arr(core as any, 'public:mutator:seen');
    assert.deepEqual(mut[0], { before: 1 });
    assert.deepEqual(mut[1], { after: 999 });
    const obs = arr(core as any, 'public:observer:seen');
    assert.deepEqual(obs, [1]);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});
