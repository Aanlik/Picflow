'use strict';

const { normalizeMultipartFilename } = require('../../src/utils/normalizeMultipartFilename');

/**
 * Multipart filename decoding was inconsistent across browsers. The upload
 * path now normalizes a Latin-1 view of UTF-8 bytes; repair existing display
 * names using the same lossless check. Storage `filename`/`path` are never
 * touched, so media files remain at their existing keys.
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('photos')) || !(await knex.schema.hasColumn('photos', 'id'))) return;
  const columns = ['original_filename', 'source_filename'];
  const available = [];
  for (const column of columns) {
    if (await knex.schema.hasColumn('photos', column)) available.push(column);
  }
  if (!available.length) return;

  let lastId = 0;
  while (true) {
    const rows = await knex('photos')
      .where('id', '>', lastId)
      .select('id', ...available)
      .orderBy('id', 'asc')
      .limit(500);
    if (!rows.length) break;

    for (const row of rows) {
      const update = {};
      for (const column of available) {
        const normalized = normalizeMultipartFilename(row[column]);
        if (normalized !== row[column]) update[column] = normalized;
      }
      if (Object.keys(update).length) await knex('photos').where({ id: row.id }).update(update);
      lastId = row.id;
    }
  }
};

exports.down = async function down() {
  // The original byte sequence cannot be inferred after repair. Reverting
  // would reintroduce corrupted names and can never safely restore literals.
};
