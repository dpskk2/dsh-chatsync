import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const risks = ['data-loss', 'corruption-spread', 'privacy', 'upgrade-environments', 'recovery'];
export const methods = ['source-review', 'automated', 'fault-injection', 'native-runtime'];
// Tiered gate (docs/release-safety-checklist.md): every release needs the full
// regression (standalone Node and the Windows Electron runtime) and the candidate
// package checked in an isolated host; a minor or major release also needs the
// physical two-device acceptance, which the maintainer may confirm.
export const patchChecks = ['full-regression', 'candidate-install'];
export const minorChecks = [...patchChecks, 'physical-two-device-github'];
// Advisory guidance: recorded when performed, never required, but a failure still blocks.
export const advisoryChecks = [...risks.flatMap(risk => methods.map(method => `${risk}/${method}`)), 'restore-drill'];
/** 'patch' for x.y.z with z > 0; any other version is treated as a minor (or major) release. */
export function releaseTier(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version));
  if (!match) throw new Error('版本号格式无效：' + version);
  return Number(match[3]) > 0 ? 'patch' : 'minor';
}
export const requiredChecksFor = tier => (tier === 'patch' ? patchChecks : minorChecks);
const blank = id => ({
  id,
  status: 'pending',
  completedAt: '',
  environment: '',
  procedure: '',
  observed: '',
  reviewer: '',
  artifacts: [],
});
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

// Git blob IDs avoid Windows checkout line endings changing the source fingerprint.
// Evidence is excluded to allow adding a report without a circular fingerprint.
export function sourceFingerprint(root) {
  const entries = git(root, ['ls-files', '--stage', '-z'])
    .split('\0')
    .filter(Boolean)
    .filter(entry => !entry.split('\t')[1]?.startsWith('release-evidence/'))
    .sort();
  if (!entries.length || entries.some(entry => !/^\d+ [a-f0-9]+ 0\t/.test(entry))) {
    throw new Error('源码为空或存在未解决的 Git 冲突');
  }
  return sha256(entries.join('\n'));
}

export function template(pkg) {
  const tier = releaseTier(pkg.version);
  return {
    schemaVersion: 2,
    version: pkg.version,
    build: pkg.chatsyncBuild,
    tier,
    sourceSha256: '',
    packageSha256: '',
    checks: requiredChecksFor(tier).map(blank),
    advisory: advisoryChecks.map(blank),
  };
}

export function validateRelease(root, manifest, packageFile) {
  const errors = [];
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (git(root, ['status', '--porcelain=v1', '--untracked-files=all']).trim()) {
    errors.push('工作区尚未冻结：请先提交全部候选源码及脱敏证据');
  }
  if (manifest.schemaVersion !== 2) errors.push('证据清单格式不支持');
  if (manifest.version !== pkg.version || manifest.build !== pkg.chatsyncBuild) errors.push('版本或构建标识不一致');
  let tier = null;
  try {
    tier = releaseTier(pkg.version);
  } catch (error) {
    errors.push(error.message);
  }
  if (manifest.tier !== tier) errors.push(`版本级别与清单不一致：${pkg.version} 属于 ${tier}`);
  const requiredChecks = requiredChecksFor(tier);
  if (!validHash(manifest.sourceSha256) || manifest.sourceSha256 !== sourceFingerprint(root))
    errors.push('源码指纹不一致，必须重新验收');
  if (
    !packageFile ||
    !fs.existsSync(packageFile) ||
    !validHash(manifest.packageSha256) ||
    manifest.packageSha256 !== sha256(fs.readFileSync(packageFile))
  )
    errors.push('候选安装包缺失或 SHA-256 不一致');
  const checks = Array.isArray(manifest.checks) ? manifest.checks : [];
  // An explicit, candidate-bound owner decision records unverified scenarios;
  // it never converts them to passed, and cannot override an actual failure.
  const decision = manifest.ownerDecision;
  const allowed = id => ['candidate-install', 'physical-two-device-github'].includes(id);
  const accepted = new Set();
  if (decision) {
    if (
      decision.version !== pkg.version ||
      decision.build !== pkg.chatsyncBuild ||
      decision.sourceSha256 !== manifest.sourceSha256 ||
      decision.packageSha256 !== manifest.packageSha256 ||
      decision.mode !== 'release-with-unverified-scenarios' ||
      !['instruction', 'reason', 'requestedBy', 'requestedAt'].every(key => nonempty(decision[key])) ||
      !Number.isFinite(Date.parse(decision.requestedAt)) ||
      Date.parse(decision.requestedAt) > Date.now() ||
      !Array.isArray(decision.acceptedChecks) ||
      !decision.acceptedChecks.length ||
      new Set(decision.acceptedChecks).size !== decision.acceptedChecks.length ||
      decision.acceptedChecks.some(id => !requiredChecks.includes(id) || !allowed(id))
    ) {
      errors.push('用户发布决定无效、越界或未绑定本次候选');
    } else for (const id of decision.acceptedChecks) accepted.add(id);
  }
  if (
    checks.length !== requiredChecks.length ||
    new Set(checks.map(check => check?.id)).size !== checks.length ||
    checks.some(check => !requiredChecks.includes(check?.id))
  )
    errors.push('检查项目不完整、重复或包含未知项目');
  const advisory = Array.isArray(manifest.advisory) ? manifest.advisory : [];
  if (
    advisory.some(check => !advisoryChecks.includes(check?.id)) ||
    new Set(advisory.map(check => check?.id)).size !== advisory.length
  )
    errors.push('参考检查项目重复或包含未知项目');
  for (const check of advisory)
    if (check?.status === 'failed') errors.push(`${check.id}：参考检查发现失败，必须先处理`);
  for (const id of requiredChecks) {
    const check = checks.find(item => item?.id === id);
    if (!check || (check.status !== 'passed' && !(check.status === 'not-verified' && accepted.has(id)))) {
      errors.push(`${id}：未通过`);
      continue;
    }
    if (
      !['environment', 'procedure', 'observed', 'reviewer'].every(key => nonempty(check[key])) ||
      !nonempty(check.completedAt) ||
      !Number.isFinite(Date.parse(check.completedAt)) ||
      Date.parse(check.completedAt) > Date.now()
    ) {
      errors.push(`${id}：缺少环境、操作、实测结果、复核人或有效完成时间`);
    }
    if (!Array.isArray(check.artifacts) || !check.artifacts.length) {
      errors.push(`${id}：缺少证据文件`);
      continue;
    }
    for (const artifact of check.artifacts) {
      const relative = artifact?.path;
      const prefix = `release-evidence/${pkg.version}/`;
      if (
        typeof relative !== 'string' ||
        !relative.startsWith(prefix) ||
        relative.includes('\\') ||
        relative.split('/').some(part => !part || part === '..' || part === '.')
      ) {
        errors.push(`${id}：证据路径必须在本版本 release-evidence 目录内`);
        continue;
      }
      const target = path.resolve(root, relative);
      const base = fs.realpathSync(root) + path.sep;
      try {
        if (
          !fs.realpathSync(target).startsWith(base) ||
          fs.lstatSync(target).isSymbolicLink() ||
          !fs.statSync(target).isFile() ||
          !fs.statSync(target).size ||
          !validHash(artifact.sha256) ||
          sha256(fs.readFileSync(target)) !== artifact.sha256
        ) {
          errors.push(`${id}：证据为空、越界或哈希不匹配：${relative}`);
        }
        const entry = git(root, ['ls-files', '--stage', '--', relative]).trim();
        if (!/^100(644|755) [a-f0-9]+ 0\t/.test(entry))
          errors.push(`${id}：证据必须是已纳入版本控制的普通文件：${relative}`);
      } catch {
        errors.push(`${id}：证据不可读取：${relative}`);
      }
    }
  }
  return errors;
}

function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--fingerprint') {
    if (git(root, ['diff', 'HEAD', '--', '.', ':!release-evidence']).trim())
      throw new Error('源码仍有未提交改动，请先冻结候选源码');
    console.log(sourceFingerprint(root));
    return;
  }
  const manifestPath = path.join(root, 'release-evidence', pkg.version, 'manifest.json');
  if (args.length === 1 && args[0] === '--init') {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(template(pkg), null, 2) + '\n', { flag: 'wx' });
    console.log(
      `已生成待验收清单：${manifestPath}（${releaseTier(pkg.version) === 'patch' ? '补丁版' : '次版本'}）；所有项目均未通过。`,
    );
    return;
  }
  if (args.length !== 2 || args[0] !== '--package')
    throw new Error('用法：node scripts/check-release-safety.mjs --init | --fingerprint | --package <候选 tgz>');
  if (!fs.existsSync(manifestPath)) throw new Error(`缺少本版安全验收清单：${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const errors = validateRelease(root, manifest, path.resolve(args[1]));
  if (errors.length) throw new Error('禁止定版/发布：\n- ' + errors.join('\n- '));
  const unverified = manifest.checks.filter(check => check.status === 'not-verified').map(check => check.id);
  console.log(
    unverified.length
      ? `依据用户决定允许有限验证发布：${pkg.version}；未验证 ${unverified.length} 项（不是全部验收通过）：${unverified.join(', ')}`
      : `安全证据门禁通过：${pkg.version} / ${pkg.chatsyncBuild}（${manifest.tier === 'patch' ? '补丁版' : '次版本'}，${manifest.checks.length} 项必过）；请保留实测范围声明。`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
