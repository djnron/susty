// Live grid carbon intensity, where a real source exists for the caller's region.
// Returns { g, source, live } or { live: false } so the client can fall back to
// its static annual table and say so rather than pretending to be current.
//
// Great Britain is the only region with a genuinely open, keyless, real-time
// feed at regional resolution (NESO). Everywhere else needs a token, so
// Electricity Maps is used only when one is configured server-side.

const TTL = 10 * 60_000;   // GB publishes in 30-min blocks; 10 min is plenty
const cache = new Map();   // key -> { at, payload }

function cached(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.payload;
  return null;
}
function remember(key, payload) {
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), payload });
  return payload;
}

// NESO Carbon Intensity API — no key, no registration.
// Regional payload nests half-hourly periods one level deeper than the national one.
export async function fromGB(regionId) {
  const url = regionId
    ? `https://api.carbonintensity.org.uk/regional/regionid/${encodeURIComponent(regionId)}`
    : "https://api.carbonintensity.org.uk/intensity";
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) return null;
  const j = await r.json();
  const d = j && j.data && j.data[0];
  if (!d) return null;
  const period = (d.data && d.data[0]) || d;
  const i = period.intensity || {};
  const g = typeof i.actual === "number" ? i.actual : i.forecast;
  if (typeof g !== "number") return null;
  return {
    g,
    live: true,
    source: regionId ? "NESO regional, live" : "NESO Great Britain, live",
    at: period.from || null,
  };
}

// ---------------------------------------------------------------------------
// United States, hourly, free. EIA-930 publishes hourly CO2 only in bulk
// spreadsheets, but the REST API does carry hourly generation by fuel type, so
// we derive intensity from the mix using EIA's own per-fuel figures.
//
// g/kWh from EIA's published lb/MWh (× 0.453592 ÷ 1000):
//   coal 2,257 lb/MWh -> 1024      natural gas 976 lb/MWh -> 443
// Petroleum from EIA's 73.2 kg/MMBtu at a ~10,800 Btu/kWh heat rate.
// Nuclear, hydro, wind and solar are zero here because this counts operational
// emissions only — the same basis eGRID and NESO use, so the numbers stay
// comparable. Batteries are zero to avoid double-counting the charge.
// BAT is deliberately absent: storage is time-shifted generation that was
// already counted when it charged. Listing it at 0 would have credited every
// discharged MWh as carbon-free while the charging energy stayed excluded,
// discounting storage twice and pulling intensity down.
const FUEL_G = { COL: 1024, NG: 443, OIL: 800, OTH: 600, NUC: 0, WAT: 0, SUN: 0, WND: 0 };

// eGRID subregion -> EIA-930 region. EIA's regions are coarser than balancing
// authorities and line up with eGRID far better than any single BA would.
// Hawaii, Alaska and Puerto Rico are absent from EIA-930, so they stay static.
const EIA_REGION = {
  CAMX: ['CAL',  'California'],       NWPP: ['NW',   'Northwest'],
  RMPA: ['NW',   'Northwest'],        AZNM: ['SW',   'Southwest'],
  ERCT: ['TEX',  'Texas'],            SPNO: ['CENT', 'Central'],
  SPSO: ['CENT', 'Central'],          MROW: ['MIDW', 'Midwest'],
  MROE: ['MIDW', 'Midwest'],          SRMW: ['MIDW', 'Midwest'],
  RFCM: ['MIDW', 'Midwest'],          SRMV: ['MIDW', 'Midwest'],
  RFCE: ['MIDA', 'Mid-Atlantic'],     RFCW: ['MIDA', 'Mid-Atlantic'],
  NEWE: ['NE',   'New England'],      NYUP: ['NY',   'New York'],
  NYCW: ['NY',   'New York'],         NYLI: ['NY',   'New York'],
  SRVC: ['CAR',  'Carolinas'],        SRSO: ['SE',   'Southeast'],
  SRTV: ['TEN',  'Tennessee'],        FRCC: ['FLA',  'Florida']
};

// Exported for testing: collapse EIA rows into the newest *complete* hour.
export function intensityFromFuelMix(rows) {
  const byHour = new Map();
  for (const r of rows || []) {
    const mwh = Number(r.value);
    if (!r.period || !r.fueltype || !isFinite(mwh)) continue;
    if (!(r.fueltype in FUEL_G)) continue;          // unknown fuel: skip, don't guess
    if (mwh <= 0) continue;                         // net-negative rows (storage) add no generation
    if (!byHour.has(r.period)) byHour.set(r.period, { gen: 0, co2: 0, fuels: new Set() });
    const h = byHour.get(r.period);
    h.gen += mwh;
    h.co2 += mwh * FUEL_G[r.fueltype];
    h.fuels.add(r.fueltype);
  }
  const hours = [...byHour.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));  // newest first
  if (!hours.length) return null;

  // The newest hour is usually still filling in, and a half-reported hour is
  // not merely stale — it's wrong in a direction we can't predict. An hour
  // carrying only gas reads ~443; only coal reads 1024. Require the hour to
  // report a fuel count comparable to the best hour in the window before
  // trusting it, so a two-fuel snapshot is never published as "live".
  const best = Math.max(...hours.map(([, h]) => h.fuels.size));
  const need = Math.max(3, Math.ceil(best * 0.7));
  for (const [period, h] of hours) {
    if (h.gen > 0 && h.fuels.size >= need) {
      return { g: Math.round(h.co2 / h.gen), period };
    }
  }
  // Nothing complete enough: say so rather than guessing from a partial hour.
  return null;
}

export async function fromEIA(subregion) {
  const key = process.env.EIA_API_KEY;
  const entry = EIA_REGION[subregion];
  if (!key || !entry) return null;
  const [code, label] = entry;

  const u = new URL('https://api.eia.gov/v2/electricity/rto/fuel-type-data/data/');
  u.searchParams.set('api_key', key);
  u.searchParams.set('frequency', 'hourly');
  u.searchParams.append('data[0]', 'value');
  u.searchParams.append('facets[respondent][]', code);
  u.searchParams.set('sort[0][column]', 'period');
  u.searchParams.set('sort[0][direction]', 'desc');
  u.searchParams.set('length', '200');   // ~8 fuels × 24h, plenty to find a full hour

  const r = await fetch(u, { headers: { accept: 'application/json' } });
  if (!r.ok) return null;
  const j = await r.json();
  const hit = intensityFromFuelMix(j && j.response && j.response.data);
  if (!hit) return null;
  return {
    g: hit.g,
    live: true,
    source: 'EIA hourly fuel mix, ' + label,
    at: hit.period,
    derived: true,      // computed from the mix, not published as an intensity
  };
}

// Optional: global real-time, but absolute values need a token on their plan.
export async function fromElectricityMaps(zone) {
  const token = process.env.ELECTRICITY_MAPS_TOKEN;
  if (!token || !zone) return null;
  const r = await fetch(
    `https://api.electricitymaps.com/v3/carbon-intensity/latest?zone=${encodeURIComponent(zone)}`,
    { headers: { "auth-token": token } }
  );
  if (!r.ok) return null;
  const j = await r.json();
  if (typeof j.carbonIntensity !== "number") return null;
  return { g: j.carbonIntensity, live: true, source: "Electricity Maps, live", at: j.datetime || null };
}

export default async function handler(req, res) {
  const country = String(req.query?.country || "").toUpperCase().slice(0, 8);
  const region = String(req.query?.region || "").slice(0, 16);
  const zone = String(req.query?.zone || "").slice(0, 32);
  const key = country + "|" + region + "|" + zone;

  res.setHeader("Cache-Control", "public, max-age=300");

  const hit = cached(key);
  if (hit) return res.status(200).json(hit);

  try {
    let out = null;
    if (country === "GB") out = await fromGB(region);
    if (!out && country === "US") out = await fromEIA(region);
    if (!out) out = await fromElectricityMaps(zone || country);
    return res.status(200).json(remember(key, out || { live: false }));
  } catch (err) {
    console.error("grid lookup failed", err);
    // Not an error the visitor needs to see; the static table is a fine fallback.
    return res.status(200).json({ live: false });
  }
}
