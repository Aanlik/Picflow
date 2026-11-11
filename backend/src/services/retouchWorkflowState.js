function customerStatus(photo, stage) {
  if (photo.withdraw_pending) return 'proof';
  if (photo.selection_cancelled && photo.delivered) return 'proof';
  if (photo.selected && photo.added_during_editing && photo.ready_for_editing && ['EDITING', 'DELIVERED'].includes(stage)) return 'editing';
  if (photo.delivered) return 'delivered';
  if (photo.selection_cancelled) return 'cancelled';
  if (photo.selected && photo.ready_for_editing && ['EDITING', 'DELIVERED'].includes(stage)) return 'editing';
  if (photo.selected) return 'selected';
  return 'proof';
}

function isCurrentDeliveredWorkflowPhoto(photo, stage) {
  return customerStatus(photo, stage) === 'delivered'
    && Number(photo.current_version) > 0
    && !photo.withdraw_pending;
}

module.exports = { customerStatus, isCurrentDeliveredWorkflowPhoto };
