const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const template = path.join(root, 'capacitor.config.template.json');
const out = path.join(root, 'capacitor.config.json');
const raw = (process.env.SMS_SERVER_URL || 'https://pagoserve.com').trim().replace(/\/$/, '');
const serverUrl = raw;
const isHttps = serverUrl.startsWith('https://');

const config = JSON.parse(fs.readFileSync(template, 'utf8'));
config.server = config.server || {};
config.server.url = serverUrl;
// Production uses HTTPS: disallow cleartext. Dev over http keeps cleartext.
config.server.cleartext = !isHttps;
config.server.androidScheme = isHttps ? 'https' : 'http';

fs.writeFileSync(out, JSON.stringify(config, null, 2) + '\n', 'utf8');
console.log(`Wrote capacitor.config.json with server.url=${serverUrl} (https=${isHttps})`);
