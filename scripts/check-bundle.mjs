// Fails the build if the App Check debug token, in either its current or its old variable
// name, appears anywhere in the files that would be published.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const secrets = [];
try {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:VITE_)?APPCHECK_DEBUG_TOKEN\s*=\s*(.+?)\s*$/);
    if (m && m[1]) secrets.push(m[1]);
  }
} catch {
  // No .env.local: nothing secret to look for.
}

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
walk('dist');

const leaks = files.filter((f) => {
  const text = readFileSync(f, 'utf8');
  // The value itself, or the old VITE_ variable name (which Vite would have copied with it).
  return secrets.some((s) => text.includes(s)) || text.includes('VITE_APPCHECK_DEBUG_TOKEN');
});
if (leaks.length) {
  console.error(`The App Check debug token would be published in: ${leaks.join(', ')}`);
  process.exit(1);
}
console.log(`check-bundle: ${files.length} files, no debug token.`);
