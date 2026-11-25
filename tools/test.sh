#!/bin/sh
# Every check, in one place. Run before pushing — main deploys on push.
#
#   sh tools/test.sh
set -e
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
# The checks describe the default deployment. An ANTHROPIC_MODEL exported in
# the shell (an existing override, say) would change TIERS.sonnet under them,
# so it is cleared here and set only for the override runs below. The two
# switches are cleared for the same reason (an operator may source .env).
unset ANTHROPIC_MODEL SUSTY_TIERS SUSTY_EXPENSIVE_TIERS

echo "== contrast =========================================================="
node tools/contrast.mjs

echo "\n== carbon model: clock, device table, model factors =================="
node tools/clock.test.mjs

echo "\n== completed-exchange functional unit ================================"
node tools/completed-exchange.test.mjs

echo "\n== model factors: index.html matches data/ ==========================="
node tools/model-factors.mjs --check

echo "\n== water: data, generated tables, accrual ==========================="
node tools/water-factors.mjs --check
node tools/water.test.mjs

echo "\n== history on this device ==========================================="
node tools/history.test.mjs

echo "\n== methodology matches code =========================================="
node tools/methodology.test.mjs

echo "\n== model tiers: all enabled =========================================="
node tools/tiers.test.mjs
echo "\n== model tiers: expensive gated ======================================"
SUSTY_EXPENSIVE_TIERS=off node tools/tiers.test.mjs
echo "\n== model tiers: all collapsed ========================================"
SUSTY_TIERS=off node tools/tiers.test.mjs
echo "\n== model tiers: an existing ANTHROPIC_MODEL override ================="
ANTHROPIC_MODEL=claude-sonnet-4-6 node tools/tiers.test.mjs
echo "\n== model tiers: ANTHROPIC_MODEL on a model that always thinks ========"
ANTHROPIC_MODEL=claude-opus-5-5 node tools/tiers.test.mjs

echo "\n== syntax ============================================================"
node --check server.js && echo "server.js ok"
for f in api/*.js; do node --check "$f" && echo "$f ok"; done
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const html = readFileSync('index.html', 'utf8');
const js = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
new (await import('node:vm')).Script(js);
console.log('index.html inline script ok');
"

echo "\nAll checks passed."
