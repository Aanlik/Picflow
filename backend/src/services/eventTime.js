const { parseBooleanInput, parseStringInput } = require('../utils/parsers');
const { AppError } = require('../utils/errors');

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Normalize and validate the event time fields shared by create and update. */
function normaliseEventTimeTriple({ event_time_start, event_time_end, is_full_day }) {
  const isFullDay = is_full_day === undefined ? true : parseBooleanInput(is_full_day, true);
  if (isFullDay) {
    return { event_time_start: null, event_time_end: null, is_full_day: true };
  }
  const start = parseStringInput(event_time_start);
  const end = parseStringInput(event_time_end);
  if (!start || !TIME_RE.test(start)) {
    throw new AppError('event_time_start must be HH:MM (24h)', 400, 'EVENT_TIME_INVALID');
  }
  if (!end || !TIME_RE.test(end)) {
    throw new AppError('event_time_end must be HH:MM (24h)', 400, 'EVENT_TIME_INVALID');
  }
  if (start >= end) {
    throw new AppError('event_time_end must be after event_time_start', 400, 'EVENT_TIME_RANGE');
  }
  return { event_time_start: start, event_time_end: end, is_full_day: false };
}

module.exports = { normaliseEventTimeTriple };
