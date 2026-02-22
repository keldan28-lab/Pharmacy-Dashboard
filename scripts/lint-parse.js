#!/usr/bin/env node
const fs = require('fs');
const acorn = require('acorn');

const files = [
  'js/app/dashboard.js',
  'js/app/spikeFactors.js',
  'js/app/chartsPage.js',
  'js/app/analyticsPage.js'
];

let hasError = false;

for (const file of files) {
  try {
    const source = fs.readFileSync(file, 'utf8');
    acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
    console.log(`OK ${file}`);
  } catch (err) {
    hasError = true;
    const pos = err && typeof err.loc === 'object' ? `:${err.loc.line}:${err.loc.column}` : '';
    console.error(`ERROR ${file}${pos} ${err.message}`);
  }
}

if (hasError) {
  process.exit(1);
}
