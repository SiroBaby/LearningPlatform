import {
  isISO8601,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

export function IsUtcDateTime(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    registerDecorator({
      name: 'isUtcDateTime',
      target: target.constructor,
      propertyName: propertyKey.toString(),
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return (
            typeof value === 'string' &&
            value.endsWith('Z') &&
            isISO8601(value, { strict: true, strictSeparator: true })
          );
        },
        defaultMessage(arguments_: ValidationArguments): string {
          return `${arguments_.property} must be an ISO-8601 UTC datetime`;
        },
      },
    });
  };
}
