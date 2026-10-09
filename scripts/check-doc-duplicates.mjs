// 文档间重复检查：跨文档出现相同句子的段落（标题、表格分隔行、代码块除外）报警。
// 双语化规则：代码块中英版本相同不算重复；需求文档与使用/实现文档的分层重叠不算重复；
// 只在同语言同层级的文档之间查重（zh-usage / zh-impl / en-usage / en-impl / root）。
import * as fs from 'fs';
import * as path from 'path';

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && e.name === 'dev') continue; // 开发时文档不参与查重
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
}
const files = ['README.md', 'README.zh.md'];
walk('docs', files);

// 去掉代码块内容（``` 之间的段落中英版本必然相同，不算重复）
function stripCodeBlocks(text) {
  return text.replace(/```[\s\S]*?```/g, '');
}

const norm = (s) => s.replace(/[`#|*]/g, '').replace(/\s/g, '');
const IGNORE = [
  norm('[English](README.md) | [中文](README.zh.md)'),
  // 两个 README 共用同一个 CI 徽章地址，中英版本必然相同，不算重复
  norm('[![CI](https://github.com/Quan-Chan/Hearth/actions/workflows/ci.yml/badge.svg)](https://github.com/Quan-Chan/Hearth/actions/workflows/ci.yml)'),
];

// 分组键：语言+层级。需求与编写要求单独一组（不参与查重）。
const groupOf = (f) => {
  if (f.includes('requirements')) return 'req';
  const sep = f.includes('\\') ? '\\' : '/';
  const lang = f.includes('docs' + sep + 'zh' + sep) ? 'zh' : f.includes('docs' + sep + 'en' + sep) ? 'en' : 'root';
  const layer = f.includes(sep + 'usage' + sep) ? 'usage' : f.includes(sep + 'implementation' + sep) ? 'impl' : 'root';
  return lang + '-' + layer;
};

const seen = new Map();
for (const f of files) {
  const group = groupOf(f);
  if (group === 'req') continue; // 需求文档不参与查重
  const text = stripCodeBlocks(fs.readFileSync(f, 'utf8'));
  for (const piece of text.split(/[。；;\n！？]/)) {
    const n = norm(piece);
    if (n.length < 18 || IGNORE.includes(n)) continue;
    const key = group + ':' + n;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push({ file: f, text: piece.trim() });
  }
}

let bad = 0;
for (const [key, locs] of seen) {
  const filesSet = new Set(locs.map((l) => l.file));
  if (filesSet.size > 1) {
    bad++;
    console.log('重复 [' + [...filesSet].join(', ') + ']: ' + locs[0].text.slice(0, 70));
  }
}
if (bad > 0) { console.log('跨文档重复 ' + bad + ' 句'); process.exit(1); }
console.log('无跨文档重复');