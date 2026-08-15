const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const template = path.join(root, 'capacitor.config.template.json');
const out = path.join(root, 'capacitor.config.json');
const serverUrl = (process.env.SMS_SERVER_URL || 'http://47.87.38.52').trim().replace(/\/$/, '');

const config = JSON.parse(fs.readFileSync(template, 'utf8'));
config.server = config.server || {};
config.server.url = serverUrl;

fs.writeFileSync(out, JSON.stringify(config, null, 2) + '\n', 'utf8');
console.log(`Wrote capacitor.config.json with server.url=${serverUrl}`);
