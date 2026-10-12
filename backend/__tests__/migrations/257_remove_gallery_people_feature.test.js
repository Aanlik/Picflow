const knexFactory = require('knex');
const migration = require('../../migrations/core/257_remove_gallery_people_feature');

describe('migration 257 — remove People in this gallery', () => {
  let db;

  beforeEach(async () => {
    db = knexFactory({
      client: 'sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await db.schema.createTable('events', (table) => {
      table.increments('id').primary();
      table.string('event_name');
      table.boolean('face_recognition_enabled');
      table.boolean('faces_visible_to_guests');
      table.timestamp('faces_last_scan_at');
      table.integer('faces_last_consolidated_count');
      table.timestamp('faces_last_consolidated_at');
    });
    await db.schema.createTable('photos', (table) => {
      table.increments('id').primary();
      table.integer('event_id');
      table.integer('category_id');
      table.string('filename');
      table.string('face_status');
      table.integer('face_count');
      table.timestamp('face_started_at');
      table.text('face_error');
      table.boolean('auto_categorized');
      table.index(['face_status'], 'photos_face_status_idx');
      table.index(['auto_categorized'], 'photos_auto_categorized_idx');
    });
    await db.schema.createTable('event_people', (table) => {
      table.increments('id').primary();
      table.integer('event_id');
      table.binary('centroid');
      table.string('label');
    });
    await db.schema.createTable('photo_faces', (table) => {
      table.increments('id').primary();
      table.integer('photo_id').references('id').inTable('photos');
      table.integer('person_id').references('id').inTable('event_people');
      table.binary('embedding');
    });
    await db.schema.createTable('event_people_merge_dismissals', (table) => {
      table.increments('id').primary();
      table.integer('event_id');
      table.binary('centroid_a');
      table.binary('centroid_b');
    });
    await db.schema.createTable('app_settings', (table) => {
      table.string('setting_key').primary();
      table.text('setting_value');
      table.string('setting_type');
    });
    await db.schema.createTable('feature_flags', (table) => {
      table.string('key').primary();
      table.boolean('value');
    });

    await db('events').insert({ id: 1, event_name: 'Keep project', face_recognition_enabled: true });
    await db('photos').insert([
      { id: 1, event_id: 1, category_id: 20, filename: 'auto.jpg', auto_categorized: true, face_status: 'done' },
      { id: 2, event_id: 1, category_id: 21, filename: 'manual.jpg', auto_categorized: false, face_status: 'pending' },
    ]);
    await db('event_people').insert({ id: 1, event_id: 1, label: 'Person', centroid: Buffer.from([1]) });
    await db('photo_faces').insert({ id: 1, photo_id: 1, person_id: 1, embedding: Buffer.from([1]) });
    await db('event_people_merge_dismissals').insert({ id: 1, event_id: 1, centroid_a: Buffer.from([1]), centroid_b: Buffer.from([2]) });
    await db('app_settings').insert([
      { setting_key: 'face_match_threshold', setting_value: '0.6', setting_type: 'faces' },
      { setting_key: 'unrelated', setting_value: 'keep', setting_type: 'general' },
    ]);
    await db('feature_flags').insert([
      { key: 'faces', value: true },
      { key: 'galleries', value: true },
    ]);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('removes face data and settings while retaining projects and ordinary photo data', async () => {
    await migration.up(db);
    await migration.up(db);

    for (const table of ['photo_faces', 'event_people', 'event_people_merge_dismissals']) {
      expect(await db.schema.hasTable(table)).toBe(false);
    }
    for (const column of [
      'face_status', 'face_count', 'face_started_at', 'face_error', 'auto_categorized',
    ]) {
      expect(await db.schema.hasColumn('photos', column)).toBe(false);
    }
    for (const column of [
      'face_recognition_enabled', 'faces_visible_to_guests', 'faces_last_scan_at',
      'faces_last_consolidated_count', 'faces_last_consolidated_at',
    ]) {
      expect(await db.schema.hasColumn('events', column)).toBe(false);
    }
    expect(await db('events').select('event_name')).toEqual([{ event_name: 'Keep project' }]);
    expect(await db('photos').select('filename', 'category_id').orderBy('id')).toEqual([
      { filename: 'auto.jpg', category_id: null },
      { filename: 'manual.jpg', category_id: 21 },
    ]);
    expect(await db('app_settings').pluck('setting_key')).toEqual(['unrelated']);
    expect(await db('feature_flags').pluck('key')).toEqual(['galleries']);
  });

  it('restores the SQLite archive write guard after rebuilding the photos table', async () => {
    await migration.up(db);
    await db('events').where({ id: 1 }).update({ is_archiving: true });

    await expect(db('photos').where({ id: 1 }).update({ filename: 'changed.jpg' }))
      .rejects.toThrow('Project archive in progress');
    await expect(db('photos').where({ id: 1 }).delete())
      .rejects.toThrow('Project archive in progress');
    await expect(db('photos').insert({ event_id: 1, filename: 'new.jpg' }))
      .rejects.toThrow('Project archive in progress');
  });
});
