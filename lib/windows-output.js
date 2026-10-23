// Windows utilities use the current console code page, not necessarily UTF-8.
export function windowsOutput(value) {
  if (!Buffer.isBuffer(value)) return String(value || '');
  if (value[0] === 0xff && value[1] === 0xfe) return value.subarray(2).toString('utf16le').trim();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(value).trim(); }
  catch { return new TextDecoder('gb18030').decode(value).trim(); }
}
