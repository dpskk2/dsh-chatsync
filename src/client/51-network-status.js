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
function NetworkStatus({ busy, remote }) {
  const [data, setData] = useState(null);
  const [checking, setChecking] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setChecking(true);
    API.network()
      .then(d => alive && setData(d))
      .catch(err => alive && setData({ ok: false, error: err.message || String(err) }))
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, [attempt, remote]);
  const ok = Boolean(data?.ok);
  const probe = ok ? data.probe : null;
  const route = !data
    ? '检测中…'
    : !ok
      ? '无法检测：' + (data.error || '未知原因')
      : data.route === 'proxy'
        ? (PROXY_SOURCES[data.source] || '代理') + ' ' + proxyShort(data.proxy)
        : data.route === 'ssh'
          ? 'SSH'
          : '直连';
  const result = !probe ? '' : probe.ok ? probe.ms + ' ms' : '连接失败 · ' + probe.title;
  const commands = ok && data.commands;
  return e(
    'details',
    { className: 'dss-net', open: Boolean(commands || (probe && !probe.ok)) || undefined },
    e(
      'summary',
      null,
      e('span', { className: 'dss-net-dot', 'data-route': ok ? data.route : 'unknown', 'aria-hidden': true }),
      e('span', null, '网络'),
      e('b', null, route),
      result ? e('span', { className: probe.ok ? 'dss-desc' : 'dss-err' }, result) : null,
      e(
        'button',
        {
          type: 'button',
          className: 'dss-link',
          disabled: checking || busy,
          onClick: event => {
            event.preventDefault();
            setAttempt(n => n + 1);
          },
        },
        checking ? '检测中…' : '重新检测',
      ),
    ),
    probe && !probe.ok ? e('div', { className: 'dss-err' }, probe.reason + '。' + probe.action) : null,
    commands ? e(CopyCommand, { label: '设置', command: commands.set }) : null,
    commands ? e(CopyCommand, { label: '撤销', command: commands.unset }) : null,
    commands?.placeholder ? e('div', { className: 'dss-desc' }, '「端口号」换成代理软件的端口') : null,
  );
}
