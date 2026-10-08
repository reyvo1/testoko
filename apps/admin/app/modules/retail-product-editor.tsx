'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { authFetch } from '../auth-fetch';
import { Panel } from '../ui';
import { usePermissions } from '../permissions';
import type { RetailPolicy } from '../../../api/src/common/retail-policy';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type Product = { id: string; sku: string; name: string; unit: string; retailPolicy?: RetailPolicy };
type Recipe = { id: string; code: string; name: string; version: number; outputProductId: string };
const empty: RetailPolicy = { gallery: [], weight: null, kitRecipeId: null };

export function RetailProductEditor({ token, products, canReadRecipes, onSaved }: { token: string; products: Product[]; canReadRecipes: boolean; onSaved: () => Promise<void> }) {
  const { canAll, identity } = usePermissions(token);
  const canUpdate = canAll('product.update') && Boolean(identity?.roles.some((role) => ['SUPER_ADMIN', 'OWNER', 'ADMIN'].includes(role)));
  const [productId, setProductId] = useState('');
  const [policy, setPolicy] = useState<RetailPolicy>(empty);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const product = products.find((row) => row.id === productId);
  async function loadRecipes(next?: string) {
    const response = await authFetch(`${API}/manufacturing/recipes?limit=100${next ? `&cursor=${encodeURIComponent(next)}` : ''}`, token);
    if (!response.ok) throw new Error(`BOM gagal dimuat (${response.status}).`);
    const data = await response.json();
    setRecipes((rows) => next ? [...rows, ...(data.items ?? [])] : data.items ?? []);
    setCursor(data.nextCursor ?? null);
  }
  useEffect(() => { if (canUpdate && canReadRecipes) void loadRecipes().catch((error) => setMessage(error.message)); }, [token, canReadRecipes, canUpdate]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (!product || busy || !canUpdate) return;
    setBusy(true); setMessage('');
    const fingerprint = JSON.stringify({ productId, policy });
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const response = await authFetch(`${API}/products/${encodeURIComponent(productId)}/retail-config`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operationKey: pending.current.key, policy }) });
      const data = await response.json();
      if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message ?? `Gagal menyimpan (${response.status}).`);
      pending.current = null; await onSaved(); setMessage('Konfigurasi retail tersimpan. Transaksi lama mempertahankan snapshot asal.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Konfigurasi gagal disimpan.'); }
    finally { setBusy(false); }
  }
  if (!canUpdate) return null;
  return <Panel eyebrow="RETAIL PRODUK" title="Galeri, barang timbang & kit"><form className="formStack" onSubmit={save}>
    <label>Produk<select required value={productId} onChange={(event) => { const row = products.find((item) => item.id === event.target.value); setProductId(event.target.value); setPolicy(row?.retailPolicy ?? empty); setMessage(''); }}><option value="">Pilih produk</option>{products.map((row) => <option key={row.id} value={row.id}>{row.sku} · {row.name}</option>)}</select></label>
    {product && <>
      <label className="checkboxRow"><input type="checkbox" checked={Boolean(policy.weight)} onChange={(event) => setPolicy({ ...policy, weight: event.target.checked ? { barcodeKey: '', baseUnitsPerEncodedUnit: 1 } : null, kitRecipeId: event.target.checked ? null : policy.kitRecipeId })}/>Barang timbang</label>
      {policy.weight && <><p>Stok dan harga memakai {product.unit}. Contoh: 0,250 KG dijual sebagai 250 GR. Barcode EAN-13 memakai prefix 2 digit + PLU 5 digit + berat 5 digit + checksum.</p><label>Prefix + PLU (7 digit)<input required pattern="2[0-9]{6}" maxLength={7} value={policy.weight.barcodeKey} onChange={(event) => setPolicy({ ...policy, weight: { ...policy.weight!, barcodeKey: event.target.value } })}/></label><label>Jumlah {product.unit} per angka berat barcode<input required type="number" min="1" max="1000" step="1" value={policy.weight.baseUnitsPerEncodedUnit} onChange={(event) => setPolicy({ ...policy, weight: { ...policy.weight!, baseUnitsPerEncodedUnit: Number(event.target.value) } })}/></label></>}
      <label>Kit dari BOM<select disabled={Boolean(policy.weight) || !canReadRecipes} value={policy.kitRecipeId ?? ''} onChange={(event) => setPolicy({ ...policy, kitRecipeId: event.target.value || null })}><option value="">Produk biasa / non-kit</option>{recipes.filter((row) => row.outputProductId === productId).map((row) => <option key={row.id} value={row.id}>{row.code} v{row.version} · {row.name}</option>)}</select></label>
      {cursor && <button type="button" className="secondary" onClick={() => void loadRecipes(cursor).catch((error) => setMessage(error.message))}>Muat BOM berikutnya</button>}
      <p>Kit mengonsumsi bahan saat penjualan; BOM dikelola di workspace Produksi. Bahan tracked/nested kit belum didukung.</p>
      {policy.gallery.map((image, index) => <div className="formGrid" key={index}><label>URL gambar {index + 1}<input required value={image.url} onChange={(event) => setPolicy({ ...policy, gallery: policy.gallery.map((row, i) => i === index ? { ...row, url: event.target.value } : row) })}/></label><label>Deskripsi gambar<input required maxLength={200} value={image.alt} onChange={(event) => setPolicy({ ...policy, gallery: policy.gallery.map((row, i) => i === index ? { ...row, alt: event.target.value } : row) })}/></label><button type="button" className="secondary" onClick={() => setPolicy({ ...policy, gallery: policy.gallery.filter((_, i) => i !== index) })}>Hapus gambar</button></div>)}
      <div className="actionRow">{canUpdate && policy.gallery.length < 12 && <button type="button" className="secondary" onClick={() => setPolicy({ ...policy, gallery: [...policy.gallery, { url: '', alt: product.name }] })}>Tambah gambar</button>}{canUpdate && <button disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan konfigurasi retail'}</button>}</div>
    </>}
    {message && <p role="status">{message}</p>}
  </form></Panel>;
}
