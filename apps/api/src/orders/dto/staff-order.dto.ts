import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { OrderItemDto } from './create-order.dto';

export class CreateStaffOrderDto {
  @IsString() @IsNotEmpty() @MaxLength(120) operationKey!: string;
  @IsString() @IsNotEmpty() customerId!: string;
  @IsString() @IsNotEmpty() cashierShiftId!: string;
  @IsString() @IsNotEmpty() warehouseId!: string;
  @IsIn(['DELIVERY','PICKUP']) fulfillmentType!: 'DELIVERY' | 'PICKUP';
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(60) shippingMethodCode?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => OrderItemDto) items!: OrderItemDto[];
}
export class StaffOrderCashDto {
  @IsString() @IsNotEmpty() @MaxLength(120) operationKey!: string;
  @IsString() @IsNotEmpty() @MaxLength(60) tenderCode!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000000000000) expectedAmount!: number;
}
