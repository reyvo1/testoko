'use client';

import { FormEvent, useEffect, useState } from 'react';
import { FEATURE_KEYS } from '@toko360/config';
import { authFetch } from '../auth-fetch';
import { usePermissions } from '../permissions';
import { Panel } from '../ui';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const FEATURES = [
  { key: FEATURE_KEYS.RETAIL_EXCHANGE, name: 'Tukar barang', help: 'Retur tunai yang lulus inspeksi dan penjualan pengganti diposting bersama.' },
  { key: FEATURE_KEYS.CUSTOMER_DEPOSIT, name: 'Deposit pelanggan', help: 'Gunakan akun LIABILITY tersendiri, selain uang muka order 2105.' },
  { key: FEATURE_KEYS.CUSTOMER_CAMPAIGN, name: 'Komunikasi pelanggan', help: 'Pengiriman tetap memerlukan consent, kontak terverifikasi dan provider yang dikonfigurasi.' },
  { key: FEATURE_KEYS.POS_SHIP_LATER, name: 'Pesanan dari toko', help: 'Reservasi, kas shift dan pemenuhan memakai alur Order/Pengiriman.' },
  { key: FEATURE_KEYS.TAX_EXPORT, name: 'Export pajak XML', help: 'Export memerlukan review legal. Aktivasi bukan sertifikasi atau pengiriman otomatis ke DJP.' },
];
type Flag = { companyId: string | null; branchId: string | null; userId: string | null; key: string; enabled: boolean; config?: Record<string, unknown> | null };
type Setting = { enabled: boolean; config: Record<string, unknown> };

export default function RetailFeatureControls({ token, companyId, branchId, onSaved }: { token: string; companyId: string; branchId: string; onSaved: () => Promise<void> }) {
  const { identity, canAll } = usePermissions(token);
  const allowed = Boolean(identity?.roles.some(role => ['SUPER_ADMIN', 'OWNER', 'ADMIN'].includes(role)) && canAll('platform.configure'));
  const [settings, setSettings] = useState<Record<string, Setting>>({});
  const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false); const [message, setMessage] = useState('');
  async function request<T>(method: string, body?: unknown): Promise<T> {
    const response = await authFetch(`${API}/platform/features`, token, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json(); if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message ?? 'Konfigurasi belum dapat diakses.'); return data;
  }
  async function load() {
    setBusy(true); setLoaded(false);
    try {
      const flags = (await request<Flag[]>('GET')).filter(row => row.companyId === companyId && !row.userId);
      const next: Record<string, Setting> = {};
      for (const feature of FEATURES) {
        const branch = flags.filter(row => row.key === feature.key && row.branchId === branchId);
        const company = flags.filter(row => row.key === feature.key && row.branchId === null);
        if (branch.length > 1 || company.length > 1) throw new Error('Konfigurasi fitur ambigu; periksa scope cabang sebelum menyimpan.');
        const row = branch[0] ?? company[0];
        next[feature.key] = { enabled: row?.enabled ?? false, config: row?.config ?? {} };
      }
      setSettings(next); setLoaded(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Konfigurasi belum dapat dimuat.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (allowed) void load(); }, [token, companyId, branchId, allowed]);
  async function save(event: FormEvent, key: string) {
    event.preventDefault(); if (busy || !loaded) return;
    const setting = settings[key]; if (!setting) return;
    const config = { ...setting.config };
    if (key === FEATURE_KEYS.CUSTOMER_DEPOSIT) {
      config.accountCode = String(config.accountCode ?? '').trim().toUpperCase();
      if (setting.enabled && (!config.accountCode || config.accountCode === '2105')) { setMessage('Deposit aktif memerlukan akun LIABILITY tersendiri selain 2105.'); return; }
    }
    setBusy(true); setMessage('');
    try { await request('POST', { key, branchId, enabled: setting.enabled, config }); await onSaved(); await load(); setMessage('Konfigurasi fitur cabang tersimpan.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Konfigurasi belum tersimpan.'); }
    finally { setBusy(false); }
  }
  if (!allowed) return null;
  return <Panel eyebrow="FITUR RETAIL" title="Konfigurasi fitur cabang" badge="Default nonaktif">
    <p className="sectionHelp">Pengaturan berlaku pada cabang akun ini. Posting tetap memeriksa permission, shift, inspeksi dan akun yang valid. Menonaktifkan fitur mempertahankan pelunasan deposit historis.</p>
    {message && <p role="status">{message}</p>}
    <button type="button" className="secondary" disabled={busy} onClick={() => void load()}>Muat ulang konfigurasi retail</button>
    {FEATURES.map(feature => <form key={feature.key} aria-label={`Konfigurasi ${feature.name}`} data-retail-feature={feature.key} onSubmit={event => void save(event, feature.key)} className="formGrid mt-5">
      <strong>{feature.name}</strong><p className="sectionHelp">{feature.help}</p>
      <label className="checkboxRow"><input type="checkbox" disabled={busy || !loaded} checked={settings[feature.key]?.enabled ?? false} onChange={event => setSettings(rows => ({ ...rows, [feature.key]: { ...rows[feature.key], enabled: event.target.checked } }))} />Aktif pada cabang ini</label>
      {feature.key === FEATURE_KEYS.CUSTOMER_DEPOSIT && <label>Kode akun deposit<input maxLength={64} disabled={busy || !loaded} value={String(settings[feature.key]?.config.accountCode ?? '')} onChange={event => setSettings(rows => ({ ...rows, [feature.key]: { ...rows[feature.key], config: { ...rows[feature.key]?.config, accountCode: event.target.value } } }))} /></label>}
      <button type="submit" disabled={busy || !loaded}>Simpan {feature.name}</button>
    </form>)}
  </Panel>;
}
