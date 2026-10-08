import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';

export function retailScope(user: AuthUser) {
  if (!user.companyId || !user.branchId) throw new ForbiddenException('Konteks company/cabang diperlukan.');
  return { companyId: user.companyId, branchId: user.branchId };
}

export function retailAuthority(user: AuthUser, roles: string[], permissions: string[]) {
  if (!user.roles.some((role) => roles.includes(role)) || (!user.roles.includes('SUPER_ADMIN') && !permissions.every((permission) => user.permissions.includes(permission)))) {
    throw new ForbiddenException('Izin operasi retail tidak tersedia.');
  }
}

export async function retailFeature(tx: Prisma.TransactionClient, scope: { companyId: string; branchId: string }, key: string) {
  const rows = await tx.featureFlag.findMany({ where: { companyId: scope.companyId, userId: null, key, OR: [{ branchId: scope.branchId }, { branchId: null }] }, take: 3 });
  if (rows.filter((row) => row.branchId === scope.branchId).length > 1 || rows.filter((row) => row.branchId === null).length > 1) throw new ForbiddenException(`Konfigurasi fitur ${key} ambigu.`);
  const flag = rows.find((row) => row.branchId === scope.branchId) ?? rows.find((row) => row.branchId === null);
  if (!flag?.enabled) throw new ForbiddenException(`Fitur ${key} belum aktif pada cabang ini.`);
  return flag.config && typeof flag.config === 'object' && !Array.isArray(flag.config) ? flag.config as Record<string, unknown> : {};
}
