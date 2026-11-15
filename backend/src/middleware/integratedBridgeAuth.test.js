const assert = require('node:assert/strict');
const { test } = require('node:test');
const { isPermittedBridgeRoute } = require('./integratedBridgeAuth');

test('integrated Bridge loopback allows read-only event metadata for project binding', () => {
  assert.equal(isPermittedBridgeRoute('GET', '/events/4/metadata'), true);
  assert.equal(isPermittedBridgeRoute('GET', '/events/4/metadata/'), true);
});

test('integrated Bridge loopback keeps the existing photo routes available', () => {
  assert.equal(isPermittedBridgeRoute('GET', '/events/4/photos'), true);
  assert.equal(isPermittedBridgeRoute('GET', '/events/4/photos/'), true);
  assert.equal(isPermittedBridgeRoute('POST', '/events/4/photos'), true);
});

test('integrated Bridge loopback does not grant metadata writes or unrelated routes', () => {
  assert.equal(isPermittedBridgeRoute('POST', '/events/4/metadata'), false);
  assert.equal(isPermittedBridgeRoute('DELETE', '/events/4/photos'), false);
  assert.equal(isPermittedBridgeRoute('GET', '/events/4/photos/extra'), false);
  assert.equal(isPermittedBridgeRoute('GET', '/events/4/metadata/extra'), false);
  assert.equal(isPermittedBridgeRoute('GET', '/events/not-a-number/metadata'), false);
});

test('integrated Bridge allowlist is limited to the event metadata and photo endpoints', () => {
  assert.equal(isPermittedBridgeRoute('GET', '/events/4/download'), false);
  assert.equal(isPermittedBridgeRoute('GET', '/events/4'), false);
  assert.equal(isPermittedBridgeRoute('PUT', '/events/4/photos'), false);
});
