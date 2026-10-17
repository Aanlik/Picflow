// Extracted verbatim from the original routes/adminEvents.js (see ./index.js).
// Exports a register function; ./index.js calls the sub-routers in the original
// registration order so Express route matching is unchanged.

const { body, validationResult } = require('express-validator');
const { db, logActivity } = require('../../database/db');
const { formatBoolean } = require('../../utils/dbCompat');
const { adminAuth } = require('../../middleware/auth');
const { requirePermission } = require('../../middleware/permissions');
const { archiveEvent } = require('../../services/archiveService');
const logger = require('../../utils/logger');
const { errorResponse, safeValidationErrors } = require('../../utils/routeHelpers');
const { requireEventOwnership, filterOwnedEventIds } = require('../../middleware/ownership');
const { deleteEventCascade } = require('./helpers');

function publicArchiveError(error) {
  const message = String(error?.message || '');
  if (/无法暂停精修同步|无法确认精修同步状态|无法读取精修交付状态|项目已归档或正在归档/.test(message)) return message;
  if (['ENOSPC', 'SQLITE_FULL'].includes(error?.code)) return '归档失败：存储空间不足。';
  if (['EACCES', 'EPERM', 'EROFS', 'SQLITE_READONLY'].includes(error?.code)) return '归档失败：存储目录没有写入权限。';
  return '归档失败，请检查存储空间和目录权限，并查看服务器日志。';
}


// Bulk delete — destructive, irreversible. Caps at 100 events per request
// to keep request time bounded; the per-event cascade touches 5 DB tables
// + 3 filesystem paths so 1000 events would risk timing out the request.
// Loops via deleteEventCascade so the per-event delete behaviour stays in
// lock-step with DELETE /:id.
//
// Confirmation is enforced client-side via the typed-DELETE pattern in
// BulkDeleteModal (#417). The previous server-side bcrypt-password gate
// was dropped because the destructive single-event DELETE /:id has never
// required a password either — events.delete permission + admin session
// is the auth boundary for both. The typed-literal client gate is the
// "accidental click" safeguard, and unlike a password input it isn't
// affected by passkey/Windows Hello autofill that auto-submits the form.
const BULK_DELETE_MAX = 100;

module.exports = (router) => {


  // Archive event
  router.post('/:id/archive', adminAuth, requirePermission('events.archive'), requireEventOwnership, async (req, res) => {
    try {
      const { id } = req.params;

      const event = await db('events').where('id', id).first();
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      if (event.is_archived) {
        return res.status(400).json({ error: 'Event is already archived' });
      }

      // Use the archive service to create ZIP archive
      await archiveEvent(event);
      require('../../services/localStorageUsage').resetLocalStorageUsageCache();

      // Archiving is already committed. An audit-log outage must not make the
      // client report that the project failed to archive.
      await logActivity('event_archived',
        { eventName: event.event_name },
        id,
        { type: 'admin', id: req.admin.id, name: req.admin.username }
      ).catch((logError) => logger.warn(`Could not log archive activity for event ${id}`, { error: logError.message }));

      res.json({ message: 'Event archived successfully' });
    } catch (error) {
      errorResponse(res, error, error?.statusCode || 500, publicArchiveError(error));
    }
  });

  // Bulk archive events
  router.post('/bulk-archive', adminAuth, requirePermission('events.archive'), [
    body('eventIds').isArray().withMessage('eventIds must be an array'),
    body('eventIds.*').isInt().withMessage('Each eventId must be an integer')
  ], async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: safeValidationErrors(errors) });
      }

      const { eventIds } = req.body;

      if (eventIds.length === 0) {
        return res.status(400).json({ error: 'No events selected for archiving' });
      }

      // Ownership scope: a non-super_admin may only archive events they own.
      // Foreign/non-existent ids are dropped and reported as failures so this
      // route can't archive another admin's events (the single-event
      // /:id/archive route enforces the same via requireEventOwnership).
      const { allowed: allowedIds, denied: deniedIds } = await filterOwnedEventIds(req.admin, eventIds);

      const results = {
        successful: [],
        failed: deniedIds.map((id) => ({ id, name: null, error: 'Access denied or event not found' }))
      };

      // Get all events to archive
      const events = allowedIds.length
        ? await db('events')
          .whereIn('id', allowedIds)
          .where('is_archived', formatBoolean(false))
        : [];

      if (events.length === 0) {
        if (results.failed.length > 0) {
          return res.json({
            message: `Bulk archive completed: 0 succeeded, ${results.failed.length} failed`,
            results
          });
        }
        return res.status(400).json({ error: 'No valid events found to archive' });
      }

      // Process each event
      let archivedAny = false;
      for (const event of events) {
        try {
        // Use the archive service to create ZIP archive
          await archiveEvent(event);
          archivedAny = true;
        
          // Log activity
          await logActivity('event_archived',
            { eventName: event.event_name, bulkOperation: true },
            event.id,
            { type: 'admin', id: req.admin.id, name: req.admin.username }
          ).catch((logError) => logger.warn(`Could not log archive activity for event ${event.id}`, { error: logError.message }));
        
          results.successful.push({
            id: event.id,
            name: event.event_name
          });
        } catch (error) {
          logger.error(`Failed to archive event ${event.id}:`, error);
          results.failed.push({
            id: event.id,
            name: event.event_name,
            error: publicArchiveError(error),
          });
        }
      }

      if (archivedAny) require('../../services/localStorageUsage').resetLocalStorageUsageCache();

      // Log bulk archive activity
      await logActivity('bulk_archive_completed',
        { 
          totalEvents: eventIds.length,
          successfulCount: results.successful.length,
          failedCount: results.failed.length
        },
        null,
        { type: 'admin', id: req.admin.id, name: req.admin.username }
      );

      res.json({
        message: `Bulk archive completed: ${results.successful.length} succeeded, ${results.failed.length} failed`,
        results
      });
    } catch (error) {
      errorResponse(res, error, 500, 'Failed to perform bulk archive');
    }
  });
  router.post('/bulk-delete', adminAuth, requirePermission('events.delete'), [
    body('eventIds').isArray({ min: 1, max: BULK_DELETE_MAX }).withMessage(`eventIds must be an array of 1-${BULK_DELETE_MAX} ids`),
    body('eventIds.*').isInt().withMessage('Each eventId must be an integer')
  ], async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: safeValidationErrors(errors) });
      }

      const { eventIds } = req.body;

      // Ownership scope: a non-super_admin may only delete events they own.
      // The single-event DELETE /:id route enforces this via
      // requireEventOwnership; this bulk route must match it, otherwise an
      // admin/editor scoped to their own events could cascade-delete any
      // event by id. Foreign/non-existent ids are dropped and reported as
      // failures (indistinguishable, to avoid an existence oracle).
      const { allowed: allowedIds, denied: deniedIds } = await filterOwnedEventIds(req.admin, eventIds);

      const results = {
        successful: [],
        failed: deniedIds.map((id) => ({ id, name: null, error: 'Access denied or event not found' }))
      };
      const adminContext = { id: req.admin.id, username: req.admin.username };

      for (const eventId of allowedIds) {
        try {
          const deleted = await deleteEventCascade(eventId, adminContext);
          results.successful.push(deleted);
        } catch (err) {
          results.failed.push({
            id: eventId,
            name: null,
            error: err.code === 'EVENT_NOT_FOUND' ? 'Event not found' : 'Failed to delete event'
          });
          logger.warn('Bulk-delete: per-event failure', { eventId, error: err.message });
        }
      }

      await logActivity('bulk_delete_completed',
        {
          totalEvents: eventIds.length,
          successfulCount: results.successful.length,
          failedCount: results.failed.length
        },
        null,
        { type: 'admin', id: req.admin.id, name: req.admin.username }
      );

      res.json({
        message: `Bulk delete completed: ${results.successful.length} succeeded, ${results.failed.length} failed`,
        results
      });
    } catch (error) {
      errorResponse(res, error, 500, 'Failed to perform bulk delete');
    }
  });

};
