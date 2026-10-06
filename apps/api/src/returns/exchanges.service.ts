import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { beginIdempotent, completeIdempotent } from '../common/idempotency';
import { decodeDateIdCursor, parsePageLimit, toCursorPage } from '../common/pagination';
import { retailAuthority, retailFeature, retailScope } from '../common/retail-feature';
import { inventoryLines } from '../common/retail-kit';
import { serializableTx } from '../common/serializable-tx';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';
import { StockAlertService } from '../sales/stock-alert.service';
import { CreateExchangeDto } from './dto/exchange.dto';
import { ReturnsService } from './returns.service';

@Injectable()
export class ExchangesService {
  constructor(private readonly prisma: PrismaService, private readonly returns: ReturnsService, private readonly sales: SalesService, private readonly stockAlerts: StockAlertService) {}

  async list(user: AuthUser, limitValue?: string, cursorValue?: string) {
    const scope = retailScope(user); const limit = parsePageLimit(limitValue);
    const cursor = decodeDateIdCursor(cursorValue);
    const rows = await this.prisma.retailExchange.findMany({ where: { ...scope, ...(cursor ? { OR: [{ createdAt: { lt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } }] } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
    return toCursorPage(rows, limit, (row) => ({ createdAt: row.createdAt.toISOString(), id: row.id }));
  }

  async create(dto: CreateExchangeDto, user: AuthUser) {
    retailAuthority(user, ['SUPER_ADMIN','OWNER','ADMIN'], ['sale.create','sale.return','sale.refund']);
    const scope = retailScope(user);
    if (!dto.operationKey?.trim() || dto.operationKey.length > 160) throw new BadRequestException('Operation key wajib, maksimal 160 karakter.');
    if (!Number.isFinite(dto.expectedDifference)) throw new BadRequestException('Selisih konfirmasi tidak valid.');
    const stockProducts = new Set<string>();
    const result = await serializableTx(this.prisma, async (tx) => {
      const gate = await beginIdempotent(tx, { companyId: scope.companyId, scope: `retail:exchange:${scope.branchId}`, key: dto.operationKey, payload: dto });
      if (gate.replay && gate.status === 'COMPLETED') return gate.response as Prisma.RetailExchangeGetPayload<Record<string, never>>;
      await retailFeature(tx, scope, 'retail_exchange');
      const row = await tx.saleReturn.findFirst({ where: { id: dto.saleReturnId }, include: { items: true } });
      const warehouse = row ? await tx.warehouse.findFirst({ where: { id: row.warehouseId, branchId: scope.branchId, branch: { companyId: scope.companyId } } }) : null;
      const sale = row && warehouse ? await tx.sale.findFirst({ where: { id: row.saleId, branchId: scope.branchId, branch: { companyId: scope.companyId } }, include: { payments: true } }) : null;
      if (!row || !warehouse || !sale) throw new NotFoundException('Retur tidak tersedia pada cabang ini.');
      if (await tx.retailExchange.findUnique({ where: { saleReturnId: row.id } })) throw new BadRequestException('Retur sudah ditukar.');
      if (!['REQUESTED','APPROVED'].includes(row.status)) throw new BadRequestException('Retur belum tersedia untuk tukar barang.');
      const shift = await tx.cashierShift.findFirst({ where: { id: dto.cashierShiftId, userId: user.sub, status: 'OPEN', user: { branchId: scope.branchId, branch: { companyId: scope.companyId } } } });
      if (!shift) throw new BadRequestException('Tukar tunai memerlukan shift aktif milik operator.');
      if (sale.payments.some((payment) => {
        const snapshot = payment.methodSnapshot as { policy?: { kind?: string } } | null;
        return (snapshot?.policy?.kind ?? (payment.method === 'CASH' ? 'CASH' : '')) !== 'CASH';
      }) || !sale.payments.length || !['CASH','ORIGINAL'].includes(row.refundMethod ?? 'ORIGINAL')) throw new BadRequestException('Tukar langsung saat ini memerlukan transaksi/refund tunai.');
      if (dto.replacement.payments || dto.replacement.onAccount || dto.replacement.onAccountAmount || (dto.replacement.paymentMethod && dto.replacement.paymentMethod !== 'CASH') || (dto.replacement.customerId && dto.replacement.customerId !== sale.customerId)) throw new BadRequestException('Pengganti harus tunai dan pelanggan asal; provider/piutang membutuhkan alur terpisah.');
      const confirmed = await this.returns.confirmSaleReturn(row.id, dto.confirmation, user, tx);
      const allocations = confirmed.refundDetails as unknown as Array<{ kind: string; amount: string }>;
      if (!allocations?.length || allocations.some((item) => item.kind !== 'CASH')) throw new BadRequestException('Tujuan refund harus kas.');
      const replacement = await this.sales.create({ ...dto.replacement, customerId: sale.customerId ?? undefined, paymentMethod: 'CASH', cashierShiftId: shift.id, idempotencyKey: `exchange:${scope.branchId}:${dto.operationKey}` }, user, { existingTx: tx });
      const refundAmount = new Prisma.Decimal(confirmed.refundAmount); const replacementAmount = new Prisma.Decimal(replacement.total);
      const difference = replacementAmount.sub(refundAmount).toDecimalPlaces(2);
      if (!difference.equals(new Prisma.Decimal(dto.expectedDifference))) throw new BadRequestException('Selisih harga berubah; tinjau quote dan konfirmasikan ulang.');
      const exchange = await tx.retailExchange.create({ data: { ...scope, saleReturnId: row.id, replacementSaleId: replacement.id, cashierShiftId: shift.id, refundAmount, replacementAmount, difference, operationKey: dto.operationKey, createdById: user.sub } });
      for (const item of replacement.items) for (const line of inventoryLines(item)) stockProducts.add(line.productId);
      await tx.eventOutbox.create({ data: { companyId: scope.companyId, eventType: 'retail.exchange.completed', aggregateType: 'RetailExchange', aggregateId: exchange.id, payload: { branchId: scope.branchId, saleReturnId: row.id, replacementSaleId: replacement.id } } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'RETAIL_EXCHANGE', entityType: 'RetailExchange', entityId: exchange.id, payload: { branchId: scope.branchId, difference: difference.toFixed(2) } } });
      await completeIdempotent(tx, { companyId: scope.companyId, scope: `retail:exchange:${scope.branchId}`, key: dto.operationKey, resourceType: 'RetailExchange', resourceId: exchange.id, response: exchange });
      return exchange;
    });
    try { if (stockProducts.size) await this.stockAlerts.alertLowStock(scope.companyId, scope.branchId, [...stockProducts], dto.replacement.warehouseId); } catch { /* canonical best-effort alert after commit */ }
    return result;
  }
}
