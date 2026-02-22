# Codex Instructions (Pharmacy Bulletin)

## Non-negotiables
- Do NOT change behavior unless explicitly requested.
- Every edit must keep the project running in a browser.
- Never introduce top-level `return` statements.
- Avoid broad refactors. Prefer minimal diffs.

## Parsing / safety gate
Before opening a PR, ensure these files parse with no syntax errors:
- js/app/dashboard.js
- js/app/spikeFactors.js
- js/app/chartsPage.js
- js/app/analyticsPage.js

Add/maintain a repo script that fails if any of the above files has a syntax error.

## Local run assumptions
- Prefer running the app via a local web server (not file://).
- Preserve relative paths under /js/app/.

## SpikeFactors / Apps Script IO
- Keep JSONP GET read compatible for local usage.
- Keep form POST write compatible for local usage.
- Do not embed Apps Script URLs in iframes.
