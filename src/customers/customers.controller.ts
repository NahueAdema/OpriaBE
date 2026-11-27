import { Controller, Get, Header, Patch } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../common/zod/zod.decorators.js';
import { toOpenApiSchema } from '../common/zod/zod-openapi.js';
import { CustomersService } from './customers.service.js';
import {
  type CustomerDetail,
  customerDetailSchema,
  type CustomerListQuery,
  customerListQuerySchema,
  type CustomerListResponse,
  customerListResponseSchema,
  type CustomerPhoneParams,
  customerPhoneParamsSchema,
  type UpdateCustomerInput,
  updateCustomerSchema,
} from './customers.schemas.js';

const listOpenApi = toOpenApiSchema(customerListResponseSchema) as SchemaObject;
const detailOpenApi = toOpenApiSchema(customerDetailSchema) as SchemaObject;

@ApiTags('customers')
@Controller('customers')
@Roles('owner', 'admin', 'staff')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get('export')
  @ApiProduces('text/csv')
  @ApiOperation({
    summary: 'Export customers as CSV',
    description:
      'Uses the same search scope as the list. es-AR friendly (UTF-8 BOM, semicolon separator) with formula injection escaped.',
  })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="clientes.csv"')
  export(
    @CurrentUser() user: AuthenticatedUser,
    @ZodQuery(customerListQuerySchema) query: CustomerListQuery,
  ): Promise<string> {
    return this.customers.export(user.tenantId, query.q);
  }

  @Get()
  @ApiOperation({
    summary: 'List customers seen by the business',
    description:
      'Includes guests (identified by phone) and account customers. Notes and consent come from the per-tenant profile.',
  })
  @ApiOkResponse({ schema: listOpenApi })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @ZodQuery(customerListQuerySchema) query: CustomerListQuery,
  ): Promise<CustomerListResponse> {
    return this.customers.list(user.tenantId, query);
  }

  @Get(':phone')
  @ApiOperation({
    summary: 'Customer file with appointment history',
  })
  @ApiOkResponse({ schema: detailOpenApi })
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam(customerPhoneParamsSchema) params: CustomerPhoneParams,
  ): Promise<CustomerDetail> {
    return this.customers.detail(user.tenantId, params.phone);
  }

  @Patch(':phone')
  @ApiOperation({
    summary: 'Save internal notes or consent for a customer',
    description:
      'Creates the per-tenant profile on the first save, so guest customers can be edited too.',
  })
  @ApiOkResponse({ schema: detailOpenApi })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam(customerPhoneParamsSchema) params: CustomerPhoneParams,
    @ZodBody(updateCustomerSchema) body: UpdateCustomerInput,
  ): Promise<CustomerDetail> {
    return this.customers.update(user.tenantId, params.phone, body);
  }
}
