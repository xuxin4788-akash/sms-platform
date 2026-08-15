const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const projectRoot = path.join(root, '..');
const out = path.join(root, 'www');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

fs.rmSync(out, { recursive: true, force: true });
ensureDir(out);
copyDir(path.join(projectRoot, 'static'), path.join(out, 'static'));
fs.copyFileSync(path.join(projectRoot, 'templates', 'index.html'), path.join(out, 'index.html'));
console.log('Mobile www synced:', out);
