import { Injectable } from '@nestjs/common';
import { DataSource, EntityTarget, ObjectLiteral, Repository } from 'typeorm';

@Injectable()
export abstract class BaseRepository<T extends ObjectLiteral> extends Repository<T> {
  protected constructor(entity: EntityTarget<T>, dataSource: DataSource) {
    super(entity, dataSource.createEntityManager());
  }
}
