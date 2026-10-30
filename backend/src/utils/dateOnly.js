/**
 * Helpers for calendar dates (for example events.event_date).
 *
 * A YYYY-MM-DD value is not an instant and must not be parsed with
 * `new Date(value)`: JavaScript interprets that form as UTC, which can display
 * as the previous local day west of UTC. Keep date-only arithmetic in UTC,
 * and only create a local-midnight Date when the product needs a local-time
 * timestamp (such as an expiration at the start of a calendar day).
 */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateOnly(value) {
  if (typeof value !== 'string') return null;
  const match = DATE_ONLY.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) return null;
  return { year, month, day };
}

function formatLocalDateOnly(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateOnlyLocalMidnight(value) {
  const parts = parseDateOnly(value);
  if (!parts) return null;
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(parts.year, parts.month - 1, parts.day);
  return date;
}

function addCalendarDays(value, days) {
  const parts = parseDateOnly(value);
  const amount = Number(days);
  if (!parts || !Number.isInteger(amount)) return null;

  // setUTCFullYear avoids Date.UTC's special treatment of years 0–99.
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function calendarDaysBetween(start, end) {
  const from = parseDateOnly(start);
  const to = parseDateOnly(end);
  if (!from || !to) return NaN;

  const startUtc = new Date(0);
  startUtc.setUTCHours(0, 0, 0, 0);
  startUtc.setUTCFullYear(from.year, from.month - 1, from.day);
  const endUtc = new Date(0);
  endUtc.setUTCHours(0, 0, 0, 0);
  endUtc.setUTCFullYear(to.year, to.month - 1, to.day);
  return (endUtc.getTime() - startUtc.getTime()) / DAY_MS;
}

module.exports = {
  parseDateOnly,
  formatLocalDateOnly,
  dateOnlyLocalMidnight,
  addCalendarDays,
  calendarDaysBetween,
};
