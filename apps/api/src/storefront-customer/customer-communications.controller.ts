import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { CustomerCommunicationsService } from './customer-communications.service';
import { CancelCustomerCampaignDto, CommunicationPreferenceDto, CreateCustomerCampaignDto, QueueCustomerReceiptDto } from './dto/customer-communications.dto';

@ApiTags('customer-communications') @Controller('storefront/account') @Public()
export class CustomerCommunicationPreferenceController {
  constructor(private readonly service: CustomerCommunicationsService) {}
  @Get('communication-preferences') preferences(@Headers('x-branch-code') branch?: string, @Headers('x-customer-session') token?: string) { return this.service.preferences(branch, token); }
  @Patch('communication-preferences') save(@Body() dto: CommunicationPreferenceDto, @Headers('x-branch-code') branch?: string, @Headers('x-customer-session') token?: string) { return this.service.savePreferences(dto, branch, token); }
  @Get('receipts') receipts(@Headers('x-branch-code') branch?: string, @Headers('x-customer-session') token?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) { return this.service.receipts(branch, token, limit, cursor); }
  @Get('receipts/:number/link') link(@Param('number') number: string, @Headers('x-branch-code') branch?: string, @Headers('x-customer-session') token?: string) { return this.service.customerReceiptLink(number, branch, token); }
}

@ApiTags('customer-campaigns') @ApiBearerAuth() @Controller('customer-campaigns')
export class CustomerCampaignController {
  constructor(private readonly service: CustomerCommunicationsService) {}
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Permissions('notification.manage') @Get()
  list(@CurrentUser() user: AuthUser, @Query('limit') limit?: string, @Query('cursor') cursor?: string) { return this.service.campaigns(user, limit, cursor); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Permissions('notification.manage') @Get(':id/deliveries')
  deliveries(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) { return this.service.campaignDeliveries(id, user, limit, cursor); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Permissions('notification.manage') @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCustomerCampaignDto) { return this.service.createCampaign(dto, user); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Permissions('notification.manage') @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CancelCustomerCampaignDto) { return this.service.cancelCampaign(id, dto, user); }
}

@ApiTags('customer-receipt-delivery') @ApiBearerAuth() @Controller('sales')
export class CustomerReceiptDeliveryController {
  constructor(private readonly service: CustomerCommunicationsService) {}
  @Roles('SUPER_ADMIN','OWNER','ADMIN','CASHIER','FINANCE') @Permissions('sale.view') @Post(':id/deliver-receipt')
  queue(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: QueueCustomerReceiptDto) { return this.service.queueReceipt(id, dto, user); }
}
