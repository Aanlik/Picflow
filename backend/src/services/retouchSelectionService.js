'use strict';

const { db } = require('../database/db');
const { SHARED_COLOR_LABEL_IDENTITY } = require('../constants/colorLabels');

const SHARED_RETOUCH_IDENTITY = '__shared_retouch_selection__';

function identityFor({ identity_mode, guest_id, guest_identifier, guest_name }) {
  if (identity_mode === 'shared') {
    return {
      identity_key: 'shared',
      guest_id: null,
      guest_identifier: SHARED_RETOUCH_IDENTITY,
      guest_name: null,
    };
  }
  const guestId = guest_id == null ? null : Number(guest_id);
  return {
    identity_key: guestId ? `guest:${guestId}` : `identifier:${guest_identifier}`,
    guest_id: guestId,
    guest_identifier: String(guest_identifier || ''),
    guest_name: guest_name ? String(guest_name).slice(0, 100) : null,
  };
}

function identityKeyFromLegacy(row) {
  if (row.guest_identifier === SHARED_COLOR_LABEL_IDENTITY) return 'shared';
  return row.guest_id == null ? `identifier:${row.guest_identifier || ''}` : `guest:${Number(row.guest_id)}`;
}

async function selectionTableMigrated(eventId, executor = db) {
  return Boolean(await executor('photo_retouch_selection_migrations').where({ event_id: Number(eventId) }).first());
}

async function migrateLegacyGreenSelections(eventId) {
  const id = Number(eventId);
  await db.transaction(async (trx) => {
    await trx('events').where({ id }).forUpdate().first();
    if (await selectionTableMigrated(id, trx)) return;

    // Before the dedicated action existed, workflow picks were stored as the
    // reserved green colour. Move those active marks once, only after the
    // Bridge confirms this is a workflow-enabled project. That preserves old
    // selections while allowing green to become an ordinary colour afterwards.
    const legacyRows = await trx('photo_feedback').where({
      event_id: id,
      feedback_type: 'color_label',
      color_label: 'green',
      is_hidden: false,
    }).select('id', 'photo_id', 'guest_id', 'guest_identifier', 'guest_name', 'created_at', 'updated_at');

    if (legacyRows.length) {
      const now = new Date().toISOString();
      const migrated = legacyRows.map((row) => ({
        event_id: id,
        photo_id: Number(row.photo_id),
        guest_id: row.guest_id == null ? null : Number(row.guest_id),
        guest_identifier: row.guest_identifier === SHARED_COLOR_LABEL_IDENTITY
          ? SHARED_RETOUCH_IDENTITY
          : String(row.guest_identifier || ''),
        identity_key: identityKeyFromLegacy(row),
        guest_name: row.guest_name || null,
        created_at: row.created_at || now,
        updated_at: row.updated_at || now,
      }));
      await trx('photo_retouch_selections')
        .insert(migrated)
        .onConflict(['photo_id', 'identity_key'])
        .ignore();
      await trx('photo_feedback').whereIn('id', legacyRows.map((row) => row.id)).delete();

      const feedbackService = require('./feedbackService');
      for (const photoId of new Set(legacyRows.map((row) => Number(row.photo_id)))) {
        await feedbackService.updatePhotoFeedbackStats(photoId, trx);
      }
    }

    await trx('photo_retouch_selection_migrations').insert({ event_id: id, migrated_at: new Date().toISOString() })
      .onConflict('event_id').ignore();
  });
}

async function writeSelection(executor, eventId, photoId, identity, selected) {
  const id = Number(photoId);
  await executor('photos').where({ id, event_id: Number(eventId) }).forUpdate().first();
  if (await executor('workflow_withdrawal_intents').where({ photo_id: id, event_id: Number(eventId) }).first()) {
    const error = new Error('撤回任务仍在处理中，请稍后重新选片');
    error.code = 'WITHDRAW_PENDING';
    throw error;
  }
  const scope = executor('photo_retouch_selections').where({
    event_id: Number(eventId), photo_id: id, identity_key: identity.identity_key,
  });
  if (!selected) {
    const removed = await scope.delete();
    return { selected: false, removed: Number(removed) > 0 };
  }

  const now = new Date().toISOString();
  await executor('photo_retouch_selections').insert({
    event_id: Number(eventId), photo_id: id, ...identity, created_at: now, updated_at: now,
  }).onConflict(['photo_id', 'identity_key']).merge({
    guest_id: identity.guest_id,
    guest_identifier: identity.guest_identifier,
    guest_name: identity.guest_name,
    updated_at: now,
  });
  return { selected: true, removed: false };
}

async function setRetouchSelection(eventId, photoId, identityInput, selected, executor = db) {
  const identity = identityFor(identityInput);
  const mutate = (trx) => writeSelection(trx, eventId, photoId, identity, Boolean(selected));
  return executor === db ? db.transaction(mutate) : mutate(executor);
}

async function setRetouchSelections(eventId, photoIds, identityInput, selected = true) {
  const identity = identityFor(identityInput);
  return db.transaction(async (trx) => {
    const results = [];
    for (const photoId of photoIds) {
      results.push(await writeSelection(trx, eventId, photoId, identity, Boolean(selected)));
    }
    return results;
  });
}

async function removeRetouchSelection(eventId, photoId, identityInput, executor = db) {
  return setRetouchSelection(eventId, photoId, identityInput, false, executor);
}

async function hasOtherRetouchSelection(eventId, photoId, identityInput, executor = db) {
  const identity = identityFor(identityInput);
  return Boolean(await executor('photo_retouch_selections')
    .where({ event_id: Number(eventId), photo_id: Number(photoId) })
    .whereNot('identity_key', identity.identity_key)
    .first('id'));
}

async function getSelectedPhotoIds(eventId, photoIds, identityInput = null, executor = db) {
  if (!photoIds?.length) return new Set();
  let query = executor('photo_retouch_selections')
    .where({ event_id: Number(eventId) })
    .whereIn('photo_id', photoIds.map(Number));
  if (identityInput) query = query.where('identity_key', identityFor(identityInput).identity_key);
  const rows = await query.distinct('photo_id');
  return new Set(rows.map((row) => Number(row.photo_id)));
}

async function getBridgeSelectionState(eventId, photoIds, executor = db) {
  const selected = await getSelectedPhotoIds(eventId, photoIds, null, executor);
  if (await selectionTableMigrated(eventId, executor)) {
    return new Map(photoIds.map((photoId) => [Number(photoId), selected.has(Number(photoId))]));
  }
  // `null` tells the one-time-upgrade Bridge adapter to keep using the legacy
  // green label until a bound project's existing marks have been migrated.
  return new Map(photoIds.map((photoId) => [Number(photoId), selected.has(Number(photoId)) ? true : null]));
}

module.exports = {
  identityFor,
  migrateLegacyGreenSelections,
  setRetouchSelection,
  setRetouchSelections,
  removeRetouchSelection,
  hasOtherRetouchSelection,
  getSelectedPhotoIds,
  getBridgeSelectionState,
};
