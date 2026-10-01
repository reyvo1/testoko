import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { decodeCursor, parsePageLimit, toCursorPage } from '../common/pagination';
import { resolveProductUnitPrice } from '../common/product-pricing';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

type DbClient = Prisma.TransactionClient | PrismaService;
type ProductCursor = { name: string; id: string };
type TenantScope = { companyId: string; branchId: string };

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  private requireTenantScope(user: AuthUser): TenantScope {
    if (!user.companyId || !user.branchId) {
      throw new ForbiddenException({
        code: 'TENANT_CONTEXT_REQUIRED',
        message: 'Pengguna belum memiliki company dan branch yang valid.',
      });
    }
    return { companyId: user.companyId, branchId: user.branchId };
  }

  private async denyTenantAccess(
    client: DbClient,
    user: AuthUser | undefined,
    scope: TenantScope,
    entityType: string,
    entityId?: string,
    payload?: Prisma.InputJsonValue,
  ): Promise<never> {
    await client.auditLog.create({
      data: {
        companyId: scope.companyId,
        userId: user?.sub,
        action: 'TENANT_ACCESS_DENIED',
        entityType,
        entityId,
        payload: payload ?? {
          authenticatedCompanyId: scope.companyId,
          authenticatedBranchId: scope.branchId,
        },
      },
    });
    throw new ForbiddenException({
      code: 'TENANT_ACCESS_DENIED',
      message: `${entityType} tidak tersedia dalam company dan branch yang diminta.`,
    });
  }

  private async resolveScope(
    user: AuthUser | undefined,
    branchCode?: string,
    requestedCompanyId?: string,
    requestedBranchId?: string,
  ): Promise<TenantScope> {
    if (user) {
      const scope = this.requireTenantScope(user);
      if ((requestedCompanyId && requestedCompanyId !== scope.companyId)
        || (requestedBranchId && requestedBranchId !== scope.branchId)) {
        return this.denyTenantAccess(this.prisma, user, scope, 'ProductCatalog', undefined, {
          authenticatedCompanyId: scope.companyId,
          authenticatedBranchId: scope.branchId,
          ...(requestedCompanyId ? { requestedCompanyId } : {}),
          ...(requestedBranchId ? { requestedBranchId } : {}),
        });
      }
      if (branchCode) {
        const branch = await this.prisma.branch.findFirst({
          where: { id: scope.branchId, companyId: scope.companyId, code: branchCode, isActive: true },
          select: { id: true },
        });
        if (!branch) {
          return this.denyTenantAccess(this.prisma, user, scope, 'Branch', scope.branchId, { requestedBranchCode: branchCode });
        }
      }
      return scope;
    }

    const normalizedCode = branchCode?.trim();
    if (!normalizedCode) {
      throw new BadRequestException({
        code: 'BRANCH_CODE_REQUIRED',
        message: 'branchCode wajib disertakan untuk katalog produk publik.',
      });
    }
    const branch = await this.prisma.branch.findFirst({
      where: { code: normalizedCode, isActive: true },
      select: { id: true, companyId: true },
    });
    if (!branch) {
      throw new NotFoundException({ code: 'STOREFRONT_BRANCH_NOT_FOUND', message: 'Cabang storefront tidak ditemukan atau tidak aktif.' });
    }
    const scope = { companyId: branch.companyId, branchId: branch.id };
    if ((requestedCompanyId && requestedCompanyId !== scope.companyId)
      || (requestedBranchId && requestedBranchId !== scope.branchId)) {
      return this.denyTenantAccess(this.prisma, undefined, scope, 'ProductCatalog', undefined, {
        requestedBranchCode: normalizedCode,
        ...(requestedCompanyId ? { requestedCompanyId } : {}),
        ...(requestedBranchId ? { requestedBranchId } : {}),
      });
    }
    return scope;
  }

  private inventoryScope(scope: TenantScope): Prisma.InventoryWhereInput {
    return {
      warehouse: {
        branchId: scope.branchId,
        branch: { companyId: scope.companyId },
      },
    };
  }

  async list(
    user: AuthUser | undefined,
    branchCode?: string,
    requestedCompanyId?: string,
    requestedBranchId?: string,
    search?: string,
    limitValue?: string,
    cursorValue?: string,
    includeInactiveValue?: string,
  ) {
    const scope = await this.resolveScope(user, branchCode, requestedCompanyId, requestedBranchId);
    const limit = parsePageLimit(limitValue);
    const cursor = decodeCursor<ProductCursor>(cursorValue);
    const filters: Prisma.ProductWhereInput[] = [];
    const query = search?.trim();
    const canManageProducts = Boolean(user?.roles.some((role) => ['SUPER_ADMIN', 'OWNER', 'ADMIN'].includes(role)));
    const includeInactive = includeInactiveValue === 'true' && canManageProducts;

    if (query) {
      filters.push({
        OR: [
          { barcode: query },
          { sku: query },
          { sku: { startsWith: query } },
          { name: { contains: query } },
          { variants: { some: { OR: [{ sku: query }, { code: query }, { name: { contains: query } }], isActive: true } } },
          { barcodes: { some: { code: query } } },
        ],
      });
    }
    if (cursor) {
      if (typeof cursor.name !== 'string' || typeof cursor.id !== 'string') throw new Error('invalid product cursor');
      filters.push({ OR: [{ name: { gt: cursor.name } }, { name: cursor.name, id: { gt: cursor.id } }] });
    }

    const rows = await this.prisma.product.findMany({
      where: {
        companyId: scope.companyId,
        ...(includeInactive ? {} : { isActive: true }),
        AND: filters.length ? filters : undefined,
      },
      include: {
        category: true,
        variants: { where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] },
        units: { where: { isActive: true }, orderBy: [{ variantId: 'asc' }, { isDefaultSale: 'desc' }, { quantityFactor: 'asc' }], include: { variant: true } },
        barcodes: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], include: { variant: true, productUnit: true } },
        inventories: {
          where: this.inventoryScope(scope),
          select: {
            available: true,
            warehouseId: true,
            warehouse: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const page = toCursorPage(rows, limit, (item) => ({ name: item.name, id: item.id }));
    const pricedItems = await Promise.all(page.items.map(async (item) => ({
      ...item,
      effectiveSalePrice: await resolveProductUnitPrice(this.prisma, {
        companyId: scope.companyId, branchId: scope.branchId, product: item, quantity: 1, segmentCode: 'RETAIL', unitCode: item.unit,
      }),
      units: await Promise.all(item.units.map(async (unit) => ({
        ...unit,
        effectiveSalePrice: await resolveProductUnitPrice(this.prisma, {
          companyId: scope.companyId, branchId: scope.branchId, product: item, quantity: 1, segmentCode: 'RETAIL',
          unitCode: unit.unitCode, unitFactor: Number(unit.quantityFactor), variantId: unit.variantId,
          variantSalePrice: unit.variant?.salePrice ? new Prisma.Decimal(unit.variant.salePrice).mul(Number(unit.quantityFactor)) : undefined,
        }),
      }))),
    })));
    if (user) return { ...page, items: pricedItems };
    return {
      ...page,
      items: pricedItems.map(({ companyId: _companyId, ...item }) => item),
    };
  }

  async create(dto: CreateProductDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    if (dto.trackExpiry && !dto.trackBatch) throw new BadRequestException('Pelacakan expiry membutuhkan pelacakan batch.');
    return this.prisma.$transaction(async (tx) => {
      if (dto.categoryId) {
        const category = await tx.category.findFirst({ where: { id: dto.categoryId, companyId: scope.companyId }, select: { id: true } });
        if (!category) throw new BadRequestException('Kategori produk tidak ditemukan.');
      }
      const product = await tx.product.create({
        data: {
          ...dto,
          companyId: scope.companyId,
          costPrice: new Prisma.Decimal(dto.costPrice),
          salePrice: new Prisma.Decimal(dto.salePrice),
          unit: (dto.unit ?? 'PCS').trim().toUpperCase(),
          minStock: dto.minStock ?? 0,
          isActive: dto.isActive ?? true,
        },
      });
      if (dto.barcode) {
        await tx.productBarcode.create({ data: { productId: product.id, code: dto.barcode, unitCode: (dto.unit ?? 'PCS').trim().toUpperCase(), quantityFactor: new Prisma.Decimal(1), isPrimary: true } });
      }
      await tx.auditLog.create({
        data: {
          companyId: scope.companyId,
          userId: user.sub,
          action: 'CREATE_PRODUCT',
          entityType: 'Product',
          entityId: product.id,
          payload: { branchId: scope.branchId, sku: product.sku },
        },
      });
      return product;
    });
  }

  // T360-20260829 value pack 2 — update produk + pencatatan riwayat harga otomatis.
  async update(id: string, dto: UpdateProductDto, user: AuthUser) {
    const scope = this.requireTenantScope(user);
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findFirst({ where: { id, companyId: scope.companyId } });
      if (!product) return this.denyTenantAccess(tx, user, scope, 'Product', id);
      if (dto.categoryId) {
        const category = await tx.category.findFirst({ where: { id: dto.categoryId, companyId: scope.companyId }, select: { id: true } });
        if (!category) throw new BadRequestException('Kategori produk tidak ditemukan pada perusahaan ini.');
      }
      const nextTrackBatch = dto.trackBatch ?? product.trackBatch;
      const nextTrackExpiry = dto.trackExpiry ?? product.trackExpiry;
      if (nextTrackExpiry && !nextTrackBatch) throw new BadRequestException('Pelacakan expiry membutuhkan pelacakan batch.');
      const updated = await tx.product.update({
        where: { id: product.id },
        data: {
          ...(dto.sku != null ? { sku: dto.sku.trim() } : {}),
          ...(dto.name != null ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description || null } : {}),
          ...(dto.unit != null ? { unit: dto.unit.trim().toUpperCase() } : {}),
          ...(dto.barcode !== undefined ? { barcode: dto.barcode || null } : {}),
          ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId || null } : {}),
          ...(dto.brandCode !== undefined ? { brandCode: dto.brandCode?.trim().toUpperCase() || null } : {}),
          ...(dto.productType !== undefined ? { productType: dto.productType } : {}),
          ...(dto.taxCategoryCode !== undefined ? { taxCategoryCode: dto.taxCategoryCode?.trim().toUpperCase() || null } : {}),
          ...(dto.salesTaxCodeId !== undefined ? { salesTaxCodeId: dto.salesTaxCodeId || null } : {}),
          ...(dto.purchaseTaxCodeId !== undefined ? { purchaseTaxCodeId: dto.purchaseTaxCodeId || null } : {}),
          ...(dto.trackBatch !== undefined ? { trackBatch: dto.trackBatch } : {}),
          ...(dto.trackExpiry !== undefined ? { trackExpiry: dto.trackExpiry } : {}),
          ...(dto.trackSerial !== undefined ? { trackSerial: dto.trackSerial } : {}),
          ...(dto.allowNegativeStock !== undefined ? { allowNegativeStock: dto.allowNegativeStock } : {}),
          ...(dto.minStock != null ? { minStock: dto.minStock } : {}),
          ...(dto.isActive != null ? { isActive: dto.isActive } : {}),
          ...(dto.costPrice != null ? { costPrice: new Prisma.Decimal(dto.costPrice) } : {}),
          ...(dto.salePrice != null ? { salePrice: new Prisma.Decimal(dto.salePrice) } : {}),
        },
      });
      if (dto.barcode !== undefined && dto.barcode) {
        const primary = await tx.productBarcode.findFirst({ where: { productId: product.id, isPrimary: true } });
        if (primary) await tx.productBarcode.update({ where: { id: primary.id }, data: { code: dto.barcode, unitCode: (dto.unit ?? updated.unit).trim().toUpperCase() } });
        else await tx.productBarcode.create({ data: { productId: product.id, code: dto.barcode, unitCode: (dto.unit ?? updated.unit).trim().toUpperCase(), quantityFactor: new Prisma.Decimal(1), isPrimary: true } });
      }
      const priceChanges: Array<{ field: string; oldValue: Prisma.Decimal; newValue: Prisma.Decimal }> = [];
      if (dto.costPrice != null && !new Prisma.Decimal(dto.costPrice).equals(product.costPrice)) {
        priceChanges.push({ field: 'costPrice', oldValue: product.costPrice, newValue: new Prisma.Decimal(dto.costPrice) });
      }
      if (dto.salePrice != null && !new Prisma.Decimal(dto.salePrice).equals(product.salePrice)) {
        priceChanges.push({ field: 'salePrice', oldValue: product.salePrice, newValue: new Prisma.Decimal(dto.salePrice) });
      }
      if (priceChanges.length) {
        await tx.productPriceHistory.createMany({
          data: priceChanges.map((change) => ({
            companyId: scope.companyId,
            productId: product.id,
            field: change.field,
            oldValue: change.oldValue,
            newValue: change.newValue,
            changedById: user.sub,
          })),
        });
      }
      await tx.auditLog.create({
        data: {
          companyId: scope.companyId,
          userId: user.sub,
          action: 'UPDATE_PRODUCT',
          entityType: 'Product',
          entityId: product.id,
          payload: { branchId: scope.branchId, priceChanged: priceChanges.length > 0 },
        },
      });
      return updated;
    });
  }

  // T360-20260829 value pack 2 — riwayat perubahan harga produk.
  async priceHistory(id: string, user: AuthUser, limitValue?: string) {
    const scope = this.requireTenantScope(user);
    const limit = Math.min(Math.max(Number(limitValue ?? 50) || 50, 1), 200);
    const product = await this.prisma.product.findFirst({ where: { id, companyId: scope.companyId }, select: { id: true } });
    if (!product) return this.denyTenantAccess(this.prisma, user, scope, 'Product', id);
    return this.prisma.productPriceHistory.findMany({
      where: { companyId: scope.companyId, productId: id },
      orderBy: [{ changedAt: 'desc' }, { id: 'asc' }],
      take: limit,
    });
  }

  async findOne(
    id: string,
    user: AuthUser | undefined,
    branchCode?: string,
    requestedCompanyId?: string,
    requestedBranchId?: string,
  ) {
    const scope = await this.resolveScope(user, branchCode, requestedCompanyId, requestedBranchId);
    const product = await this.prisma.product.findFirst({
      where: { id, companyId: scope.companyId, isActive: true },
      include: {
        category: true,
        variants: { where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] },
        units: { where: { isActive: true }, orderBy: [{ variantId: 'asc' }, { isDefaultSale: 'desc' }, { quantityFactor: 'asc' }], include: { variant: true } },
        barcodes: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], include: { variant: true, productUnit: true } },
        inventories: {
          where: this.inventoryScope(scope),
          include: { warehouse: true },
        },
      },
    });
    if (product) {
      const effectiveSalePrice = await resolveProductUnitPrice(this.prisma, { companyId: scope.companyId, branchId: scope.branchId, product, quantity: 1, segmentCode: 'RETAIL', unitCode: product.unit });
      const units = await Promise.all(product.units.map(async (unit) => ({
        ...unit,
        effectiveSalePrice: await resolveProductUnitPrice(this.prisma, {
          companyId: scope.companyId, branchId: scope.branchId, product, quantity: 1, segmentCode: 'RETAIL',
          unitCode: unit.unitCode, unitFactor: Number(unit.quantityFactor), variantId: unit.variantId,
          variantSalePrice: unit.variant?.salePrice ? new Prisma.Decimal(unit.variant.salePrice).mul(Number(unit.quantityFactor)) : undefined,
        }),
      })));
      const pricedProduct = { ...product, units, effectiveSalePrice };
      if (user) return pricedProduct;
      const { companyId: _companyId, ...publicProduct } = pricedProduct;
      return publicProduct;
    }
    const exists = await this.prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (exists) return this.denyTenantAccess(this.prisma, user, scope, 'Product', id);
    throw new NotFoundException('Produk tidak ditemukan.');
  }
}
