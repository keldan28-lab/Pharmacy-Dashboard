#!/usr/bin/env node
const { spawnSync } = require('node:child_process');

const files = [
  'js/app/dashboard.js',
  'js/app/spikeFactors.js',
  'js/app/chartsPage.js',
  'js/app/analyticsPage.js'
];

let hasError = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    hasError = true;
    process.stderr.write(`\n[parse-error] ${file}\n`);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.stdout) process.stderr.write(result.stdout);
  } else {
    process.stdout.write(`[ok] ${file}\n`);
  }
}

if (hasError) {
  process.exitCode = 1;
} else {
  process.stdout.write('\nAll core JS files parsed successfully.\n');
}
