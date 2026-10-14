// Generates the clearly-labeled example data for the "Field trials" workspace: a CSV from field
// sensors, an Excel workbook of agronomist corrections, and a nested JSON weather feed.
// Deterministic (seeded), so rebuilding gives identical files.
import fs from 'node:fs';
import XLSX from 'xlsx';
const out = process.argv[2];
let seed = 20261014; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const norm = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const farms = [{ farm: 'North Ridge', soil: 6.4, rain: 1.0 }, { farm: 'River Bend', soil: 7.1, rain: 1.25 }, { farm: 'Dry Creek', soil: 7.8, rain: 0.6 }];
const crops = { Maize: { base: 9.5, varieties: ['DK-62', 'P1197', 'NK-603'] }, Wheat: { base: 6.2, varieties: ['Kingbird', 'Brennan', 'Glenn'] }, Soybean: { base: 3.4, varieties: ['AG-27', 'P22T'] } };
const treatments = ['control', 'low N', 'high N', 'cover crop'];
const rows = []; let id = 1;
for (const season of [2024, 2025]) for (const f of farms) for (const [crop, c] of Object.entries(crops)) for (const variety of c.varieties) for (const t of treatments) {
  if (rnd() < 0.18) continue;
  const area = +(t === 'control' ? 2 + rnd() * 30 : 0.4 + rnd() * 6).toFixed(2); // big control fields, small trial plots
  const n = t === 'high N' ? 180 + rnd() * 40 : t === 'low N' ? 60 + rnd() * 30 : t === 'cover crop' ? 30 + rnd() * 20 : 110 + rnd() * 20;
  const plantMonth = crop === 'Wheat' ? 3 + Math.floor(rnd() * 2) : 4 + Math.floor(rnd() * 2);
  const plant = `${season}-${String(plantMonth).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 27)).padStart(2, '0')}`;
  const harvestMonth = plantMonth + 4 + Math.floor(rnd() * 2);
  const harvest = `${season}-${String(harvestMonth).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 27)).padStart(2, '0')}`;
  const nEffect = crop === 'Soybean' ? 0 : (n - 110) / 400;
  const smallPlotBonus = area < 3 ? 0.08 : 0; // trial plots get more care: the reason an unweighted average flatters
  const y = c.base * (1 + nEffect + smallPlotBonus + (t === 'cover crop' ? 0.03 : 0)) * (0.75 + 0.25 * f.rain) * (season === 2025 ? 1.04 : 1) + norm() * c.base * 0.07;
  rows.push({ plot_id: `P${String(id++).padStart(4, '0')}`, season, farm: f.farm, crop, variety, treatment: t, area_ha: area, planting_date: plant, harvest_date: harvest, n_applied_kg_ha: +n.toFixed(0), soil_ph: +(f.soil + norm() * 0.25).toFixed(2), yield_t_ha: +Math.max(0.5, y).toFixed(2) });
}
const csv = [Object.keys(rows[0]).join(','), ...rows.map(r => Object.values(r).join(','))].join('\n') + '\n';
fs.writeFileSync(`${out}/field_plots.csv`, csv);
// Corrections: a few plots re-weighed at the elevator, some sensor readings dropped (blank) → filled from sensors by priority merge.
const corr = rows.filter(() => rnd() < 0.08).map(r => ({ plot_id: r.plot_id, yield_t_ha: +(r.yield_t_ha * (0.9 + rnd() * 0.15)).toFixed(2), corrected_by: ['A. Moreno', 'J. Okafor'][Math.floor(rnd() * 2)], reason: ['elevator weigh ticket', 'combine monitor recalibrated', 'hand-harvest sample'][Math.floor(rnd() * 3)] }));
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(corr), 'Corrections');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ note: 'Example workbook generated for the Query Studio demo. Values are synthetic.' }]), 'About');
XLSX.writeFile(wb, `${out}/agronomist_corrections.xlsx`);
// Weather: nested JSON, one station per farm with monthly readings.
const weather = { provider: 'Example weather feed (synthetic)', generated: '2026-10-14', stations: farms.map((f, i) => ({ station_id: `WX-${101 + i}`, farm: f.farm, readings: [2024, 2025].flatMap(y => Array.from({ length: 12 }, (_, m) => ({ month: `${y}-${String(m + 1).padStart(2, '0')}`, rain_mm: +Math.max(0, (40 + 50 * Math.sin((m - 2) / 12 * Math.PI * 2) * 0.5 + 35) * f.rain * (0.7 + rnd() * 0.6)).toFixed(1), temp_c: +(4 + 18 * Math.sin((m - 3) / 12 * Math.PI * 2 + 0.3) * 0.5 + 10 + norm()).toFixed(1) }))) })) };
fs.writeFileSync(`${out}/weather_stations.json`, JSON.stringify(weather, null, 1));
console.log(rows.length, 'plots,', corr.length, 'corrections');
