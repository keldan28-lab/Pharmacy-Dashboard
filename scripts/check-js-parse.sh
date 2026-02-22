#!/usr/bin/env bash
set -euo pipefail

files=(
  "js/app/dashboard.js"
  "js/app/spikeFactors.js"
  "js/app/chartsPage.js"
  "js/app/analyticsPage.js"
)

for f in "${files[@]}"; do
  node --check "$f"
done

echo "Parse check passed for required app files."
