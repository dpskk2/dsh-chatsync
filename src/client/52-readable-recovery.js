// Use the host's own Markdown primitive when available, including code/list rendering.
let recoveryUi = {};
try {
  recoveryUi = require('@deepseek-ai/dsh-client-ui-primitives');
} catch {
  /* older hosts keep readable text */
}
const recoveryMarkdownLabels = {
  code: {
    copyLabel: '复制',
    copiedLabel: '已复制',
    toolbarLabels: { codeLabel: '代码', wrapLabel: '自动换行', unwrapLabel: '取消换行' },
  },
  footnotes: '脚注',
};
function RecoveryMarkdown({ text }) {
  if (recoveryUi.MarkdownText)
    return e(recoveryUi.MarkdownText, { text, streaming: false, labels: recoveryMarkdownLabels });
  return e('div', { className: 'dss-readable-text' }, text);
}

function RecoveryReadableVersion({ value, onMore, loading }) {
  const presentation = value.presentation;
  if (value.missing || presentation?.kind === 'missing') return e('p', { className: 'dss-desc' }, '此版本没有文件');
  if (!presentation)
    return e('div', { className: 'dss-readable-text' }, value.text || value.hint || '此文件暂不支持预览');
  if (presentation.kind === 'conversation')
    return e(
      'div',
      { className: 'dss-transcript', 'aria-label': '会话预览' },
      presentation.messages.map((message, index) =>
        e(
          'article',
          {
            key: message.id + ':' + index,
            className: 'dss-message dss-message-' + message.role,
            'aria-label': message.role === 'user' ? '用户消息' : '助手回复',
          },
          e(
            'div',
            { className: 'dss-message-body' },
            message.content.map((part, i) =>
              part.type === 'text'
                ? message.role === 'assistant'
                  ? e(RecoveryMarkdown, { key: i, text: part.text })
                  : e('div', { key: i, className: 'dss-readable-text' }, part.text)
                : e(
                    'div',
                    { key: i, className: 'dss-file-preview' },
                    e('span', { 'aria-hidden': true }, '▧'),
                    e('span', null, part.name),
                    part.bytes ? e('small', null, fmtBytes(part.bytes)) : null,
                  ),
            ),
          ),
        ),
      ),
      !presentation.total ? e('p', { className: 'dss-desc' }, '这份记录中没有用户消息或助手回复。') : null,
      presentation.incomplete ? e('p', { className: 'dss-err' }, '部分记录无法读取，预览不完整。') : null,
      presentation.hasMore
        ? e(
            'button',
            { type: 'button', className: 'dss-pill', disabled: loading, onClick: onMore },
            loading ? '正在读取…' : '继续显示对话',
          )
        : null,
    );
  if (presentation.kind === 'fields')
    return e(
      'div',
      { className: 'dss-readable-fields' },
      presentation.note ? e('p', { className: 'dss-desc' }, presentation.note) : null,
      e(
        'dl',
        null,
        presentation.fields.map((field, i) =>
          e('div', { key: i, className: 'dss-readable-field' }, e('dt', null, field.name), e('dd', null, field.value)),
        ),
      ),
    );
  if (presentation.kind === 'projects')
    return e(
      'div',
      { className: 'dss-readable-projects' },
      presentation.projects.map(project =>
        e(
          'article',
          { key: project.id },
          e('strong', null, project.title),
          e('div', null, project.location),
          e('div', { className: 'dss-desc' }, project.sessions + ' 个会话'),
        ),
      ),
      e('p', { className: 'dss-desc' }, '已归档 ' + presentation.archived + ' 个会话'),
    );
  if (presentation.kind === 'image')
    return e(
      'figure',
      { className: 'dss-readable-image' },
      e('img', { src: presentation.url, alt: presentation.name }),
      e('figcaption', null, presentation.name),
    );
  if (presentation.kind === 'file')
    return e(
      'div',
      { className: 'dss-file-preview' },
      e('span', { 'aria-hidden': true }, '▧'),
      e('strong', null, presentation.name),
      e('span', null, fmtBytes(presentation.bytes)),
      presentation.note ? e('p', { className: 'dss-desc' }, presentation.note) : null,
    );
  return e(
    'div',
    null,
    presentation.kind === 'markdown'
      ? e(RecoveryMarkdown, { text: presentation.text })
      : e('pre', { className: 'dss-readable-text' }, presentation.text),
    presentation.truncated ? e('p', { className: 'dss-desc' }, '文件较长，预览仅显示部分内容。') : null,
  );
}

function RecoveryReadableComparison({ preview, record, onMore, loading }) {
  const single =
    record?.reason === 'local-project-unavailable' &&
    record.versions?.local?.sha256 &&
    record.versions.local.sha256 === record.versions?.remote?.sha256;
  return e(
    'div',
    { className: 'dss-readable-comparison', style: single ? { gridTemplateColumns: 'minmax(0,1fr)' } : undefined },
    (single ? ['local'] : ['local', 'remote']).map(side =>
      e(
        'section',
        { key: side, className: 'dss-readable-side' },
        e(
          'div',
          { className: 'dss-readable-heading' },
          single ? '迁移前的会话' : side === 'local' ? '当时本机的内容' : '当时远端的内容',
        ),
        e(
          'div',
          { className: 'dss-readable-scroll', tabIndex: 0 },
          e(RecoveryReadableVersion, { value: preview[side], onMore: () => onMore?.(side), loading }),
        ),
      ),
    ),
  );
}
