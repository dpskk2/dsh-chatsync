/* ---------- 同步图标 ---------- */
function SyncIcon(props) {
  const size = props.size || 16;
  const style = { display: 'block', width: size, height: size, flex: 'none',
    aspectRatio: '1 / 1', transformBox: 'view-box', transformOrigin: '50% 50%',
    ...(props.spin ? { animation: 'dss-spin .9s linear infinite' } : {}) };
  return e('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', style, 'aria-hidden': true },
    e('path', { d: 'M13.196152423 5A6 6 0 1 0 14 8', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
    e('path', { d: 'M13.196152423 1.8V5h-3.2', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }));
}

