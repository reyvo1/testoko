import {parityDatabase} from './helpers/parity-database.mjs';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { load } from './helpers/import-ts.mjs';
const database=parityDatabase('ppob');
const url=database.url;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const opts = { platform:'node', external:['@prisma/client','@nestjs/common','@nestjs/microservices','@nestjs/websockets'] };
const { DigitalServicesService } = await load('apps/api/src/digital-services/digital-services.service.ts',opts);
const { PlatformService } = await load('apps/api/src/platform/platform.service.ts',opts);
const { ppobOperation, clearPpobOperation, ppobAccess } = await load('apps/pos/lib/ppob-operation.ts');
const platform = new PlatformService(prisma,{list:()=>[]},{});
const service = new DigitalServicesService(prisma,platform);
const user = {sub:'ppob-user',companyId:'ppob-company',branchId:'ppob-branch',roles:['CASHIER'],permissions:['digital_service.view','digital_service.manage']};
const dto = {providerSku:'TEST-PREPAID',customerNo:'0000000000',idempotencyKey:'ppob-test-operation',maxPrice:20,expectedSellingPrice:25};
let enabled;
let integration;
before(async()=>{
  database.prepare();
  for(const [id,slug] of [['ppob-company','ppob-test'],['other-company','other-test']])await prisma.company.create({data:{id,slug,name:'Synthetic TEST only'}});
  for(const [id,companyId,code] of [['ppob-branch','ppob-company','TEST1'],['ppob-branch-2','ppob-company','TEST2'],['other-branch','other-company','OTHER']])await prisma.branch.create({data:{id,companyId,code,name:'TEST branch'}});
  for(const [id,branchId] of [['ppob-user','ppob-branch'],['ppob-user-2','ppob-branch']])await prisma.user.create({data:{id,branchId,name:'Synthetic TEST user',email:`${id}@example.invalid`,passwordHash:'synthetic-only'}});
  integration=await prisma.integrationConnection.create({data:{companyId:user.companyId,branchId:user.branchId,type:'PPOB',provider:'DIGIFLAZZ',name:'TEST only',status:'CONNECTED',encryptedSecrets:'synthetic-not-a-real-credential'}});
  await prisma.digitalServiceProduct.create({data:{companyId:user.companyId,integrationId:integration.id,providerSku:dto.providerSku,name:'TEST prepaid',category:'TEST',costPrice:20,salePrice:25}});
});
after(async()=>{await database.close(prisma);});

test('PPOB readiness defaults OFF, returns no secret and denies disabled mutation without outbox or numbering',async()=>{
  const state=await service.status(user);assert.equal(state.enabled,false);assert.equal(state.connected,true);assert.equal(state.certification,'PENDING');assert.equal(state.cashPosting,'NOT_IMPLEMENTED');assert(!JSON.stringify(state).includes(integration.encryptedSecrets));
  await assert.rejects(()=>service.createTransaction(dto,user),/belum aktif/);assert.equal(await prisma.digitalServiceTransaction.count(),0);assert.equal(await prisma.eventOutbox.count(),0);assert.equal(await prisma.numberSequence.count(),0);
  enabled=await prisma.featureFlag.create({data:{companyId:user.companyId,branchId:user.branchId,key:'digital_services_ppob',scope:'BRANCH',enabled:true,config:{rolloutPercentage:100}}});
});
test('catalog and create use the same branch integration and exclude unsupported postpaid products',async()=>{
  const companyIntegration=await prisma.integrationConnection.create({data:{companyId:user.companyId,type:'PPOB',provider:'DIGIFLAZZ',name:'Company TEST',status:'CONNECTED'}});
  await prisma.digitalServiceProduct.create({data:{companyId:user.companyId,integrationId:companyIntegration.id,providerSku:'COMPANY-ONLY',name:'Other catalog',category:'TEST',salePrice:1}});
  await prisma.digitalServiceProduct.create({data:{companyId:user.companyId,integrationId:integration.id,providerSku:'POSTPAID',name:'Postpaid',kind:'POSTPAID',category:'TEST',salePrice:1}});
  assert.deepEqual((await service.products(user)).items.map(r=>r.providerSku),[dto.providerSku]);
  for(const providerSku of ['POSTPAID','COMPANY-ONLY'])await assert.rejects(()=>service.createTransaction({...dto,providerSku},user),/tidak tersedia/);
});
test('price drift, provider max-price and permission denial cannot queue or allocate a number',async()=>{
  await assert.rejects(()=>service.createTransaction({...dto,expectedSellingPrice:24},user),/Harga jual katalog berubah/);
  await assert.rejects(()=>service.createTransaction({...dto,maxPrice:19},user),/maxPrice/);
  await assert.rejects(()=>service.createTransaction(dto,{...user,roles:['AUDITOR'],permissions:['digital_service.manage']}),/Izin/);
  assert.equal(await prisma.eventOutbox.count(),0);assert.equal(await prisma.numberSequence.count(),0);
});
test('concurrent retry creates one transaction, outbox and audit; replay survives disabling ingress',async()=>{
  const rows=await Promise.all([service.createTransaction(dto,user),service.createTransaction(dto,user)]);assert.equal(rows[0].id,rows[1].id);
  assert.equal(await prisma.digitalServiceTransaction.count(),1);assert.equal(await prisma.eventOutbox.count(),1);assert.equal(await prisma.auditLog.count(),1);
  assert(!('customerNo' in (await prisma.auditLog.findFirst()).payload));
  await prisma.featureFlag.update({where:{id:enabled.id},data:{enabled:false}});assert.equal((await service.createTransaction(dto,user)).id,rows[0].id);
});
test('operation key cannot expose another branch/cashier or change destination, SKU or confirmed prices',async()=>{
  await assert.rejects(()=>service.createTransaction(dto,{...user,branchId:'ppob-branch-2'}),/konteks/);
  await assert.rejects(()=>service.createTransaction(dto,{...user,sub:'ppob-user-2'}),/konteks/);
  for(const change of [{customerNo:'1111111111'},{providerSku:'OTHER'},{maxPrice:22},{expectedSellingPrice:26}])await assert.rejects(()=>service.createTransaction({...dto,...change},user),/isi transaksi/);
  assert.equal(await prisma.digitalServiceTransaction.count(),1);assert.equal(await prisma.eventOutbox.count(),1);
});
test('history/detail stay tenant-scoped and recheck preserves provider authority and throttling',async()=>{
  const row=await prisma.digitalServiceTransaction.findFirst();assert.equal((await service.transactions({...user,branchId:'ppob-branch-2'})).items.length,0);
  await assert.rejects(()=>service.transaction(row.id,{...user,companyId:'other-company',branchId:'other-branch'}),/tidak ditemukan/);
  await assert.rejects(()=>service.recheck(row.id,user),/PENDING/);
  await prisma.digitalServiceTransaction.update({where:{id:row.id},data:{status:'PENDING'}});
  await service.recheck(row.id,user);await assert.rejects(()=>service.recheck(row.id,user),/60 detik/);
  assert.equal(await prisma.eventOutbox.count(),2);assert.equal((await prisma.digitalServiceTransaction.findUnique({where:{id:row.id}})).status,'PENDING');
});
test('readiness and manifest agree on scope precedence, rollout and user override',async()=>{
  await prisma.featureFlag.update({where:{id:enabled.id},data:{enabled:true,config:{rolloutPercentage:0}}});assert.equal((await service.status(user)).enabled,false);assert.equal((await platform.manifest(user)).features.digital_services_ppob.enabled,false);
  await prisma.featureFlag.create({data:{companyId:user.companyId,branchId:user.branchId,userId:user.sub,key:'digital_services_ppob',scope:'USER',enabled:true,config:{rolloutPercentage:100}}});
  assert.equal((await service.status(user)).enabled,true);assert.equal((await platform.manifest(user)).features.digital_services_ppob.enabled,true);
});
test('durable UI retry keeps one key, refuses changed payload, stores no raw destination and separates accounts',async()=>{
  const rows=new Map();const storage={getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};
  const payload={customerNo:'0000000000',providerSku:'TEST'};const key=await ppobOperation(storage,'branch:cashier',payload);assert.equal(await ppobOperation(storage,'branch:cashier',payload),key);assert(![...rows.values()][0].includes(payload.customerNo));
  await assert.rejects(()=>ppobOperation(storage,'branch:cashier',{...payload,customerNo:'1111111111'}),/belum terkonfirmasi/);
  assert.notEqual(await ppobOperation(storage,'branch:other',payload),key);clearPpobOperation(storage,'branch:cashier');assert.notEqual(await ppobOperation(storage,'branch:cashier',payload),key);
});
test('cashier, read-only and custom-role UI actions match both permission and role guard',()=>{
  const token=claims=>`x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.x`;
  assert.deepEqual(ppobAccess(token(user)),{view:true,manage:true,scope:'ppob-company:ppob-branch:ppob-user'});
  assert.equal(ppobAccess(token({...user,roles:['AUDITOR'],permissions:['digital_service.view']})).manage,false);
  assert.equal(ppobAccess(token({...user,roles:['CUSTOM'],permissions:['digital_service.view','digital_service.manage']})).view,true);
  assert.equal(ppobAccess(token({...user,roles:['CUSTOM'],permissions:['digital_service.view','digital_service.manage']})).manage,false);
  assert.equal(ppobAccess('invalid').view,false);
});
