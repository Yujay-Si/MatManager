'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ssmat-material-smoke-'));
const phases = process.env.MATERIAL_SMOKE_WEB === '1' ? ['file', 'http'] : ['write', 'read'];
try {
  for (const phase of phases) {
    const env = { ...process.env, SSMAT_SMOKE_USER_DATA: profile, MATERIAL_SMOKE_PHASE: phase };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [path.join(__dirname, 'material-smoke-main.js')], { env, encoding: 'utf8', timeout: 60000, windowsHide: true });
    if (result.error || result.status !== 0) throw new Error(`${phase}: ${result.error?.message || result.status}\n${result.stdout}\n${result.stderr}`);
    console.log(phase + ': ' + result.stdout.trim());
  }
} finally {
  // Both phases share one profile; discard it even on failure without touching daily user data.
  if (path.dirname(profile) !== os.tmpdir() || !path.basename(profile).startsWith('ssmat-material-smoke-') || fs.lstatSync(profile).isSymbolicLink()) {
    throw new Error('材料测试数据目录校验失败，未清理。');
  }
  fs.rmSync(profile, { recursive: true, force: true });
}
