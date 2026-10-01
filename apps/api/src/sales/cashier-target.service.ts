import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';

/**
 * T360-20260825 Fitur 5: target & progres kasir.
 * Target penjualan per kasir per hari disimpan di SystemSetting (namespace sales, key cashier_targets).
 * Progres real-time = total sale COMPLETED kasir hari ini vs target. Tanpa migrasi schema.
 */
type TargetMap = Record<string, number>; // userId -> target rupiah harian

const KEY = 'cashier_targets';

@Injectable()
export class CashierTargetService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadTargets(companyId: string): Promise<TargetMap> {
    const setting = await this.prisma.systemSetting.findFirst({
      where: { companyId, namespace: 'sales', key: KEY },
    });
    if (!setting) return {};
    return (typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value) as TargetMap;
  }

  async saveTargets(user: AuthUser, targets: TargetMap) {
    const clean: TargetMap = {};
    for (const [userId, value] of Object.entries(targets ?? {})) {
      const v = Number(value);
      if (!Number.isFinite(v) || v < 0) throw new BadRequestException(`Target tidak valid untuk user ${userId}.`);
      clean[userId] = Math.round(v);
    }
    const existing = await this.prisma.systemSetting.findFirst({ where: { companyId: user.companyId as string, namespace: 'sales', key: KEY } });
    const value = clean as unknown as import('@prisma/client').Prisma.InputJsonValue;
    if (existing) await this.prisma.systemSetting.update({ where: { id: existing.id }, data: { value, updatedAt: new Date() } });
    else await this.prisma.systemSetting.create({
      data: { companyId: user.companyId as string, branchId: user.branchId ?? null, namespace: 'sales', key: KEY, value },
    });
    return clean;
  }

  /** Progres semua kasir pada branch token (atau satu kasir bila self). */
  async progress(user: AuthUser) {
    const companyId = user.companyId as string;
    const targets = await this.loadTargets(companyId);
    const start = new Date(); start.setHours(0, 0, 0, 0);

    const cashiers = await this.prisma.user.findMany({
      where: { branchId: user.branchId ?? undefined, branch: { companyId }, isActive: true },
      select: { id: true, name: true },
      take: 100,
    });

    const rows = await Promise.all(cashiers.map(async (cashier) => {
      const agg = await this.prisma.sale.aggregate({
        where: { cashierShift: { userId: cashier.id }, status: 'COMPLETED', createdAt: { gte: start } },
        _sum: { total: true }, _count: true,
      });
      // fallback: sale tanpa shift juga dihitung via createdById-like field tidak ada — cukup shift-based
      const achieved = Number(agg._sum.total ?? 0);
      const target = targets[cashier.id] ?? 0;
      return {
        userId: cashier.id,
        name: cashier.name,
        target,
        achieved,
        transactions: agg._count,
        progressPct: target > 0 ? Math.min(999, Math.round((achieved / target) * 100)) : null,
        onTrack: target > 0 ? achieved >= target : null,
      };
    }));

    return { generatedAt: new Date().toISOString(), rows: rows.sort((a, b) => b.achieved - a.achieved) };
  }
}
