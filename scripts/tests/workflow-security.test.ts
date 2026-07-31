import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('GitHub workflow supply-chain policy', () => {
  it('pins every third-party action to a full commit SHA', () => {
    const workflowDirectory = resolve(process.cwd(), '.github', 'workflows');
    const violations: string[] = [];

    for (const file of readdirSync(workflowDirectory)) {
      if (!/\.ya?ml$/i.test(file)) continue;
      const source = readFileSync(resolve(workflowDirectory, file), 'utf8');
      for (const match of source.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)) {
        const reference = match[1];
        if (reference.startsWith('./')) continue;
        const separator = reference.lastIndexOf('@');
        const revision = separator >= 0 ? reference.slice(separator + 1) : '';
        if (!/^[0-9a-f]{40}$/i.test(revision)) violations.push(`${file}: ${reference}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
