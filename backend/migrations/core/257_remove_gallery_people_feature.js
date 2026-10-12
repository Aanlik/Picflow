/**
 * Remove the retired "People in this gallery" face-recognition feature.
 *
 * The tables only contain derived face detections, biometric embeddings,
 * person labels and merge decisions. The photo and event records themselves
 * remain intact. Automatic categories created by this feature are cleared
 * before their tracking column is removed.
 */

const FACE_SETTINGS = [
  'face_match_threshold',
  'face_min_cluster_size',
  'face_quality_min_score',
  'face_quality_min_px',
  'face_auto_categorize_enabled',
];

const PHOTO_COLUMNS = [
  'face_status',
  'face_count',
  'face_started_at',
  'face_error',
  'auto_categorized',
];

const EVENT_COLUMNS = [
  'face_recognition_enabled',
  'faces_visible_to_guests',
  'faces_last_scan_at',
  'faces_last_consolidated_count',
  'faces_last_consolidated_at',
];

async function dropColumns(knex, tableName, columns) {
  if (!(await knex.schema.hasTable(tableName))) return;
  for (const columnName of columns) {
    if (!(await knex.schema.hasColumn(tableName, columnName))) continue;
    await knex.schema.alterTable(tableName, (table) => table.dropColumn(columnName));
  }
}

exports.up = async function up(knex) {
  if (await knex.schema.hasTable('photos')) {
    const hasAutoCategoryFlag = await knex.schema.hasColumn('photos', 'auto_categorized');
    const hasCategory = await knex.schema.hasColumn('photos', 'category_id');
    if (hasAutoCategoryFlag && hasCategory) {
      await knex('photos').where({ auto_categorized: true }).update({ category_id: null });
    }
  }

  // Drop children before their referenced people table.
  for (const tableName of [
    'event_people_merge_dismissals',
    'photo_faces',
    'event_people',
  ]) {
    if (await knex.schema.hasTable(tableName)) await knex.schema.dropTable(tableName);
  }

  await dropColumns(knex, 'photos', PHOTO_COLUMNS);
  await dropColumns(knex, 'events', EVENT_COLUMNS);

  if (await knex.schema.hasTable('app_settings')) {
    await knex('app_settings')
      .whereIn('setting_key', FACE_SETTINGS)
      .orWhere('setting_type', 'faces')
      .del();
  }
  if (await knex.schema.hasTable('feature_flags')) {
    await knex('feature_flags').where({ key: 'faces' }).del();
  }

  // SQLite rebuilds `photos` when these columns are dropped and removes its
  // triggers as a side effect. Migration 251 installs the archive write guard
  // on that table, so restore those triggers after the rebuild (also safe for
  // upgrades where the guard was never installed).
  await require('./251_workflow_archive_guard_and_unbind').up(knex);
};

exports.down = async function down() {
  // Deliberately irreversible: biometric indexes and labels are erased by up.
  // Recreating an empty feature schema would imply a rollback can restore them.
};
