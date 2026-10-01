import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { MobileOpsService } from './mobile-ops.service';

// POST-1C — mobile stock-opname drafts and Telegram identity administration.
//
// Note what is absent: there is no route here that takes a platformUserId and performs an action on
// its behalf. Binding administration and draft capture are operator-session routes, permission gated.
// The identity-to-permission resolution lives in the service and is exercised by tests, because a
// route that accepted a chat id would put the whole security model one refactor away from being gone.
@ApiTags('mobile-ops')
@ApiBearerAuth()
@Controller('mobile-ops')
export class MobileOpsController {
  constructor(private readonly service: MobileOpsService) {}

  @Get('telegram/bindings')
  @Permissions('user.manage')
  listBindings(@CurrentUser() user: AuthUser) {
    return this.service.listBindings(user);
  }

  @Post('telegram/bindings')
  @Permissions('user.manage')
  bind(@Body() dto: { employeeId: string; platformUserId: string; platformChatId?: string; displayName?: string }, @CurrentUser() user: AuthUser) {
    return this.service.bindIdentity(user, dto);
  }

  @Put('telegram/bindings/revoke')
  @Permissions('user.manage')
  revoke(@Body() dto: { bindingId: string; reason: string }, @CurrentUser() user: AuthUser) {
    return this.service.revokeBinding(user, dto.bindingId, dto.reason);
  }

  // The list an operator needs to actually supervise the wave. Without it a draft can only be reached
  // by knowing its id, and a draft that nobody can see is a draft nobody files — the count would be
  // captured on a device and then quietly expire. Read-only and paginated; the scan/submit mutations
  // stay behind the device that owns the draft.
  @Get('drafts')
  @Permissions('inventory.manage')
  listDrafts(@CurrentUser() user: AuthUser, @Query('status') status?: 'OPEN' | 'SUBMITTED' | 'DISCARDED', @Query('warehouseId') warehouseId?: string) {
    return this.service.listDrafts(user, status, warehouseId);
  }

  @Post('drafts/open')
  @Permissions('inventory.manage')
  openDraft(@Body() dto: { deviceId: string; warehouseId: string; locationId?: string; opnameId?: string }, @CurrentUser() user: AuthUser) {
    return this.service.openDraft(user, dto);
  }

  @Post('drafts/:draftId/scan')
  @Permissions('inventory.manage')
  addScan(@Param('draftId') draftId: string, @Body() dto: { barcode?: string; sku?: string; quantity: number; unit?: string; note?: string }, @CurrentUser() user: AuthUser) {
    return this.service.addScan(user, draftId, dto);
  }

  @Get('drafts/:draftId')
  @Permissions('inventory.manage')
  getDraft(@Param('draftId') draftId: string, @CurrentUser() user: AuthUser) {
    return this.service.getDraft(user, draftId);
  }

  @Get('drafts/:draftId/discrepancy')
  @Permissions('inventory.manage')
  discrepancy(@Param('draftId') draftId: string, @CurrentUser() user: AuthUser) {
    return this.service.reviewDiscrepancy(user, draftId);
  }

  @Post('drafts/:draftId/submit')
  @Permissions('inventory.manage')
  submit(@Param('draftId') draftId: string, @Body() dto: { opnameId: string }, @CurrentUser() user: AuthUser) {
    return this.service.submitDraft(user, draftId, dto.opnameId);
  }

  @Post('drafts/:draftId/discard')
  @Permissions('inventory.manage')
  discard(@Param('draftId') draftId: string, @Body() dto: { reason: string }, @CurrentUser() user: AuthUser) {
    return this.service.discardDraft(user, draftId, dto.reason);
  }
}
