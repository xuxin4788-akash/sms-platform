const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const projectRoot = path.join(root, '..');
const out = path.join(root, 'www');

// Files/dirs that must never be bundled into the Android package.
// *.apk are browser-download artifacts hosted under /static; embedding them
// inflates the app by hundreds of MB and serves no purpose on-device.
const EXCLUDE_EXT = new Set(['.apk', '.aab', '.keystore', '.jks', '.log', '.db']);
const EXCLUDE_DIRS = new Set(['build', 'node_modules', '.git']);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDE_DIRS.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      if (EXCLUDE_EXT.has(path.extname(entry.name).toLowerCase())) continue;
      fs.copyFileSync(s, d);
    }
  }
}

fs.rmSync(out, { recursive: true, force: true });
ensureDir(out);
copyDir(path.join(projectRoot, 'static'), path.join(out, 'static'));
fs.copyFileSync(path.join(projectRoot, 'templates', 'index.html'), path.join(out, 'index.html'));
console.log('Mobile www synced:', out);
