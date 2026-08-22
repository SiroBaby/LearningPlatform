export class DateTimeUtil {
  static nowUtc(): Date {
    return new Date();
  }

  static toUtcIsoString(value: Date): string {
    return value.toISOString();
  }
}
