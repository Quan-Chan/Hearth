"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const ArrayRegistry_1 = require("../../src/core/ArrayRegistry");
function makeRegistry() {
    const r = new ArrayRegistry_1.ArrayRegistry();
    r.expose('items', 'mod-a', [{ id: 1 }, { id: 2 }]);
    return r;
}
(0, node_test_1.test)('expose + pull：返回深拷贝快照', () => {
    const r = makeRegistry();
    const snap = r.pull('items');
    strict_1.default.deepEqual(snap, [{ id: 1 }, { id: 2 }]);
    // 修改快照不影响注册表
    snap.push({ id: 3 });
    snap[0].id = 999;
    strict_1.default.deepEqual(r.pull('items'), [{ id: 1 }, { id: 2 }]);
});
(0, node_test_1.test)('expose：重名、非法名、非数组初始值都抛错', () => {
    const r = makeRegistry();
    strict_1.default.throws(() => r.expose('items', 'mod-b'), /已存在/);
    strict_1.default.throws(() => r.expose('', 'mod-b'), /非空字符串/);
    strict_1.default.throws(() => r.expose('x', 'mod-b', 'not-array'), /必须是数组/);
});
(0, node_test_1.test)('pull：不存在的数组抛错', () => {
    const r = makeRegistry();
    strict_1.default.throws(() => r.pull('nope'), /不存在/);
});
(0, node_test_1.test)('unexpose：仅拥有者可取消公开', () => {
    const r = makeRegistry();
    strict_1.default.throws(() => r.unexpose('items', 'mod-b'), /无权取消公开/);
    strict_1.default.throws(() => r.unexpose('nope', 'mod-a'), /不存在/);
    r.unexpose('items', 'mod-a');
    strict_1.default.equal(r.has('items'), false);
});
(0, node_test_1.test)('编辑操作：push / pop / shift / unshift', () => {
    const r = new ArrayRegistry_1.ArrayRegistry();
    r.expose('a', 'm', []);
    r.edit('a', { type: 'push', value: 1 });
    r.edit('a', { type: 'push', values: [2, 3] });
    strict_1.default.deepEqual(r.pull('a'), [1, 2, 3]);
    r.edit('a', { type: 'pop' });
    strict_1.default.deepEqual(r.pull('a'), [1, 2]);
    r.edit('a', { type: 'shift' });
    strict_1.default.deepEqual(r.pull('a'), [2]);
    r.edit('a', { type: 'unshift', value: 0 });
    strict_1.default.deepEqual(r.pull('a'), [0, 2]);
});
(0, node_test_1.test)('编辑操作：set / removeAt / removeValue / splice / clear / apply', () => {
    const r = new ArrayRegistry_1.ArrayRegistry();
    r.expose('a', 'm', [10, 20, 30, 40]);
    r.edit('a', { type: 'set', index: 1, value: 99 });
    strict_1.default.deepEqual(r.pull('a'), [10, 99, 30, 40]);
    r.edit('a', { type: 'removeAt', index: 0 });
    strict_1.default.deepEqual(r.pull('a'), [99, 30, 40]);
    r.edit('a', { type: 'removeValue', value: 30 });
    strict_1.default.deepEqual(r.pull('a'), [99, 40]);
    r.edit('a', { type: 'removeValue', value: 9999 }); // 不存在 -> no-op
    strict_1.default.deepEqual(r.pull('a'), [99, 40]);
    r.edit('a', { type: 'splice', index: 1, deleteCount: 1, insert: [7, 8] });
    strict_1.default.deepEqual(r.pull('a'), [99, 7, 8]);
    r.edit('a', { type: 'clear' });
    strict_1.default.deepEqual(r.pull('a'), []);
    r.edit('a', { type: 'apply', fn: (arr) => arr.map((x) => x * 2) });
    strict_1.default.deepEqual(r.pull('a'), []);
});
(0, node_test_1.test)('编辑操作：越界与未知操作抛错', () => {
    const r = new ArrayRegistry_1.ArrayRegistry();
    r.expose('a', 'm', [1]);
    strict_1.default.throws(() => r.edit('a', { type: 'set', index: 5, value: 1 }), /越界/);
    strict_1.default.throws(() => r.edit('a', { type: 'removeAt', index: -1 }), /越界/);
    strict_1.default.throws(() => r.edit('a', { type: 'bogus' }), /不支持的数组操作/);
    strict_1.default.throws(() => r.edit('nope', { type: 'push', value: 1 }), /不存在/);
});
(0, node_test_1.test)('编辑不会改变数组名（公共数组名不可变）', () => {
    const r = makeRegistry();
    r.edit('items', { type: 'push', value: 3 });
    strict_1.default.deepEqual(r.list(), ['items']);
    strict_1.default.equal(r.ownerOf('items'), 'mod-a');
});
(0, node_test_1.test)('ownerOf / has / list', () => {
    const r = makeRegistry();
    strict_1.default.equal(r.ownerOf('items'), 'mod-a');
    strict_1.default.equal(r.ownerOf('nope'), undefined);
    strict_1.default.equal(r.has('items'), true);
    strict_1.default.deepEqual(r.list(), ['items']);
});
