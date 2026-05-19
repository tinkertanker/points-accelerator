const DATE_TIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function toDateTimeLocalInputValue(value: string | null, timeZoneOffsetMinutes?: number) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offset = timeZoneOffsetMinutes ?? date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export function fromDateTimeLocalInputValue(value: string, timeZoneOffsetMinutes?: number) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (timeZoneOffsetMinutes === undefined) {
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const match = DATE_TIME_LOCAL_PATTERN.exec(trimmed);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute] = match;
  const parts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  };

  if (
    parts.month < 1 ||
    parts.month > 12 ||
    parts.hour < 0 ||
    parts.hour > 23 ||
    parts.minute < 0 ||
    parts.minute > 59
  ) {
    return null;
  }

  const localUtcTime = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const localDate = new Date(localUtcTime);
  if (
    localDate.getUTCFullYear() !== parts.year ||
    localDate.getUTCMonth() !== parts.month - 1 ||
    localDate.getUTCDate() !== parts.day ||
    localDate.getUTCHours() !== parts.hour ||
    localDate.getUTCMinutes() !== parts.minute
  ) {
    return null;
  }

  const utcTime = localUtcTime + timeZoneOffsetMinutes * 60_000;

  return new Date(utcTime).toISOString();
}
