import { Module } from '@nestjs/common';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { OperationsControlModule } from '../operations-control/operations-control.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorefrontCustomerModule } from '../storefront-customer/storefront-customer.module';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';
import { StorefrontOrderReturnsController } from './storefront-order-returns.controller';
import { SalesModule } from '../sales/sales.module';
import { ExchangesController } from './exchanges.controller';
import { ExchangesService } from './exchanges.service';
@Module({ imports: [PrismaModule, AccountingCoreModule, OperationsControlModule, StorefrontCustomerModule, SalesModule], controllers: [ReturnsController, StorefrontOrderReturnsController, ExchangesController], providers: [ReturnsService, ExchangesService], exports: [ReturnsService] })
export class ReturnsModule {}
