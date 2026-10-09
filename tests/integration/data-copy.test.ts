import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { Hearth } from '../../src/core/Hearth';
import { mkTmpDir, rmDir, waitFor, items, yamlFor } from '../helpers';

/**
 * 事件 data 拷贝：每个监听者收到独立副本，修改自己的副本不影响其他监听者。
 */

const MUTATOR_CJS = `module.exports = {
  name: 'mutator',
  start(ctx) { ctx.exposeObject('seen', { items: [] }); },
  onEvent(ctx, event) {
    ctx.object('seen').items.push({ before: event.data.count });
    event.data.count = 999;
    ctx.object('seen').items.push({ after: event.data.count });
  },
};
`;

const OBSERVER_CJS = `module.exports = {
  name: 'observer',
  start(ctx) { ctx.exposeObject('seen', { items: [] }); },
  onEvent(ctx, event) {
    ctx.object('seen').items.push(event.data.count);
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
    const core = new Hearth({ logFile: path.join(dir, 'core.log'), moduleDir: dir, watch: false });
    await core.start();
    await core.sendEvent('go', { count: 1 });
    await waitFor(() => items(core as any, 'public:mutator:seen').length === 2 && items(core as any, 'public:observer:seen').length === 1);
    const mut = items(core as any, 'public:mutator:seen');
    assert.deepEqual(mut[0], { before: 1 });
    assert.deepEqual(mut[1], { after: 999 });
    const obs = items(core as any, 'public:observer:seen');
    assert.deepEqual(obs, [1]);
    await core.stop();
  } finally {
    rmDir(dir);
  }
});