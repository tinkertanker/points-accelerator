import { Decimal } from "@prisma/client/runtime/library";

export function decimal(value: number | string | Decimal): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

export function decimalToNumber(value: Decimal | null | undefined): number {
  if (!value) {
    return 0;
  }

  return Number(value.toString());
}

export function maxDecimalMagnitude(...values: Array<Decimal | number>): number {
  return values.reduce<number>((largest, current) => {
    const numeric = current instanceof Decimal ? decimalToNumber(current) : current;
    return Math.max(largest, Math.abs(numeric));
  }, 0);
}
