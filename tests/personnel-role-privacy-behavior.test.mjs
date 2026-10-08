import {parityDatabase} from './helpers/parity-database.mjs';
import assert from 'node:assert/strict';
import test,{before,after} from 'node:test';
import {PrismaClient} from '@prisma/client';import {load} from './helpers/import-ts.mjs';
import {isPersonnelSelfOnly} from '../packages/contracts/personnel-authority.cjs';
const database=parityDatabase('personnel');
const url=database.url;
const db=new PrismaClient({datasources:{db:{url}}});const opts={platform:'node',external:['@prisma/client','@nestjs/*']};
const {HrService}=await load('apps/api/src/hr/hr.service.ts',opts);const {AttendanceService}=await load('apps/api/src/attendance/attendance.service.ts',opts);const {PayrollService}=await load('apps/api/src/payroll/payroll.service.ts',opts);
const hr=new HrService(db);const attendance=new AttendanceService(db,{get:()=>undefined});const payroll=new PayrollService(db,{get:()=>undefined},{});
const user={sub:'personal-user',companyId:'personal-company',branchId:'personal-branch',roles:['EMPLOYEE'],permissions:['employee.self','attendance.view','attendance.record','leave.view','overtime.view','payroll.view']};
const supervisor={...user,sub:'supervisor-user',roles:['HR'],permissions:['employee.view','attendance.view','leave.view','overtime.view','payroll.view']};
const date=new Date('2026-10-07T00:00:00Z');
before(async()=>{
  database.prepare();
 await db.company.create({data:{id:user.companyId,name:'Synthetic TEST',slug:'personnel-test'}});await db.branch.create({data:{id:user.branchId,companyId:user.companyId,code:'TEST',name:'Synthetic branch'}});
 for(const [id,employeeId] of [[user.sub,'own-employee'],['peer-user','peer-employee'],[supervisor.sub,'supervisor-employee']]){
  await db.user.create({data:{id,branchId:user.branchId,email:`${id}@example.invalid`,name:'Synthetic user',passwordHash:'synthetic-only'}});
  await db.employee.create({data:{id:employeeId,userId:id,companyId:user.companyId,branchId:user.branchId,employeeNumber:employeeId,fullName:'Synthetic TEST employee',employmentStatus:'PERMANENT',hireDate:date}});
 }
 for(const employeeId of ['own-employee','peer-employee']){
  await db.leaveRequest.create({data:{companyId:user.companyId,employeeId,leaveTypeId:'TEST type',startDate:date,endDate:date,totalDays:1}});
  await db.overtimeRequest.create({data:{companyId:user.companyId,branchId:user.branchId,employeeId,requestedStart:date,requestedEnd:new Date(date.getTime()+3600000)}});
  await db.employeeSchedule.create({data:{companyId:user.companyId,branchId:user.branchId,employeeId,workDate:date}});
  await db.attendanceCorrection.create({data:{companyId:user.companyId,employeeId,requestedById:employeeId==='own-employee'?user.sub:'peer-user',reason:'Synthetic TEST correction',proposedData:{workDate:'2026-10-07'}}});
  await db.employeeBiometricCredential.create({data:{companyId:user.companyId,employeeId,biometricType:'FINGERPRINT',deviceUserCode:employeeId}});
 }
});
after(async()=>{await database.close(db);});
test('legacy EMPLOYEE read grants and cashier/warehouse combinations retain personal authority; supervisors keep explicit authority',()=>{
 assert.equal(isPersonnelSelfOnly(user),true);assert.equal(isPersonnelSelfOnly({...user,roles:['EMPLOYEE','CASHIER','WAREHOUSE']}),true);
 assert.equal(isPersonnelSelfOnly({...user,roles:['WAREHOUSE'],permissions:['inventory.opname','attendance.record']}),true);
 assert.equal(isPersonnelSelfOnly(supervisor),false);assert.equal(isPersonnelSelfOnly({...user,roles:['EMPLOYEE','PAYROLL']}),false);
 assert.equal(isPersonnelSelfOnly({...user,roles:['EMPLOYEE','CUSTOM'],permissions:[...user.permissions,'employee.view']}),false);
});
test('leave and overtime reads are personal for employee and branch-wide for HR',async()=>{
 for(const list of [hr.listLeaveRequests.bind(hr),hr.listOvertimeRequests.bind(hr)]){const personal=await list(user);assert.equal(personal.length,1);assert.equal(personal[0].employeeId,'own-employee');assert.equal((await list(supervisor)).length,2);}
});
test('roster, attendance corrections and biometrics never enumerate a peer employee',async()=>{
 const lists=[()=>attendance.listSchedules(user,'2026-10-01','2026-10-31'),()=>attendance.listCorrections(user),()=>attendance.listBiometrics(user)];
 for(const list of lists){const rows=await list();assert.equal(rows.length,1);assert.equal(rows[0].employeeId,'own-employee');}
 assert.equal((await attendance.listSchedules(supervisor,'2026-10-01','2026-10-31')).length,2);assert.equal((await attendance.listCorrections(supervisor)).length,2);
});
test('explicit other employee filters/config/attendance mutation cannot widen personal authority and denial is audited',async()=>{
 for(const call of [()=>attendance.listSchedules(user,'2026-10-01','2026-10-31','peer-employee'),()=>attendance.listCorrections(user,undefined,'peer-employee'),()=>attendance.listBiometrics(user,'peer-employee'),()=>attendance.employeeConfig(user,'peer-employee')])await assert.rejects(call,/company dan branch/);
 await assert.rejects(()=>attendance.record(user,{employeeId:'peer-employee',eventType:'CHECK_IN',method:'MANUAL',idempotencyKey:'personal-spoof-event',occurredAt:'2026-10-07T08:00:00Z'}),/company dan branch/);
 assert.equal(await db.attendanceEvent.count(),0);assert.ok(await db.auditLog.count({where:{userId:user.sub,action:'TENANT_ACCESS_DENIED'}})>=4);
 assert.ok(await attendance.employeeConfig(user,'own-employee'));
});
test('branch payroll reads reject legacy employee grants before reading salaries, while HR keeps permitted branch reads',async()=>{
 for(const call of [()=>payroll.listRuns(user),()=>payroll.listRunResults('other-run',user),()=>payroll.employeeProfiles('peer-employee',user),()=>payroll.listLiabilities(user),()=>payroll.listPayments('other-run',user)])await assert.rejects(call,/Portal Karyawan/);
 assert.deepEqual(await payroll.listRuns(supervisor),[]);assert.equal(await db.payrollResult.count(),0);
});
test('attendance retry keys cannot expose peer events and warehouse personal recording cannot impersonate peers',async()=>{
 const event=await db.attendanceEvent.create({data:{companyId:user.companyId,branchId:user.branchId,employeeId:'peer-employee',eventType:'CHECK_IN',method:'MANUAL',occurredAt:date,operationId:'peer-attendance-operation'}});
 await assert.rejects(()=>attendance.record(user,{employeeId:'own-employee',eventType:'CHECK_IN',method:'MANUAL',occurredAt:date.toISOString(),operationId:event.operationId}),/company dan branch/);
 const warehouse={...user,roles:['WAREHOUSE'],permissions:['attendance.record','inventory.opname']};
 await assert.rejects(()=>attendance.record(warehouse,{employeeId:'peer-employee',eventType:'CHECK_IN',method:'MANUAL',occurredAt:date.toISOString()}),/company dan branch/);
 assert.equal(await db.attendanceEvent.count(),1);
});
test('personal attendance configuration consistently prefers the active branch policy over company fallback',async()=>{
 await db.attendancePolicy.create({data:{companyId:user.companyId,code:'COMPANY-TEST',name:'Synthetic company policy',allowedMethods:['MANUAL'],requirePhoto:false}});
 const branch=await db.attendancePolicy.create({data:{companyId:user.companyId,branchId:user.branchId,code:'BRANCH-TEST',name:'Synthetic branch policy',allowedMethods:['SELFIE_GPS'],requirePhoto:true}});
 const state=await attendance.employeeConfig(user,'own-employee');
 assert.equal(state.policy.id,branch.id);assert.equal(state.policy.requirePhoto,true);
});
