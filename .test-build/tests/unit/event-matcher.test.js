"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const EventMatcher_1 = require("../../src/core/EventMatcher");
(0, node_test_1.test)('精确匹配：相同字符串才匹配', () => {
    strict_1.default.equal((0, EventMatcher_1.eventMatches)('core:startup', 'core:startup'), true);
    strict_1.default.equal((0, EventMatcher_1.eventMatches)('core:startup', 'core:shutdown'), false);
    strict_1.default.equal((0, EventMatcher_1.eventMatches)('chat:message', 'chat:message:extra'), false);
});
(0, node_test_1.test)('通配符 *：匹配任意字符序列', () => {
    strict_1.default.equal((0, EventMatcher_1.eventMatches)('chat:*', 'chat:message'), true);
    strict_1.default.equal((0, EventMatcher_1.eventMatches)('chat:*', 'chat:'), true);
    strict_1.default.equal((0, EventMatcher_1.eventMatches)('chat:*', 'chat'), false);
    strict_1.default.equal((0, EventMatcher_1.eventMatches)('*', 'anything:at:all'), true);
    strict_1.default.equal((0, EventMatcher_1.eventMatches)('a*b', 'axxxb'), true);
    strict_1.default.equal((0, EventMatcher_1.eventMatches)('a*b', 'ab'), true);
});
(0, node_test_1.test)('通配符 ?：匹配单个字符', () => {
    strict_1.default.equal((0, EventMatcher_1.eventMatches)('a?c', 'abc'), true);
    strict_1.default.equal((0, EventMatcher_1.eventMatches)('a?c', 'ac'), false);
    strict_1.default.equal((0, EventMatcher_1.eventMatches)('a?c', 'abbc'), false);
});
(0, node_test_1.test)('正则特殊字符按字面处理', () => {
    strict_1.default.equal((0, EventMatcher_1.eventMatches)('a.b', 'a.b'), true);
    strict_1.default.equal((0, EventMatcher_1.eventMatches)('a.b', 'axb'), false);
    strict_1.default.equal((0, EventMatcher_1.eventMatches)('a+b', 'a+b'), true);
    strict_1.default.equal((0, EventMatcher_1.eventMatches)('a+b', 'aaab'), false);
});
(0, node_test_1.test)('anyEventMatches：未定义/空列表不匹配，任一命中即匹配', () => {
    strict_1.default.equal((0, EventMatcher_1.anyEventMatches)(undefined, 'x'), false);
    strict_1.default.equal((0, EventMatcher_1.anyEventMatches)([], 'x'), false);
    strict_1.default.equal((0, EventMatcher_1.anyEventMatches)(['a', 'b:*'], 'b:1'), true);
    strict_1.default.equal((0, EventMatcher_1.anyEventMatches)(['a', 'b:*'], 'c'), false);
});
(0, node_test_1.test)('patternToRegExp 输出正确的正则', () => {
    strict_1.default.equal((0, EventMatcher_1.patternToRegExp)('chat:*').test('chat:message'), true);
    strict_1.default.equal((0, EventMatcher_1.patternToRegExp)('chat:*').test('chat'), false);
    strict_1.default.equal((0, EventMatcher_1.patternToRegExp)('core:startup').test('core:startup'), true);
});
(0, node_test_1.test)('非字符串输入不匹配', () => {
    strict_1.default.equal((0, EventMatcher_1.eventMatches)('*', ''), true); // 空串也匹配 *
    strict_1.default.equal((0, EventMatcher_1.eventMatches)(undefined, 'x'), false);
    strict_1.default.equal((0, EventMatcher_1.eventMatches)('x', undefined), false);
});
