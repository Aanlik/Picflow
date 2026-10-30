const path = require('path');
const { formatBoolean } = require('../../src/utils/dbCompat');
const { parseBooleanInput } = require('../../src/utils/parsers');

function normalizeLegacyPath(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const input = value.trim();
  if (input.includes('\\') || input.includes('\0')
      || path.posix.isAbsolute(input) || path.win32.isAbsolute(input) || /^[A-Za-z]:/.test(input)) return null;
  const normalized = input.replace(/\/+$/g, '');
  const parts = normalized.split('/');
  if (!normalized || parts.some((part) => !part || part === '.' || part === '..')
      || parts.some((part) => part.toLocaleLowerCase() === 'pixcakedelivery')) return null;
  return normalized;
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('external_media_sources'))) {
    await knex.schema.createTable('external_media_sources', (table) => {
      table.increments('id').primary();
      table.integer('event_id').notNullable().references('id').inTable('events').onDelete('CASCADE');
      table.string('root_id', 64).notNullable().defaultTo('default');
      table.text('relative_path').notNullable().defaultTo('');
      table.string('purpose', 16).notNullable().defaultTo('gallery');
      table.boolean('watch_enabled').notNullable().defaultTo(false);
      table.string('status', 32).notNullable().defaultTo('ready');
      table.boolean('is_active').notNullable().defaultTo(true);
      table.timestamp('last_scanned_at').nullable();
      table.text('last_error').nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      table.unique(['event_id', 'root_id', 'relative_path'], 'external_media_sources_event_root_path_uniq');
      table.index(['event_id', 'is_active'], 'external_media_sources_event_active_idx');
      table.index(['watch_enabled', 'is_active'], 'external_media_sources_watch_idx');
    });
  }
  if (!(await knex.schema.hasColumn('photos', 'external_source_id'))) {
    await knex.schema.alterTable('photos', (table) => table.integer('external_source_id').nullable());
  }
  await knex.raw('CREATE INDEX IF NOT EXISTS photos_event_external_source_idx ON photos (event_id, external_source_id)');

  // The old event fields only identify the last folder. Preserve them for
  // compatibility, and migrate exactly that known folder without rebasing any
  // photo path or moving any source file.
  if (!(await knex.schema.hasColumn('events', 'external_path'))) return;
  const events = await knex('events').whereNotNull('external_path').select('id', 'external_path', 'external_watch');
  for (const event of events) {
    const rawPath = String(event.external_path || '');
    const relativePath = normalizeLegacyPath(rawPath);
    // Do not turn an old absolute host path, invalid traversal, or the
    // delivery workspace into a misleading path below the new mount root.
    // The legacy value remains in events.external_path, and any photos stay
    // unlinked so administrators can explicitly add the correct folder.
    if (relativePath === null) continue;
    const watchEnabled = parseBooleanInput(event.external_watch, false);
    const existing = await knex('external_media_sources').where({
      event_id: event.id, root_id: 'default', relative_path: relativePath,
    }).first();
    let sourceId = existing?.id;
    if (!sourceId) {
      const result = await knex('external_media_sources').insert({
        event_id: event.id,
        root_id: 'default',
        relative_path: relativePath,
        purpose: 'both',
        watch_enabled: formatBoolean(watchEnabled),
        status: watchEnabled ? 'watching' : 'pending',
        is_active: true,
      }).returning('id');
      sourceId = result[0]?.id ?? result[0];
    }
    const prefix = relativePath ? `${relativePath}/` : '';
    const photos = await knex('photos')
      .where({ event_id: event.id })
      .whereNotNull('external_relpath')
      .whereNull('external_source_id')
      .select('id', 'external_relpath');
    const matchingIds = photos
      .filter((photo) => photo.external_relpath === relativePath || photo.external_relpath.startsWith(prefix))
      .map((photo) => photo.id);
    for (let i = 0; i < matchingIds.length; i += 500) {
      await knex('photos').whereIn('id', matchingIds.slice(i, i + 500)).update({ external_source_id: sourceId });
    }
  }
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS photos_event_external_source_idx');
  if (await knex.schema.hasColumn('photos', 'external_source_id')) {
    await knex.schema.alterTable('photos', (table) => {
      table.dropColumn('external_source_id');
    });
  }
  if (await knex.schema.hasTable('external_media_sources')) await knex.schema.dropTable('external_media_sources');
};
