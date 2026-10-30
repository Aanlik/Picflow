'use strict';

exports.up = async (knex) => {
  if (!(await knex.schema.hasTable('photo_retouch_requests'))) return;
  if (!(await knex.schema.hasColumn('photo_retouch_requests', 'guest_name'))) {
    await knex.schema.alterTable('photo_retouch_requests', (table) => {
      table.string('guest_name', 100).nullable();
    });
  }

  if (!(await knex.schema.hasTable('gallery_guests'))) return;
  const requests = await knex('photo_retouch_requests')
    .whereNull('guest_name')
    .whereNotNull('guest_identifier')
    .select('id', 'event_id', 'guest_id', 'guest_identifier');
  for (const request of requests) {
    const guestQuery = knex('gallery_guests').where({ event_id: request.event_id });
    if (request.guest_id) guestQuery.andWhere({ id: request.guest_id });
    else guestQuery.andWhere({ identifier: request.guest_identifier });
    const guest = await guestQuery.select('name').first();
    if (guest?.name) {
      await knex('photo_retouch_requests').where({ id: request.id }).update({ guest_name: guest.name });
    }
  }
};

exports.down = async (knex) => {
  if (await knex.schema.hasColumn('photo_retouch_requests', 'guest_name')) {
    await knex.schema.alterTable('photo_retouch_requests', (table) => table.dropColumn('guest_name'));
  }
};
