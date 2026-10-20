// Only GitHub can pass this release's pre-upload private-repository check.
export function parseSyncRemote(value) {
  const match = /^(?:https:\/\/(github\.com)\/|git@(github\.com):|ssh:\/\/git@(github\.com)\/)([\w.-]+)\/([\w.-]+?)\/?$/i.exec(String(value || '').trim());
  if (!match) return null;
  const owner = match[4], repo = match[5].replace(/\.git$/i, '');
  if (!repo || [owner, repo].some(p => p === '.' || p === '..')) return null;
  return { host: 'github.com', provider: 'github', owner, repo, fullName: owner + '/' + repo };
}
