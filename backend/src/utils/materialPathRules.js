const DELIVERY_DIRECTORY_NAMES = new Set(['pixcakedelivery', '项目交付']);

function isDeliveryDirectoryName(value) {
  return typeof value === 'string' && DELIVERY_DIRECTORY_NAMES.has(value.toLocaleLowerCase());
}

function containsDeliveryDirectory(value) {
  const parts = Array.isArray(value) ? value : String(value || '').split(/[\\/]+/);
  return parts.some(isDeliveryDirectoryName);
}

module.exports = {
  DELIVERY_DIRECTORY_NAMES,
  isDeliveryDirectoryName,
  containsDeliveryDirectory,
};
