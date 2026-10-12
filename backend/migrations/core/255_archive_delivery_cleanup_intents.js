'use strict';

// Permanent archive deletion can outlive a PicPeak request or a Bridge outage.
// Persist whether the Bridge must also remove the project's generated NAS
// delivery folders; ordinary project unbinding keeps the default false.
exports.up = async (knex) => {
  if (await knex.schema.hasTable('workflow_unbind_intents')
      && !(await knex.schema.hasColumn('workflow_unbind_intents', 'delete_delivery'))) {
    await knex.schema.alterTable('workflow_unbind_intents', (table) => {
      table.boolean('delete_delivery').notNullable().defaultTo(false);
    });
  }
};

exports.down = async () => {};
