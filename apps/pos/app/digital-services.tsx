'use client';
import { FormEvent, useEffect, useState } from 'react';
import { clearPpobOperation, ppobAccess, ppobOperation } from '../lib/ppob-operation';

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Product = { id: string; providerSku: string; name: string; category: string; salePrice: string | number; costPrice?: string | number | null };
type Transaction = { id: string; number: string; providerSku: string; customerNo: string; sellingPrice: string | number; status: string; serialNumber?: string | null; message?: string | null; idempotencyKey: string };
type Page<T> = { items: T[]; pageInfo: { nextCursor: string | null } };
type Status = { enabled: boolean; connected: boolean; hasCredentials: boolean; certification: string; cashPosting: string };
const money = (value: string | number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value));

export default function PosDigitalServices({ api, token, online }: { api: Api; token: string; online: boolean }) {
  const access = ppobAccess(token);
  const [status, setStatus] = useState<Status | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [productCursor, setProductCursor] = useState<string | null>(null);
  const [transactionCursor, setTransactionCursor] = useState<string | null>(null);
  const [query, setQuery] = useState(''); const [loadedQuery, setLoadedQuery] = useState('');
  const [sku, setSku] = useState(''); const [customerNo, setCustomerNo] = useState('');
  const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const product = products.find(row => row.providerSku === sku);
  const ready = online && status?.enabled && status.connected && status.hasCredentials && access.manage;

  async function refresh() {
    if (!online || !access.view || busy) return;
    setBusy(true);
    try {
      const [readiness, catalog, history] = await Promise.all([
        api<Status>('/digital-services/status'),
        api<Page<Product>>(`/digital-services/products?limit=25&search=${encodeURIComponent(query.trim())}`),
        api<Page<Transaction>>('/digital-services/transactions?limit=20'),
      ]);
      setStatus(readiness); setProducts(catalog.items); setProductCursor(catalog.pageInfo.nextCursor);
      setTransactions(history.items); setTransactionCursor(history.pageInfo.nextCursor); setLoadedQuery(query.trim()); setConfirmed(false); setMessage('');
      const pending = sessionStorage.getItem(`toko360_ppob_pending:${access.scope}`);
      if (pending && history.items.some(row => row.idempotencyKey === JSON.parse(pending).key)) {
        clearPpobOperation(sessionStorage, access.scope);
        setMessage('Transaksi terakhir sudah tersimpan. Periksa status di riwayat; jangan kirim ulang sebagai transaksi baru.');
      }
    } catch (cause) { setStatus(null); setMessage(cause instanceof Error ? cause.message : 'PPOB belum dapat dimuat.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, [token, online]);

  async function more(kind: 'products' | 'transactions') {
    const cursor = kind === 'products' ? productCursor : transactionCursor;
    if (!online || busy || !cursor) return;
    setBusy(true);
    try {
      if (kind === 'products') {
        const page = await api<Page<Product>>(`/digital-services/products?limit=25&search=${encodeURIComponent(loadedQuery)}&cursor=${encodeURIComponent(cursor)}`);
        setProducts(rows => [...rows, ...page.items.filter(item => !rows.some(row => row.id === item.id))]); setProductCursor(page.pageInfo.nextCursor);
      } else {
        const page = await api<Page<Transaction>>(`/digital-services/transactions?limit=20&cursor=${encodeURIComponent(cursor)}`);
        setTransactions(rows => [...rows, ...page.items.filter(item => !rows.some(row => row.id === item.id))]); setTransactionCursor(page.pageInfo.nextCursor);
      }
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Halaman PPOB belum dapat dimuat.'); }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!ready || !product || !confirmed || busy) return;
    setBusy(true);
    try {
      const payload = { providerSku: product.providerSku, customerNo: customerNo.trim(), expectedSellingPrice: Number(product.salePrice), ...(product.costPrice != null ? { maxPrice: Number(product.costPrice) } : {}) };
      const idempotencyKey = await ppobOperation(sessionStorage, access.scope, payload);
      const transaction = await api<Transaction>('/digital-services/transactions', { method: 'POST', body: JSON.stringify({ ...payload, idempotencyKey }) });
      clearPpobOperation(sessionStorage, access.scope); setTransactions(rows => [transaction, ...rows.filter(row => row.id !== transaction.id)]);
      setCustomerNo(''); setConfirmed(false); setMessage(`${transaction.number} tersimpan · ${transaction.status}. Status provider harus diperiksa sampai selesai.`);
    } catch (cause) {
      const statusCode = (cause as { status?: number })?.status;
      if (statusCode && [400,403,404,422].includes(statusCode)) clearPpobOperation(sessionStorage, access.scope);
      setMessage(cause instanceof Error ? cause.message : 'Hasil pengiriman belum diketahui. Ulangi dengan produk dan nomor yang sama.');
    } finally { setBusy(false); }
  }
  async function recheck(row: Transaction) {
    if (!online || !access.manage || busy) return; setBusy(true);
    try { await api(`/digital-services/transactions/${row.id}/recheck`, { method: 'POST', body: '{}' }); setMessage('Pemeriksaan ulang masuk antrean. Muat ulang riwayat untuk melihat hasil provider.'); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Pemeriksaan ulang gagal.'); }
    finally { setBusy(false); }
  }
  if (!access.view) return <section data-pos-ppob><p className="notice">Akun ini belum mempunyai izin melihat PPOB. Hubungi Admin.</p></section>;
  return <section className="ppobWorkspace" data-pos-ppob>
    <div className="notice" role="status">{!online ? 'PPOB membutuhkan server online. Transaksi tidak masuk antrean offline kasir.' : !status ? 'Memuat kesiapan PPOB…' : !status.enabled ? 'PPOB belum diaktifkan untuk akun/cabang ini. Hubungi Admin di Pengaturan & Akses → Feature.' : !status.connected || !status.hasCredentials ? 'Provider PPOB belum dikonfigurasi. Hubungi Admin di Integrasi & Notifikasi → PPOB.' : 'Adapter prepaid tersedia. Sertifikasi provider nyata masih PENDING.'}</div>
    <p className="panelNote">PPOB memakai transaksi provider terpisah. Pembayaran pelanggan belum otomatis diposting ke jurnal dan rekap kas shift. Menu ini menampilkan harga katalog dan status provider.</p>
    {message && <p className="notice" role="status">{message}</p>}
    <div className="ppobColumns">
      <section className="returnPanel"><h3>Katalog layanan digital</h3><form className="returnWorkspace" onSubmit={event => { event.preventDefault(); void refresh(); }}><label>Cari pulsa, data, token atau voucher<input value={query} maxLength={100} onChange={event => setQuery(event.target.value)} /></label><button type="submit" disabled={busy || !online}>Cari dan muat ulang</button><label>Produk PPOB<select value={sku} disabled={busy} onChange={event => { setSku(event.target.value); setConfirmed(false); }}><option value="">Pilih produk</option>{products.map(row => <option key={row.id} value={row.providerSku}>{row.name} · {money(row.salePrice)}</option>)}</select></label>{!products.length && <p>Belum ada katalog aktif. Admin perlu menghubungkan provider dan menyinkronkan katalog prepaid.</p>}{productCursor && <button type="button" className="secondary" disabled={busy || !online} onClick={() => void more('products')}>Produk berikutnya</button>}</form></section>
      <section className="returnPanel"><h3>Kirim transaksi PPOB</h3><form className="returnWorkspace" onSubmit={submit}><label>Nomor pelanggan / meter<input required minLength={3} maxLength={100} value={customerNo} disabled={busy} autoComplete="off" onChange={event => { setCustomerNo(event.target.value.replace(/\s+/g, '')); setConfirmed(false); }} /></label>{product && <strong>{product.name} · {money(product.salePrice)}</strong>}<label className="ppobConfirm"><input type="checkbox" checked={confirmed} disabled={busy || !ready || !product} onChange={event => setConfirmed(event.target.checked)} /><span>Saya sudah memeriksa produk, nomor tujuan dan harga katalog.</span></label><button type="submit" disabled={busy || !ready || !product || !confirmed || customerNo.length < 3}>Konfirmasi dan kirim PPOB</button>{!access.manage && <p>Akun ini hanya dapat melihat katalog dan riwayat PPOB.</p>}</form></section>
    </div>
    <section className="returnPanel"><h3>Riwayat PPOB cabang</h3><ul className="ppobHistory">{transactions.map(row => <li key={row.id}><strong>{row.number} · {row.status}</strong><span>{row.providerSku} · {row.customerNo} · {money(row.sellingPrice)}</span><span>{row.serialNumber ?? row.message ?? 'Menunggu hasil provider'}</span>{access.manage && ['PENDING','PROCESSING'].includes(row.status) && <button type="button" className="secondary" disabled={busy || !online} onClick={() => void recheck(row)}>Periksa status provider</button>}</li>)}</ul>{!transactions.length && <p>Belum ada transaksi PPOB pada cabang aktif.</p>}{transactionCursor && <button type="button" className="secondary" disabled={busy || !online} onClick={() => void more('transactions')}>Riwayat berikutnya</button>}</section>
  </section>;
}
