// Tiny demo app: loads .env and prints what it got, then keeps running.
const fs = require('fs');
const env = Object.fromEntries(
  fs.readFileSync(__dirname + '/.env', 'utf8')
    .split('\n')
    .filter((l) => /^\s*[A-Za-z_]/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
console.log(`[${new Date().toLocaleTimeString()}] started with`, env);
require('http').createServer((_, res) => res.end(JSON.stringify(env))).listen(Number(env.PORT) || 3000);
