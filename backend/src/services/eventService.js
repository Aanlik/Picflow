/**
 * Event Service Layer
 * Handles all event-related business logic
 *
 * @module services/eventService
 */

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;
const { db } = require('../database/db');

const { formatBoolean } = require('../utils/dbCompat');
const { hasColumnCached } = require('../utils/schemaCache');
const { getBcryptRounds } = require('../utils/passwordValidation');

const { parseBooleanInput, parseStringInput } = require('../utils/parsers');
const { normaliseEventTimeTriple } = require('./eventTime');
const { toUtcIso } = require('../utils/dateNormalize');

const getStoragePath = () => process.env.STORAGE_PATH || path.join(__dirname, '../../../storage');

// Cache for schema detection
let customerColumnCache = null;

/**
 * Check if the database has the canonical customer_name column
 * @returns {Promise<boolean>}
 */
const hasCustomerContactColumns = async () => {
  if (customerColumnCache === true) {
    return true;
  }

  try {
    const hasColumn = await db.schema.hasColumn('events', 'customer_name');
    if (hasColumn) {
      customerColumnCache = true;
    }
    return hasColumn;
  } catch (error) {
    return false;
  }
};

/**
 * Map event for API response (normalize customer fields)
 * @param {Object} event - Database event object
 * @returns {Object} - Normalized event object
 */
const mapEventForApi = (event) => {
  if (!event || typeof event !== 'object') {
    return event;
  }

  const {
    host_name,
    customer_name,
    ...rest
  } = event;
  return {
    ...rest,
    customer_name: customer_name ?? host_name ?? null
  };
};

/** Generate a unique, category-independent gallery slug. */
const generateUniqueSlug = async (eventName, eventDate) => {
  const processedName = eventName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const baseSlug = `${processedName}-${eventDate}`;
  let slug = baseSlug;
  let counter = 1;

  while (await db('events').where({ slug }).first()) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  return slug;
};

/**
 * Create event storage folders
 * @param {string} slug - Event slug
 * @returns {Promise<string>} - Path to event folder
 */
const createEventFolders = async (slug) => {
  const storagePath = getStoragePath();
  const eventPath = path.join(storagePath, 'events/active', slug);
  await fs.mkdir(path.join(eventPath, 'collages'), { recursive: true });
  await fs.mkdir(path.join(eventPath, 'individual'), { recursive: true });
  return eventPath;
};

/**
 * Create a new event
 * @param {Object} eventData - Event data
 * @returns {Promise<Object>} - Created event
 */
const createEvent = async (eventData, options = {}) => {
  return require('./eventCreationService').createEvent(eventData, {
    ...options,
    actor: options.actor || (eventData.created_by ? { id: eventData.created_by } : undefined),
  });
};

/**
 * Get all events with optional filtering
 * @param {Object} options - Filter options
 * @param {string} options.status - 'all', 'active', or 'archived'
 * @returns {Promise<Array>} - Array of events
 */
const getAllEvents = async (options = {}) => {
  const { status = 'all' } = options;

  let query = db('events').select('*');

  if (status === 'active') {
    query = query.where('is_active', formatBoolean(true));
  } else if (status === 'archived') {
    query = query.where('is_archived', formatBoolean(true));
  }

  const events = await query.orderBy('created_at', 'desc');

  // Add photo counts
  for (const event of events) {
    const photoCount = await db('photos').where('event_id', event.id).count('id as count').first();
    event.photo_count = photoCount.count;
  }

  return events.map(mapEventForApi);
};

/**
 * Get a single event by ID
 * @param {number} id - Event ID
 * @returns {Promise<Object|null>}
 */
const getEventById = async (id) => {
  const event = await db('events').where('id', id).first();
  return event ? mapEventForApi(event) : null;
};

/**
 * Get a single event by slug
 * @param {string} slug - Event slug
 * @returns {Promise<Object|null>}
 */
const getEventBySlug = async (slug) => {
  const event = await db('events').where('slug', slug).first();
  return event ? mapEventForApi(event) : null;
};

/**
 * Update an event
 * @param {number} id - Event ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} - Updated event
 */
const updateEvent = async (id, updates) => {
  const customerColumnsAvailable = await hasCustomerContactColumns();

  // Don't allow updating certain fields
  delete updates.id;
  delete updates.slug;
  delete updates.created_at;
  delete updates.password_confirmation;

  // Handle customer name update
  if (updates.customer_name !== undefined) {
    const nextName = parseStringInput(updates.customer_name);
    if (nextName) {
      if (customerColumnsAvailable) {
        updates.customer_name = nextName;
      } else {
        delete updates.customer_name;
      }
      updates.host_name = nextName;
    } else {
      delete updates.customer_name;
    }
  }

  // Handle require_password update
  if (updates.require_password !== undefined) {
    const requirePasswordUpdate = parseBooleanInput(updates.require_password, true);
    updates.require_password = formatBoolean(requirePasswordUpdate);

    // Get current event to check password requirements
    const event = await db('events').where('id', id).first();
    const currentRequirePassword = parseBooleanInput(event.require_password, true);

    // If enabling password and it was previously disabled, require a new password
    if (requirePasswordUpdate === true && !currentRequirePassword && !updates.password) {
      throw new Error('Password must be provided when enabling password requirement.');
    }

    // If disabling password, generate a random hash
    if (requirePasswordUpdate === false && currentRequirePassword) {
      updates.password_hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), getBcryptRounds());
    }
  }

  // Handle password update
  if (updates.password) {
    updates.password_hash = await bcrypt.hash(updates.password, getBcryptRounds());
    delete updates.password;
  }

  // Migration 137 — calendar time fields. We re-normalise the triple
  // ONLY when at least one of the three fields was supplied; otherwise
  // leave the row's current values alone. is_full_day=true forces both
  // times to null regardless of what was supplied.
  const timeFieldsTouched = (
    updates.event_time_start !== undefined
    || updates.event_time_end !== undefined
    || updates.is_full_day !== undefined
  );
  if (timeFieldsTouched) {
    if (await hasColumnCached('events', 'is_full_day')) {
      const triple = normaliseEventTimeTriple({
        event_time_start: updates.event_time_start,
        event_time_end: updates.event_time_end,
        is_full_day: updates.is_full_day,
      });
      updates.event_time_start = triple.event_time_start;
      updates.event_time_end = triple.event_time_end;
      updates.is_full_day = formatBoolean(triple.is_full_day);
    } else {
      // Un-migrated install — drop the fields silently.
      delete updates.event_time_start;
      delete updates.event_time_end;
      delete updates.is_full_day;
    }
  }

  await db('events').where('id', id).update(updates);

  return { success: true };
};

/**
 * Soft delete an event (mark as inactive)
 * @param {number} id - Event ID
 * @returns {Promise<Object>}
 */
const deleteEvent = async (id) => {
  await db('events').where('id', id).update({ is_active: formatBoolean(false) });
  return { success: true };
};

/**
 * Extend event expiration
 * @param {number} id - Event ID
 * @param {number} days - Days to extend
 * @returns {Promise<Object>}
 */
const extendExpiration = async (id, days) => {
  const event = await db('events').where('id', id).first();
  if (!event) {
    throw new Error('Event not found');
  }

  const expiresAtIso = toUtcIso(event.expires_at);
  const newExpiration = expiresAtIso ? new Date(expiresAtIso) : new Date(Number.NaN);
  if (Number.isNaN(newExpiration.getTime())) {
    throw new Error('Project expiration timestamp is invalid');
  }
  newExpiration.setDate(newExpiration.getDate() + days);

  await db('events').where('id', id).update({
    expires_at: newExpiration,
    is_active: formatBoolean(true) // Reactivate if expired
  });

  return { expires_at: newExpiration };
};

module.exports = {
  // Core CRUD
  createEvent,
  getAllEvents,
  getEventById,
  getEventBySlug,
  updateEvent,
  deleteEvent,
  extendExpiration,

  // Utilities
  mapEventForApi,
  hasCustomerContactColumns,
  generateUniqueSlug,
  createEventFolders,
  // Calendar time triple normaliser (migration 137). Exported so the
  // inline adminEvents POST/PUT (which doesn't go through createEvent)
  // can share the validation contract.
  normaliseEventTimeTriple
};
