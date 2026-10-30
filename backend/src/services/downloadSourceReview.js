function unknownPhotos(db, eventId) {
  return db('photos').where({ event_id: eventId }).whereNull('download_source_kind')
    .where(function () { this.whereNotIn('source_origin', ['external', 'reference']).orWhereNull('source_origin'); });
}

async function listUnknownSources(db, eventId) {
  const count = await unknownPhotos(db, eventId).count('* as count').first();
  const photos = await unknownPhotos(db, eventId)
    .select('id', 'filename', 'original_filename', 'source_filename').orderBy('id').limit(50);
  return { photos, total: Number(count.count) };
}

async function classifyUnknownSource(db, eventId, photoId, kind, filename) {
  if (!['original', 'delivery'].includes(kind)) throw new TypeError('Invalid download source');
  const query = unknownPhotos(db, eventId).where({ id: photoId });
  if (typeof filename === 'string') query.where({ filename });
  return query.update({ download_source_kind: kind });
}

async function listReviewedSources(db, eventId, page = 1) {
  const query = () => db('photos').where({ event_id: eventId })
    .whereIn('download_source_kind', ['original', 'delivery'])
    .where(function () { this.whereNotIn('source_origin', ['external', 'reference']).orWhereNull('source_origin'); });
  const count = await query().count('* as count').first();
  const photos = await query().select('id', 'filename', 'original_filename', 'source_filename', 'download_source_kind')
    .orderBy('id').limit(50).offset((page - 1) * 50);
  return { photos, total: Number(count.count) };
}

async function changeReviewedSource(db, eventId, photoId, expected, filename, kind) {
  if (!['original', 'delivery'].includes(kind) || !['original', 'delivery'].includes(expected) || typeof filename !== 'string') throw new TypeError('Invalid download source');
  return db('photos').where({ event_id: eventId, id: photoId, download_source_kind: expected, filename })
    .where(function () { this.whereNotIn('source_origin', ['external', 'reference']).orWhereNull('source_origin'); })
    .update({ download_source_kind: kind });
}

module.exports = { listUnknownSources, classifyUnknownSource, listReviewedSources, changeReviewedSource };
