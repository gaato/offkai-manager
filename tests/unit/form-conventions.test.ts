import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

function routeFiles(filename: string, directory = resolve('src/routes')): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(filename, path);
    return entry.isFile() && entry.name === filename ? [path] : [];
  });
}

describe('form conventions', () => {
  it('uses named actions for every page action', () => {
    for (const path of routeFiles('+page.server.ts')) {
      expect(readFileSync(path, 'utf8'), path).not.toMatch(/^\s*default\s*:/m);
    }
  });

  it('gives every POST form an explicit named action', () => {
    for (const path of routeFiles('+page.svelte')) {
      const source = readFileSync(path, 'utf8');
      for (const [tag] of source.matchAll(/<form\b[\s\S]*?>/g)) {
        if (/\bmethod="POST"/.test(tag)) {
          expect(tag, `${path}: ${tag}`).toMatch(/\saction=/);
        }
      }
    }
  });
});
