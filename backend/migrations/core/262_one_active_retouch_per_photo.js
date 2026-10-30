'use strict';

const INDEX = 'photo_retouch_one_active_per_photo_idx';

exports.up = async (knex) => {
  if (!(await knex.schema.hasTable('photo_retouch_requests'))) return;
  for (const column of ['event_id', 'photo_id', 'status']) {
    if (!(await knex.schema.hasColumn('photo_retouch_requests', column))) return;
  }

  // Preserve every historical request. Where legacy data already has several
  // open requests for one photo, keep the newest request active and mark the
  // older active rows cancelled before enforcing the one-active-request rule.
  const active = await knex('photo_retouch_requests')
    .whereNotIn('status', ['cancelled', 'completed', 'closed'])
    .select('id', 'event_id', 'photo_id')
    .orderBy('id', 'desc');
  const seen = new Set();
  const superseded = [];
  for (const row of active) {
    const key = `${row.event_id}:${row.photo_id}`;
    if (seen.has(key)) superseded.push(row.id);
    else seen.add(key);
  }
  for (let offset = 0; offset < superseded.length; offset += 500) {
    await knex('photo_retouch_requests')
      .whereIn('id', superseded.slice(offset, offset + 500))
      .update({ status: 'cancelled', updated_at: knex.fn.now() });
  }

  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS ${INDEX}
    ON photo_retouch_requests (event_id, photo_id)
    WHERE status NOT IN ('cancelled', 'completed', 'closed')`);
};

exports.down = async (knex) => {
  if (!(await knex.schema.hasTable('photo_retouch_requests'))) return;
  await knex.raw(`DROP INDEX IF EXISTS ${INDEX}`);
};
