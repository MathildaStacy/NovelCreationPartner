/* Generate production notices from installed files, retaining exact provenance. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const licenseName = /(?:^|[._-])(?:licen[sc]e|copying|notice)(?:[._-]|$)/i;
const ignored = new Set(['node_modules', '.git', '__tests__', '__fixtures__', '__mocks__']);
const repoOf = pkg => String(typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository && pkg.repository.url) || '')
  .replace(/^git\+/, '').replace(/^git@github.com:/, 'https://github.com/').replace(/^ssh:\/\/git@github.com\//, 'https://github.com/').replace(/\.git$/, '').replace(/\/$/, '');
function children(folder, nested, depth = 0) {
  const files = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const name = path.join(folder, entry.name);
    if (entry.isFile() && licenseName.test(entry.name)) files.push(name);
    else if (nested && depth < 6 && entry.isDirectory() && !ignored.has(entry.name)) files.push(...children(name, true, depth + 1));
  }
  return files.sort();
}
const read = file => ({ path: path.relative(root, file), text: fs.readFileSync(file, 'utf8') });
// A README declaration alone is preserved but never mistaken for the required full text.
function readmeNotices(folder) {
  const notices = [];
  for (const entry of fs.readdirSync(folder).filter(name => /^readme(?:\.|$)/i.test(name))) {
    const file = path.join(folder, entry);
    if (!fs.statSync(file).isFile()) continue;
    const source = fs.readFileSync(file, 'utf8');
    const section = source.match(/^#{1,6}\s*(?:licen[sc]e|copyright|legal)[^\n]*\n([\s\S]*?)(?=^#{1,6}\s|$(?![\s\S]))/im);
    if (section) notices.push({ path: path.relative(root, file), text: section[0].trim() });
  }
  return notices;
}
function fullText(text, license) {
  text = text.replace(/\s+/g, ' ');
  if (/\bMIT\b/.test(license)) return /Permission is hereby granted, free of charge/.test(text) && /(?:THE|THIS) SOFTWARE IS PROVIDED ["'“`]+AS IS/.test(text) && /Copyright/i.test(text);
  if (/Apache-2\.0/.test(license)) return /Apache License/.test(text) && /TERMS AND CONDITIONS FOR USE/.test(text) && /END OF TERMS AND CONDITIONS/.test(text);
  if (license === '0BSD') return /Permission to use, copy, modify/.test(text) && /WARRANTIES/.test(text);
  if (/BSD/.test(license)) return /Redistribution and use/.test(text) && /THIS(?: SOFTWARE)? IS PROVIDED/.test(text);
  return text.length > 150 && /copyright|public domain|permission|redistribution/i.test(text);
}
const records = [];
for (const [location, metadata] of Object.entries(lock.packages)) {
  if (!location || metadata.dev || metadata.link) continue;
  const folder = path.join(root, location);
  const manifest = path.join(folder, 'package.json');
  if (!fs.existsSync(manifest)) throw new Error(`Install dependencies before generating licenses: ${location}`);
  const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const license = typeof pkg.license === 'string' ? pkg.license : (pkg.license && pkg.license.type) || metadata.license || 'Unspecified';
  if (/(?:GPL-2\.0-only|AGPL|UNLICENSED|LicenseRef|Proprietary)/i.test(license)) throw new Error(`Review license compatibility: ${pkg.name}: ${license}`);
  const sources = children(folder, false).map(read);
  records.push({ name: pkg.name, version: pkg.version, license, integrity: metadata.integrity, folder, repository: repoOf(pkg), sources });
}
for (const pkg of records) {
  if (!pkg.sources.some(source => fullText(source.text, pkg.license))) pkg.sources = children(pkg.folder, true).map(read).concat(readmeNotices(pkg.folder));
  // Monorepo packages often reference a root LICENSE omitted from their tarball.
  // Use only an installed sibling declaring the exact same repository and license.
  if (!pkg.sources.some(source => fullText(source.text, pkg.license)) && pkg.repository) {
    const donor = records.find(peer => peer !== pkg && peer.repository === pkg.repository && peer.license === pkg.license && peer.sources.some(source => fullText(source.text, peer.license)));
    if (donor) pkg.sources.push(...donor.sources.filter(source => fullText(source.text, pkg.license)).map(source => Object.assign({}, source, { via: `${donor.name}@${donor.version}`, repository: pkg.repository })));
  }
}
// Official upstream notices omitted by npm tarballs are cached for offline regeneration.
// An upgrade must be reviewed again: name, version, repository, license and lock integrity all match.
const supplementalPath = path.join(root, 'docs/licenses/sources.json');
const supplemental = JSON.parse(fs.readFileSync(supplementalPath, 'utf8'));
if (supplemental.formatVersion !== 1 || !Array.isArray(supplemental.records)) throw new Error('Invalid supplemental license manifest');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
for (const group of supplemental.records) {
  const sources = group.sources.map(source => {
    const absolute = path.resolve(root, source.path);
    if (!absolute.startsWith(path.join(root, 'docs/licenses') + path.sep)
      || !source.url.startsWith('https://raw.githubusercontent.com/') || !/^[a-f0-9]{40}$/.test(source.ref)) throw new Error('Invalid upstream license provenance');
    const bytes = fs.readFileSync(absolute);
    if (sha256(bytes) !== source.sha256) throw new Error(`License source changed: ${source.path}`);
    return Object.assign({}, source, { text: bytes.toString('utf8'), repository: group.repository },
      group.note ? { note: group.note } : {}, group.sourceRelease ? { sourceRelease: group.sourceRelease } : {});
  });
  for (const check of group.matchingSources || []) {
    const absolute = path.resolve(root, check.installedPath);
    if (!absolute.startsWith(path.join(root, 'node_modules') + path.sep)
      || sha256(fs.readFileSync(absolute)) !== check.sha256) throw new Error(`Upstream runtime identity changed: ${check.installedPath}`);
  }
  for (const target of group.packages) {
    if (!group.note && group.sources.some(source => source.ref !== target.gitHead)) throw new Error(`License source is not the npm release commit: ${target.name}@${target.version}`);
    const installed = records.filter(pkg => pkg.name === target.name && pkg.version === target.version);
    for (const pkg of installed) {
      if (pkg.repository !== group.repository || pkg.license !== group.license || pkg.integrity !== target.integrity) {
        throw new Error(`Supplemental license no longer matches installed package: ${target.name}@${target.version}`);
      }
      if (!pkg.sources.some(source => fullText(source.text, pkg.license))) {
        pkg.sources.push(...sources.map(source => Object.assign({}, source, { packageVersion: target.version,
          registryUrl: target.registryUrl, packageGitHead: target.gitHead, packageIntegrity: target.integrity })));
      }
    }
  }
}
const unique = [...new Map(records.map(pkg => [`${pkg.name}@${pkg.version}`, pkg])).values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const packages = unique.map(pkg => ({ name: pkg.name, version: pkg.version, license: pkg.license, repository: pkg.repository,
  sources: pkg.sources, text: pkg.sources.map(source => `${source.path}${source.via ? ` (same repository: ${source.via})` : ''}${source.url ? `\nOfficial source: ${source.url}` : ''}${source.note ? `\n${source.note}` : ''}\n${source.text}`).join('\n\n') || 'No license notice was included in this installed package. Release review required.',
  complete: pkg.sources.some(source => fullText(source.text, pkg.license)) }));
const missing = packages.filter(pkg => !pkg.complete).map(pkg => `${pkg.name}@${pkg.version}`);
fs.mkdirSync(path.join(root, 'src/assets'), { recursive: true });
fs.writeFileSync(path.join(root, 'src/assets/licenses.json'), JSON.stringify({ license: fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'), packages, missing }, null, 2) + '\n');
process.stdout.write(`Bundled ${packages.length} production dependency notices; ${missing.length} packages still require complete-license review.\n${missing.join('\n')}\n`);
if (missing.length) process.exitCode = 1;
