import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * T360-20260825 GROWTH PACK — Fitur 1: notifikasi stok menipis real-time.
 * Dipanggil dari sales.service setelah posting penjualan: bila available
 * produk <= minStock, buat Notification TELEGRAM (dedupe 1x per hari per produk).
 */

const DEDUPE_PREFIX = 'low-stock-alert';

@Injectable()
export class StockAlertService {
  constructor(private readonly prisma: PrismaService) {}

  /** Kirim alert untuk daftar productId yang baru saja terjual. Idempotent per hari+produk+gudang. */
  async alertLowStock(companyId: string, branchId: string | null, productIds: string[], warehouseId: string) {
    if (!productIds.length) return { alerted: [] as string[] };
    const recipients = await this.digestRecipients(companyId);
    if (!recipients.length) return { alerted: [] as string[] };

    const todayKey = new Date().toISOString().slice(0, 10);
    // Bandingkan langsung terhadap minStock tiap produk (bukan ambang keras),
    // supaya produk dengan minimum stok tinggi juga terdeteksi.
    const inventories = await this.prisma.inventory.findMany({
      where: { warehouseId, productId: { in: productIds } },
      select: { available: true, productId: true, product: { select: { name: true, sku: true, minStock: true } } },
    });
    const breached = inventories.filter((inv) => inv.available <= inv.product.minStock);
    const alerted: string[] = [];

    for (const inv of breached) {
      for (const recipient of recipients) {
        const dedupeKey = `${DEDUPE_PREFIX}:${companyId}:${warehouseId}:${inv.productId}:${todayKey}`;
        const duplicate = await this.prisma.notification.findFirst({
          where: { companyId, channel: 'TELEGRAM', recipient, templateCode: dedupeKey },
        });
        if (duplicate) continue;
        await this.prisma.notification.create({
          data: {
            companyId,
            channel: 'TELEGRAM',
            recipient,
            templateCode: dedupeKey,
            subject: `Stok menipis: ${inv.product.name}`,
            body: `⚠️ STOK MENIPIS — ${inv.product.name} (${inv.product.sku})\nSisa ${inv.available} pcs di gudang (minimum ${inv.product.minStock}).\nSegera restock sebelum kehabisan.`,
          },
        });
      }
      alerted.push(inv.productId);
    }
    return { alerted };
  }

  private async digestRecipients(companyId: string): Promise<string[]> {
    // pakai konfigurasi penerima yang sama dengan laporan harian
    const setting = await this.prisma.systemSetting.findFirst({
      where: { companyId, namespace: 'reports', key: 'daily_digest' },
    });
    if (!setting) return [];
    try {
      const parsed = typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value;
      return Array.isArray(parsed?.recipients) ? parsed.recipients.filter((r: unknown): r is string => typeof r === 'string') : [];
    } catch { return []; }
  }
}
