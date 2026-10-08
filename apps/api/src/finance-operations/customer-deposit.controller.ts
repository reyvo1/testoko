import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { CreateCustomerDepositDto } from './dto/customer-deposit.dto';
import { FinanceOperationsService } from './finance-operations.service';
@ApiTags('customer-deposits') @ApiBearerAuth() @Controller('finance-operations/customer-deposits')
export class CustomerDepositController {
  constructor(private readonly finance: FinanceOperationsService) {}
  @Roles('SUPER_ADMIN','OWNER','ADMIN','FINANCE') @Permissions('finance.create','sale.view') @Get('customers')
  customers(@CurrentUser() user: AuthUser, @Query('limit') limit?: string, @Query('cursor') cursor?: string) { return this.finance.depositCustomers(user,limit,cursor); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','CASHIER','FINANCE') @Permissions('sale.view') @Get(':customerId/balance')
  balance(@CurrentUser() user: AuthUser, @Param('customerId') customerId: string, @Query('accountCode') accountCode?: string) { return this.finance.depositBalance(user, customerId, accountCode); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN','FINANCE') @Permissions('finance.create') @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCustomerDepositDto) { return this.finance.createCustomerDeposit(dto, user); }
}
