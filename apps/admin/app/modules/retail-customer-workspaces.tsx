'use client';
import { useEffect, useRef, useState } from 'react';
import { authFetch } from '../auth-fetch';
import { usePermissions } from '../permissions';
import { Panel, Table, StatusChip, rupiah } from '../ui';
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type Page<T> = { items: T[]; pageInfo: { nextCursor: string | null; hasMore: boolean } };
async function request<T>(token: string, path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await authFetch(`${API}${path}`, token, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json(); if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message ?? 'Permintaan gagal.'); return data;
}
function useOperation() { const ref = useRef<{ hash: string; key: string } | null>(null); return { key(body: unknown) { const hash = JSON.stringify(body); if (ref.current?.hash !== hash) ref.current = { hash, key: crypto.randomUUID() }; return ref.current.key; }, done() { ref.current = null; } }; }

export function CustomerDepositWorkspace({ token }: { token: string }) {
  const { canAll, identity } = usePermissions(token);
  const allowed = Boolean(identity?.roles.some(r => ['SUPER_ADMIN','OWNER','ADMIN','FINANCE'].includes(r)) && canAll('finance.create','sale.view'));
  const [customers, setCustomers] = useState<Array<{ id: string; name: string }>>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [form, setForm] = useState({ customerId: '', kind: 'CREDIT', amount: '', settlementAccountCode: '', depositAccountCode: '', externalRef: '' });
  const [balance, setBalance] = useState<{ posted: string; reserved: string; available: string } | null>(null);
  const [document, setDocument] = useState<{ id: string; number: string; status: string } | null>(null);
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const operation = useOperation();
  async function loadCustomers(next?: string) { try { const page = await request<Page<{ id: string; name: string }>>(token, `/finance-operations/customer-deposits/customers?limit=50${next ? `&cursor=${encodeURIComponent(next)}` : ''}`); setCustomers(rows => next ? [...rows, ...page.items] : page.items); setCursor(page.pageInfo.nextCursor); } catch(e) { setMessage(e instanceof Error ? e.message : 'Pelanggan belum dapat dimuat.'); } }
  useEffect(() => { if (allowed) void loadCustomers(); }, [token, allowed]);
  async function checkBalance() { if (!form.customerId) return; try { setBalance(await request(token, `/finance-operations/customer-deposits/${encodeURIComponent(form.customerId)}/balance${form.depositAccountCode ? `?accountCode=${encodeURIComponent(form.depositAccountCode)}` : ''}`)); } catch(e) { setBalance(null); setMessage(e instanceof Error ? e.message : 'Saldo belum tersedia.'); } }
  async function submit(e: React.FormEvent) { e.preventDefault(); if (busy) return; setBusy(true); try { const body = { customerId: form.customerId, kind: form.kind, amount: Number(form.amount), settlementAccountCode: form.settlementAccountCode.trim(), ...(form.depositAccountCode ? { depositAccountCode: form.depositAccountCode.trim() } : {}), ...(form.externalRef ? { externalRef: form.externalRef.trim() } : {}) }; setDocument(await request(token, '/finance-operations/customer-deposits', 'POST', { ...body, operationKey: operation.key(body) })); operation.done(); setMessage('Dokumen dibuat. Setujui lalu posting setelah penerimaan/pengembalian dana diverifikasi.'); await checkBalance(); } catch(e) { setMessage(e instanceof Error ? e.message : 'Deposit gagal dibuat.'); } finally { setBusy(false); } }
  async function transition(action: 'approve' | 'post') { if (!document || busy) return; setBusy(true); try { setDocument(await request(token, `/finance-operations/${document.id}/${action}`, 'POST', {})); await checkBalance(); setMessage(action === 'post' ? 'Deposit telah diposting melalui Accounting Core.' : 'Dokumen disetujui.'); } catch(e) { setMessage(e instanceof Error ? e.message : 'Perubahan status gagal.'); } finally { setBusy(false); } }
  if (!allowed) return null;
  return <Panel eyebrow="CUSTOMER DEPOSIT" title="Deposit pelanggan" badge="Liability terpisah">
    <p className="sectionHelp">Saldo tersedia berasal dari jurnal yang sudah diposting, dikurangi refund yang masih menunggu approval. Penerimaan atau pengembalian kas memerlukan shift aktif milik operator posting.</p>
    {message && <p role="status" className="notice">{message}</p>}
    <form className="formStack" onSubmit={submit}><div className="grid2">
      <label>Pelanggan<select required value={form.customerId} onChange={e => { setBalance(null); setForm({ ...form, customerId: e.target.value }); }}><option value="">Pilih pelanggan</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Transaksi<select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}><option value="CREDIT">Terima deposit</option><option value="REFUND">Kembalikan deposit</option></select></label>
      <label>Jumlah<input required type="number" min="0.01" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></label>
      <label>Kode akun kas/bank tender<input required maxLength={40} value={form.settlementAccountCode} onChange={e => setForm({ ...form, settlementAccountCode: e.target.value })} /></label>
      <label>Akun deposit historis (opsional)<input maxLength={40} value={form.depositAccountCode} onChange={e => setForm({ ...form, depositAccountCode: e.target.value })} /></label>
      <label>Referensi penerimaan/pengembalian<input maxLength={160} value={form.externalRef} onChange={e => setForm({ ...form, externalRef: e.target.value })} /></label>
    </div><div className="actionRow"><button disabled={busy}>Buat dokumen deposit</button><button type="button" className="secondary" disabled={busy || !form.customerId} onClick={() => void checkBalance()}>Periksa saldo</button>{cursor && <button type="button" className="secondary" onClick={() => void loadCustomers(cursor)}>Pelanggan berikutnya</button>}</div></form>
    {balance && <p>Tercatat {rupiah(Number(balance.posted))} · Ditahan {rupiah(Number(balance.reserved))} · Tersedia <strong>{rupiah(Number(balance.available))}</strong></p>}
    {document && <div className="actionRow"><strong>{document.number}</strong><StatusChip status={document.status} />{identity?.roles.some(r=>['SUPER_ADMIN','OWNER','FINANCE'].includes(r)) && canAll('finance.approve') && ['DRAFT','WAITING_APPROVAL'].includes(document.status) && <button disabled={busy} onClick={() => void transition('approve')}>Setujui deposit</button>}{identity?.roles.some(r=>['SUPER_ADMIN','OWNER','FINANCE'].includes(r)) && canAll('finance.post') && document.status === 'APPROVED' && <button disabled={busy} onClick={() => void transition('post')}>Posting deposit</button>}</div>}
  </Panel>;
}

type Campaign = { id: string; channel: string; templateCode: string; status: string; _count?: { deliveries: number } };
export function CustomerCampaignWorkspace({ token }: { token: string }) {
  const { canAll, identity } = usePermissions(token); const allowed = Boolean(identity?.roles.some(r => ['SUPER_ADMIN','OWNER','ADMIN'].includes(r)) && canAll('notification.manage'));
  const [campaigns, setCampaigns] = useState<Campaign[]>([]); const [cursor, setCursor] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Array<{ id: string; code: string; channel: string; isActive: boolean; body: string }>>([]);
  const [template, setTemplate] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [deliveries, setDeliveries] = useState<Array<{ id: string; status: string; attempts: number }>>([]);
  const [deliveryCursor,setDeliveryCursor] = useState<string|null>(null);const [campaignId,setCampaignId] = useState('');
  const operation = useOperation();
  async function refresh(next?: string) { try { const rows = await request<Page<Campaign>>(token, `/customer-campaigns?limit=20${next ? `&cursor=${encodeURIComponent(next)}` : ''}`); setCampaigns(prior => next ? [...prior, ...rows.items] : rows.items); setCursor(rows.pageInfo.nextCursor); } catch(e) { setMessage(e instanceof Error ? e.message : 'Campaign belum dapat dimuat.'); } }
  useEffect(() => { if (allowed) { void refresh(); void request<typeof templates>(token, '/notifications/templates').then(setTemplates).catch(e => setMessage(e.message)); } }, [token, allowed]);
  async function create(e: React.FormEvent) { e.preventDefault(); const selected = templates.find(t => t.id === template); if (!selected || busy) return; setBusy(true); try { const body = { templateCode: selected.code, channel: selected.channel }; await request(token, '/customer-campaigns', 'POST', { ...body, operationKey: operation.key(body) }); operation.done(); await refresh(); setMessage('Campaign masuk antrean. Hanya kontak terverifikasi dengan persetujuan marketing yang dapat dikirim.'); } catch(e) { setMessage(e instanceof Error ? e.message : 'Campaign gagal dibuat.'); } finally { setBusy(false); } }
  async function cancel(row: Campaign) { if (busy) return; setBusy(true); try { await request(token, `/customer-campaigns/${row.id}/cancel`, 'POST', { operationKey: `cancel-${row.id}` }); await refresh(); setMessage('Campaign dibatalkan. Kiriman yang sudah berlangsung diperiksa melalui status provider.'); } catch(e) { setMessage(e instanceof Error ? e.message : 'Pembatalan gagal.'); } finally { setBusy(false); } }
  async function trace(id: string,next?:string) { try { const rows = await request<Page<{ id: string; notification: { status: string; attempts: number } | null }>>(token, `/customer-campaigns/${id}/deliveries?limit=50${next ? `&cursor=${encodeURIComponent(next)}` : ''}`); const items = rows.items.map(row => ({ id:row.id,status:row.notification?.status??'UNKNOWN',attempts:row.notification?.attempts??0 }));setDeliveries(prior=>next?[...prior,...items]:items);setDeliveryCursor(rows.pageInfo.nextCursor);setCampaignId(id); } catch(e) { setMessage(e instanceof Error ? e.message : 'Status belum tersedia.'); } }
  if (!allowed) return null;
  return <Panel eyebrow="CUSTOMER CAMPAIGN" title="Campaign dengan persetujuan pelanggan" badge="Batch 100">
    {message && <p className="notice" role="status">{message}</p>}
    <form className="formStack" onSubmit={create}><label>Template marketing<select required value={template} onChange={e => setTemplate(e.target.value)}><option value="">Pilih template tanpa variabel</option>{templates.filter(t => t.isActive && ['EMAIL','WHATSAPP'].includes(t.channel) && !t.body.includes('{{')).map(t => <option key={t.id} value={t.id}>{t.code} · {t.channel}</option>)}</select></label><button disabled={busy}>Antrekan campaign</button></form>
    <Table head={['Template','Channel','Status','Penerima','Aksi']} rows={campaigns.map(row => [row.templateCode,row.channel,<StatusChip status={row.status} />,row._count?.deliveries ?? 0,<span className="actionRow"><button type="button" className="secondary" onClick={() => void trace(row.id)}>Status pengiriman</button>{row.status !== 'CANCELLED' && <button type="button" className="secondary" disabled={busy} onClick={() => void cancel(row)}>Batalkan</button>}</span>])} empty="Belum ada campaign." />
    {cursor && <button type="button" className="secondary" onClick={() => void refresh(cursor)}>Campaign berikutnya</button>}
    {deliveryCursor && <button type="button" className="secondary" onClick={()=>void trace(campaignId,deliveryCursor)}>Pengiriman berikutnya</button>}
    {deliveries.length > 0 && <Table head={['Kiriman','Status','Percobaan']} rows={deliveries.map(row => [row.id,<StatusChip status={row.status} />,row.attempts])} />}
  </Panel>;
}
