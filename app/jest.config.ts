import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '(^|/)(src|test)/.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Testcontainers cần thời gian kéo image + khởi động Postgres
  testTimeout: 120000,
};

export default config;
