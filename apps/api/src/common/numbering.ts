// Atomic document numbering service (w0-atomic-number-sequence).
import { Prisma, PrismaClient } from '@prisma/client';

type DbClient = Prisma.TransactionClient | PrismaClient;

async function resolveDocumentScopeCode(
  tx: DbClient,
  companyId: string,
  branchId?: string | null,
): Promise<string> {
  if (branchId) {
    const branch = await tx.branch.findFirst({
      where: { id: branchId, companyId },
      select: { code: true },
    });
    if (!branch) throw new Error('Branch nomor dokumen tidak ditemukan pada company yang diminta.');
    return branch.code;
  }

  const company = await tx.company.findUnique({
    where: { id: companyId },
    select: { slug: true },
  });
  if (!company) throw new Error('Company nomor dokumen tidak ditemukan.');
  return company.slug?.trim() || companyId;
}

function formatNumber(prefix: string, scopeCode: string, now: Date, seq: number, padding: number): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${prefix}-${scopeCode}-${yyyy}${mm}-${String(seq).padStart(padding, '0')}`;
}

/**
 * Ambil nomor dokumen berikutnya secara ATOMIK per company/branch/documentType.
 * WAJIB dipanggil di dalam transaksi yang sama dengan pembuatan dokumen.
 *
 * Nomor user-facing membawa branch code (atau company slug/id untuk sequence tanpa branch)
 * karena sequence memang tenant-scoped sementara banyak kolom nomor transaksi memiliki
 * unique constraint global. Dengan demikian sequence 000001 dari dua tenant tidak dapat
 * menghasilkan nomor bisnis global yang sama.
 *
 * Atomicity:
 * - PostgreSQL (production): transaksi default READ COMMITTED; dua transaksi bersamaan
 *   yang membaca nextNumber sama akan gagal salah satunya pada CAS updateMany
 *   (nextNumber sudah berubah) dan dapat di-retry pemanggil.
 * - SQLite (dev lokal): transaction serializable menjamin eksklusif.
 * - Fallback kompatibilitas lama (random) tetap tersedia via documentNumber().
 */
export async function nextDocumentNumber(
  tx: DbClient,
  opts: {
    companyId: string;
    branchId?: string | null;
    documentType: string;
    prefix: string;
    padding?: number;
    resetPolicy?: 'MONTHLY' | 'YEARLY' | 'NEVER';
  },
): Promise<string> {
  const now = new Date();
  const period = opts.resetPolicy === 'NEVER'
    ? 'ALL'
    : opts.resetPolicy === 'YEARLY'
      ? String(now.getUTCFullYear())
      : `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const scopeCode = await resolveDocumentScopeCode(tx, opts.companyId, opts.branchId);

  // Cari row sequence (findFirst karena compound unique tidak mendukung null secara type-safe)
  let row = await tx.numberSequence.findFirst({
    where: { companyId: opts.companyId, branchId: opts.branchId ?? null, documentType: opts.documentType },
  });
  if (!row) {
    row = await tx.numberSequence.create({
      data: { companyId: opts.companyId, branchId: opts.branchId ?? null, documentType: opts.documentType, prefix: opts.prefix, nextNumber: 1, resetPolicy: opts.resetPolicy ?? 'MONTHLY', lastResetAt: now },
    });
  }

  let current = row.nextNumber;
  if (period !== 'ALL' && row.lastResetAt) {
    const rowPeriod = opts.resetPolicy === 'YEARLY'
      ? String(row.lastResetAt.getUTCFullYear())
      : `${row.lastResetAt.getUTCFullYear()}${String(row.lastResetAt.getUTCMonth() + 1).padStart(2, '0')}`;
    if (rowPeriod !== period) current = 1;
  }

  // CAS increment: updateMany guarded mencegah double-assign saat race
  const bumped = await tx.numberSequence.updateMany({
    where: { id: row.id, nextNumber: current },
    data: { nextNumber: current + 1, lastResetAt: now },
  });
  if (bumped.count !== 1) throw new Error(`Konflik sequence ${opts.documentType}; ulangi transaksi.`);

  return formatNumber(opts.prefix, scopeCode, now, current, opts.padding ?? 6);
}

/** Legacy fallback (random) — dipertahankan untuk konteks tanpa tenant. */
export function documentNumber(prefix: string): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replaceAll('-', '');
  const random = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${date}-${random}`;
}
