'use client';
import { FormEvent, useState } from 'react';
import { authFetch } from '../auth-fetch';
import { usePermissions } from '../permissions';
import { Panel, Table } from '../ui';
type Node = {id:string;code:string;name:string;role:string;branchId?:string|null};
type Capability = {flowCode:string;label:string;offlineCapable:boolean;degradedImpact?:string|null;localAuthoritative:boolean};
type Backup = {entityId:string;createdAt:string;payload:{completedAt:string;checksum:string;sizeBytes:number;kind:string}};
const API=process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000/api/v1';
export default function BranchContinuityControls({token,nodes,capabilities,onChange}:{token:string;nodes:Node[];capabilities:Capability[];onChange:()=>Promise<void>}){
  const {canAll}=usePermissions(token);const allowed=canAll('integration.manage');
  const [nodeId,setNodeId]=useState('');const [flowCode,setFlowCode]=useState('');
  const [offline,setOffline]=useState(false);const [impact,setImpact]=useState('');
  const [label,setLabel]=useState('');const [local,setLocal]=useState(false);
  const [checksum,setChecksum]=useState('');const [size,setSize]=useState('');const [completedAt,setCompletedAt]=useState('');
  const [backups,setBackups]=useState<Backup[]>([]);const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
  const [policy,setPolicy]=useState<{source:string;offlineCapable:boolean;degradedImpact?:string|null}|null>(null);
  async function api<T>(path:string,init?:RequestInit):Promise<T>{const response=await authFetch(`${API}${path}`,token,{...init,headers:{'Content-Type':'application/json',...init?.headers}});const data=await response.json();if(!response.ok)throw new Error(data.message??`HTTP ${response.status}`);return data;}
  async function run(action:()=>Promise<void>){if(!allowed||busy)return;setBusy(true);setMessage('');try{await action();}catch(error){setMessage(error instanceof Error?error.message:'Kontinuitas belum dapat diperbarui.');}finally{setBusy(false);}}
  async function savePolicy(event:FormEvent){event.preventDefault();await run(async()=>{await api(`/branch-continuity/nodes/${nodeId}/policy`,{method:'PUT',body:JSON.stringify({flowCode,offlineCapable:offline,degradedImpact:impact})});setPolicy(await api(`/branch-continuity/nodes/${nodeId}/policy/${encodeURIComponent(flowCode)}`));setMessage('Kebijakan node tersimpan.');});}
  async function declare(event:FormEvent){event.preventDefault();await run(async()=>{await api('/branch-continuity/capabilities',{method:'PUT',body:JSON.stringify({flowCode,label,offlineCapable:offline,degradedImpact:impact,localAuthoritative:local})});await onChange();setMessage('Kontrak flow perusahaan tersimpan.');});}
  async function recordBackup(event:FormEvent){event.preventDefault();await run(async()=>{await api('/branch-continuity/backups',{method:'POST',body:JSON.stringify({nodeId,checksum,sizeBytes:Number(size),completedAt:new Date(completedAt).toISOString(),kind:'LOCAL'})});setBackups(await api('/branch-continuity/backups'));setMessage('Metadata backup tercatat. Berkas backup tetap dikelola pada server asal.');});}
  if(!allowed)return null;
  return <Panel eyebrow="BRANCH CONTINUITY" title="Kebijakan offline & bukti pemulihan">
    <p className="sectionHelp">Kebijakan memengaruhi izin bekerja saat cabang terputus. Catatan backup hanya menyimpan metadata; tindakan ini tidak membuat backup, menjalankan restore, atau memindahkan stok.</p>
    <div className="grid2"><div className="formStack">
      <label>Node<select value={nodeId} onChange={e=>{setNodeId(e.target.value);setPolicy(null);}}><option value="">Pilih node</option>{nodes.map(node=><option key={node.id} value={node.id}>{node.code} · {node.name}</option>)}</select></label>
      <label>Flow<select value={flowCode} onChange={e=>{const cap=capabilities.find(row=>row.flowCode===e.target.value);setFlowCode(e.target.value);setLabel(cap?.label??'');setOffline(cap?.offlineCapable??false);setImpact(cap?.degradedImpact??'');setLocal(cap?.localAuthoritative??false);setPolicy(null);}}><option value="">Pilih kontrak</option>{capabilities.map(row=><option key={row.flowCode} value={row.flowCode}>{row.label} · {row.flowCode}</option>)}</select></label>
      <label>Kode flow<input minLength={2} maxLength={80} value={flowCode} onChange={e=>setFlowCode(e.target.value)}/></label><label>Label kontrak<input minLength={2} maxLength={160} value={label} onChange={e=>setLabel(e.target.value)}/></label>
      <label><input type="checkbox" checked={offline} onChange={e=>setOffline(e.target.checked)}/> Boleh berjalan offline</label><label>Dampak saat offline<textarea maxLength={500} value={impact} onChange={e=>setImpact(e.target.value)}/></label>
      <form onSubmit={savePolicy}><button disabled={busy||!nodeId||!flowCode||(offline&&!impact.trim())}>Simpan override node</button></form>
      <button type="button" className="secondary" disabled={busy||!nodeId||!flowCode} onClick={()=>void run(async()=>{setPolicy(await api(`/branch-continuity/nodes/${nodeId}/policy/${encodeURIComponent(flowCode)}`));})}>Periksa kebijakan efektif</button>
      {policy&&<p>{policy.source} · offline {policy.offlineCapable?'diizinkan':'ditolak'} · {policy.degradedImpact??'tanpa dampak terdaftar'}</p>}
      <form onSubmit={declare}><label><input type="checkbox" checked={local} onChange={e=>setLocal(e.target.checked)}/> Otoritas lokal dalam kontrak perusahaan</label><button disabled={busy||flowCode.length<2||label.length<2||(offline&&!impact.trim())}>Simpan kontrak perusahaan</button></form>
    </div><div className="formStack"><form className="formStack" onSubmit={recordBackup}>
      <label>Waktu backup selesai<input required type="datetime-local" value={completedAt} onChange={e=>setCompletedAt(e.target.value)}/></label><label>SHA-256 berkas backup<input required pattern="[a-fA-F0-9]{64}" maxLength={64} value={checksum} onChange={e=>setChecksum(e.target.value)}/></label><label>Ukuran berkas (byte)<input required type="number" min={0} step={1} value={size} onChange={e=>setSize(e.target.value)}/></label><button disabled={busy||!nodeId}>Catat metadata backup</button>
      </form><button type="button" className="secondary" disabled={busy||!nodeId||!/^[a-f0-9]{64}$/i.test(checksum)} onClick={()=>void run(async()=>{const result=await api<{verified:boolean}>('/branch-continuity/backups/verify-restore',{method:'POST',body:JSON.stringify({nodeId,checksum})});setMessage(result.verified?'Checksum cocok dengan backup terbaru yang tercatat. Restore berkas tetap dilakukan pada server.':'Checksum tidak terverifikasi.');})}>Verifikasi checksum sebelum restore</button>
      <button type="button" className="secondary" disabled={busy} onClick={()=>void run(async()=>{setBackups(await api('/branch-continuity/backups'));})}>Muat catatan backup terbaru</button>
      <button type="button" className="secondary" disabled={busy||!nodeId} onClick={()=>void run(async()=>{const node=nodes.find(row=>row.id===nodeId);if(!node)return;const result=await api<{next:string}>('/branch-continuity/rejoin',{method:'POST',body:JSON.stringify({code:node.code,name:node.name,role:node.role,...(node.branchId?{branchId:node.branchId}:{})})});setMessage(result.next);})}>Daftarkan kembali node setelah pemulihan</button>
    </div></div>
    <Table head={['Node','Selesai','SHA-256','Byte','Jenis']} rows={backups.map(row=>[nodes.find(node=>node.id===row.entityId)?.code??row.entityId,row.payload.completedAt,<code>{row.payload.checksum}</code>,row.payload.sizeBytes,row.payload.kind])} empty="Muat catatan backup untuk melihat metadata yang tersimpan."/>
    {message&&<p className="notice" role="status">{message}</p>}
  </Panel>;
}
