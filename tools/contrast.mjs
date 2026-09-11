#!/usr/bin/env node
// Contrast checker for the palette in index.html.
//
// The project rule is to compute contrast rather than assert it: a previous
// version of this design claimed #16A34A passed 4.5:1 on white when it is
// 3.3:1. Every ratio quoted in a comment in index.html should appear here.
//
//   node tools/contrast.mjs
//
// Exits non-zero if any pair in use falls below its threshold. Pairs marked
// `rejected` are combinations the design deliberately does NOT use; they are
// listed so the reason stays visible, and they are expected to fail.

const lum = hex => {
  const c = hex.replace('#', '').match(/../g)
    .map(h => parseInt(h, 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Kept in step with :root (dark, the default) and [data-theme="light"].
const LIGHT = { paper: '#ffffff', ink: '#000000', hairline: '#c9c9c9', link: '#0000ee', visited: '#551a8b' };
const DARK  = { paper: '#000000', ink: '#ffffff', hairline: '#3a3a3a', link: '#6699ff', visited: '#cc99ff' };
// Accents do not invert with the theme. They are fills, and both carry black.
const GOLD = '#ffd700', MINT = '#00ff9c';

// min 4.5 = AA body text. 3.0 = AA non-text/UI boundary. 1.0 = decorative
// divider, adjacent content identifiable without it, so no floor applies.
const PAIRS = [
  ['light  body ink on paper',           LIGHT.ink,     LIGHT.paper, 4.5],
  ['light  link on paper',               LIGHT.link,    LIGHT.paper, 4.5],
  ['light  visited link on paper',       LIGHT.visited, LIGHT.paper, 4.5],
  ['light  divider vs paper',            LIGHT.hairline, LIGHT.paper, 1.0],
  ['dark   body ink on paper',           DARK.ink,      DARK.paper,  4.5],
  ['dark   link on paper',               DARK.link,     DARK.paper,  4.5],
  ['dark   visited link on paper',       DARK.visited,  DARK.paper,  4.5],
  ['dark   divider vs paper',            DARK.hairline, DARK.paper,  1.0],
  ['both   black on gold fill',          LIGHT.ink,     GOLD,        4.5],
  ['both   black on mint fill',          LIGHT.ink,     MINT,        4.5],
  ['both   mint on black button',        MINT,          LIGHT.ink,   4.5],
  ['dark   gold fill vs paper',          GOLD,          DARK.paper,  3.0],
  ['dark   mint fill vs paper',          MINT,          DARK.paper,  3.0],
];

// The two places the Figma reference is not followed, and why.
const REJECTED = [
  ['reference: gold text on white eyebrows', GOLD,        LIGHT.paper, 4.5],
  ['reference: mint text on white headings', MINT,        LIGHT.paper, 4.5],
  ['white on gold - why fills carry black',  LIGHT.paper, GOLD,        4.5],
  ['#0000ee on black - why dark relinks',    LIGHT.link,  DARK.paper,  4.5],
];

// Light-mode accent fills barely differ from white paper, which is why every
// one of them is contained by a 3px black rule rather than by its fill.
const NOTED = [
  ['gold fill edge vs light paper (hence the rule)', GOLD, LIGHT.paper],
  ['mint fill edge vs light paper (hence the rule)', MINT, LIGHT.paper],
];

let failed = 0;
const line = (name, fg, bg, min, expectFail = false) => {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok && !expectFail) failed++;
  const tag = expectFail ? (ok ? 'UNEXPECTED PASS' : 'rejected') : (ok ? 'pass' : 'FAIL');
  console.log(`${tag.padEnd(16)} ${r.toFixed(2).padStart(6)}:1  (min ${min.toFixed(1)})  ${name}`);
  if (expectFail && ok) failed++;   // a rejected pair that now passes means the note is stale
};

console.log('In use:');
for (const [n, fg, bg, min] of PAIRS) line(n, fg, bg, min);
console.log('\nDeliberately not used:');
for (const [n, fg, bg, min] of REJECTED) line(n, fg, bg, min, true);

console.log('\nFor the record:');
for (const [n, fg, bg] of NOTED) console.log(`${''.padEnd(16)} ${ratio(fg, bg).toFixed(2).padStart(6)}:1${''.padEnd(11)}  ${n}`);

console.log(failed ? `\n${failed} problem(s).` : '\nAll good.');
process.exit(failed ? 1 : 0);
