import { Injectable } from '@nestjs/common';
import {
  TypeOrmModuleOptions,
  TypeOrmOptionsFactory,
} from '@nestjs/typeorm';

import { ApplicationConfigService } from '../config/application-config.service';

@Injectable()
export class TypeOrmConfigService implements TypeOrmOptionsFactory {
  constructor(private readonly config: ApplicationConfigService) {}

  createTypeOrmOptions(): TypeOrmModuleOptions {
    const database = this.config.database;
    const ssl = database.ssl.mode === 'verify-ca'
      ? {
          ca: database.ssl.ca,
          rejectUnauthorized: true,
        }
      : undefined;

    return {
      type: 'postgres',
      host: database.host,
      port: database.port,
      username: database.user,
      password: database.password,
      database: database.name,
      ...(ssl === undefined ? {} : { ssl }),
      // `timestamptz` lưu instant theo UTC; session UTC giữ mọi query/default nhất quán.
      extra: { options: '-c timezone=UTC' },
      entities: [__dirname + '/../**/*.entity{.ts,.js}'],
      migrations: [__dirname + '/migrations/*{.ts,.js}'],
      // Phase 0: dùng migration, không synchronize tự động (bài học DB an toàn)
      synchronize: false,
      migrationsRun: false,
    };
  }
}
