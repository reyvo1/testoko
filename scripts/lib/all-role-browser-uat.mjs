import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { load } from '../../tests/helpers/import-ts.mjs';
const roles=['SUPER_ADMIN','OWNER','ADMIN','CASHIER','WAREHOUSE','PURCHASING','FINANCE','AUDITOR','HR','PAYROLL','MANAGER','EMPLOYEE'];
export async function runAllRoleBrowserUat({cdp,apiUrl,adminUrl,posUrl,employeeUrl,token,evidence,http,evaluateValue,waitExpression,navigateAdminContext,assertResponsiveMatrix,assertViewportIntegrity,captureSuccessScreenshot}){
  const opts={platform:'node',external:['react','react-dom','lucide-react']};
  const {resolveAdminNavigation}=await load('apps/admin/app/navigation.ts',opts);
  const {resolveDomainViews}=await load('apps/admin/app/domain-workspaces.ts',opts);
  const stamp=randomUUID();const failures=[];const checks=[];
  fs.mkdirSync('handoff/quality',{recursive:true});
  fs.writeFileSync('handoff/quality/all-role-browser-progress-latest.json',JSON.stringify({status:'RUNNING',sourceIdentity:evidence.sourceIdentity,roles:checks,failures,humanAcceptance:'PENDING'},null,2)+'\n');
  async function api(path,body,method='GET',access=token){const response=await http(`${apiUrl}${path}`,{method,headers:{authorization:`Bearer ${access}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw new Error(`All-role fixture ${method} ${path}: HTTP ${response.status}`);return data;}
  const instrument=await cdp.call('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const original=window.fetch;window.__roleReads={pending:0,failures:[]};window.fetch=async(...args)=>{window.__roleReads.pending++;try{const response=await original(...args);if(!response.ok){const url=new URL(typeof args[0]==='string'?args[0]:args[0].url,location.href);window.__roleReads.failures.push({path:url.pathname,status:response.status});}return response;}finally{window.__roleReads.pending--;}};})();`});
  try{
    for(const role of roles){let account;const row={role,routes:[],status:'PASS'};checks.push(row);
      console.log(`[all-role browser] ${role}: real login and permitted menus`);
      try{
        const email=`role-${role.toLowerCase()}-${stamp}@example.invalid`;const password=`TEST-${randomUUID()}-only`;
        account=await api('/users',{name:`Synthetic TEST ${role}`,email,password,roleNames:[role]},'POST');
        const employee=role==='EMPLOYEE'?await api('/hr/employees',{userId:account.id,employeeNumber:`ROLE-${stamp.slice(0,8)}`,fullName:'Synthetic TEST employee',email,employmentStatus:'PERMANENT',hireDate:new Date().toISOString().slice(0,10),timezone:'Asia/Makassar'},'POST'):null;
        const login=await api('/auth/login',{email,password},'POST');if(!login.accessToken)throw new Error('Real authenticated role token missing.');
        const identity=login.user;if(identity?.roles.length!==1||identity.roles[0]!==role)throw new Error('Authenticated role differs from requested fixture.');
        const manifest=await api('/platform/manifest',null,'GET',login.accessToken);
        const workspaces=resolveAdminNavigation(manifest,identity).flatMap(group=>group.items);
        await cdp.call('Page.navigate',{url:adminUrl});await waitExpression(cdp,`location.origin===${JSON.stringify(new URL(adminUrl).origin)} && document.readyState==='complete'`,'All-role Admin origin');
        await evaluateValue(cdp,`(()=>{localStorage.setItem('toko360_token',${JSON.stringify(login.accessToken)});localStorage.removeItem('toko360_refresh');location.reload();return true;})()`);
        await waitExpression(cdp,`Boolean(document.querySelector('#admin-main'))`,'All-role authenticated Admin');
        for(const workspace of workspaces){const domains=resolveDomainViews(workspace,manifest,identity);const routes=domains.length?domains.map(view=>`${workspace.route}/${view.key}`):[workspace.route];
          for(const route of routes){const result={route,status:'PASS'};row.routes.push(result);
            try{
              if(domains.length)await navigateAdminContext(cdp,route,`${role} ${route}`);
              else{await cdp.call('Page.navigate',{url:new URL(route,adminUrl).href});await waitExpression(cdp,`document.querySelector('#admin-main')?.getAttribute('data-admin-workspace')===${JSON.stringify(workspace.key)}`,`${role} ${route}`);}
              await waitExpression(cdp,`window.__roleReads?.pending===0 && !document.querySelector('.loadingState')`,`${role} ${route} settled`);
              await new Promise(resolve=>setTimeout(resolve,400));
              const state=await evaluateValue(cdp,`({errors:[...document.querySelectorAll('#admin-main h4')].filter(n=>n.textContent==='Terjadi kendala').length,serverFailures:window.__roleReads.failures.filter(r=>r.status>=500),reads:window.__roleReads.failures})`);
              result.deniedOptionalReads=state.reads;if(state.errors||state.serverFailures.length||state.reads.some(read=>read.status>=400))throw new Error(`Visible workspace error or rejected request: ${JSON.stringify(state.reads)}`);
              await assertViewportIntegrity(cdp,`${role} ${route}`,1440,900);
            }catch(error){result.status='FAIL';result.error=error.message;failures.push({role,route,error:error.message});row.status='FAIL';}
            if(row.routes.length%10===0)console.log(`[all-role browser] ${role}: ${row.routes.length} contexts checked`);
          }
        }
        if(role==='ADMIN'){
          const accounts=await api('/accounting-core/accounts',null,'GET',login.accessToken);
          const expense=accounts.find(row=>row.isActive&&row.type==='EXPENSE');const cash=accounts.find(row=>row.isActive&&row.type==='ASSET');
          if(!expense||!cash)throw new Error('Admin draft browser requires scoped synthetic expense/cash accounts.');
          const peer=await api('/finance-operations',{type:'OPERATING_EXPENSE',amount:17,debitAccountCode:expense.code,creditAccountCode:cash.code,description:'Synthetic TEST peer draft',requireApproval:false,idempotencyKey:`role-peer-${stamp}`},'POST');
          await navigateAdminContext(cdp,'/finance/banking','Admin own canonical Finance draft');
          const panel=`[...document.querySelectorAll('.panel')].find(n=>n.textContent.includes('Transaksi Keuangan Operasional'))`;
          await waitExpression(cdp,`Boolean((${panel})?.querySelector('form')) && window.__roleReads?.pending===0`,'Admin permitted draft form');
          const description=`Synthetic TEST Admin draft ${stamp}`;
          await evaluateValue(cdp,`(()=>{const panel=(${panel});for(const [label,value] of [['Keterangan',${JSON.stringify(description)}],['Nominal','17']]){const input=[...panel.querySelectorAll('label')].find(n=>n.textContent.startsWith(label)).querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}const approval=panel.querySelector('input[type="checkbox"]');if(approval?.checked)approval.click();return true;})()`);
          await evaluateValue(cdp,`(()=>{[...(${panel}).querySelectorAll('button')].find(n=>n.textContent==='Simpan').click();return true;})()`);
          await waitExpression(cdp,`(${panel}).textContent.includes(${JSON.stringify(description)}) && window.__roleReads?.pending===0`,'Admin draft visible after canonical create');
          const page=await api('/finance-operations?limit=100',null,'GET',login.accessToken);const own=page.items.find(row=>row.description===description);
          if(!own||own.createdById!==account.id||own.status!=='DRAFT'||page.items.some(row=>row.createdById!==account.id||row.id===peer.id))throw new Error('Admin Finance read leaks a peer or loses its own draft.');
          const activeActions=await evaluateValue(cdp,`[...(${panel}).querySelectorAll('button')].some(n=>['Approve','Reject','Posting','Batal'].includes(n.textContent.trim()))`);if(activeActions)throw new Error('Admin has a forbidden Finance approval/posting control.');
          for(const action of ['approve','post']){const response=await http(`${apiUrl}/finance-operations/${own.id}/${action}`,{method:'POST',headers:{authorization:`Bearer ${login.accessToken}`,'content-type':'application/json'},body:'{}'});if(response.status!==403)throw new Error(`Admin Finance ${action} should remain denied.`);}
          const unchanged=(await api('/finance-operations?limit=100',null,'GET',login.accessToken)).items.find(item=>item.id===own.id);
          if(!unchanged||unchanged.status!=='DRAFT'||unchanged.accountingEventId||unchanged.postedAt)throw new Error('Denied Admin actions changed or posted its draft.');
          const reads=await evaluateValue(cdp,`window.__roleReads.failures`);if(reads.some(read=>read.status>=400))throw new Error(`Admin Finance dependency rejected request: ${JSON.stringify(reads)}`);
          row.financeOwnDraft={status:'PASS',scope:'CREATED_BY_AUTHENTICATED_ACTOR',transactionStatus:own.status,approvePostAccess:'DENIED',journalPosted:false,screenshot:await captureSuccessScreenshot(cdp,'all-role-admin-own-finance-draft')};
        }
        if(role==='WAREHOUSE'){
          const categories=await api('/assets/categories');const category=categories.find(row=>row.isActive!==false);
          if(!category)throw new Error('Maintenance selector browser requires a synthetic scoped asset category.');
          const asset=await api('/assets',{categoryId:category.id,code:`ROLE-${stamp.slice(0,8)}`,name:'Synthetic TEST maintenance asset',acquisitionCost:17,paymentMode:'CASH'},'POST');
          const catalog=await api(`/assets/maintenance-catalog?limit=25&search=${encodeURIComponent(asset.code)}`,null,'GET',login.accessToken);
          if(!catalog.items.some(row=>row.id===asset.id)||catalog.items.some(row=>Object.keys(row).sort().join(',')!=='assetType,code,id,name,status'))throw new Error('Warehouse maintenance projection is missing or leaks private/financial fields.');
          const fullAssets=await http(`${apiUrl}/assets`,{headers:{authorization:`Bearer ${login.accessToken}`}});if(fullAssets.status!==403)throw new Error('Warehouse full financial asset list should remain denied.');
          await navigateAdminContext(cdp,'/assets-fleet/maintenance','Warehouse operational asset selector');
          await waitExpression(cdp,`Boolean([...document.querySelectorAll('label')].find(n=>n.textContent.startsWith('Kode atau nama aset'))?.querySelector('input')) && window.__roleReads?.pending===0`,'Warehouse asset catalog search ready');
          await evaluateValue(cdp,`(()=>{const input=[...document.querySelectorAll('label')].find(n=>n.textContent.startsWith('Kode atau nama aset')).querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(asset.code)});input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
          await evaluateValue(cdp,`(()=>{[...document.querySelectorAll('button')].find(n=>n.textContent==='Cari aset').click();return true;})()`);
          const assetForms=`['Buat Jadwal Maintenance','Buat Work Order'].map(title=>[...document.querySelectorAll('.panel')].find(n=>n.textContent.includes(title)))`;
          await waitExpression(cdp,`(${assetForms}).every(panel=>Boolean(panel?.querySelector('select option[value="${asset.id}"]'))) && window.__roleReads?.pending===0`,'Warehouse permitted asset in both maintenance forms');
          await evaluateValue(cdp,`(()=>{for(const panel of (${assetForms})){const select=[...panel.querySelectorAll('label')].find(n=>n.textContent.startsWith('Aset')).querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(asset.id)});select.dispatchEvent(new Event('change',{bubbles:true}));}return true;})()`);
          const assetReads=await evaluateValue(cdp,`window.__roleReads.failures`);if(assetReads.some(read=>read.status>=400))throw new Error(`Warehouse maintenance dependency rejected request: ${JSON.stringify(assetReads)}`);
          row.maintenanceSelection={status:'PASS',projection:'OPERATIONAL_FIELDS_ONLY',financialAssetAccess:'DENIED',screenshot:await captureSuccessScreenshot(cdp,'all-role-warehouse-maintenance-selector')};
          const driver=await api('/hr/employees',{employeeNumber:`DRIVER-${stamp.slice(0,8)}`,fullName:'Synthetic TEST fleet driver',employmentStatus:'PERMANENT',hireDate:new Date().toISOString().slice(0,10),timezone:'Asia/Makassar'},'POST');
          const vehicle=await api('/fleet/vehicles',{code:`ROLE-${stamp.slice(0,8)}`,plateNumber:`TEST-${stamp.slice(0,8)}`,vehicleType:'VAN'},'POST');
          await api('/fleet/driver-assignments',{vehicleId:vehicle.id,employeeId:driver.id,isPrimary:true},'POST');
          await navigateAdminContext(cdp,'/operations-control/delivery','Warehouse authorized fleet driver selector');
          await waitExpression(cdp,`Boolean([...document.querySelectorAll('label')].find(n=>n.textContent.startsWith('Driver'))?.querySelector('select option[value="${driver.id}"]'))`,'Warehouse assigned driver selectable without HR access');
          await waitExpression(cdp,`window.__roleReads?.pending===0`,'Warehouse driver dependencies settled');
          const driverReads=await evaluateValue(cdp,`window.__roleReads.failures`);if(driverReads.some(read=>read.status>=400))throw new Error(`Warehouse driver bootstrap rejected request: ${JSON.stringify(driverReads)}`);
          row.driverSelection={status:'PASS',source:'ACTIVE_SCOPED_FLEET_ASSIGNMENTS',hrDirectoryAccess:false,screenshot:await captureSuccessScreenshot(cdp,'all-role-warehouse-driver-selection')};
          const warehouses=await api('/master-data/warehouses');const warehouse=(Array.isArray(warehouses)?warehouses:warehouses.items).find(row=>row.isActive!==false&&row.branchId===manifest.branch.id);
          if(!warehouse)throw new Error('Stocktake browser requires active TEST warehouse.');
          const opname=await api('/advanced-inventory/stock-opnames',{warehouseId:warehouse.id,notes:'Synthetic TEST all-role mobile count'},'POST');
          let item,product;
          for(const candidate of (opname.items||[])){
            if(opname.items.filter(row=>row.productId===candidate.productId).length!==1)continue;
            const row=await api(`/products/${candidate.productId}`);
            if(row.isActive===false||row.trackBatch)continue;
            item=candidate;product=row;break;
          }
          if(!item||!product)throw new Error('Canonical TEST opname requires an active unambiguous snapshot product.');
          await navigateAdminContext(cdp,'/inventory-control/stocktake','Warehouse mobile count canonical context');
          await waitExpression(cdp,`[...document.querySelectorAll('select option')].some(n=>n.value===${JSON.stringify(opname.id)})`,'Warehouse mobile count option');
          const panel=`[...document.querySelectorAll('.panel')].find(n=>n.textContent.includes('Scan hitungan gudang'))`;
          await evaluateValue(cdp,`(()=>{const select=(${panel}).querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(opname.id)});select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
          await evaluateValue(cdp,`(()=>{[...(${panel}).querySelectorAll('button')].find(n=>n.textContent==='Buka / lanjutkan draft perangkat').click();return true;})()`);
          await waitExpression(cdp,`(${panel}).textContent.includes('Draft dibuka.')`,'Warehouse draft persisted');
          if(!product.barcode){
            await evaluateValue(cdp,`(()=>{const select=[...(${panel}).querySelectorAll('label')].find(n=>n.textContent.startsWith('Jenis kode')).querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'sku');select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
            await waitExpression(cdp,`[...(${panel}).querySelectorAll('label')].some(n=>n.textContent==='SKU')`,'Warehouse SKU input');
          }
          await evaluateValue(cdp,`(()=>{const input=[...(${panel}).querySelectorAll('label')].find(n=>n.textContent===${JSON.stringify(product.barcode?'Barcode':'SKU')}).querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(product.barcode||product.sku)});input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
          await evaluateValue(cdp,`(()=>{[...(${panel}).querySelectorAll('button')].find(n=>n.textContent==='Simpan scan').click();return true;})()`);
          await waitExpression(cdp,`(${panel}).textContent.includes('Scan tersimpan.')`,'Warehouse scan persisted');
          await evaluateValue(cdp,`(()=>{[...(${panel}).querySelectorAll('button')].find(n=>n.textContent==='Kirim hitungan ke Stock Opname').click();return true;})()`);
          await waitExpression(cdp,`(${panel}).textContent.includes('Hitungan masuk Stock Opname.')`,'Warehouse count filed canonically');
          const saved=(await api('/advanced-inventory/stock-opnames')).find(row=>row.id===opname.id);if(saved.items.find(row=>row.id===item.id)?.countedQty!==1)throw new Error('Browser count did not reach canonical snapshot item.');
          row.mobileCount={status:'PASS',opnameStatus:saved.status,inventoryPosted:false,screenshot:await captureSuccessScreenshot(cdp,'all-role-warehouse-mobile-count')};
        }
        if(role==='EMPLOYEE'){
          const denied=await http(`${apiUrl}/payroll/runs`,{headers:{authorization:`Bearer ${login.accessToken}`}});if(denied.status!==403)throw new Error('Employee can read branch payroll despite self-service boundary.');
          for(const path of ['/hr/leave-requests','/hr/overtime-requests','/attendance/schedules','/attendance/corrections']){const rows=await api(path,null,'GET',login.accessToken);if(rows.some(item=>item.employeeId!==employee.id))throw new Error('Personnel self-service list leaks another employee.');}
          await cdp.call('Page.navigate',{url:employeeUrl});await waitExpression(cdp,`location.origin===${JSON.stringify(new URL(employeeUrl).origin)} && document.readyState==='complete'`,'Employee real-role portal origin');
          await evaluateValue(cdp,`(()=>{localStorage.setItem('employeeToken',${JSON.stringify(login.accessToken)});location.reload();return true;})()`);
          await waitExpression(cdp,`document.body.innerText.includes(${JSON.stringify(employee.employeeNumber)}) && Boolean(document.querySelector('.employeeNav'))`,'Employee real-role personal profile');
          const routes=await evaluateValue(cdp,`[...document.querySelectorAll('.employeeNav a')].map(n=>n.getAttribute('href')).filter(Boolean)`);
          for(const path of [...new Set(routes)]){await cdp.call('Page.navigate',{url:new URL(path,employeeUrl).href});await waitExpression(cdp,`location.pathname===${JSON.stringify(path)} && Boolean(document.querySelector('.employeeNav')) && window.__roleReads?.pending===0`,'Employee real-role self-service route');await assertViewportIntegrity(cdp,`EMPLOYEE portal ${path}`,1440,900);}
          row.employeePortal={status:'PASS',routes:[...new Set(routes)],payrollBranchAccess:'DENIED',otherPersonnelVisible:false,matrix:await assertResponsiveMatrix(cdp,'EMPLOYEE portal'),screenshot:await captureSuccessScreenshot(cdp,'all-role-employee-personal')};
        }
        row.matrix=await assertResponsiveMatrix(cdp,`Role ${role}`);
        row.screenshot=await captureSuccessScreenshot(cdp,`all-role-${role.toLowerCase()}`);
        if(['CASHIER','AUDITOR','MANAGER'].includes(role)){
          await cdp.call('Page.navigate',{url:posUrl});await waitExpression(cdp,`location.origin===${JSON.stringify(new URL(posUrl).origin)} && document.readyState==='complete'`,'All-role POS origin');
          await evaluateValue(cdp,`(()=>{localStorage.setItem('toko360_pos_token',${JSON.stringify(login.accessToken)});location.reload();return true;})()`);
          await waitExpression(cdp,`Boolean(document.querySelector('.posWorkspaceNav'))`,`${role} POS navigation`);
          await evaluateValue(cdp,`(()=>{const button=[...document.querySelectorAll('.posWorkspaceNav button')].find(n=>n.textContent.includes('PPOB'));if(!button)throw new Error('Cashier PPOB menu missing');button.click();return true;})()`);
          await waitExpression(cdp,`Boolean(document.querySelector('[data-pos-ppob]'))`,`${role} POS PPOB`);
          await waitExpression(cdp,`window.__roleReads.pending===0 && !document.body.innerText.includes('Memuat kesiapan PPOB')`,`${role} PPOB readiness`);
          const posReads=await evaluateValue(cdp,`window.__roleReads.failures`);if(posReads.some(read=>read.status>=400))throw new Error(`PPOB role bootstrap rejected request: ${JSON.stringify(posReads)}`);
          if(role!=='CASHIER'){const forbiddenNav=await evaluateValue(cdp,`[...document.querySelectorAll('.posWorkspaceNav button')].some(n=>['Penjualan','Shift & Kas','Sinkronisasi'].includes(n.textContent.trim()))`);if(forbiddenNav)throw new Error('Read-only role has unauthorized cashier workspace.');const enabled=await evaluateValue(cdp,`[...document.querySelectorAll('[data-pos-ppob] button')].some(n=>n.textContent.includes('Konfirmasi dan kirim')&&!n.disabled)`);if(enabled)throw new Error('Read-only PPOB role has active submit.');}
          row.posPpob={status:'PASS',matrix:await assertResponsiveMatrix(cdp,`${role} PPOB`),screenshot:await captureSuccessScreenshot(cdp,`all-role-${role.toLowerCase()}-ppob`)};
        }
      }catch(error){row.status='FAIL';row.error=error.message;failures.push({role,error:error.message});}
      finally{
        if(account?.id)await api(`/users/${account.id}/status`,{isActive:false},'PATCH');
        fs.mkdirSync('handoff/quality',{recursive:true});
        fs.writeFileSync('handoff/quality/all-role-browser-progress-latest.json',JSON.stringify({status:'RUNNING',sourceIdentity:evidence.sourceIdentity,roles:checks,failures,humanAcceptance:'PENDING'},null,2)+'\n');
        console.log(`[all-role browser] ${role}: ${row.status}, ${row.routes.length} contexts checked`);
      }
    }
  }finally{
    await cdp.call('Page.removeScriptToEvaluateOnNewDocument',{identifier:instrument.identifier});
    await cdp.call('Page.navigate',{url:adminUrl});await waitExpression(cdp,`location.origin===${JSON.stringify(new URL(adminUrl).origin)} && document.readyState==='complete'`,'Restore Admin origin');await evaluateValue(cdp,`(()=>{localStorage.setItem('toko360_token',${JSON.stringify(token)});location.reload();return true;})()`);
    await cdp.call('Page.navigate',{url:posUrl});await waitExpression(cdp,`location.origin===${JSON.stringify(new URL(posUrl).origin)} && document.readyState==='complete'`,'Restore POS origin');await evaluateValue(cdp,`(()=>{localStorage.setItem('toko360_pos_token',${JSON.stringify(token)});location.reload();return true;})()`);
  }
  evidence.checks.push({id:'ALL_12_ROLES_MENU_API_BROWSER',status:failures.length?'FAIL':'PASS',sourceIdentity:evidence.sourceIdentity,roles:checks,routeCount:checks.reduce((sum,row)=>sum+row.routes.length,0),fixture:'actual scoped Users API, real login, disabled after audit; synthetic TEST only',humanAcceptance:'PENDING'});
  fs.writeFileSync('handoff/quality/all-role-browser-progress-latest.json',JSON.stringify({status:failures.length?'FAIL':'PASS',sourceIdentity:evidence.sourceIdentity,roles:checks,failures,humanAcceptance:'PENDING'},null,2)+'\n');
  if(failures.length)throw new Error(`All-role menu/browser parity failed: ${JSON.stringify(failures.slice(0,20))}`);
}
