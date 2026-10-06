import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { ApproveTaxExportMappingDto, CreateTaxExportDto } from './dto/tax-export.dto';
import { TaxExportsService } from './tax-exports.service';
@ApiTags('coretax-exports') @ApiBearerAuth() @Controller('accounting-core/tax-exports') @Roles('SUPER_ADMIN','OWNER','FINANCE')
export class TaxExportsController {
  constructor(private readonly service: TaxExportsService) {}
  @Get('documents/:id/draft') @Permissions('tax.view')
  draft(@Param('id') id: string,@Query('contract') contract: string,@CurrentUser() user: AuthUser) { return this.service.draft(id,contract,user); }
  @Post('documents/:id/approve-mapping') @Permissions('tax.manage')
  approve(@Param('id') id: string,@Body() dto: ApproveTaxExportMappingDto,@CurrentUser() user: AuthUser) { return this.service.approve(id,dto,user); }
  @Post() @Permissions('tax.manage','report.export')
  create(@Body() dto: CreateTaxExportDto,@CurrentUser() user: AuthUser) { return this.service.create(dto,user); }
}
