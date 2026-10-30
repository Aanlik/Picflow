const express = require('express');
const router = express.Router();
const { db, logActivity } = require('../database/db');
const { verifyGalleryAccess, denySlideshowToken } = require('../middleware/gallery');
const { resolveGuest } = require('../middleware/guestAuth');
const { blockHiddenGallery } = require('../utils/revealMode');
const { feedbackRateLimit, generateGuestIdentifier } = require('../middleware/feedbackRateLimit');
const { noStoreCache } = require('../middleware/noStoreCache');
const feedbackService = require('../services/feedbackService');
const retouchSelectionService = require('../services/retouchSelectionService');
const { sanitizeComment } = require('../utils/feedbackValidation');
const {
  getPublicPhotoStates, prepareVersionFolder, withdrawPhotoSelection, persistWithdrawalIntent,
  triggerWorkflowSync,
} = require('../services/photographyWorkflowBridge');
const { isPhotoHiddenFromViewer } = require('../utils/photoVisibility');

function customerStatus(photo, stage) {
  // A delivered image that its customer kept is back in the proofing queue;
  // the photo bytes stay retouched, but it is no longer an active RAW task.
  if (photo.withdraw_pending) return 'proof';
  if (photo.selection_cancelled && photo.delivered) return 'proof';
  if (photo.selected && photo.added_during_editing && photo.ready_for_editing && ['EDITING', 'DELIVERED'].includes(stage)) return 'editing';
  if (photo.delivered) return 'delivered';
  if (photo.selection_cancelled) return 'cancelled';
  if (photo.selected && photo.ready_for_editing && ['EDITING', 'DELIVERED'].includes(stage)) return 'editing';
  if (photo.selected) return 'selected';
  return 'proof';
}

router.get('/:slug/retouch-workflow', verifyGalleryAccess, resolveGuest, blockHiddenGallery, noStoreCache, async (req, res) => {
  try {
    const [workflow, guestIdentifier] = await Promise.all([
      getPublicPhotoStates(req.event.id),
      generateGuestIdentifier(req),
    ]);
    const visiblePhotos = await db('photos').where({ event_id: req.event.id }).select('id', 'visibility');
    const visibleIds = new Set(visiblePhotos
      .filter((photo) => !isPhotoHiddenFromViewer(photo, req.accessLevel))
      .map((photo) => Number(photo.id)));
    const rawPhotos = workflow.status === 200 && Array.isArray(workflow.data.photos) ? workflow.data.photos : [];
    const photos = rawPhotos
      .filter((photo) => visibleIds.has(Number(photo.photo_id)))
      .map((photo) => ({
        photo_id: Number(photo.photo_id),
        selected: Boolean(photo.selected) && !photo.withdraw_pending,
        withdraw_pending: Boolean(photo.withdraw_pending),
        // A kept delivered image is intentionally back in the proof queue.
        // The internal flag still protects Bridge from processing its RAW,
        // but it should not present as a cancelled/revision-only customer state.
        selection_cancelled: Boolean(photo.selection_cancelled && !photo.delivered),
        delivered_retained: Boolean(photo.selection_cancelled && photo.delivered),
        delivered: Boolean(photo.delivered),
        current_version: Number(photo.current_version) || 0,
        added_during_editing: Boolean(photo.added_during_editing),
        ready_for_editing: Boolean(photo.ready_for_editing),
        state: customerStatus(photo, workflow.data.stage),
      }));
    const requests = await db('photo_retouch_requests')
      .where({ event_id: req.event.id, guest_identifier: guestIdentifier })
      .select('id', 'photo_id', 'request_type', 'base_version', 'customer_message', 'guest_name', 'status', 'photographer_reply', 'created_at', 'updated_at')
      .orderBy('created_at', 'desc');
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      enabled: workflow.status === 200,
      bridge_available: workflow.status === 200,
      photos,
      requests: requests.filter((request) => visibleIds.has(Number(request.photo_id))),
    });
  } catch (error) {
    require('../utils/logger').error('Gallery retouch workflow read failed', { error: error.message });
    res.status(500).json({ error: 'Unable to load retouch status' });
  }
});

function selectionIdentity(settings, req, guestIdentifier) {
  return {
    identity_mode: settings.identity_mode,
    guest_id: req.guest?.id ?? null,
    guest_identifier: guestIdentifier,
    guest_name: req.guest?.name || null,
  };
}

async function requireRetouchWorkflow(eventId) {
  const workflow = await getPublicPhotoStates(eventId);
  return workflow.status === 200;
}

router.post('/:slug/photos/:photoId/retouch-selection',
  verifyGalleryAccess,
  denySlideshowToken,
  blockHiddenGallery,
  resolveGuest,
  async (req, res) => {
    try {
      const event = req.event;
      const photoId = Number(req.params.photoId);
      if (!Number.isSafeInteger(photoId) || photoId < 1 || typeof req.body?.selected !== 'boolean') {
        return res.status(400).json({ error: 'Invalid retouch selection' });
      }
      const photo = await db('photos').where({ id: photoId, event_id: event.id }).first();
      if (!photo || isPhotoHiddenFromViewer(photo, req.accessLevel)) return res.sendStatus(404);

      const settings = await feedbackService.getEventFeedbackSettings(event.id);
      if (settings.identity_mode === 'guest' && (!req.guest || req.guest.eventId !== event.id)) {
        return res.status(401).json({ error: 'Guest identity required', code: 'GUEST_IDENTITY_REQUIRED' });
      }
      if (!(await requireRetouchWorkflow(event.id))) return res.status(503).json({ error: 'Retouch workflow is not connected' });

      const guestIdentifier = await generateGuestIdentifier(req);
      await feedbackRateLimit('color_label')(req, res, (error) => { if (error) throw error; });
      if (res.headersSent) return;
      const result = await retouchSelectionService.setRetouchSelection(
        event.id, photoId, selectionIdentity(settings, req, guestIdentifier), req.body.selected,
      );
      await logActivity('guest_retouch_selection_changed', {
        photo_id: photoId,
        selected: result.selected,
        filename: photo.filename,
      }, event.id, {
        type: 'guest', id: guestIdentifier.substring(0, 16), name: req.guest?.name || '客户',
      });
      void triggerWorkflowSync(event.id);
      res.json({ success: true, selected: result.selected });
    } catch (error) {
      if (error.code === 'WITHDRAW_PENDING') return res.status(409).json({ error: error.message, code: error.code });
      require('../utils/logger').error('Retouch selection update failed', { error: error.message });
      res.status(500).json({ error: 'Unable to update retouch selection' });
    }
  }
);

router.post('/:slug/retouch-selections/batch',
  verifyGalleryAccess,
  denySlideshowToken,
  blockHiddenGallery,
  resolveGuest,
  async (req, res) => {
    try {
      const event = req.event;
      const photoIds = req.body?.photo_ids;
      const selected = req.body?.selected;
      if (!Array.isArray(photoIds) || photoIds.length < 1 || photoIds.length > 100 ||
          photoIds.some((id) => !Number.isSafeInteger(id) || id < 1) ||
          new Set(photoIds).size !== photoIds.length || typeof selected !== 'boolean') {
        return res.status(400).json({ error: 'Invalid retouch selection' });
      }
      const settings = await feedbackService.getEventFeedbackSettings(event.id);
      if (settings.identity_mode === 'guest' && (!req.guest || req.guest.eventId !== event.id)) {
        return res.status(401).json({ error: 'Guest identity required', code: 'GUEST_IDENTITY_REQUIRED' });
      }
      if (!(await requireRetouchWorkflow(event.id))) return res.status(503).json({ error: 'Retouch workflow is not connected' });
      const photos = await db('photos').where({ event_id: event.id }).whereIn('id', photoIds);
      if (photos.length !== photoIds.length || photos.some((photo) => isPhotoHiddenFromViewer(photo, req.accessLevel))) {
        return res.status(404).json({ error: 'Photo not found' });
      }

      req.feedbackRateLimitCost = photoIds.length;
      await feedbackRateLimit('color_label')(req, res, (error) => { if (error) throw error; });
      if (res.headersSent) return;
      const guestIdentifier = await generateGuestIdentifier(req);
      const results = await retouchSelectionService.setRetouchSelections(
        event.id, photoIds, selectionIdentity(settings, req, guestIdentifier), selected,
      );
      const appliedIds = photoIds.filter((_id, index) => results[index]?.selected === selected);
      await logActivity('guest_retouch_selection_batch', {
        photo_ids: appliedIds,
        count: appliedIds.length,
        selected,
      }, event.id, {
        type: 'guest', id: guestIdentifier.substring(0, 16), name: req.guest?.name || '客户',
      });
      void triggerWorkflowSync(event.id);
      res.json({ success: true, applied_count: appliedIds.length, selected, photo_ids: appliedIds });
    } catch (error) {
      if (error.code === 'WITHDRAW_PENDING') return res.status(409).json({ error: error.message, code: error.code });
      require('../utils/logger').error('Batch retouch selection update failed', { error: error.message });
      res.status(500).json({ error: 'Unable to update retouch selections' });
    }
  }
);

router.post('/:slug/photos/:photoId/withdraw-selection',
  verifyGalleryAccess,
  denySlideshowToken,
  blockHiddenGallery,
  resolveGuest,
  async (req, res) => {
    try {
      const event = req.event;
      const photoId = Number(req.params.photoId);
      if (!Number.isSafeInteger(photoId) || photoId < 1) return res.status(400).json({ error: 'Invalid photo ID' });
      const photo = await db('photos').where({ id: photoId, event_id: event.id }).first();
      if (!photo || isPhotoHiddenFromViewer(photo, req.accessLevel)) return res.sendStatus(404);
      const deleteDelivered = req.body?.delete_delivered;
      if (typeof deleteDelivered !== 'boolean') return res.status(400).json({ error: 'Please choose whether to delete the delivered image' });

      const settings = await feedbackService.getEventFeedbackSettings(event.id);
      if (settings.identity_mode === 'guest' && (!req.guest || req.guest.eventId !== event.id)) {
        return res.status(401).json({ error: 'Guest identity required', code: 'GUEST_IDENTITY_REQUIRED' });
      }
      const guestIdentifier = await generateGuestIdentifier(req);
      const workflow = await getPublicPhotoStates(event.id);
      if (workflow.status !== 200) return res.status(503).json({ error: 'Retouch workflow is not connected' });
      const workflowPhoto = workflow.data.photos.find((item) => Number(item.photo_id) === photoId);
      if (!workflowPhoto?.delivered) return res.status(409).json({ error: 'A delivered retouched version is required', code: 'NO_DELIVERED_VERSION' });

      const identity = selectionIdentity(settings, req, guestIdentifier);
      const remove = await db.transaction(async (trx) => {
        // Serialize selection withdrawal with workflow tasks and other photo edits.
        await trx('photos').where({ id: photoId, event_id: event.id }).forUpdate().first();
        const result = await retouchSelectionService.removeRetouchSelection(event.id, photoId, identity, trx);
        result.anotherParticipantSelected = await retouchSelectionService.hasOtherRetouchSelection(event.id, photoId, identity, trx);
        if (result.removed && !result.anotherParticipantSelected) await persistWithdrawalIntent(event.id, photoId, deleteDelivered, trx);
        return result;
      });
      const anotherParticipantSelected = remove.anotherParticipantSelected;
      if (!remove.removed) return res.status(409).json({ error: 'The selection has already changed', code: 'SELECTION_CHANGED' });

      // One participant cannot cancel another participant's active pick.
      if (anotherParticipantSelected) {
        const openRequests = db('photo_retouch_requests')
          .where({ event_id: event.id, photo_id: photoId })
          .whereNotIn('status', ['cancelled', 'completed', 'closed']);
        if (settings.identity_mode !== 'shared') openRequests.where({ guest_identifier: guestIdentifier });
        await openRequests.update({ status: 'cancelled', updated_at: new Date().toISOString() });
        await triggerWorkflowSync(event.id);
        return res.json({ success: true, kept_for_other_participant: true });
      }

      const withdrawn = await withdrawPhotoSelection(event.id, photoId, deleteDelivered);
      if (![200, 202].includes(withdrawn.status)) {
        // Keep Picflow selection and RAW task consistent if the Bridge could
        // not safely restore the proof or remove the NAS RAW association.
        if (withdrawn.status >= 400 && withdrawn.status < 500) await retouchSelectionService
          .setRetouchSelection(event.id, photoId, identity, true).catch(() => {});
        return res.status(503).json({ error: withdrawn.data?.detail || 'Unable to update the retouch workflow', code: 'WITHDRAW_FAILED' });
      }
      const openRequests = db('photo_retouch_requests')
        .where({ event_id: event.id, photo_id: photoId })
        .whereNotIn('status', ['cancelled', 'completed', 'closed']);
      if (settings.identity_mode !== 'shared') openRequests.where({ guest_identifier: guestIdentifier });
      await openRequests.update({ status: 'cancelled', updated_at: new Date().toISOString() });
      await triggerWorkflowSync(event.id);
      res.json({ success: true, processing: Boolean(withdrawn.data?.processing), deleted: deleteDelivered, current_version: withdrawn.data?.current_version || 0 });
    } catch (error) {
      require('../utils/logger').error('Gallery retouch withdrawal failed', { error: error.message });
      res.status(500).json({ error: 'Unable to withdraw this retouch selection' });
    }
  }
);

router.post('/:slug/photos/:photoId/retouch-requests',
  verifyGalleryAccess,
  denySlideshowToken,
  blockHiddenGallery,
  resolveGuest,
  feedbackRateLimit('comment'),
  async (req, res) => {
    try {
      const event = req.event;
      const settings = await feedbackService.getEventFeedbackSettings(event.id);
      const photoId = Number(req.params.photoId);
      if (!Number.isSafeInteger(photoId) || photoId < 1) return res.status(400).json({ error: 'Invalid photo ID' });
      const photo = await db('photos').where({ id: photoId, event_id: event.id }).first();
      if (!photo || isPhotoHiddenFromViewer(photo, req.accessLevel)) return res.sendStatus(404);

      if (await db('workflow_withdrawal_intents').where({ photo_id: photoId, event_id: event.id }).first()) return res.status(409).json({ error: '撤回任务仍在处理中', code: 'WITHDRAW_PENDING' });
      const requestType = req.body?.request_type;
      if (!['revision', 'additional'].includes(requestType)) {
        return res.status(400).json({ error: 'Invalid request type' });
      }
      const message = sanitizeComment(typeof req.body?.message === 'string' ? req.body.message : '');
      if (!message || message.length > 1000) return res.status(400).json({ error: 'Message must be between 1 and 1000 characters' });
      if (settings.identity_mode === 'guest' && (!req.guest || req.guest.eventId !== event.id)) {
        return res.status(401).json({ error: 'Guest identity required', code: 'GUEST_IDENTITY_REQUIRED' });
      }
      const activeRequest = () => db('photo_retouch_requests')
        .where({ event_id: event.id, photo_id: photoId })
        .whereNotIn('status', ['cancelled', 'completed', 'closed']);
      if (await activeRequest().first('id')) {
        return res.status(409).json({
          error: 'This photo already has an active retouch request',
          code: 'RETOUCH_ALREADY_ACTIVE',
        });
      }
      const workflow = await getPublicPhotoStates(event.id);
      if (workflow.status !== 200) return res.status(503).json({ error: 'Retouch workflow is not connected' });

      let baseVersion = null;
      let status = 'open';
      let targetVersion = null;
      let deliveryFolder = null;
      const workflowPhoto = workflow.data.photos.find((item) => Number(item.photo_id) === photoId);
      if (requestType === 'revision') {
        if (!workflowPhoto?.delivered) return res.status(409).json({ error: 'A delivered retouched version is required before requesting a revision', code: 'NO_DELIVERED_VERSION' });
        baseVersion = Number(workflowPhoto.current_version) || 1;
        const requestedVersion = Number(req.body?.base_version);
        if (!Number.isSafeInteger(requestedVersion) || requestedVersion !== baseVersion) {
          return res.status(409).json({ error: 'The delivered version changed. Refresh the gallery and try again.', code: 'VERSION_CHANGED', current_version: baseVersion });
        }
      }

      // A new edit of a delivered photo gets a dedicated Vn folder. The Bridge
      // checks the version again while creating it, so a concurrent delivery
      // cannot silently direct the photographer to a stale folder.
      if (workflowPhoto?.delivered) {
        const prepared = await prepareVersionFolder(event.id, photoId, workflowPhoto.current_version);
        if (prepared.status === 409) return res.status(409).json({ error: 'The delivered version changed. Refresh and try again.', code: 'VERSION_CHANGED' });
        if (prepared.status !== 200 || !prepared.data?.folder || !Number.isSafeInteger(Number(prepared.data?.version))) {
          return res.status(503).json({ error: 'Unable to prepare the next retouch folder', code: 'VERSION_FOLDER_UNAVAILABLE' });
        }
        targetVersion = Number(prepared.data.version);
        deliveryFolder = String(prepared.data.folder);
      }
      const guestIdentifier = await generateGuestIdentifier(req);
      // A request means the client wants this photo processed. Selection is
      // recorded independently from any Lightroom-style colour label.
      const identity = selectionIdentity(settings, req, guestIdentifier);
      const created = await db.transaction(async (trx) => {
        // Serialize requests for one photo across guests. SQLite ignores
        // FOR UPDATE, but the transaction's write below still serializes the
        // final insert; the second active-request check closes the race window
        // created while version-folder preparation contacted Bridge.
        const currentPhoto = await trx('photos').where({ id: photoId, event_id: event.id }).forUpdate().first('id');
        if (!currentPhoto) return { missing: true };
        const duplicate = await trx('photo_retouch_requests')
          .where({ event_id: event.id, photo_id: photoId })
          .whereNotIn('status', ['cancelled', 'completed', 'closed'])
          .first('id');
        if (duplicate) return { conflict: true };
        await retouchSelectionService.setRetouchSelection(event.id, photoId, identity, true, trx);
        const [request] = await trx('photo_retouch_requests').insert({
          event_id: event.id,
          photo_id: photoId,
          guest_id: req.guest?.id || null,
          guest_identifier: guestIdentifier,
          guest_name: req.guest?.name || (typeof req.body?.guest_name === 'string' ? req.body.guest_name.trim().slice(0, 100) : null),
          request_type: requestType,
          base_version: baseVersion,
          customer_message: message,
          status,
          target_version: targetVersion,
          delivery_folder: deliveryFolder,
        }).returning(['id', 'photo_id', 'request_type', 'base_version', 'customer_message', 'guest_name', 'status', 'photographer_reply', 'created_at', 'updated_at']);
        return { request };
      });
      if (created.missing) return res.sendStatus(404);
      if (created.conflict) {
        return res.status(409).json({
          error: 'This photo already has an active retouch request',
          code: 'RETOUCH_ALREADY_ACTIVE',
        });
      }
      await triggerWorkflowSync(event.id);
      res.status(201).json({ request: created.request });
    } catch (error) {
      require('../utils/logger').error('Gallery retouch request failed', { error: error.message });
      if (error?.code === '23505' || error?.code === 'SQLITE_CONSTRAINT_UNIQUE'
        || String(error?.message || '').includes('photo_retouch_one_active_per_photo_idx')) {
        return res.status(409).json({
          error: 'This photo already has an active retouch request',
          code: 'RETOUCH_ALREADY_ACTIVE',
        });
      }
      res.status(500).json({ error: 'Unable to submit retouch request' });
    }
  }
);

router.delete('/:slug/retouch-requests/:requestId',
  verifyGalleryAccess,
  denySlideshowToken,
  blockHiddenGallery,
  resolveGuest,
  async (req, res) => {
    try {
      const requestId = Number(req.params.requestId);
      if (!Number.isSafeInteger(requestId) || requestId < 1) return res.status(400).json({ error: 'Invalid request ID' });
      if (req.accessLevel === 'hidden') return res.sendStatus(404);
      const guestIdentifier = await generateGuestIdentifier(req);
      const request = await db('photo_retouch_requests')
        .where({ id: requestId, event_id: req.event.id, guest_identifier: guestIdentifier })
        .first();
      if (!request) return res.sendStatus(404);
      const photo = await db('photos').where({ id: request.photo_id, event_id: req.event.id }).first();
      if (!photo || isPhotoHiddenFromViewer(photo, req.accessLevel)) return res.sendStatus(404);
      if (['cancelled', 'completed', 'closed'].includes(request.status)) {
        return res.status(409).json({ error: 'This request can no longer be cancelled', code: 'REQUEST_NOT_CANCELLABLE' });
      }
      const updated = await db.transaction(async (trx) => {
        const current = await trx('photo_retouch_requests')
          .where({ id: requestId, event_id: req.event.id, guest_identifier: guestIdentifier })
          .forUpdate().first();
        if (!current || ['cancelled', 'completed', 'closed'].includes(current.status)) return null;
        await trx('photo_retouch_requests').where({ id: requestId }).update({ status: 'cancelled', updated_at: new Date().toISOString() });
        // Cancelling a revision request is independent of withdrawing the
        // photo selection. Keep the delivered image and retouch selection.
        return trx('photo_retouch_requests').where({ id: requestId }).first();
      });
      if (!updated) return res.status(409).json({ error: 'This request can no longer be cancelled', code: 'REQUEST_NOT_CANCELLABLE' });
      await triggerWorkflowSync(req.event.id);
      res.json({ request: {
        id: updated.id,
        photo_id: updated.photo_id,
        request_type: updated.request_type,
        base_version: updated.base_version,
        customer_message: updated.customer_message,
        status: updated.status,
        photographer_reply: updated.photographer_reply,
        created_at: updated.created_at,
        updated_at: updated.updated_at,
      } });
    } catch (error) {
      require('../utils/logger').error('Gallery retouch request cancellation failed', { error: error.message });
      res.status(500).json({ error: 'Unable to cancel the retouch request' });
    }
  }
);

module.exports = router;
