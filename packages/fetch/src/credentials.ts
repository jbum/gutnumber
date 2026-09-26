import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SiteCredential {
  type: 'basic';
  user: string;
  pass: string;
}

export type CredentialLookup = (url: string) => SiteCredential | null;

/** Per-host credentials from $GUTNUMBER_PRIVATE_DIR/credentials.json (ARCHITECTURE §6.5). */
export function loadCredentials(privateDir: string | null, fallbackDir = process.cwd()): CredentialLookup {
  const candidates = [privateDir && join(privateDir, 'credentials.json'), join(fallbackDir, 'credentials.json')].filter(Boolean) as string[];
  let table: Record<string, SiteCredential> = {};
  for (const p of candidates) {
    if (existsSync(p)) {
      table = JSON.parse(readFileSync(p, 'utf8'));
      break;
    }
  }
  return credentialLookup(table);
}

export function credentialLookup(table: Record<string, SiteCredential>): CredentialLookup {
  return (url: string) => {
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return null;
    }
    // exact host, then parent domains (www.example.com → example.com)
    const parts = host.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const c = table[parts.slice(i).join('.')];
      if (c && c.type === 'basic') return c;
    }
    return null;
  };
}

export const basicHeader = (c: SiteCredential) => 'Basic ' + Buffer.from(`${c.user}:${c.pass}`).toString('base64');
