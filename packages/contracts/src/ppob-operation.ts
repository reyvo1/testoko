type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function ppobAccess(token: string) {
  try {
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    const roles: string[] = Array.isArray(claims.roles) ? claims.roles : [];
    const permissions: string[] = Array.isArray(claims.permissions) ? claims.permissions : [];
    const can = (permission: string) => roles.includes('SUPER_ADMIN') || permissions.includes(permission);
    return { view: can('digital_service.view'), manage: roles.some(role => ['SUPER_ADMIN','OWNER','ADMIN','CASHIER'].includes(role)) && can('digital_service.manage'), scope: `${claims.companyId}:${claims.branchId}:${claims.sub}` };
  } catch { return { view: false, manage: false, scope: '' }; }
}
export async function ppobOperation(storage: Storage, scope: string, payload: unknown) {
  return durableOperation(storage, `toko360_ppob_pending:${scope}`, payload, 'pos-ppob');
}
export async function durableOperation(storage: Storage, slot: string, payload: unknown, prefix: string) {
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload))))).map(x => x.toString(16).padStart(2,'0')).join('');
  const previous = storage.getItem(slot);
  if (previous) {
    const operation = JSON.parse(previous) as { key: string; digest: string };
    if (operation.digest !== digest) throw new Error(prefix==='mobile-scan'?'Scan sebelumnya belum terkonfirmasi. Ulangi barcode dan jumlah yang sama.':'Transaksi sebelumnya belum terkonfirmasi. Periksa riwayat atau ulangi produk dan nomor yang sama.');
    return operation.key;
  }
  const key = `${prefix}:${crypto.randomUUID()}`;
  storage.setItem(slot, JSON.stringify({ key, digest }));
  return key;
}
export function clearPpobOperation(storage: Storage, scope: string) { storage.removeItem(`toko360_ppob_pending:${scope}`); }
