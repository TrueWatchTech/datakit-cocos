'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectDistTag } = require('./release-policy.cjs');

test('prereleases update latest until the first stable release', () => {
  assert.equal(selectDistTag('0.1.0-alpha.1', []), 'latest');
  assert.equal(selectDistTag('0.1.0-alpha.2', ['0.1.0-alpha.1']), 'latest');
  assert.equal(selectDistTag('0.1.0-beta.1', ['0.1.0-alpha.2']), 'latest');
  assert.equal(selectDistTag('0.1.0-alpha.10', ['0.1.0-alpha.2']), 'latest');
});

test('stable releases take over latest even after a higher prerelease', () => {
  assert.equal(selectDistTag('0.1.0', ['0.2.0-alpha.1']), 'latest');
  assert.equal(selectDistTag('0.1.1', ['0.1.0', '0.2.0-alpha.1']), 'latest');
});

test('a published stable release permanently excludes prereleases from latest', () => {
  assert.equal(selectDistTag('0.2.0-alpha.1', ['0.1.0']), 'alpha');
  assert.equal(selectDistTag('2.0.0-beta.1', ['0.1.0', '0.2.0-alpha.1']), 'beta');
});

test('older versions and malformed tags cannot downgrade latest', () => {
  assert.equal(selectDistTag('0.1.0-alpha.1', ['0.1.0-alpha.2']), 'alpha');
  assert.throws(() => selectDistTag('0.1.0', ['0.1.1']));
  assert.throws(() => selectDistTag('0.1.0-rc.1', []));
});

test('retries select the same tag from the existing package version', () => {
  assert.equal(selectDistTag('0.1.0-alpha.2', ['0.1.0-alpha.1', '0.1.0-alpha.2']), 'latest');
  assert.equal(selectDistTag('0.1.0', ['0.1.0-alpha.2', '0.1.0']), 'latest');
});
