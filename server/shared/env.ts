// Env reader for the local Express server. Parsing mirrors loadAuthEnv in
// server/auth.ts: process.env first, then .env, then .dev.vars (KEY=VALUE per
// line, blanks and # comments ignored, surrounding quotes stripped).

import * as fs from 'node:fs';

export function readEnv(key: string): string | undefined {
  if (process.env[key] !== undefined) return process.env[key];

  for (const file of ['.env', '.dev.vars']) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    let found: string | undefined;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const [, k, vRaw] = m;
      let v = vRaw.trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (k === key) found = v;
    }
    if (found !== undefined) return found;
  }
  return undefined;
}
