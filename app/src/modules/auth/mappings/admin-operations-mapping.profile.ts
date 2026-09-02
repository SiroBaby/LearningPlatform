import { Inject, Injectable } from '@nestjs/common';
import { createMap, forMember, mapFrom, type Mapper } from '@automapper/core';

import { MAPPER } from '../../../common/mapping/mapper.provider';
import { DateTimeUtil } from '../../../common/datetime.util';
import { SuperAdminRoleChangeRequestResult } from '../contracts/super-admin-role-change-request.result';
import { SuperAdminRoleChangeRequestResponseDto } from '../dto/super-admin-role-change-request.response.dto';

@Injectable()
export class AdminOperationsMappingProfile {
  constructor(@Inject(MAPPER) mapper: Mapper) {
    createMap(
      mapper,
      SuperAdminRoleChangeRequestResult,
      SuperAdminRoleChangeRequestResponseDto,
      forMember(
        (destination) => destination.createdAt,
        mapFrom((source) => DateTimeUtil.toUtcIsoString(source.createdAt)),
      ),
      forMember(
        (destination) => destination.expiresAt,
        mapFrom((source) => DateTimeUtil.toUtcIsoString(source.expiresAt)),
      ),
    );
  }
}
