#!/usr/bin/env node
const { spawnSync } = require('node:child_process');

const files = [
  'js/app/dashboard.js',
  'js/app/spikeFactors.js',
  'js/app/chartsPage.js',
  'js/app/analyticsPage.js',
  'js/app/taskManagerPage.js'
];

let failed = false;
for (const file of files) {
  const res = spawnSync(process.execPath, ['--check', file], { stdio: 'pipe', encoding: 'utf8' });
  if (res.status !== 0) {
    failed = true;
    process.stderr.write(`\n✗ Syntax check failed: ${file}\n`);
    if (res.stdout) process.stderr.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
  } else {
    process.stdout.write(`✓ Syntax check passed: ${file}\n`);
  }
}

if (failed) process.exit(1);
