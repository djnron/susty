#!/bin/sh
# Every check, in one place. Run before pushing — main deploys on push.
#
#   sh tools/test.sh
set -e
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

echo "== contrast =========================================================="
node tools/contrast.mjs

echo "\n== carbon model: clock, device table, model factors =================="
node tools/clock.test.mjs

echo "\n== model tiers: all enabled =========================================="
node tools/tiers.test.mjs
echo "\n== model tiers: expensive gated ======================================"
SUSTY_EXPENSIVE_TIERS=off node tools/tiers.test.mjs
echo "\n== model tiers: all collapsed ========================================"
SUSTY_TIERS=off node tools/tiers.test.mjs

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
