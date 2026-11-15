/* ---------- 设置分节:网络连接(Git 走哪个代理 + 仓库连通测试;直连时给出可复制的代理命令) ---------- */
const PROXY_SOURCES = { 'git-config': 'Git 代理', manual: '插件代理', env: '环境变量代理', system: '系统代理' };
/* 本机代理只显示端口,其他主机显示 主机:端口 */
function proxyShort(url) {
  try {
    const u = new URL(url);
    return (/^(?:127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname) ? '' : u.hostname) + ':' + u.port;
  } catch {
    return url;
  }
}
function CopyCommand({ label, command }) {
  const [state, setState] = useState('');
  const copy = async () => {
    try {
      await window.navigator.clipboard.writeText(command);
      setState('已复制');
    } catch {
      setState('请手动复制');
    }
  };
  return e(
    'div',
    { className: 'dss-net-command' },
    e('span', { className: 'dss-net-label' }, label),
    e('code', null, command),
    e('button', { type: 'button', className: 'dss-pill', onClick: copy }, state || '复制'),
  );
}
function NetworkStatus({ busy, remote, candidate }) {
  const [data, setData] = useState(null);
  const [checking, setChecking] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [showDetails, setShowDetails] = useState(true);
  const pendingRemote = candidate?.remote && candidate.remote !== remote ? candidate.remote : null;
  useEffect(() => {
    let alive = true;
    const provider = candidate?.config?.remoteWeb?.label;
    if (pendingRemote && !attempt) {
      setData({ ok: true, candidate: true, provider });
      setChecking(false);
      return;
    }
    setChecking(true);
    const request = pendingRemote
      ? API.saveConnection({
          remote: pendingRemote,
          expectedRemote: candidate.expectedRemote,
          expectedBranch: candidate.expectedBranch,
          expectedAutoRepo: candidate.expectedAutoRepo,
          validateOnly: true,
        }).then(answer => ({ ok: answer.ok, candidate: true, provider, error: answer.error }))
      : API.network();
    request
      .then(d => alive && setData(d))
      .catch(err => alive && setData({ ok: false, error: err.message || String(err) }))
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, [attempt, remote, candidate, pendingRemote]);
  const ok = Boolean(data?.ok);
  const probe = ok ? data.probe : null;
  const route = !data
    ? '检测中…'
    : !ok
      ? '无法检测：' + (data.error || '未知原因')
      : data.candidate
        ? data.provider
        : data.route === 'proxy'
          ? (PROXY_SOURCES[data.source] || '代理') + ' ' + proxyShort(data.proxy)
          : data.route === 'ssh'
            ? 'SSH'
            : '直连';
  const result =
    ok && data.candidate ? '仓库已验证' : !probe ? '' : probe.ok ? probe.ms + ' ms' : '连接失败 · ' + probe.title;
  const commands = ok && data.commands;
  const hasDetails = Boolean(commands || (probe && !probe.ok));
  return e(
    'div',
    { className: 'dss-net' },
    e(
      'div',
      { className: 'dss-net-row' },
      e(
        'button',
        {
          type: 'button',
          className: 'dss-net-trigger',
          title: '重新检测网络',
          'aria-label': ['网络', checking ? '检测中' : route, !checking && result, '重新检测']
            .filter(Boolean)
            .join('，'),
          disabled: checking || busy,
          onClick: () => {
            setShowDetails(true);
            setAttempt(n => n + 1);
          },
        },
        e('span', { className: 'dss-net-dot', 'data-route': ok ? data.route : 'unknown', 'aria-hidden': true }),
        e(
          'span',
          { className: 'dss-net-text' },
          e('span', null, '网络'),
          e('b', null, checking ? '检测中…' : route),
          !checking && result
            ? e('span', { className: probe?.ok || data?.candidate ? 'dss-desc' : 'dss-err' }, result)
            : null,
        ),
      ),
      hasDetails
        ? e(
            'button',
            {
              className: 'dss-link',
              type: 'button',
              'aria-expanded': showDetails,
              'aria-label': showDetails ? '收起网络排查' : '展开网络排查',
              onClick: () => setShowDetails(value => !value),
            },
            e('span', { 'aria-hidden': true }, showDetails ? '▾' : '▸'),
          )
        : null,
    ),
    hasDetails && showDetails
      ? e(
          'div',
          { className: 'dss-net-detail' },
          probe && !probe.ok ? e('div', { className: 'dss-err' }, probe.reason + '。' + probe.action) : null,
          commands ? e(CopyCommand, { label: '设置', command: commands.set }) : null,
          commands ? e(CopyCommand, { label: '撤销', command: commands.unset }) : null,
          commands?.placeholder ? e('div', { className: 'dss-desc' }, '「端口号」换成代理软件的端口') : null,
        )
      : null,
  );
}
