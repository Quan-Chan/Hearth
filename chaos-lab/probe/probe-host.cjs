'use strict';
const path = require('path');
const { startCore } = require(path.join(__dirname, '..', '..', 'dist', 'index.js'));
async function main() {
  const guard = process.env.GUARD === '1';
  await startCore({ moduleDir: path.join(__dirname, 'modules'), logFile: path.join(__dirname, 'probe.log'), watch: false, guardProcess: guard });
  setTimeout(function () { process.stdout.write(JSON.stringify({ k: 'survived', guard: guard }) + '\n'); process.exit(0); }, 3000);
}
main().catch(function (e) { console.error(e); process.exit(2); });
