import { Controller, Get, Header, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { retailScope } from '../common/retail-feature';
import { mintReceiptShare, verifyReceiptShare } from '../common/receipt-access';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * T360-20260825 GROWTH PACK — Fitur 2: struk digital via link/QR.
 * Signed tenant-bound receipt: GET /receipts/:saleNumber?share=...
 * Render HTML ringan (mobile-friendly) untuk dibuka dari scan QR di kasir.
 * Tidak menampilkan biaya (unitCost), hanya sisi pelanggan.
 */

@ApiTags('receipts')
@Controller()
export class ReceiptController {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  @ApiBearerAuth()
  @Roles('SUPER_ADMIN','OWNER','ADMIN','CASHIER','FINANCE')
  @Permissions('sale.view')
  @Get('sales/:saleNumber/receipt-link')
  async share(@Param('saleNumber') saleNumber: string, @CurrentUser() user: AuthUser) {
    const scope = retailScope(user);
    const sale = await this.prisma.sale.findFirst({ where: { number: saleNumber, branchId: scope.branchId, branch: { companyId: scope.companyId } }, select: { id: true, number: true, branchId: true } });
    if (!sale) throw new NotFoundException('Struk tidak tersedia.');
    const token = mintReceiptShare(sale, scope.companyId, this.config.get<string>('RECEIPT_SIGNING_KEY') ?? this.config.get<string>('JWT_SECRET') ?? '');
    return { path: `/receipts/${encodeURIComponent(sale.number)}?share=${encodeURIComponent(token)}`, expiresIn: 3600 };
  }

  @Public()
  @ApiQuery({ name: 'share', required: true })
  @Get('receipts/:saleNumber')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async receipt(@Param('saleNumber') saleNumber: string, @Query('share') share?: string) {
    const claims = verifyReceiptShare(share, saleNumber, this.config.get<string>('RECEIPT_SIGNING_KEY') ?? this.config.get<string>('JWT_SECRET') ?? '');
    if (!claims) throw new NotFoundException('Struk tidak tersedia.');
    const sale = await this.prisma.sale.findFirst({
      where: { id: claims.s, number: claims.n, branchId: claims.b, branch: { companyId: claims.c } },
      select: {
        number: true, status: true, subtotal: true, discount: true, tax: true, total: true,
        createdAt: true,
        branch: { select: { name: true, address: true } },
        items: {
          select: { quantity: true, unitPrice: true, netSubtotal: true, product: { select: { name: true, sku: true } } },
          orderBy: { id: 'asc' as const },
        },
      },
    });
    if (!sale) {
      // tetap balas halaman ramah-HP, bukan JSON error mentah
      throw new NotFoundException(page(`Struk ${esc(saleNumber)}`, `<p class="err">Struk dengan nomor ${esc(saleNumber)} tidak ada.</p>`));
    }

    const rows = sale.items.map((it) => `
      <tr>
        <td>${esc(it.product.name)}<div class="sku">${esc(it.product.sku)}</div></td>
        <td class="num">${it.quantity} × ${fmt(it.unitPrice)}</td>
        <td class="num strong">${fmt(it.netSubtotal)}</td>
      </tr>`).join('');

    // T360-20260829 value pack 2 — bagikan struk via WhatsApp + cetak.
    const configured = this.config.get<string>('PUBLIC_API_URL');
    let base: URL | null = null;
    try { base = configured ? new URL(configured) : null; } catch { /* fail closed on sharing origin */ }
    const trustedBase = base && !base.username && !base.password && !base.search && !base.hash && (base.protocol === 'https:' || (base.protocol === 'http:' && ['localhost','127.0.0.1'].includes(base.hostname) && this.config.get<string>('NODE_ENV') !== 'production')) ? base.href.replace(/\/$/, '') : null;
    const receiptUrl = trustedBase ? `${trustedBase}/receipts/${encodeURIComponent(sale.number)}?share=${encodeURIComponent(share!)}` : null;
    const shareText = `Struk ${sale.number} — ${fmt(sale.total)} dari ${sale.branch.name}\n${receiptUrl}`;
    const body = `
      <div class="head">
        <h1>${esc(sale.branch.name)}</h1>
        ${sale.branch.address ? `<div>${esc(sale.branch.address)}</div>` : ''}
      </div>
      <div class="meta">
        <div><span>No. Struk</span><b>${esc(sale.number)}</b></div>
        <div><span>Tanggal</span><b>${new Date(sale.createdAt).toLocaleString('id-ID')}</b></div>
        <div><span>Status</span><b>${esc(sale.status)}</b></div>
      </div>
      <table>${rows}</table>
      <div class="totals">
        <div><span>Subtotal</span><b>${fmt(sale.subtotal)}</b></div>
        ${gtZero(sale.discount) ? `<div><span>Diskon</span><b>−${fmt(sale.discount)}</b></div>` : ''}
        ${gtZero(sale.tax) ? `<div><span>Pajak</span><b>${fmt(sale.tax)}</b></div>` : ''}
        <div class="grand"><span>TOTAL</span><b>${fmt(sale.total)}</b></div>
      </div>
      <p class="thanks">Terima kasih telah berbelanja 🙏</p>
      <div class="share no-print">
        ${receiptUrl ? `<a class="btn" href="https://wa.me/?text=${encodeURIComponent(shareText)}" target="_blank" rel="noopener noreferrer">Bagikan via WhatsApp</a>` : '<span class="sku">Tautan berbagi belum tersedia. Hubungi admin.</span>'}
        <button class="btn secondary" type="button" onclick="window.print()">Cetak</button>
      </div>`;
    return page(`Struk ${sale.number}`, body);
  }
}

const fmt = (v: unknown) => 'Rp ' + Number(v ?? 0).toLocaleString('id-ID');
const gtZero = (v: unknown) => Number(v ?? 0) > 0;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function page(title: string, body: string): string {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#f4f5fb;margin:0;color:#111827}
  .card{max-width:420px;margin:24px auto;background:#fff;border-radius:16px;box-shadow:0 8px 30px rgba(15,23,42,.08);padding:24px}
  h1{margin:0 0 4px;font-size:20px;color:#4f46e5}
  .head{border-bottom:2px dashed #e5e7eb;padding-bottom:12px;margin-bottom:12px}
  .head div{color:#6b7280;font-size:12px}
  .meta{display:flex;flex-direction:column;gap:4px;font-size:13px;margin-bottom:12px}
  .meta div{display:flex;justify-content:space-between}
  .meta span{color:#6b7280}
  table{width:100%;border-collapse:collapse;font-size:14px}
  td{padding:8px 0;border-bottom:1px solid #f3f4f6;vertical-align:top}
  .num{text-align:right;white-space:nowrap}
  .strong{font-weight:600}
  .sku{font-size:11px;color:#9ca3af}
  .totals{margin-top:12px;font-size:14px;display:flex;flex-direction:column;gap:6px}
  .totals div{display:flex;justify-content:space-between}
  .grand{border-top:2px dashed #e5e7eb;padding-top:10px;font-size:17px;font-weight:700;color:#4f46e5}
  .thanks{text-align:center;color:#9ca3af;font-size:12px;margin-top:18px}
  .err{text-align:center;color:#dc2626;padding:24px 0}
  .share{display:flex;gap:8px;margin-top:16px}
  .btn{flex:1;display:inline-block;text-align:center;padding:10px 12px;border-radius:10px;border:0;background:#4f46e5;color:#fff;font-size:13px;font-weight:600;text-decoration:none;cursor:pointer}
  .btn.secondary{background:#eef2ff;color:#4f46e5}
  @media print{ body{background:#fff} .card{box-shadow:none;margin:0;max-width:none} .no-print{display:none} }
</style></head><body><div class="card">${body}</div></body></html>`;
}
