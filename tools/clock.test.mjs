#!/usr/bin/env node
// Tests the attended-time clock and the device/panel split in index.html.
//
//   node tools/clock.test.mjs
//
// Real time cannot exercise a 75-second grace window many times over, so the
// same arithmetic is reproduced here with injectable time.
//
// Keep in step with GRACE / clockSync / DEVICE_BASE / PANELS in index.html.

const GRACE = 75000;
const DEVICE_BASE = { phone: 0.9, tablet: 3.3, laptop: 6.0, monitor: 68.0 };
const PANELS = {
  lcdPhone:   { light: 0.60, dark: 0.60 }, oledPhone:   { light: 0.55, dark: 0.45 },
  lcdTablet:  { light: 2.20, dark: 2.20 }, oledTablet:  { light: 1.65, dark: 1.32 },
  lcdLaptop:  { light: 4.00, dark: 4.00 }, oledLaptop:  { light: 3.00, dark: 2.40 },
  lcdMonitor: { light: 22.0, dark: 22.0 }, oledMonitor: { light: 9.00, dark: 7.20 }
};
const DEVICE_CLASS = {
  lcdPhone: 'phone',   oledPhone: 'phone',   lcdTablet: 'tablet',  oledTablet: 'tablet',
  lcdLaptop: 'laptop', oledLaptop: 'laptop', lcdMonitor: 'monitor', oledMonitor: 'monitor'
};

function harness() {
  let now = 0, attendedMs = 0, openMs = 0, lastSlice = 0, lastActivity = 0;
  let blurred = false, visible = true, wasOn = true;
  const onScreen = () => visible && !blurred;
  const sync = () => {
    const dt = now - lastSlice, from = lastSlice;
    lastSlice = now;
    if (dt > 0 && wasOn) {
      openMs += dt;
      const cutoff = Math.max(from, Math.min(now, lastActivity + GRACE));
      attendedMs += Math.max(0, cutoff - from);
    }
    wasOn = onScreen();
  };
  return {
    wait(sec) { for (let i = 0; i < sec / 2; i++) { now += 2000; sync(); } return this; },
    act()   { sync(); lastActivity = now; blurred = false; wasOn = onScreen(); return this; },
    blur()  { sync(); blurred = true;  wasOn = false; return this; },
    focus() { sync(); blurred = false; wasOn = onScreen(); return this; },
    hide()  { sync(); visible = false; wasOn = false; return this; },
    show()  { sync(); visible = true;  wasOn = onScreen(); return this; },
    attended: () => attendedMs / 1000,
    open: () => openMs / 1000
  };
}

const energy = (panel, theme, sec) => {
  const p = PANELS[panel][theme], b = DEVICE_BASE[DEVICE_CLASS[panel]];
  return { device: (b + p) * sec / 3600, panel: p * sec / 3600 };
};

let fails = 0;
const near = (label, got, want, tol = 1.2) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${label}: ${got.toFixed(3)} (want ~${want.toFixed(3)})`);
};

console.log('Attended time — "duration of use"');
{
  const c = harness();
  for (let i = 0; i < 30; i++) c.wait(2).act();
  near('  60s of active use charges in full', c.attended(), 60);
}
{
  const c = harness().act().wait(3600);
  near('  a one-hour absence costs GRACE and no more', c.attended(), GRACE / 1000);
  near('  ...while "open" still reads the full hour', c.open(), 3600, 2.5);
}
{
  const c = harness().act().wait(70);
  near('  70s motionless reading (inside grace)', c.attended(), 70);
}
{
  const c = harness().act().wait(20).hide().wait(3600).show().wait(0);
  near('  hidden for an hour adds nothing', c.attended(), 20);
}
{
  const c = harness().act().wait(20).blur().wait(3600).focus().act().wait(10);
  near('  blurred for an hour adds nothing', c.attended(), 30);
}
{
  const c = harness().act().wait(3352);
  console.log(`\n  the reported case: 55m52s open, one exchange`);
  console.log(`    was 3352s charged, now ${c.attended().toFixed(0)}s (${(c.attended()/3352*100).toFixed(1)}% of wall clock)`);
}

console.log('\nDevice energy — whole device in the total, panel a component of it');
{
  const e = energy('lcdLaptop', 'dark', 3600);
  near('  1h attended, LCD laptop: device Wh', e.device, 10.0);
  // The panel is not reported as its own row, but it must remain a component
  // of the device figure rather than an addition to it.
  near('  panel component of that', e.panel, 4.0);
  if (e.panel >= e.device) { fails++; console.log('FAIL  panel must be a component of device'); }
  else console.log('pass  panel is a component of device, not an addition');
}
{
  // The only figure in the ledger that moves with the theme.
  const light = energy('oledPhone', 'light', 3600), dark = energy('oledPhone', 'dark', 3600);
  near('  OLED phone panel, light', light.panel, 0.55);
  near('  OLED phone panel, dark',  dark.panel,  0.45);
  near('  dark-mode device saving',  light.device - dark.device, 0.10, 0.001);
}
// The published measurements were taken on LCD machines (Dell Latitudes, an HP
// EliteBook), so the range check belongs on the LCD configuration only:
// measured laptop 9-13 W, DIMPACT smartphone 1-2 W and desktop + monitor
// 77-100 W. An OLED panel in dark mode is *expected* to fall below its LCD
// sibling — that is the saving the ledger attributes — so it is checked
// against the LCD figure instead of against the published range.
const watts = (panel, theme) => DEVICE_BASE[DEVICE_CLASS[panel]] + PANELS[panel][theme];
// phone 1-2 W and desktop 77-100 W from DIMPACT; laptop 9-13 W measured
// (Roskilde); tablet pinned to DIMPACT's single 5.5 W figure.
const ranges = { phone: [1, 2], tablet: [5.4, 5.6], laptop: [9, 13], monitor: [75, 100] };
const lcdOf = { phone: 'lcdPhone', tablet: 'lcdTablet', laptop: 'lcdLaptop', monitor: 'lcdMonitor' };

console.log('\nLCD configurations against the published ranges');
for (const [cls, panel] of Object.entries(lcdOf)) {
  const w = watts(panel, 'dark'), [lo, hi] = ranges[cls];
  const ok = w >= lo && w <= hi;
  if (!ok) fails++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${panel} = ${w.toFixed(2)} W in published ${lo}-${hi} W`);
}

console.log('\nOLED configurations against their LCD sibling');
for (const panel of ['oledPhone', 'oledTablet', 'oledLaptop', 'oledMonitor']) {
  const cls = DEVICE_CLASS[panel], lcd = watts(lcdOf[cls], 'dark');
  for (const theme of ['light', 'dark']) {
    const w = watts(panel, theme);
    const ok = w > 0 && w <= lcd;
    if (!ok) fails++;
    console.log(`${ok ? 'pass' : 'FAIL'}  ${panel}/${theme} = ${w.toFixed(2)} W <= ${lcd.toFixed(2)} W LCD`);
  }
  const saving = watts(panel, 'light') - watts(panel, 'dark');
  const ok = saving > 0;
  if (!ok) fails++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${panel} saves ${saving.toFixed(2)} W in dark`);
}

console.log('\nModel-relative energy factors');
{
  // Keep in step with MODEL_ENERGY in index.html. Derived from EcoLogits'
  // f(P_active, B) fitted to ML.ENERGY, at batch 32, midpoint active params.
  const MODEL_ENERGY = {
    'claude-haiku-4-5':  { factor: 0.52, thinks: false },
    'claude-sonnet-4-6': { factor: 1.00, thinks: false },
    'claude-opus-4-6':   { factor: 1.33, thinks: true  },
    'claude-opus-4-7':   { factor: 1.33, thinks: true  },
    'claude-opus-4-8':   { factor: 1.33, thinks: true  }
  };
  const A = 1.17e-6, B = -1.12e-2, G = 4.05e-5;
  const f = (p, b) => A * Math.exp(B * b) * p + G;
  const active = { 'claude-haiku-4-5': 22.5, 'claude-sonnet-4-6': 88,
                   'claude-opus-4-6': 133.5, 'claude-opus-4-7': 133.5,
                   'claude-opus-4-8': 133.5 };
  const anchor = f(active['claude-sonnet-4-6'], 32);

  // Every published factor must reproduce from the source function.
  for (const [name, { factor }] of Object.entries(MODEL_ENERGY)) {
    const derived = f(active[name], 32) / anchor;
    const ok = Math.abs(derived - factor) < 0.01;
    if (!ok) fails++;
    console.log(`${ok ? 'pass' : 'FAIL'}  ${name} factor ${factor} reproduces from EcoLogits (${derived.toFixed(3)})`);
  }
  // The anchor must be exactly 1: it is the model susty actually runs.
  const anchored = MODEL_ENERGY['claude-sonnet-4-6'].factor === 1.00;
  if (!anchored) fails++;
  console.log(`${anchored ? 'pass' : 'FAIL'}  claude-sonnet-4-6 is the 1.00x anchor`);

  // Absolute calibration: a real exchange must stay inside Oviedo et al's
  // measured IQR for a frontier-model query, 0.16-0.60 Wh.
  const wh = (831 * 0.00005 + 571 * 0.0005) * 1.12 * 1.15 + 2 * 0.003;
  const perExchange = wh / 2;
  const inRange = perExchange >= 0.16 && perExchange <= 0.60;
  if (!inRange) fails++;
  console.log(`${inRange ? 'pass' : 'FAIL'}  ${perExchange.toFixed(3)} Wh/exchange inside Oviedo IQR 0.16-0.60`);
}

// The regression that prompted the tablet class in the first place.
{
  const t = watts('lcdTablet', 'dark'), l = watts('lcdLaptop', 'dark');
  const ok = t < l;
  if (!ok) fails++;
  console.log(`\n${ok ? 'pass' : 'FAIL'}  a tablet (${t.toFixed(2)} W) is not billed as a laptop (${l.toFixed(2)} W)`);
}

console.log(fails ? `\n${fails} failure(s)` : '\nAll good.');
process.exit(fails ? 1 : 0);
