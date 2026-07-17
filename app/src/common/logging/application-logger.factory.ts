import { ConsoleLogger, type LogLevel } from '@nestjs/common';

interface ApplicationLoggerOptions {
  readonly context?: string;
  readonly environment?: string;
}

class DevelopmentConsoleLogger extends ConsoleLogger {
  protected stringifyMessage(message: unknown, logLevel: LogLevel): string {
    if (isApplicationEvent(message)) {
      return formatApplicationEvent(message);
    }

    return super.stringifyMessage(message, logLevel);
  }
}

export function createApplicationLogger(options: ApplicationLoggerOptions = {}): ConsoleLogger {
  const environment = options.environment ?? process.env.NODE_ENV;
  if (environment === 'production') {
    return new ConsoleLogger({ context: options.context, json: true });
  }

  return new DevelopmentConsoleLogger({ context: options.context });
}

function isApplicationEvent(message: unknown): message is Record<string, unknown> {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return false;
  if (Object.getPrototypeOf(message) !== Object.prototype) return false;
  return 'event' in message && typeof message.event === 'string';
}

function formatApplicationEvent(event: Record<string, unknown>): string {
  const details = Object.keys(event)
    .filter((key) => key !== 'event')
    .sort()
    .map((key) => `${key}=${formatEventValue(event[key])}`);
  return [event.event, ...details].join(' ');
}

function formatEventValue(value: unknown): string {
  if (typeof value === 'string') {
    return /^[A-Za-z0-9._:/-]+$/u.test(value) ? value : JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return `[${typeof value}]`;
}
