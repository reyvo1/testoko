import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';

// POST-1C — Telegram identity resolution and mobile stock-opname drafts.
//
// Everything security-relevant in POST-1C is in this one file, because the roadmap's invariants are
// all of the same shape: a chat id must not be able to become a permission.
//
// The resolution path is deliberately short and total:
//
//     platformUserId -> TelegramIdentityBinding -> Employee -> company/branch/permissions
//
// There is no branch that skips a step. A payload that names a company, a branch, or a permission is
// ignored on arrival — the values used are always read from the binding and the employee behind it.
// That is what makes "no direct database writes from bot handlers" a structural property rather than
// a rule someone has to remember.
//
// Two things this file deliberately does NOT do:
//
//   - it does not call the Telegram API. Nothing here sends a message; this resolves an identity that
//     something else has already been told about. That keeps the security surface testable without a
//     network dependency and without adding an SDK to the lockfile.
//   - it does not post inventory. A mobile draft is a draft. Counting posts through the existing
//     canonical StockOpname lifecycle, which is untouched by this wave.

@Injectable()
export class MobileOpsService {
  private readonly logger = new Logger(MobileOpsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private tenant(user: AuthUser) {
    if (!user.companyId) throw new ForbiddenException('Operasional mobile harus punya tenant.');
    return user.companyId;
  }

  // ---------------------------------------------------------------- binding

  // Bind a platform identity to an employee. Both sides are looked up, never taken from the request:
  // a binding created against someone else's employee id is a privilege escalation, so the employee
  // must belong to the caller's tenant.
  async bindIdentity(user: AuthUser, dto: { employeeId: string; platformUserId: string; platformChatId?: string; displayName?: string }) {
    const companyId = this.tenant(user);
    if (!dto.platformUserId?.trim()) throw new BadRequestException('platformUserId wajib diisi.');
    const employee = await this.prisma.employee.findFirst({ where: { id: dto.employeeId, companyId } });
    if (!employee) throw new NotFoundException('Employee tidak ditemukan pada tenant ini.');
    if (employee.terminationDate) {
      throw new ForbiddenException('Employee sudah berhenti; tidak dapat diikat ke kanal Telegram.');
    }
    const existing = await this.prisma.telegramIdentityBinding.findFirst({ where: { platformUserId: dto.platformUserId } });
    if (existing && existing.employeeId !== employee.id && existing.isActive) {
      // One platform identity, one employee. Two active bindings would mean a shared phone, which is
      // how one person quietly operates as two people with two sets of permissions.
      throw new ForbiddenException('Platform identity ini sudah terikat ke employee lain pada tenant ini.');
    }
    const saved = await this.prisma.telegramIdentityBinding.upsert({
      where: { platformUserId: dto.platformUserId },
      create: { companyId, employeeId: employee.id, platformUserId: dto.platformUserId.trim(), platformChatId: dto.platformChatId ?? null, displayName: dto.displayName ?? null },
      update: { companyId, employeeId: employee.id, isActive: true, revokedAt: null, revokedReason: null, platformChatId: dto.platformChatId ?? null, displayName: dto.displayName ?? null },
    });
    await this.prisma.auditLog.create({
      data: { companyId, userId: user.sub, action: 'TELEGRAM_IDENTITY_BOUND', entityType: 'TelegramIdentityBinding', entityId: saved.id, payload: { employeeId: employee.id, displayName: dto.displayName ?? null } },
    });
    return { id: saved.id, employeeId: saved.employeeId, displayName: saved.displayName, isActive: saved.isActive };
  }

  // Revocation is addressed by the binding's own row id, not by the platform identity. The operator
  // screen deliberately never receives platformUserId — it is credential-adjacent — so a revoke
  // keyed on it could only be driven by an id the UI is not allowed to hold, and every call would
  // 404. The tenant scope is unchanged: a binding id from another company still resolves to nothing.
  async revokeBinding(user: AuthUser, bindingId: string, reason: string) {
    const companyId = this.tenant(user);
    if (!bindingId?.trim()) throw new BadRequestException('bindingId wajib diisi.');
    if (!reason?.trim()) throw new BadRequestException('Pencabutan binding wajib disertai alasan.');
    const binding = await this.prisma.telegramIdentityBinding.findFirst({ where: { id: bindingId, companyId } });
    if (!binding) throw new NotFoundException('Binding tidak ditemukan pada tenant ini.');
    const revoked = await this.prisma.telegramIdentityBinding.update({
      where: { id: binding.id }, data: { isActive: false, revokedAt: new Date(), revokedReason: reason.trim() },
    });
    await this.prisma.auditLog.create({
      data: { companyId, userId: user.sub, action: 'TELEGRAM_IDENTITY_REVOKED', entityType: 'TelegramIdentityBinding', entityId: binding.id, payload: { reason: reason.trim() } },
    });
    return { id: revoked.id, isActive: revoked.isActive, revokedAt: revoked.revokedAt };
  }

  // The whole security model in one method: a platform id resolves to an employee, or to nothing.
  //
  // Role and permission come from the same join tables the API guard uses (UserRole -> Role ->
  // RolePermission -> Permission). Reimplementing the lookup would create a second, quietly divergent
  // definition of what someone may do, and the divergence would only surface as a security incident.
  async resolveIdentity(platformUserId: string) {
    if (!platformUserId?.trim()) return null;
    const binding = await this.prisma.telegramIdentityBinding.findFirst({ where: { platformUserId: platformUserId.trim(), isActive: true } });
    if (!binding) return null;
    // A binding outlives the employment it was made for, so the employee has to be re-checked on
    // every resolution. Revoking the binding alone is not enough.
    const employee = await this.prisma.employee.findFirst({ where: { id: binding.employeeId, companyId: binding.companyId } });
    if (!employee) return null;
    if (employee.terminationDate) {
      this.logger.warn(`Telegram identity ${platformUserId} resolves to a terminated employee; refusing.`);
      return null;
    }
    const user = employee.userId
      ? await this.prisma.user.findFirst({
        where: { id: employee.userId, isActive: true },
        include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
      })
      : null;
    const roles = (user?.roles ?? []).map((r) => r.role.name);
    const permissions = [...new Set((user?.roles ?? []).flatMap((r) => r.role.permissions.map((p) => p.permission.code)))];
    // A successful resolution is the only trustworthy evidence that a binding was actually used. The
    // operator screen reads lastUsedAt, and nothing else in this file could supply it — so without this
    // write the column stays null forever and every row reads "belum pernah" while the identity is in
    // daily use. That is the "column exists, default looks correct, nobody writes it" failure: it is
    // invisible to every gate because nothing throws.
    //
    // Deliberately a separate statement, not part of the lookups above, for two reasons: a resolution
    // must succeed even if this bookkeeping write fails, and it must never be able to change WHICH
    // identity resolved. best-effort is the right trade for an observability column — losing one
    // timestamp is survivable, failing a command because a timestamp could not be stored is not.
    await this.prisma.telegramIdentityBinding
      .update({ where: { id: binding.id }, data: { lastUsedAt: new Date() } })
      .catch((error: unknown) => this.logger.warn(`Gagal menulis lastUsedAt untuk binding ${binding.id}: ${String(error)}`));
    return {
      bindingId: binding.id,
      employeeId: employee.id,
      employeeName: employee.fullName,
      companyId: binding.companyId,
      // Branch is the employee's, not the chat's: an employee scoped to one branch cannot act in another.
      branchId: employee.branchId,
      roles,
      permissions,
      userId: employee.userId,
    };
  }

  // Assert a resolved identity holds a permission. Called by every command handler; returning a
  // decision rather than a boolean keeps the refusal reason with the decision.
  async assertPermission(platformUserId: string, permission: string) {
    const identity = await this.resolveIdentity(platformUserId);
    if (!identity) {
      throw new ForbiddenException('Identitas Telegram tidak terikat ke employee aktif. Perintah ditolak.');
    }
    // SUPER_ADMIN is the same bypass the API guard uses; a second definition here would diverge.
    const isSuperAdmin = identity.roles.some((r) => r.toUpperCase() === 'SUPER_ADMIN');
    if (!isSuperAdmin && !identity.permissions.includes(permission)) {
      throw new ForbiddenException(`Employee tidak memiliki izin ${permission}.`);
    }
    return identity;
  }

  /**
   * Resolve a barcode or SKU to an active product for the caller's tenant.
   *
   * Added with the Telegram command surface, which is the first caller that needs to answer "what does
   * this scan say?" from a chat. Tenant-scoped on the same `companyId` the rest of this file uses, and
   * inactive products are excluded: a lookup that returned a discontinued product would let a count
   * name something the canonical opname can never contain.
   *
   * Cost price is deliberately not selected. Nothing on a customer- or operator-facing surface needs
   * it, and a field that exists here is a field that can leak later.
   */
  async findProductForLookup(user: AuthUser, code: string) {
    const companyId = this.tenant(user);
    const needle = code?.trim();
    if (!needle) return null;
    return this.prisma.product.findFirst({
      where: { companyId, isActive: true, OR: [{ barcode: needle }, { sku: needle }] },
      select: { id: true, name: true, sku: true, barcode: true, unit: true, salePrice: true },
    });
  }

  async listBindings(user: AuthUser) {
    const companyId = this.tenant(user);
    return this.prisma.telegramIdentityBinding.findMany({
      where: { companyId }, orderBy: { createdAt: 'desc' },
      select: { id: true, employeeId: true, displayName: true, isActive: true, revokedAt: true, revokedReason: true, lastUsedAt: true, createdAt: true },
      // platformUserId is intentionally not returned: this is an operator screen, and a chat id there
      // is a credential-adjacent value with no reason to be on it.
    });
  }

  // ---------------------------------------------------------------- mobile drafts

  // Open or resume a draft. The unique key (device, warehouse, location, status) means a second scan
  // on the same device reopens the same draft instead of silently starting a second count.
  async openDraft(user: AuthUser, dto: { deviceId: string; warehouseId: string; locationId?: string; opnameId?: string }) {
    const companyId = this.tenant(user);
    if (!dto.deviceId?.trim()) throw new BadRequestException('deviceId wajib diisi; draft terikat perangkat.');
    // Warehouse carries no companyId — the tenant arrives through its branch. Filtering on the branch's
    // company is what actually scopes this to the caller's tenant.
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: dto.warehouseId, branch: { companyId } },
      select: { id: true, branchId: true },
    });
    if (!warehouse) throw new NotFoundException('Gudang tidak ditemukan pada tenant ini.');
    const existing = await this.prisma.mobileOpnameDraft.findFirst({
      where: { deviceId: dto.deviceId, warehouseId: dto.warehouseId, locationId: dto.locationId ?? null, status: 'OPEN' },
    });
    if (existing) {
      // Resume, not restart. Returning the stored lines is the entire point of a resumable count.
      //
      // But the resume path used to ignore the opnameId the caller passed, so a draft opened before
      // a StockOpname existed could never be attached to one afterwards: it stayed opname-less for
      // life, reviewDiscrepancy had no snapshot to compare against, and every line read
      // system=null. A device that is handed the opname on its second scan is the normal case — the
      // count starts before a supervisor opens the canonical count, and that is exactly when the
      // supervisor hands it over. So fill it in when it is missing.
      let draft = existing;
      if (!existing.opnameId && dto.opnameId) {
        const attached = await this.prisma.mobileOpnameDraft.update({
          where: { id: existing.id },
          data: { opnameId: dto.opnameId },
          select: { id: true, opnameId: true },
        });
        draft = { ...existing, opnameId: attached.opnameId };
      }
      return { id: draft.id, resumed: true, status: draft.status, opnameId: draft.opnameId, lineCount: this.lineCount(draft.lines), lastScannedAt: draft.lastScannedAt };
    }
    const created = await this.prisma.mobileOpnameDraft.create({
      data: { companyId, employeeId: user.sub, deviceId: dto.deviceId, warehouseId: dto.warehouseId, locationId: dto.locationId ?? null, opnameId: dto.opnameId ?? null, lines: [], deviceLocalAt: new Date() },
    });
    return { id: created.id, resumed: false, status: created.status, opnameId: created.opnameId, lineCount: 0, lastScannedAt: null };
  }

  // Append a scan. Repeating the same barcode increments the existing line rather than appending a
  // duplicate: a hundred counts of the same unit is a hundred units, not a hundred lines.
  async addScan(user: AuthUser, draftId: string, dto: { barcode?: string; sku?: string; quantity: number; unit?: string; note?: string }) {
    const companyId = this.tenant(user);
    if (!Number.isFinite(dto.quantity) || dto.quantity <= 0) {
      throw new BadRequestException('Kuantitas hasil hitung harus bilangan positif.');
    }
    if (!dto.barcode?.trim() && !dto.sku?.trim()) {
      throw new BadRequestException('Scan harus membawa barcode atau SKU.');
    }
    const draft = await this.prisma.mobileOpnameDraft.findFirst({ where: { id: draftId, companyId } });
    if (!draft) throw new NotFoundException('Draft tidak ditemukan pada tenant ini.');
    if (draft.status !== 'OPEN') throw new BadRequestException(`Draft berstatus ${draft.status}; tidak dapat ditambah.`);

    const lines = this.linesOf(draft.lines);
    const key = (dto.barcode ?? dto.sku ?? '').trim();
    const existing = lines.find((l) => l.key === key);
    if (existing) existing.quantity += dto.quantity;
    else lines.push({ key, barcode: dto.barcode?.trim() ?? null, sku: dto.sku?.trim() ?? null, quantity: dto.quantity, unit: dto.unit ?? null, note: dto.note ?? null });

    const saved = await this.prisma.mobileOpnameDraft.update({
      where: { id: draft.id }, data: { lines: lines as object, lastScannedAt: new Date() },
    });
    return { id: saved.id, status: saved.status, lineCount: lines.length, totalUnits: lines.reduce((sum, l) => sum + l.quantity, 0) };
  }

  // Every draft on this tenant, newest first. This is the supervision surface: without it the only way
  // to reach a draft is to already know its id, so a count taken on a device could sit OPEN forever
  // with nobody aware of it. Scoped by company on every query, and the line count is reported so an
  // operator can see which drafts are worth opening — `lines` itself is a device-local Json payload
  // and is deliberately not projected here.
  async listDrafts(user: AuthUser, status?: 'OPEN' | 'SUBMITTED' | 'DISCARDED', warehouseId?: string) {
    const companyId = this.tenant(user);
    const drafts = await this.prisma.mobileOpnameDraft.findMany({
      where: {
        companyId,
        ...(status ? { status } : {}),
        // Warehouse carries no companyId, so the tenant check has to go through its branch — same rule
        // openDraft applies, and applying it here too keeps the filter from becoming a cross-tenant read.
        ...(warehouseId ? { warehouse: { branch: { companyId } } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      select: {
        id: true, deviceId: true, warehouseId: true, locationId: true, opnameId: true,
        status: true, lastScannedAt: true, deviceLocalAt: true, createdAt: true, updatedAt: true, lines: true,
      },
    });
    const warehouseIds = [...new Set(drafts.map((d) => d.warehouseId))];
    const warehouses = warehouseIds.length
      ? await this.prisma.warehouse.findMany({ where: { id: { in: warehouseIds } }, select: { id: true, name: true, code: true } })
      : [];
    const warehouseById = new Map(warehouses.map((w) => [w.id, w]));
    const rows = drafts.map((draft) => ({
      id: draft.id,
      deviceId: draft.deviceId,
      warehouseId: draft.warehouseId,
      warehouseName: warehouseById.get(draft.warehouseId)?.name ?? null,
      warehouseCode: warehouseById.get(draft.warehouseId)?.code ?? null,
      locationId: draft.locationId,
      opnameId: draft.opnameId,
      status: draft.status,
      lineCount: this.lineCount(draft.lines),
      lastScannedAt: draft.lastScannedAt,
      deviceLocalAt: draft.deviceLocalAt,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      // A draft with an opname is filed; one without is still waiting for a supervisor to point it at a
      // canonical count. That distinction is what the operator is scanning this list for.
      awaitingFiling: draft.status === 'OPEN' && !draft.opnameId,
    }));
    return {
      rows,
      counts: {
        total: rows.length,
        open: rows.filter((r) => r.status === 'OPEN').length,
        submitted: rows.filter((r) => r.status === 'SUBMITTED').length,
        discarded: rows.filter((r) => r.status === 'DISCARDED').length,
        awaitingFiling: rows.filter((r) => r.awaitingFiling).length,
      },
      note: 'Draft OPEN tanpa opnameId belum filed ke penghitungan kanonik. Penyesuaian inventory tetap lewat alur StockOpname dengan persetujuan.',
    };
  }

  async getDraft(user: AuthUser, draftId: string) {
    const companyId = this.tenant(user);
    const draft = await this.prisma.mobileOpnameDraft.findFirst({ where: { id: draftId, companyId } });
    if (!draft) throw new NotFoundException('Draft tidak ditemukan pada tenant ini.');
    return { ...draft, lineCount: this.lineCount(draft.lines) };
  }

  // Discrepancy review: what the device counted against what the system believes.
  //
  // "System believes" is the opname's own snapshot (`StockOpnameItem.systemQty`), captured when the
  // count was opened — not the live Inventory row. Comparing against live stock would let a count that
  // started last week silently be measured against today's numbers, and the difference shown to the
  // operator would be two different questions. When the draft is not attached to an opname there is
  // no snapshot yet, so `system` is null and the row is reported as uncounted-against rather than
  // pretending a difference of zero.
  //
  // Reported, never adjusted: turning a difference into stock stays the canonical approval flow's job.
  async reviewDiscrepancy(user: AuthUser, draftId: string) {
    const companyId = this.tenant(user);
    const draft = await this.prisma.mobileOpnameDraft.findFirst({ where: { id: draftId, companyId } });
    if (!draft) throw new NotFoundException('Draft tidak ditemukan pada tenant ini.');
    const lines = this.linesOf(draft.lines);
    const barcodes = lines.map((l) => l.barcode).filter((b): b is string => Boolean(b));
    const products = await this.prisma.product.findMany({
      where: { companyId, OR: [{ barcode: { in: barcodes } }, ...(lines.some((l) => l.sku) ? [{ sku: { in: lines.map((l) => l.sku).filter((s): s is string => Boolean(s)) } }] : [])] },
      select: { id: true, name: true, barcode: true, sku: true },
    });
    const byBarcode = new Map(products.filter((p) => p.barcode).map((p) => [p.barcode as string, p]));
    const bySku = new Map(products.filter((p) => p.sku).map((p) => [p.sku as string, p]));

    // The snapshot to measure against, when the draft is already filed under an opname.
    const snapshot = draft.opnameId
      ? await this.prisma.stockOpnameItem.findMany({ where: { opnameId: draft.opnameId }, select: { productId: true, batchNumber: true, systemQty: true } })
      : [];
    // A batch-tracked product occupies one row per batch; a phone counts the product, not the batch.
    // Summing the batches is what makes the comparison mean the same thing on both sides.
    const systemByProduct = new Map<string, number>();
    for (const item of snapshot) {
      systemByProduct.set(item.productId, (systemByProduct.get(item.productId) ?? 0) + item.systemQty);
    }

    const rows = lines.map((l) => {
      const product = (l.barcode ? byBarcode.get(l.barcode) : undefined) ?? (l.sku ? bySku.get(l.sku) : undefined);
      const system = product ? systemByProduct.get(product.id) ?? null : null;
      const counted = l.quantity;
      // difference stays null when there is nothing to compare against, so "not counted yet" can never
      // be mistaken for "counted and matched".
      const difference = system === null ? null : counted - system;
      return {
        key: l.key,
        productId: product?.id ?? null,
        productName: product?.name ?? null,
        sku: l.sku,
        unit: l.unit,
        counted,
        system,
        difference,
        matched: difference === 0,
        resolved: Boolean(product),
        note: l.note,
      };
    });
    const compared = rows.filter((r) => r.difference !== null);
    return {
      draftId: draft.id,
      status: draft.status,
      opnameId: draft.opnameId ?? null,
      lines: rows,
      unresolved: rows.filter((r) => !r.resolved).length,
      comparedCount: compared.length,
      // Over/short are counted lines, not a verdict about missing stock. Only a supervisor-approved
      // canonical posting can conclude that, and this endpoint cannot.
      overCounted: compared.filter((r) => (r.difference ?? 0) > 0).length,
      shortCounted: compared.filter((r) => (r.difference ?? 0) < 0).length,
      matchedCount: compared.filter((r) => r.difference === 0).length,
      netDifference: compared.reduce((sum, r) => sum + (r.difference ?? 0), 0),
      note: draft.opnameId
        ? 'Selisih dihitung terhadap snapshot StockOpname saat penghitungan dibuka. Penyesuaian inventory tetap lewat alur adjustment kanonik dengan persetujuan.'
        : 'Draft belum terikat ke StockOpname, jadi belum ada snapshot sistem. Kirimkan draft ke opname kanonik untuk melihat selisih.',
    };
  }

  // Hand the draft to the canonical lifecycle.
  //
  // This writes the counted quantities into the opname's own items and nothing else. That is the whole
  // point of the wave: without it a mobile count is captured, marked SUBMITTED, and then the canonical
  // `submitOpname` refuses it forever with "Semua barang harus dihitung sebelum diajukan", because the
  // counted quantity was stored on the draft and never reached `StockOpnameItem.countedQty`. The mobile
  // path would have been a dead end with a success message on it.
  //
  // What this deliberately does NOT do: create or complete a StockOpname, transition it past
  // COUNTING, or touch inventory. Submission and the supervisor approval stay behind the canonical
  // lifecycle, which is where this wave's permissions do not reach.
  async submitDraft(user: AuthUser, draftId: string, opnameId: string) {
    const companyId = this.tenant(user);
    const draft = await this.prisma.mobileOpnameDraft.findFirst({ where: { id: draftId, companyId } });
    if (!draft) throw new NotFoundException('Draft tidak ditemukan pada tenant ini.');
    if (draft.status !== 'OPEN') throw new BadRequestException(`Draft berstatus ${draft.status}.`);
    const lines = this.linesOf(draft.lines);
    if (lines.length === 0) throw new BadRequestException('Draft kosong tidak dapat dikirim.');
    const opname = await this.prisma.stockOpname.findFirst({ where: { id: opnameId } });
    if (!opname) throw new NotFoundException('StockOpname tidak ditemukan.');
    // The opname must belong to the same warehouse the draft was counting, or the count is filed
    // against the wrong stock.
    if (opname.warehouseId !== draft.warehouseId) {
      throw new BadRequestException('StockOpname dan draft harus pada gudang yang sama.');
    }
    // Counting may only be filled while the opname is still open for it. Filing into an opname that is
    // already WAITING_APPROVAL or COMPLETED would rewrite numbers a supervisor has already ruled on.
    if (opname.status !== 'COUNTING' && opname.status !== 'DRAFT') {
      throw new BadRequestException(`StockOpname berstatus ${opname.status}; hitungan tidak dapat diisi lagi.`);
    }

    // Resolve the counted lines to products first: writing a quantity onto an item needs its productId,
    // and a line that resolves to nothing must not be silently dropped on the way through.
    const barcodes = lines.map((l) => l.barcode).filter((b): b is string => Boolean(b));
    const skus = lines.map((l) => l.sku).filter((s): s is string => Boolean(s));
    const products = await this.prisma.product.findMany({
      where: { companyId, OR: [{ barcode: { in: barcodes } }, ...(skus.length ? [{ sku: { in: skus } }] : [])] },
      select: { id: true, name: true, barcode: true, sku: true },
    });
    const byBarcode = new Map(products.filter((p) => p.barcode).map((p) => [p.barcode as string, p]));
    const bySku = new Map(products.filter((p) => p.sku).map((p) => [p.sku as string, p]));

    const items = await this.prisma.stockOpnameItem.findMany({
      where: { opnameId: opname.id }, select: { id: true, productId: true, batchNumber: true, systemQty: true, countedQty: true, reason: true },
    });
    const byProduct = new Map<string, typeof items>();
    for (const item of items) {
      const list = byProduct.get(item.productId) ?? [];
      list.push(item);
      byProduct.set(item.productId, list);
    }

    const unresolved: string[] = [];
    const notInOpname: string[] = [];
    const updates: Array<{ id: string; data: { countedQty: number; difference: number; reason: string } }> = [];
    for (const line of lines) {
      const product = (line.barcode ? byBarcode.get(line.barcode) : undefined) ?? (line.sku ? bySku.get(line.sku) : undefined);
      if (!product) { unresolved.push(line.key); continue; }
      const candidates = byProduct.get(product.id) ?? [];
      if (candidates.length === 0) { notInOpname.push(product.name ?? product.id); continue; }
      // A batch-tracked product has one row per batch. The device counted the product as a whole, so the
      // total goes on the row that is still uncounted; if every batch is already counted the count is
      // spread across them in order, which is the same thing the canonical count screen does by hand.
      // Either way the quantity that reaches inventory is the quantity that was counted.
      const target = candidates.find((c) => c.countedQty === null);
      if (target) {
        updates.push({ id: target.id, data: { countedQty: line.quantity, difference: line.quantity - target.systemQty, reason: line.note ?? 'Dihitung perangkat mobile' } });
        continue;
      }
      let remaining = line.quantity;
      for (const candidate of candidates) {
        if (remaining <= 0) break;
        const alreadyCounted = candidate.countedQty ?? 0;
        const capacity = Math.max(0, candidate.systemQty - alreadyCounted);
        if (capacity === 0) continue;
        const take = Math.min(capacity, remaining);
        updates.push({ id: candidate.id, data: { countedQty: alreadyCounted + take, difference: alreadyCounted + take - candidate.systemQty, reason: candidate.reason ?? 'Dihitung perangkat mobile' } });
        remaining -= take;
      }
      if (remaining > 0) {
        updates.push({ id: candidates[0].id, data: { countedQty: (candidates[0].countedQty ?? 0) + remaining, difference: (candidates[0].countedQty ?? 0) + remaining - candidates[0].systemQty, reason: 'Dihitung perangkat mobile (melebihi snapshot)' } });
      }
    }

    // A line that cannot be resolved, or a product that is not in this opname, must not be dropped in
    // silence — the operator would see "sent" and believe the count is complete when it is not.
    if (unresolved.length || notInOpname.length) {
      throw new BadRequestException(
        `Baris tidak dapat dipetakan ke item StockOpname: ${[...unresolved.map((k) => `baris ${k}`), ...notInOpname.map((n) => `produk ${n}`)].join('; ')}. Draft tetap OPEN.`
      );
    }

    const saved = await this.prisma.$transaction(async (tx) => {
      for (const update of updates) {
        await tx.stockOpnameItem.update({ where: { id: update.id }, data: update.data });
      }
      const row = await tx.mobileOpnameDraft.update({ where: { id: draft.id }, data: { status: 'SUBMITTED', opnameId } });
      await tx.auditLog.create({
        data: { companyId, userId: user.sub, action: 'MOBILE_OPNAME_DRAFT_SUBMITTED', entityType: 'MobileOpnameDraft', entityId: draft.id, payload: { opnameId, lineCount: lines.length, filledItems: updates.length } },
      });
      return row;
    });
    return {
      id: saved.id,
      status: saved.status,
      opnameId: saved.opnameId,
      filledItems: updates.length,
      note: 'Hitungan draft sudah masuk ke item StockOpname. Pengajuan dan persetujuan tetap lewat alur StockOpname kanonik; posting inventory belum dilakukan.',
    };
  }

  async discardDraft(user: AuthUser, draftId: string, reason: string) {
    const companyId = this.tenant(user);
    if (!reason?.trim()) throw new BadRequestException('Membuang draft wajib disertai alasan.');
    const draft = await this.prisma.mobileOpnameDraft.findFirst({ where: { id: draftId, companyId } });
    if (!draft) throw new NotFoundException('Draft tidak ditemukan pada tenant ini.');
    if (draft.status !== 'OPEN') throw new BadRequestException(`Draft berstatus ${draft.status}.`);
    const saved = await this.prisma.mobileOpnameDraft.update({ where: { id: draft.id }, data: { status: 'DISCARDED' } });
    await this.prisma.auditLog.create({
      data: { companyId, userId: user.sub, action: 'MOBILE_OPNAME_DRAFT_DISCARDED', entityType: 'MobileOpnameDraft', entityId: draft.id, payload: { reason: reason.trim(), lineCount: this.lineCount(draft.lines) } },
    });
    return { id: saved.id, status: saved.status };
  }

  // ---------------------------------------------------------------- internals

  private linesOf(raw: unknown): Array<{ key: string; barcode: string | null; sku: string | null; quantity: number; unit: string | null; note: string | null }> {
    if (!Array.isArray(raw)) return [];
    return raw.filter((l): l is { key: string; barcode: string | null; sku: string | null; quantity: number; unit: string | null; note: string | null } =>
      Boolean(l) && typeof (l as { key?: unknown }).key === 'string' && Number.isFinite((l as { quantity?: unknown }).quantity));
  }

  private lineCount(raw: unknown): number {
    return this.linesOf(raw).length;
  }
}
