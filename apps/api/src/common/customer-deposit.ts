import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { normalizeTenderPolicy } from './tender-policy';

type Scope = { companyId: string; branchId: string };

export async function depositSettlement(tx: Prisma.TransactionClient, scope: Scope, accountCode: string, externalRef?: string) {
  const references = await tx.masterReference.findMany({ where: { companyId: scope.companyId, type: 'PAYMENT_METHOD', isActive: true, OR: [{ branchId: scope.branchId }, { branchId: null }] }, take: 100 });
  const selected = new Map<string, typeof references[number]>();
  for (const reference of references.filter(row=>!row.branchId)) selected.set(reference.code,reference);
  for (const reference of references.filter(row=>row.branchId===scope.branchId)) selected.set(reference.code,reference);
  for (const reference of selected.values()) {
    const policy = normalizeTenderPolicy(reference.code, reference.metadata);
    if (!['CASH','BANK'].includes(policy.kind) || policy.settlementAccountCode !== accountCode || policy.settlementBehavior !== 'IMMEDIATE' || policy.feeRatePercent || policy.requiresProvider) continue;
    if (policy.requiresReference && !externalRef?.trim()) throw new BadRequestException('Referensi settlement diperlukan untuk deposit ini.');
    return { code: reference.code, kind: policy.kind, accountCode };
  }
  throw new BadRequestException('Settlement deposit harus tender kas/bank immediate aktif tanpa fee/provider.');
}

export async function depositAccount(tx: Prisma.TransactionClient, scope: Scope, requireEnabled = true, historicalCode?: string) {
  const flags = await tx.featureFlag.findMany({ where: { companyId: scope.companyId, userId: null, key: 'customer_deposit', OR: [{ branchId: scope.branchId }, { branchId: null }] }, take: 3 });
  if (!historicalCode && (flags.filter((row) => row.branchId === scope.branchId).length > 1 || flags.filter((row) => row.branchId === null).length > 1)) throw new BadRequestException('Konfigurasi deposit ambigu.');
  const flag = flags.find((row) => row.branchId === scope.branchId) ?? flags.find((row) => row.branchId === null);
  const config = flag?.config as Record<string, unknown> | null;
  const code = historicalCode ?? (typeof config?.accountCode === 'string' ? config.accountCode : '');
  if ((requireEnabled && !flag?.enabled) || !code || code === '2105') throw new BadRequestException('Deposit belum aktif/dikonfigurasi dengan akun liability terpisah dari uang muka order.');
  const account = await tx.account.findFirst({ where: { code, branchId: scope.branchId, type: 'LIABILITY', isActive: true, branch: { companyId: scope.companyId } } });
  if (!account) throw new BadRequestException('Akun deposit harus liability aktif pada cabang ini.');
  if (requireEnabled) {
    const taxUse = await tx.taxCode.count({where:{companyId:scope.companyId,OR:[{payableAccountCode:code},{receivableAccountCode:code},{expenseAccountCode:code}]}});
    const otherUse = await tx.$queryRaw<Array<{ count: bigint | number }>>(Prisma.sql`SELECT COUNT(*) AS count FROM "JournalLine" jl WHERE jl."accountId" = ${account.id} AND NOT EXISTS (SELECT 1 FROM "AccountingEvent" e JOIN "AccountingEventLine" el ON el."accountingEventId" = e.id WHERE e."journalEntryId" = jl."journalEntryId" AND el."itemType" = 'CustomerDeposit')`);
    if (taxUse || Number(otherUse[0]?.count ?? 0)) throw new BadRequestException('Akun deposit harus khusus dan tidak digunakan jurnal/pajak domain lain.');
  }
  return account;
}

export async function customerDepositBalance(tx: Prisma.TransactionClient, scope: Scope, customerId: string, accountCode: string, excludeRefundId?: string) {
  const customer = await tx.customer.findFirst({ where: { id: customerId, companyId: scope.companyId }, select: { id: true } });
  if (!customer) throw new BadRequestException('Pelanggan deposit tidak tersedia pada perusahaan ini.');
  const rows = await tx.$queryRaw<Array<{ balance: Prisma.Decimal | number | string }>>(Prisma.sql`
    SELECT COALESCE(SUM(jl."credit" - jl."debit"), 0) AS balance
    FROM "JournalLine" jl JOIN "Account" a ON a.id = jl."accountId"
    JOIN "AccountingEvent" e ON e."journalEntryId" = jl."journalEntryId"
    WHERE e."companyId" = ${scope.companyId} AND e."branchId" = ${scope.branchId}
      AND e.status = 'POSTED' AND a."branchId" = ${scope.branchId} AND a.code = ${accountCode}
      AND EXISTS (SELECT 1 FROM "AccountingEventLine" el WHERE el."accountingEventId" = e.id
        AND el."itemType" = 'CustomerDeposit' AND el."itemId" = ${customerId})`);
  const posted = new Prisma.Decimal(rows[0]?.balance ?? 0).toDecimalPlaces(2);
  const holds = await tx.operationalFinanceTransaction.aggregate({ where: { ...scope, type: 'OTHER', counterpartyType: 'CUSTOMER', counterpartyId: customerId, referenceType: 'CustomerDepositRefund', debitAccountCode: accountCode, status: { in: ['DRAFT','WAITING_APPROVAL','APPROVED'] }, ...(excludeRefundId ? { id: { not: excludeRefundId } } : {}) }, _sum: { grossAmount: true } });
  const reserved = holds._sum.grossAmount ?? new Prisma.Decimal(0);
  return { posted, reserved, available: posted.sub(reserved).toDecimalPlaces(2) };
}

export async function reservedDepositAccounts(tx: Prisma.TransactionClient, scope: Scope) {
  const rows = await tx.$queryRaw<Array<{ code: string }>>(Prisma.sql`
    SELECT DISTINCT a.code FROM "Account" a JOIN "JournalLine" jl ON jl."accountId" = a.id
    JOIN "AccountingEvent" e ON e."journalEntryId" = jl."journalEntryId"
    WHERE a."branchId" = ${scope.branchId} AND a.type = 'LIABILITY' AND e."companyId" = ${scope.companyId}
      AND e."branchId" = ${scope.branchId} AND EXISTS (SELECT 1 FROM "AccountingEventLine" el
        WHERE el."accountingEventId" = e.id AND el."itemType" = 'CustomerDeposit')`);
  const flags = await tx.featureFlag.findMany({ where: { companyId: scope.companyId, userId: null, key: 'customer_deposit', OR: [{ branchId: scope.branchId }, { branchId: null }] }, take: 3 });
  const result = new Set(rows.map((row) => row.code));
  for (const flag of flags) { const config = flag.config as Record<string, unknown> | null; if (typeof config?.accountCode === 'string' && config.accountCode !== '2105') result.add(config.accountCode); }
  return result;
}
