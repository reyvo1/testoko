import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import { evaluateProductMixContract } from '../scripts/lib/admin-dashboard-contract.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const browserUat = fs.readFileSync(path.join(repoRoot, 'scripts', 'browser-uat.mjs'), 'utf8');

// The runner state: prisma/seed.ts creates products but never creates Sale/SaleItem, so a
// freshly seeded CI database has no product sales and the product-mix donut cannot render.
const withSales = {
  hasProductDonut: true,
  productEmpty: '',
  charts: ['line', 'donut'],
};
const withoutSales = {
  hasProductDonut: false,
  productEmpty: 'Belum ada data komposisi',
  charts: ['line'],
};

test('product mix contract menerima donut ketika ada penjualan produk', () => {
  const result = evaluateProductMixContract(withSales);
  assert.equal(result.ok, true);
  assert.equal(result.state, 'donut');
});

test('product mix contract menerima empty state ketika belum ada penjualan produk', () => {
  const result = evaluateProductMixContract(withoutSales);
  assert.equal(result.ok, true);
  assert.equal(result.state, 'empty');
});

test('product mix contract menolak contract tidak konsisten: chartsSelective donut tapi panel kosong', () => {
  // charts still claims a donut while the product-performance panel renders neither a donut
  // nor an empty state. That is a real regression and must stay red.
  const result = evaluateProductMixContract({ hasProductDonut: false, productEmpty: '', charts: ['line', 'donut'] });
  assert.equal(result.ok, false, 'panel kosong tidak boleh dianggap sah walau charts menyebut donut');
  assert.match(result.reason, /empty state/);
});

test('product mix contract menolak donut yang hilang walau sales data ada', () => {
  // Sales exist, so the donut branch is expected; the donut svg must actually be registered in charts.
  const result = evaluateProductMixContract({ hasProductDonut: true, productEmpty: '', charts: ['line'] });
  assert.equal(result.ok, false, 'donut hilang saat ada penjualan harus tetap merah');
  assert.match(result.reason, /daftar chart/);
});

test('product mix contract menolak panel kosong total: tanpa donut dan tanpa empty state', () => {
  const result = evaluateProductMixContract({ hasProductDonut: false, productEmpty: '', charts: ['line'] });
  assert.equal(result.ok, false);
});

test('product mix contract menolak donut yang diklaim ada tetapi tidak tercatat di daftar chart', () => {
  const result = evaluateProductMixContract({ hasProductDonut: true, productEmpty: '', charts: ['line'] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /daftar chart/);
});

test('product mix contract menolak contract yang tidak terbaca', () => {
  assert.equal(evaluateProductMixContract(null).ok, false);
  assert.equal(evaluateProductMixContract(undefined).ok, false);
});

test('browser-uat memakai helper contract dan tetap mewajibkan line chart', () => {
  assert.match(browserUat, /import \{ evaluateProductMixContract \} from '\.\/lib\/admin-dashboard-contract\.mjs';/);
  assert.match(browserUat, /evaluateProductMixContract\(dashboardContract\)/);
  // data-independent parts of the contract must remain strict in both branches
  assert.match(browserUat, /charts\.includes\('line'\)/, 'line chart wajib tanpa syarat');
  assert.match(browserUat, /dashboardContract\.metricCount !== 6/);
  assert.match(browserUat, /dashboardContract\.title !== 'Dashboard Overview'/);
  assert.match(browserUat, /requiredDashboardPanels\.every/);
});

test('browser-uat tidak lagi menuntut donut secara mutlak', () => {
  assert.doesNotMatch(
    browserUat,
    /\['line','donut'\]\.every/,
    'syarat donut mutlak dihapus supaya contract bisa hijau di environment tanpa penjualan'
  );
});

test('browser-uat mengukur donut dan empty state di dalam panel product-performance', () => {
  assert.match(browserUat, /data-dashboard-panel="product-performance"/);
  assert.match(browserUat, /hasProductDonut/);
  assert.match(browserUat, /productEmpty/);
});

test('produk merender empty state ketika productMix kosong, jadi cabang kosong benar-benar ada', () => {
  const dashboard = fs.readFileSync(path.join(repoRoot, 'apps', 'admin', 'app', 'dashboard-overview.tsx'), 'utf8');
  assert.match(dashboard, /productMix\.length \?/, 'panel harus bercabang berdasarkan productMix');
  assert.match(dashboard, /<DashboardDonut items=\{productMix\} \/>/);
  assert.match(dashboard, /Belum ada data komposisi/);
});
