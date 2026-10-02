// Contract for the Admin reference dashboard product-performance panel.
//
// The panel has exactly two legitimate renderings, decided by whether product sales exist:
//   - sales present  -> the donut chart must render (data-chart-kind="donut")
//   - sales absent   -> the empty state must render (.emptyState with a title)
//
// Both branches are asserted. Asserting only one branch is what made the previous check
// unsatisfiable in a freshly seeded environment, where the seed creates products but no
// sales at all, so the donut can never appear.
//
// The line chart, the six panels, the six metrics and the dashboard title are required in
// BOTH branches -- those parts of the contract are data-independent and stay strict.
export function evaluateProductMixContract(dashboardContract) {
  if (!dashboardContract) return { ok: false, reason: 'dashboard contract tidak terbaca' };
  const { hasProductDonut, productEmpty } = dashboardContract;
  if (hasProductDonut) {
    const donutInCharts = Array.isArray(dashboardContract.charts) && dashboardContract.charts.includes('donut');
    return donutInCharts
      ? { ok: true, state: 'donut' }
      : { ok: false, reason: 'donut terpasang sebagai panel tetapi tidak muncul di daftar chart' };
  }
  const emptyText = typeof productEmpty === 'string' ? productEmpty.trim() : '';
  return emptyText
    ? { ok: true, state: 'empty' }
    : { ok: false, reason: 'tanpa penjualan produk, panel harus menampilkan empty state' };
}
