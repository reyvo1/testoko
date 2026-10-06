import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { CreateExchangeDto } from './dto/exchange.dto';
import { ExchangesService } from './exchanges.service';
@ApiTags('retail-exchanges') @ApiBearerAuth() @Controller('returns/exchanges')
export class ExchangesController {
  constructor(private readonly service: ExchangesService) {}
  @Roles('SUPER_ADMIN','OWNER','ADMIN','FINANCE') @Permissions('sale.return') @Get()
  list(@CurrentUser() user: AuthUser, @Query('limit') limit?: string, @Query('cursor') cursor?: string) { return this.service.list(user, limit, cursor); }
  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Permissions('sale.create','sale.return','sale.refund') @Post()
  create(@Body() dto: CreateExchangeDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user); }
}
