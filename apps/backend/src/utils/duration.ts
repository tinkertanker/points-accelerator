import { AppError } from "./app-error.js";

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const UNIT_MS: Record<string, number> = {
  s: SECOND_MS,
  sec: SECOND_MS,
  secs: SECOND_MS,
  second: SECOND_MS,
  seconds: SECOND_MS,
  m: MINUTE_MS,
  min: MINUTE_MS,
  mins: MINUTE_MS,
  minute: MINUTE_MS,
  minutes: MINUTE_MS,
  h: HOUR_MS,
  hr: HOUR_MS,
  hrs: HOUR_MS,
  hour: HOUR_MS,
  hours: HOUR_MS,
  d: DAY_MS,
  day: DAY_MS,
  days: DAY_MS,
};

export const MIN_LUCKY_DRAW_DURATION_MS = 10 * SECOND_MS;
export const MAX_LUCKY_DRAW_DURATION_MS = 7 * DAY_MS;

export function parseDuration(input: string): number {
  const trimmed = input.trim().toLowerCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)$/);
  if (!match) {
    throw new AppError(
      `Could not parse "${input}" as a duration. Try e.g. 30s, 5m, 1 hour, or 2 days.`,
      400,
    );
  }
  const [, valueRaw, unit] = match as unknown as [string, string, string];
  const value = Number.parseFloat(valueRaw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new AppError(`Duration must be a positive number (got "${input}").`, 400);
  }
  const factor = UNIT_MS[unit];
  if (!factor) {
    throw new AppError(
      `Unknown time unit "${unit}". Use seconds, minutes, hours, or days (s/m/h/d).`,
      400,
    );
  }
  const total = Math.round(value * factor);
  if (total < MIN_LUCKY_DRAW_DURATION_MS) {
    throw new AppError("Duration must be at least 10 seconds.", 400);
  }
  if (total > MAX_LUCKY_DRAW_DURATION_MS) {
    throw new AppError("Duration must be at most 7 days.", 400);
  }
  return total;
}
