import { classes } from '@automapper/classes';
import { createMapper } from '@automapper/core';

export const MAPPER = Symbol('MAPPER');

export const mapperProvider = {
  provide: MAPPER,
  useFactory: () => createMapper({ strategyInitializer: classes() }),
};
