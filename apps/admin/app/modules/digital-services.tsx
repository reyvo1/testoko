'use client';

import { FormEvent, useEffect, useState } from 'react';
import { authFetch } from '../auth-fetch';
import { usePermissions } from '../permissions';
import { Panel, StatusChip, Table } from '../ui';
import { clearPpobOperation, ppobAccess, ppobOperation } from '../../../../packages/contracts/src/ppob-operation';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type Product = { providerSku:string; name:string; category:string; brand?:string|null; costPrice?:string|null; salePrice:string; active:boolean; stock?:number|null; unlimitedStock:boolean };
type Tx = { id:string; number:string; providerSku:string; customerNo:string; sellingPrice:string; costAmount?:string|null; status:string; serialNumber?:string|null; message?:string|null; createdAt:string; attempts:number };
type Page<T> = { items:T[]; pageInfo:{nextCursor:string|null} };
type Integration = { id:string; type:string; provider:string; name:string; status:string; hasSecrets:boolean; branchId?:string|null; lastHealthCheckAt?:string|null; lastError?:string|null };

async function call<T>(token:string,path:string,init?:RequestInit):Promise<T>{
  const response=await authFetch(`${API}${path}`,token,{...init,headers:{'Content-Type':'application/json',...(init?.headers??{})}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(Array.isArray(body.message)?body.message.join(', '):body.message??`HTTP ${response.status}`),{status:response.status});
  return body as T;
}

export default function DigitalServicesView({token}:{token:string}){
  const {canAll,identity}=usePermissions(token);
  const adminRole=Boolean(identity?.roles.some((role)=>['SUPER_ADMIN','OWNER','ADMIN'].includes(role)));
  const access=ppobAccess(token);
  const canManage=access.manage&&canAll('digital_service.manage');
  const canSync=adminRole&&canManage;
  const canConfigure=adminRole&&canAll('integration.manage');
  const [products,setProducts]=useState<Product[]>([]);
  const [txs,setTxs]=useState<Tx[]>([]);
  const [integration,setIntegration]=useState<Integration|null>(null);
  const [message,setMessage]=useState('');
  const [readiness,setReadiness]=useState<{enabled:boolean;connected:boolean;hasCredentials:boolean;integrationId:string|null;certification:string;cashPosting:string}|null>(null);
  const [productCursor,setProductCursor]=useState<string|null>(null);
  const [txCursor,setTxCursor]=useState<string|null>(null);
  const [loadedQuery,setLoadedQuery]=useState('');
  const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [query,setQuery]=useState('');
  const [form,setForm]=useState({providerSku:'',customerNo:'',maxPrice:''});
  const [credential,setCredential]=useState({username:'',apiKey:'',name:'Digiflazz'});

  async function refresh(){
    try{
      const [p,t,connections,status]=await Promise.all([
        call<Page<Product>>(token,`/digital-services/products?limit=25${query?`&search=${encodeURIComponent(query)}`:''}`),
        call<Page<Tx>>(token,'/digital-services/transactions?limit=20'),
        call<Integration[]>(token,'/platform/integrations'),
        call<{enabled:boolean;connected:boolean;hasCredentials:boolean;integrationId:string|null;certification:string;cashPosting:string}>(token,'/digital-services/status'),
      ]);
      setProducts(p.items); setTxs(t.items); setProductCursor(p.pageInfo.nextCursor); setTxCursor(t.pageInfo.nextCursor); setReadiness(status); setLoadedQuery(query); setConfirmed(false);
      setIntegration(connections.find(row=>row.id===status.integrationId)??connections.find(row=>row.type==='PPOB'&&row.provider.toUpperCase()==='DIGIFLAZZ')??null);
      setMessage('');
    }catch(cause){setMessage(cause instanceof Error?cause.message:'Digital services gagal dimuat.');}
  }
  useEffect(()=>{void refresh();},[token]);

  async function saveConnection(event:FormEvent){
    event.preventDefault();
    if(!canConfigure)return;
    if(!credential.username.trim()||!credential.apiKey.trim()){setMessage('Username dan API key Digiflazz wajib diisi.');return;}
    setBusy(true);
    try{
      const encryptedSecrets=JSON.stringify({username:credential.username.trim(),apiKey:credential.apiKey.trim()});
      if(integration){
        await call(token,`/platform/integrations/${integration.id}`,{method:'PATCH',body:JSON.stringify({status:'CONNECTED',encryptedSecrets,config:{catalogKind:'prepaid'},capabilities:{catalog:true,prepaidTransaction:true,recheck:true}})});
      }else{
        await call(token,'/platform/integrations',{method:'POST',body:JSON.stringify({type:'PPOB',provider:'DIGIFLAZZ',name:credential.name.trim()||'Digiflazz',encryptedSecrets,config:{catalogKind:'prepaid'},capabilities:{catalog:true,prepaidTransaction:true,recheck:true}})});
      }
      setCredential((value)=>({...value,username:'',apiKey:''}));
      await refresh();
      setMessage('Koneksi Digiflazz tersimpan terenkripsi. Jalankan Sync katalog untuk memuat produk provider.');
    }catch(cause){setMessage(cause instanceof Error?cause.message:'Koneksi Digiflazz gagal disimpan.');}
    finally{setBusy(false);}
  }

  async function sync(){setBusy(true);try{const result=await call<{queued:boolean;message?:string}>(token,'/digital-services/catalog/sync',{method:'POST',body:'{}'});setMessage(result.message??(result.queued?'Sinkron katalog masuk antrean worker.':'Sinkron katalog sudah di antrean.'));}catch(cause){setMessage(cause instanceof Error?cause.message:'Gagal sinkron katalog.');}finally{setBusy(false);}}
  async function more(kind:'products'|'transactions'){
    const cursor=kind==='products'?productCursor:txCursor;if(!cursor||busy)return;
    setBusy(true);try{
      if(kind==='products'){const page=await call<Page<Product>>(token,`/digital-services/products?limit=25&search=${encodeURIComponent(loadedQuery)}&cursor=${encodeURIComponent(cursor)}`);setProducts(rows=>[...rows,...page.items]);setProductCursor(page.pageInfo.nextCursor);}
      else{const page=await call<Page<Tx>>(token,`/digital-services/transactions?limit=20&cursor=${encodeURIComponent(cursor)}`);setTxs(rows=>[...rows,...page.items]);setTxCursor(page.pageInfo.nextCursor);}
    }catch(cause){setMessage(cause instanceof Error?cause.message:'Halaman PPOB gagal dimuat.');}finally{setBusy(false);}
  }
  async function buy(event:FormEvent){
    event.preventDefault();const product=products.find(row=>row.providerSku===form.providerSku);
    if(!canManage||!confirmed||!product||!readiness?.enabled||!readiness.connected||!readiness.hasCredentials||busy)return;
    setBusy(true);try{
      const payload={providerSku:form.providerSku,customerNo:form.customerNo.trim(),expectedSellingPrice:Number(product.salePrice),...(form.maxPrice?{maxPrice:Number(form.maxPrice)}:{})};
      const idempotencyKey=await ppobOperation(sessionStorage,access.scope,payload);
      await call(token,'/digital-services/transactions',{method:'POST',body:JSON.stringify({...payload,idempotencyKey})});
      clearPpobOperation(sessionStorage,access.scope);setForm(value=>({...value,customerNo:''}));setConfirmed(false);await refresh();setMessage('Transaksi PPOB tersimpan. Periksa status provider sampai selesai.');
    }catch(cause){if([400,403,404,422].includes((cause as {status:number}).status))clearPpobOperation(sessionStorage,access.scope);setMessage(cause instanceof Error?cause.message:'Hasil pengiriman belum diketahui; ulangi produk dan nomor yang sama.');}finally{setBusy(false);}
  }
  async function recheck(id:string){setBusy(true);try{await call(token,`/digital-services/transactions/${id}/recheck`,{method:'POST',body:'{}'});await refresh();setMessage('Recheck provider masuk antrean.');}catch(cause){setMessage(cause instanceof Error?cause.message:'Recheck gagal.');}finally{setBusy(false);}}

  return <section className="moduleStack">
    <section className="grid2">
      <Panel eyebrow="PPOB CONNECTION" title="Digiflazz" badge={integration?.status??'BELUM TERHUBUNG'}>
        {integration&&<div className="formStack"><div><StatusChip status={integration.status}/></div><small>Credential: {integration.hasSecrets?'TERSIMPAN':'BELUM ADA'} · scope: {integration.branchId?'BRANCH':'COMPANY'}</small>{integration.lastError&&<div className="notice">{integration.lastError}</div>}</div>}
        {canConfigure&&<form className="formStack" onSubmit={saveConnection}>
          <label>Nama koneksi<input value={credential.name} onChange={(e)=>setCredential({...credential,name:e.target.value})}/></label>
          <label>Username Digiflazz<input autoComplete="off" value={credential.username} onChange={(e)=>setCredential({...credential,username:e.target.value})}/></label>
          <label>API key<input type="password" autoComplete="new-password" value={credential.apiKey} onChange={(e)=>setCredential({...credential,apiKey:e.target.value})}/></label>
          <button disabled={busy}>{integration?'Rotasi credential & aktifkan':'Hubungkan Digiflazz'}</button>
          <p className="sectionHelp">Secret dikirim satu kali ke backend lalu disimpan terenkripsi. API key tidak pernah dibaca kembali ke browser.</p>
        </form>}
      </Panel>
      <Panel eyebrow="PPOB / DIGIFLAZZ" title="Katalog layanan digital" badge={`${products.length} produk`}>
        <div className="formStack"><div className="rowActions"><input placeholder="Cari pulsa / PLN / data / game" value={query} onChange={(e)=>setQuery(e.target.value)}/><button type="button" className="secondary" onClick={()=>void refresh()}>Cari</button>{canSync&&<button type="button" disabled={busy||integration?.status!=='CONNECTED'} onClick={()=>void sync()}>Sync katalog</button>}</div>
        <Table head={['SKU','Produk','Kategori','Harga','Stok']} rows={products.map((product)=>[product.providerSku,<><strong>{product.name}</strong><br/><small>{product.brand??'-'}</small></>,product.category,new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR'}).format(Number(product.salePrice)),product.unlimitedStock?'∞':String(product.stock??'-')])} empty="Katalog belum tersinkron. Hubungkan Digiflazz lalu sync katalog."/>{productCursor&&<button type="button" className="secondary" disabled={busy} onClick={()=>void more('products')}>Produk berikutnya</button>}</div>
      </Panel>
    </section>
    <section className="grid2">
      <Panel eyebrow="TRANSAKSI DIGITAL" title="Pulsa, token, paket & voucher"><form className="formStack" onSubmit={buy}><label>Produk<select required value={form.providerSku} onChange={(e)=>{const product=products.find((row)=>row.providerSku===e.target.value);setForm({...form,providerSku:e.target.value,maxPrice:product?.costPrice??''});setConfirmed(false);}}><option value="">Pilih produk</option>{products.map((product)=><option key={product.providerSku} value={product.providerSku}>{product.providerSku} · {product.name} · Rp {Number(product.salePrice).toLocaleString('id-ID')}</option>)}</select></label><label>Nomor pelanggan / meter<input required minLength={3} value={form.customerNo} onChange={(e)=>{setForm({...form,customerNo:e.target.value.replace(/\s+/g,'')});setConfirmed(false);}}/></label><label>Batas harga beli provider<input type="number" min="0" value={form.maxPrice} onChange={(e)=>{setForm({...form,maxPrice:e.target.value});setConfirmed(false);}}/></label><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Saya sudah memeriksa produk, nomor tujuan dan harga katalog.</label>{canManage&&<button disabled={busy||!confirmed||!form.providerSku||!readiness?.enabled||!readiness.connected||!readiness.hasCredentials}>Kirim transaksi</button>}<p className="sectionHelp">Kunci transaksi dipertahankan saat retry. Eksekusi provider melalui worker. Pembayaran pelanggan belum otomatis masuk jurnal dan rekap kas shift.</p></form></Panel>
      <Panel eyebrow="PPOB HEALTH" title="Kesiapan provider"><div className="formStack"><div><StatusChip status={integration?.status??'DISCONNECTED'}/></div><p>{!readiness?.enabled?'Aktifkan fitur PPOB untuk cabang/akun melalui Pengaturan & Akses → Feature.':readiness.connected&&readiness.hasCredentials?'Adapter prepaid dikonfigurasi. Sertifikasi provider nyata masih PENDING.':'Hubungkan provider dan simpan credential terlebih dahulu.'}</p><small>Live provider tetap bergantung pada credential Digiflazz yang valid dan akses jaringan worker.</small></div></Panel>
    </section>
    <Panel eyebrow="PPOB HISTORY" title="Status transaksi provider"><Table head={['Nomor','SKU / Tujuan','Status','Harga','SN / Pesan','Aksi']} rows={txs.map((row)=>[row.number,<><strong>{row.providerSku}</strong><br/><small>{row.customerNo}</small></>,<StatusChip status={row.status}/>,new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR'}).format(Number(row.sellingPrice)),row.serialNumber??row.message??'-',canManage&&['PENDING','PROCESSING'].includes(row.status)?<button type="button" className="secondary" disabled={busy} onClick={()=>void recheck(row.id)}>Recheck</button>:null])} empty="Belum ada transaksi digital."/>{txCursor&&<button type="button" className="secondary" disabled={busy} onClick={()=>void more('transactions')}>Riwayat berikutnya</button>}</Panel>
    {message&&<div className="notice">{message}</div>}
  </section>;
}
