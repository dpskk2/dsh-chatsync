import test from 'node:test';
import assert from 'node:assert/strict';
import { compareDshVersions, parseDshVersion } from '../lib/dsh-version.js';

test('DSH versions order by SemVer precedence, release candidates included', () => {
  assert.equal(compareDshVersions('0.2.2-rc.1', '0.2.1-rc.5'), 1);
  assert.equal(compareDshVersions('0.2.1', '0.2.1-rc.5'), 1);
  assert.equal(compareDshVersions('0.2.1-rc.5', '0.2.1'), -1);
  assert.equal(compareDshVersions('0.2.1-rc.10', '0.2.1-rc.9'), 1);
  assert.equal(compareDshVersions('0.2.1-rc.9', '0.2.1-rc.10'), -1);
  assert.equal(compareDshVersions('0.2.1-rc.5', '0.2.1-rc.5'), 0);
  assert.equal(compareDshVersions('1.0.0', '0.99.99'), 1);
  assert.equal(compareDshVersions('0.2.1-rc', '0.2.1-rc.1'), -1);
  assert.equal(compareDshVersions('0.2.1-alpha.1', '0.2.1-rc.1'), -1);
  assert.equal(compareDshVersions('0.2.1-rc.1', '0.2.1-1'), 1, 'alphanumeric identifiers rank above numeric ones');
});

test('versions that cannot be parsed are not ordered', () => {
  assert.equal(compareDshVersions('dev-build', '0.2.1'), null);
  assert.equal(compareDshVersions('0.2.1', ''), null);
  assert.equal(compareDshVersions(null, '0.2.1'), null);
  assert.equal(compareDshVersions('0.2', '0.2.1'), null);
  assert.equal(compareDshVersions('01.2.3', '1.2.3'), null);
  assert.equal(parseDshVersion('0.2.1-rc..1'), null);
});
