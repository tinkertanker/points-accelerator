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
  const utcTime =
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
    ) + timeZoneOffsetMinutes * 60_000;

  return new Date(utcTime).toISOString();
}
