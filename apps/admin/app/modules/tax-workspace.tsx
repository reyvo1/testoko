'use client';

import { useEffect, useState } from 'react';
import CoretaxExportWorkspace from './coretax-export-workspace';
import { authFetch } from '../auth-fetch';
import { usePermissions } from '../permissions';
import { canReadPath, readOptional } from '../read-path-contract';
import { canAccessApiPath } from '../../../../packages/contracts/src/api-access';
import { Panel, StatusChip, Table, rupiah, tanggal } from '../ui';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

type Account = { id: string; code: string; name: string; type: string; isActive: boolean };
type TaxCode = {
  id: string; code: string; version: number; name: string; scope: string; rate: string | number; inclusive: boolean; recoverable: boolean;
  payableAccountCode?: string | null; receivableAccountCode?: string | null; expenseAccountCode?: string | null;
  calculationRules?: { coretax?: { vatRatePercent?:string;otherTaxBaseNumerator?:string;otherTaxBaseDenominator?:string;bppuObjectCode?:string } }; effectiveFrom?: string | null; effectiveTo?: string | null; status: 'DRAFT'|'ACTIVE'|'INACTIVE'; legalReference?: string | null;
};
type TaxTransaction = {
  id: string; accountingEventId?: string | null; sourceType: string; sourceId: string; direction: string; transactionDate: string; taxPeriod?: string | null;
  taxableBase: string | number; taxAmount: string | number; status: string; documentNumber?: string | null;
  taxCode: { id: string; code: string; version: number; name: string } | null;
};
type TaxDocument = { id: string; number: string; documentType: string; status: string; sourceType: string; sourceId: string; issueDate: string; taxPeriod?: string | null; counterpartyName?: string | null; netAmount: string | number; taxAmount: string | number; grossAmount: string | number; externalReference?: string | null };
type TaxReconciliation = {
  from: string; to: string;
  businessCalendar: { timezone: string; from: string; to: string };
  directions: Array<{ direction: string; count: number; taxableBase: number; taxAmount: number }>;
  mappedAccountMovement: Array<{ code: string; name: string; type: string; debit: number; credit: number; net: number }>;
  integrity: { transactionCount: number; missingAccountingEvent: number; missingJournal: number; nonPosted: number; ok: boolean };
  documents: { count: number; netAmount: number; taxAmount: number; grossAmount: number };
};
type CursorPage<T> = { items: T[]; pageInfo?: { hasMore: boolean; nextCursor?: string | null } };
type TaxPreview = { taxCode: TaxCode | null; net: string | number; tax: string | number; gross: string | number };

const emptyForm = {
  code: '', version: 1, name: '', scope: 'SALE', ratePercent: '11', inclusive: false, recoverable: false,
  payableAccountCode: '', receivableAccountCode: '', expenseAccountCode: '', effectiveFrom: '', effectiveTo: '',
  status: 'DRAFT' as 'DRAFT'|'ACTIVE', legalReference: '', coretaxVatRate:'',coretaxNumerator:'',coretaxDenominator:'',bppuObjectCode:'',
};

function isoDate(value?: string | null) { return value ? new Date(value).toISOString().slice(0, 10) : ''; }
export default function TaxWorkspace({ token, onOpenAccountingEvent }: { token: string; onOpenAccountingEvent?: (id: string) => void }) {
  // accounting-core.controller.ts: POST /accounting-core/tax-codes dan
  // PATCH /accounting-core/tax-codes/:id/status keduanya dijaga tax.manage. Endpoint
  // tax/preview hanya tax.view dan tidak menulis apa pun, jadi tetap dibiarkan terbuka.
  const { canAll, identity } = usePermissions(token);
  const canReadTax = canReadPath(identity, '/accounting-core/tax-codes');
  const canManageTax = canAll('tax.manage') && canAccessApiPath(identity, '/accounting-core/tax-codes','POST');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [codes, setCodes] = useState<TaxCode[]>([]);
  const [transactions, setTransactions] = useState<TaxTransaction[]>([]);
  const [documents, setDocuments] = useState<TaxDocument[]>([]);
  const [reconciliation, setReconciliation] = useState<TaxReconciliation | null>(null);
  const [form, setForm] = useState(emptyForm);
  // Empty initial filters let Tax Core resolve the trusted company's current month.
  const [range, setRange] = useState({ from: '', to: '' });
  const [direction, setDirection] = useState('');
  const [message, setMessage] = useState('');
  const [previewInput, setPreviewInput] = useState({ taxCodeId: '', amount: 0 });
  const [taxPreview, setTaxPreview] = useState<TaxPreview | null>(null);

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await authFetch(`${API}${path}`, token, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    });
    const data = await response.json();
    if (!response.ok) {
      const detail = typeof data.message === 'string' ? data.message : Array.isArray(data.message) ? data.message.join(', ') : data?.message?.message ?? data?.error ?? 'Permintaan gagal.';
      throw new Error(detail);
    }
    return data as T;
  }

  async function refresh() {
    if (!canReadTax) return;
    try {
      const dates = new URLSearchParams();
      if (range.from) dates.set('from', range.from);
      if (range.to) dates.set('to', range.to);
      const qs = new URLSearchParams(dates);
      qs.set('limit', '100');
      if (direction) qs.set('direction', direction);
      const [accountRows, taxCodes, ledger, docs, recon] = await Promise.all([
        readOptional(identity, '/accounting-core/accounts', [] as Account[], p => api<Account[]>(p)),
        api<TaxCode[]>('/accounting-core/tax-codes'),
        api<CursorPage<TaxTransaction>>(`/accounting-core/tax-transactions?${qs.toString()}`),
        api<CursorPage<TaxDocument>>(`/accounting-core/tax-documents?${dates.toString()}&limit=100`),
        api<TaxReconciliation>(`/accounting-core/tax-reconciliation?${dates.toString()}`),
      ]);
      if (!recon.businessCalendar?.from || !recon.businessCalendar?.to || !recon.businessCalendar?.timezone) throw new Error('Kalender perusahaan belum tersedia dari Tax Core.');
      setAccounts(accountRows);
      setCodes(taxCodes);
      setTransactions(ledger.items ?? []);
      setDocuments(docs.items ?? []);
      setReconciliation(recon);
      if (!range.from && !range.to) {
        setRange(current => current.from || current.to ? current : { from: recon.businessCalendar.from, to: recon.businessCalendar.to });
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Gagal memuat tax workspace.');
    }
  }

  useEffect(() => { void refresh(); }, [token, canReadTax, range.from, range.to, direction]);

  async function saveTaxCode(event: React.FormEvent) {
    event.preventDefault(); setMessage('');
    try {
      const rate = Number(form.ratePercent) / 100;
      if (!Number.isFinite(rate) || rate < 0) throw new Error('Tarif pajak tidak valid.');
      await api('/accounting-core/tax-codes', { method: 'POST', body: JSON.stringify({
        code: form.code.trim().toUpperCase(), version: form.version, name: form.name.trim(), scope: form.scope, rate,
        inclusive: form.inclusive, recoverable: form.recoverable,
        payableAccountCode: form.payableAccountCode || undefined, receivableAccountCode: form.receivableAccountCode || undefined,
        expenseAccountCode: form.expenseAccountCode || undefined, effectiveFrom: form.effectiveFrom || undefined,
        effectiveTo: form.effectiveTo || undefined, status: form.status, legalReference: form.legalReference.trim() || undefined,
        ...((form.coretaxVatRate || form.bppuObjectCode) ? {calculationRules:{coretax:{vatRatePercent:form.coretaxVatRate,otherTaxBaseNumerator:form.coretaxNumerator,otherTaxBaseDenominator:form.coretaxDenominator,bppuObjectCode:form.bppuObjectCode}}}:{}),
      }) });
      setMessage(`${form.code.toUpperCase()} v${form.version} tersimpan.`);
      setForm(emptyForm); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal menyimpan tax code.'); }
  }

  function cloneVersion(row: TaxCode) {
    const nextVersion = Math.max(...codes.filter((item) => item.code === row.code).map((item) => item.version), row.version) + 1;
    setForm({
      code: row.code, version: nextVersion, name: row.name, scope: row.scope, ratePercent: String(Number(row.rate) * 100),
      inclusive: row.inclusive, recoverable: row.recoverable, payableAccountCode: row.payableAccountCode ?? '',
      receivableAccountCode: row.receivableAccountCode ?? '', expenseAccountCode: row.expenseAccountCode ?? '',
      effectiveFrom: '', effectiveTo: '', status: 'DRAFT', legalReference: row.legalReference ?? '',
      coretaxVatRate:row.calculationRules?.coretax?.vatRatePercent??'',coretaxNumerator:row.calculationRules?.coretax?.otherTaxBaseNumerator??'',coretaxDenominator:row.calculationRules?.coretax?.otherTaxBaseDenominator??'',bppuObjectCode:row.calculationRules?.coretax?.bppuObjectCode??'',
    });
  }

  async function previewTax(event: React.FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      const result = await api<TaxPreview>('/accounting-core/tax/preview', { method: 'POST', body: JSON.stringify({ taxCodeId: previewInput.taxCodeId, amount: Number(previewInput.amount) }) });
      setTaxPreview(result);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal melakukan preview pajak.'); }
  }

  async function updateStatus(row: TaxCode, status: 'ACTIVE'|'INACTIVE') {
    setMessage('');
    try {
      await api(`/accounting-core/tax-codes/${row.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setMessage(`${row.code} v${row.version} → ${status}.`); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal mengubah status tax code.'); }
  }

  const activeAccounts = accounts.filter((row) => row.isActive);
  const liabilities = activeAccounts.filter((row) => row.type === 'LIABILITY');
  const assets = activeAccounts.filter((row) => row.type === 'ASSET');
  const expenses = activeAccounts.filter((row) => row.type === 'EXPENSE');

  if (!canReadTax) return <><CoretaxExportWorkspace token={token} documents={[]} /><p className="notice" role="status">Akun ini belum mempunyai akses ke konfigurasi dan ledger pajak. Data tersebut tidak ditampilkan.</p></>;
  return <>
    {message && <div className="notice">{message}</div>}
    <CoretaxExportWorkspace token={token} documents={documents.filter(row=>row.status==='ISSUED')} />
    <section className="grid2">
      <Panel eyebrow="TAX CORE" title="Versioned Tax Configuration" badge={`${codes.length} version`}>
        <form className="formStack" onSubmit={saveTaxCode}>
          <section className="grid2">
            <label>Kode<input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="PPN-OUT" /></label>
            <label>Version<input required type="number" min="1" value={form.version} onChange={(e) => setForm({ ...form, version: Number(e.target.value) })} /></label>
            <label>Nama<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label>Scope<select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}><option>SALE</option><option>PURCHASE</option><option>EXPENSE</option><option>ASSET</option><option>PAYROLL</option><option>SHIPPING</option><option>WITHHOLDING</option><option>OTHER</option></select></label>
            <label>Tarif (%)<input required inputMode="decimal" value={form.ratePercent} onChange={(e) => setForm({ ...form, ratePercent: e.target.value })} /></label>
            <label>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as 'DRAFT'|'ACTIVE' })}><option>DRAFT</option><option>ACTIVE</option></select></label>
            <label>Efektif dari<input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></label>
            <label>Efektif sampai<input type="date" value={form.effectiveTo} onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })} /></label>
            <label>Utang pajak<select value={form.payableAccountCode} onChange={(e) => setForm({ ...form, payableAccountCode: e.target.value })}><option value="">—</option>{liabilities.map((a) => <option key={a.id} value={a.code}>{a.code} · {a.name}</option>)}</select></label>
            <label>Piutang pajak<select value={form.receivableAccountCode} onChange={(e) => setForm({ ...form, receivableAccountCode: e.target.value })}><option value="">—</option>{assets.map((a) => <option key={a.id} value={a.code}>{a.code} · {a.name}</option>)}</select></label>
            <label>Beban pajak<select value={form.expenseAccountCode} onChange={(e) => setForm({ ...form, expenseAccountCode: e.target.value })}><option value="">—</option>{expenses.map((a) => <option key={a.id} value={a.code}>{a.code} · {a.name}</option>)}</select></label>
            <label>Tarif PPN statutory Coretax (%)<input inputMode="decimal" value={form.coretaxVatRate} onChange={e=>setForm({...form,coretaxVatRate:e.target.value})}/></label>
            <label>Rasio DPP lain: pembilang<input inputMode="numeric" value={form.coretaxNumerator} onChange={e=>setForm({...form,coretaxNumerator:e.target.value})}/></label>
            <label>Rasio DPP lain: penyebut<input inputMode="numeric" value={form.coretaxDenominator} onChange={e=>setForm({...form,coretaxDenominator:e.target.value})}/></label>
            <label>Kode objek BPPU (withholding)<input value={form.bppuObjectCode} onChange={e=>setForm({...form,bppuObjectCode:e.target.value})}/></label>
            <label>Referensi hukum<input value={form.legalReference} onChange={(e) => setForm({ ...form, legalReference: e.target.value })} /></label>
          </section>
          <div className="actionRow"><label className="checkboxRow"><input type="checkbox" checked={form.inclusive} onChange={(e) => setForm({ ...form, inclusive: e.target.checked })} /> Inclusive</label><label className="checkboxRow"><input type="checkbox" checked={form.recoverable} onChange={(e) => setForm({ ...form, recoverable: e.target.checked })} /> Recoverable input</label>{canManageTax&&<button>Simpan version</button>}</div>
        </form>
      </Panel>

      <Panel eyebrow="TAX PREVIEW" title="Simulasi Pajak" badge="server authoritative">
        <form className="formStack" onSubmit={previewTax}>
          <label>Tax code<select required value={previewInput.taxCodeId} onChange={(e)=>setPreviewInput({...previewInput,taxCodeId:e.target.value})}><option value="">Pilih tax code ACTIVE</option>{codes.filter(c=>c.status==='ACTIVE').map(c=><option key={c.id} value={c.id}>{c.code} v{c.version} · {c.name}</option>)}</select></label>
          <label>Nilai transaksi<input required type="number" min="0" step="0.01" value={previewInput.amount} onChange={(e)=>setPreviewInput({...previewInput,amount:Number(e.target.value)})}/></label>
          <button>Hitung preview</button>
        </form>
        {taxPreview && <div className="stats sectionBlock"><div className="stat"><small>Net</small><strong>{rupiah(Number(taxPreview.net))}</strong></div><div className="stat"><small>Tax</small><strong>{rupiah(Number(taxPreview.tax))}</strong></div><div className="stat"><small>Gross</small><strong>{rupiah(Number(taxPreview.gross))}</strong></div></div>}
        <p className="sectionHelp">Preview memakai tax engine tenant-scoped yang sama dengan posting transaksi; tidak menyimpan jurnal atau TaxTransaction.</p>
      </Panel>

      <Panel eyebrow="PERIODE PAJAK" title="Tax Reconciliation" badge={reconciliation?.integrity.ok ? 'PASS' : 'REVIEW'}>
        <div className="grid2"><label>Dari<input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label><label>Sampai<input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label></div>
        {reconciliation && <p className="sectionHelp">Kalender perusahaan: {reconciliation.businessCalendar.timezone}.</p>}
        {reconciliation && <>
          <Table head={['Direction','Transaksi','Taxable Base','Tax']} rows={reconciliation.directions.map((row) => [row.direction, row.count, rupiah(row.taxableBase), rupiah(row.taxAmount)])} empty="Belum ada transaksi pajak pada periode ini." />
          <p className="sectionHelp">Integrity: {reconciliation.integrity.transactionCount} transaksi · missing event {reconciliation.integrity.missingAccountingEvent} · missing journal {reconciliation.integrity.missingJournal} · non-posted {reconciliation.integrity.nonPosted}. Tax document: {reconciliation.documents.count}, tax {rupiah(reconciliation.documents.taxAmount)}.</p>
        </>}
      </Panel>
    </section>

    <Panel eyebrow="TAX CONFIGURATION HISTORY" title="Kode Pajak & Version Lifecycle" badge={`${codes.filter((row) => row.status === 'ACTIVE').length} ACTIVE`}>
      <Table head={['Kode','Nama','Scope','Tarif','Efektif','Mapping','Status','Aksi']} rows={codes.map((row) => [
        <strong>{row.code} v{row.version}</strong>, row.name, row.scope, `${(Number(row.rate) * 100).toFixed(4).replace(/\.0+$/, '')}%`, `${isoDate(row.effectiveFrom) || '∞'} → ${isoDate(row.effectiveTo) || '∞'}`,
        <small>AP:{row.payableAccountCode || '-'} · AR:{row.receivableAccountCode || '-'} · EXP:{row.expenseAccountCode || '-'}</small>, <StatusChip status={row.status} />,
        <span className="actionRow">{canManageTax&&<><button type="button" className="secondary" onClick={() => cloneVersion(row)}>Buat v+1</button>{row.status === 'DRAFT' && <button type="button" onClick={() => void updateStatus(row, 'ACTIVE')}>Aktifkan</button>}{row.status === 'ACTIVE' && <button type="button" className="secondary" onClick={() => void updateStatus(row, 'INACTIVE')}>Nonaktifkan</button>}</>}</span>,
      ])} empty="Belum ada konfigurasi pajak." />
      <p className="sectionHelp">Version yang sudah ACTIVE atau dipakai TaxTransaction tidak dapat ditimpa. Koreksi tarif/mapping dilakukan melalui version baru agar transaksi historis tetap reproducible.</p>
    </Panel>

    <section className="grid2">
      <Panel eyebrow="TAX LEDGER" title="Tax Transactions" badge={`${transactions.length} baris`}>
        <label>Direction<select value={direction} onChange={(e) => setDirection(e.target.value)}><option value="">Semua</option><option>OUTPUT</option><option>INPUT</option><option>WITHHOLDING</option><option>SELF_ASSESSED</option></select></label>
        <Table head={['Tanggal','Tax code','Direction','Source','Base','Tax','Status','Drill-down']} rows={transactions.map((row) => [tanggal(row.transactionDate), row.taxCode ? `${row.taxCode.code} v${row.taxCode.version}${row.taxCode.name ? ` · ${row.taxCode.name}` : ''}` : '-', row.direction, `${row.sourceType}:${row.sourceId}`, rupiah(Number(row.taxableBase)), rupiah(Number(row.taxAmount)), <StatusChip status={row.status} />, row.accountingEventId && onOpenAccountingEvent ? <button type="button" className="secondary" onClick={() => onOpenAccountingEvent(row.accountingEventId!)}>Accounting event</button> : '-'])} empty="Belum ada tax transaction pada filter ini." />
      </Panel>
      <Panel eyebrow="TAX DOCUMENTS" title="Dokumen Pajak" badge={`${documents.length} dokumen`}>
        <Table head={['Nomor','Tipe','Tanggal','Source','Counterparty','Tax','Gross','Status']} rows={documents.map((row) => [<strong>{row.number}</strong>, row.documentType, tanggal(row.issueDate), `${row.sourceType}:${row.sourceId}`, row.counterpartyName ?? '-', rupiah(Number(row.taxAmount)), rupiah(Number(row.grossAmount)), <StatusChip status={row.status} />])} empty="Belum ada tax document pada periode ini." />
      </Panel>
    </section>

    <Panel eyebrow="TAX ↔ JOURNAL RECONCILIATION" title="Mapped Account Movement" badge={`${reconciliation?.mappedAccountMovement.length ?? 0} akun`}>
      <Table head={['Akun','Tipe','Debit','Credit','Net D-C']} rows={(reconciliation?.mappedAccountMovement ?? []).map((row) => [<><strong>{row.code}</strong><small className="blockMeta">{row.name}</small></>, row.type, rupiah(row.debit), rupiah(row.credit), rupiah(row.net)])} empty="Belum ada movement pada akun pajak terpetakan untuk periode ini." />
    </Panel>
  </>;
}
