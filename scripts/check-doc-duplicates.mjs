// 文档间重复检查：跨文档出现相同句子的段落（标题、表格分隔行除外）报警。
import * as fs from 'fs';
import * as path from 'path';

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
}
const files = ['README.md'];
walk('docs', files);
const norm = (s) => s.replace(/[`#|*]/g, '').replace(/\s/g, '');
const seen = new Map();
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  for (const piece of text.split(/[。；;\n！？]/)) {
    const n = norm(piece);
    if (n.length < 18) continue;
    if (!seen.has(n)) seen.set(n, []);
    seen.get(n).push({ file: f, text: piece.trim() });
  }
}
let bad = 0;
for (const [n, locs] of seen) {
  const filesSet = new Set(locs.map((l) => l.file));
  if (filesSet.size > 1) {
    bad++;
    console.log(`重复 [${[...filesSet].join(', ')}]: ${locs[0].text.slice(0, 70)}`);
  }
}
if (bad > 0) { console.log(`跨文档重复 ${bad} 句`); process.exit(1); }
console.log('无跨文档重复');