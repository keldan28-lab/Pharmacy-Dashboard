#!/usr/bin/env bash
set -euo pipefail

node --check js/app/dashboard.js
node --check js/app/spikeFactors.js
node --check js/app/chartsPage.js
node --check js/app/analyticsPage.js

echo "Syntax check passed for required app files."
