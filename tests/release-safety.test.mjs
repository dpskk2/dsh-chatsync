import { removeFixture } from './helpers/fixture-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { requiredChecks, sourceFingerprint, template, validateRelease } from '../scripts/check-release-safety.mjs';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsync-release-gate-'));
  // Only this newly created, isolated test directory is removed.
  t.after(() => removeFixture(root));
  const git = args => execFileSync('git', args, { cwd: root, stdio: 'pipe', windowsHide: true });
  git(['init']);
  git(['config', 'user.name', 'Release gate fixture']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  git(['config', 'core.autocrlf', 'false']);
  const pkg = { version: '1.2.3', chatsyncBuild: 'fixture-only' };
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
  fs.writeFileSync(path.join(root, '.gitignore'), '/work/\n');
  fs.writeFileSync(path.join(root, 'source.mjs'), 'export const preserved = true;\n');
  git(['add', '.']);
  git(['commit', '-m', 'fixture source']);
  const evidenceDir = path.join(root, 'release-evidence', pkg.version);
  fs.mkdirSync(evidenceDir, { recursive: true });
  const report = JSON.stringify({ fixtureOnly: true, result: 'synthetic gate test; not product evidence' });
  fs.writeFileSync(path.join(evidenceDir, 'report.json'), report);
  fs.mkdirSync(path.join(root, 'work'));
  const packageFile = path.join(root, 'work', 'candidate.tgz');
  fs.writeFileSync(packageFile, 'synthetic package bytes for gate test');
  const manifest = template(pkg);
  manifest.sourceSha256 = sourceFingerprint(root);
  manifest.packageSha256 = digest(fs.readFileSync(packageFile));
  for (const check of manifest.checks)
    Object.assign(check, {
      status: 'passed',
      completedAt: '2020-01-01T00:00:00+08:00',
      environment: 'isolated fixture',
      procedure: 'synthetic gate validation',
      observed: 'fixture only',
      reviewer: 'test fixture',
      artifacts: [{ path: 'release-evidence/1.2.3/report.json', sha256: digest(report) }],
    });
  fs.writeFileSync(path.join(evidenceDir, 'manifest.json'), JSON.stringify(manifest));
  git(['add', '.']);
  git(['commit', '-m', 'fixture evidence']);
  return { root, git, manifest, packageFile, evidenceDir, errors: () => validateRelease(root, manifest, packageFile) };
}

test('release checklist starts with all 24 mandatory items pending', () => {
  const manifest = template({ version: '1.2.3', chatsyncBuild: 'test' });
  assert.equal(requiredChecks.length, 24);
  assert.equal(new Set(requiredChecks).size, 24);
  assert.ok(manifest.checks.every(check => check.status === 'pending' && !check.artifacts.length));
  assert.equal(manifest.sourceSha256, '');
});

test('complete committed evidence for the exact candidate passes; adding evidence does not change source fingerprint', t => {
  const f = fixture(t);
  assert.equal(sourceFingerprint(f.root), f.manifest.sourceSha256);
  assert.deepEqual(f.errors(), []);
});

test('pending, failed, skipped, interrupted and missing checks block release', t => {
  const f = fixture(t);
  for (const status of ['pending', 'failed', 'skipped', 'interrupted', 'verification-pending']) {
    f.manifest.checks[0].status = status;
    assert.ok(
      f.errors().some(error => error.includes('未通过')),
      status,
    );
  }
  f.manifest.checks.shift();
  assert.ok(f.errors().some(error => error.includes('不完整')));
});

test('repeated evidence IDs cannot replace a missing runtime check', t => {
  const f = fixture(t);
  f.manifest.checks[1] = structuredClone(f.manifest.checks[0]);
  assert.ok(f.errors().some(error => error.includes('重复')));
  assert.ok(f.errors().some(error => error.includes('data-loss/automated')));
});

test('uncommitted changes block release even if the index fingerprint is unchanged', t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.root, 'source.mjs'), '// later edit\n');
  assert.ok(f.errors().some(error => error.includes('尚未冻结')));
});

test('committed source changes invalidate previous evidence', t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.root, 'source.mjs'), '// new behavior\n');
  f.git(['add', 'source.mjs']);
  f.git(['commit', '-m', 'changed source']);
  assert.ok(f.errors().some(error => error.includes('源码指纹不一致')));
});

test('changed or missing candidate package blocks release', t => {
  const f = fixture(t);
  fs.appendFileSync(f.packageFile, 'different build');
  assert.ok(f.errors().some(error => error.includes('候选安装包')));
  fs.unlinkSync(f.packageFile);
  assert.ok(f.errors().some(error => error.includes('候选安装包')));
});

test('missing, changed, empty or out-of-scope evidence blocks release', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.evidenceDir, 'report.json'), 'changed');
  assert.ok(f.errors().some(error => error.includes('哈希不匹配')));
  fs.writeFileSync(path.join(f.evidenceDir, 'report.json'), '');
  assert.ok(f.errors().some(error => error.includes('证据为空')));
  fs.unlinkSync(path.join(f.evidenceDir, 'report.json'));
  assert.ok(f.errors().some(error => error.includes('不可读取')));
  f.manifest.checks[0].artifacts[0].path = 'release-evidence/1.2.3/../../package.json';
  assert.ok(f.errors().some(error => error.includes('证据路径')));
});

test('wrong version, missing review details, future dates and absent artifacts block release', t => {
  const f = fixture(t);
  f.manifest.version = '1.2.2';
  f.manifest.checks[0].reviewer = '';
  f.manifest.checks[1].completedAt = '2999-01-01T00:00:00Z';
  f.manifest.checks[2].artifacts = [];
  const errors = f.errors();
  assert.ok(errors.some(error => error.includes('版本或构建')));
  assert.equal(errors.filter(error => error.includes('有效完成时间')).length, 2);
  assert.ok(errors.some(error => error.includes('缺少证据文件')));
});

function ownerDecision(f) {
  const id = 'physical-two-device-github';
  f.manifest.checks.find(c => c.id === id).status = 'not-verified';
  f.manifest.ownerDecision = {
    mode: 'release-with-unverified-scenarios',
    version: '1.2.3',
    build: 'fixture-only',
    sourceSha256: f.manifest.sourceSha256,
    packageSha256: f.manifest.packageSha256,
    requestedAt: '2020-01-01T00:00:00Z',
    requestedBy: 'fixture owner',
    instruction: 'fixture explicit decision',
    reason: 'fixture only; no product acceptance',
    acceptedChecks: [id],
  };
}
test('explicit owner decision preserves unverified status and remains bound to candidate', t => {
  const f = fixture(t);
  ownerDecision(f);
  assert.deepEqual(f.errors(), []);
  assert.equal(f.manifest.checks.at(-1).status, 'not-verified');
  f.manifest.ownerDecision.packageSha256 = '0'.repeat(64);
  assert.ok(f.errors().some(e => e.includes('用户发布决定无效')));
});
test('owner decision cannot excuse failed, missing, pending or skipped checks', t => {
  const f = fixture(t);
  ownerDecision(f);
  for (const status of ['failed', 'pending', 'skipped', 'interrupted']) {
    f.manifest.checks.at(-1).status = status;
    assert.ok(f.errors().some(e => e.includes('physical-two-device-github：未通过')));
  }
});
test('owner decision cannot bypass regression, automated tests, source review or failed installation', t => {
  const f = fixture(t);
  ownerDecision(f);
  for (const id of ['full-regression', 'privacy/automated', 'privacy/source-review']) {
    f.manifest.ownerDecision.acceptedChecks = [id];
    assert.ok(f.errors().some(e => e.includes('用户发布决定无效')));
  }
  f.manifest.ownerDecision.acceptedChecks = ['candidate-install'];
  f.manifest.checks.find(c => c.id === 'candidate-install').status = 'failed';
  assert.ok(f.errors().some(e => e.includes('candidate-install：未通过')));
});
test('unverified scenarios still require complete committed evidence and decision metadata', t => {
  const f = fixture(t);
  ownerDecision(f);
  f.manifest.checks.at(-1).artifacts = [];
  assert.ok(f.errors().some(e => e.includes('缺少证据文件')));
  delete f.manifest.ownerDecision.instruction;
  assert.ok(f.errors().some(e => e.includes('用户发布决定无效')));
});
