import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const sections = [...changelog.matchAll(/^## (\d+\.\d+\.\d+(?:-[\w.-]+)?)\s*·\s*\d{4}-\d{2}-\d{2}\s*$/gm)];
const index = sections.findIndex((section) => section[1] === version);
if (index === -1) throw new Error(`CHANGELOG.md 缺少 ${version} 的更新日志`);
const section = sections[index];
const notes = changelog.slice(section.index + section[0].length, sections[index + 1]?.index ?? changelog.length).trim();
if (!notes || !/[\u4e00-\u9fff]/u.test(notes)) {
  throw new Error(`${version} 的更新日志必须包含中文说明`);
}
writeFileSync('release-notes.md', `${notes}\n`);
