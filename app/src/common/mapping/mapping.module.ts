import { Global, Module } from '@nestjs/common';

import { mapperProvider } from './mapper.provider';

@Global()
@Module({
  providers: [mapperProvider],
  exports: [mapperProvider],
})
export class MappingModule {}
