import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const interactiveTags = new Set([
  'button',
  'input',
  'select',
  'textarea',
  'a',
  'Link',
  'GatedButton',
]);

function collectTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(path);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [path] : [];
  });
}

function hasAttribute(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  name: string,
): boolean {
  return element.attributes.properties.some(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === name,
  );
}

describe('interactive UI tooltips', () => {
  it('gives every first-party interactive element a tooltip', () => {
    const failures: string[] = [];

    for (const file of collectTsxFiles(resolve(process.cwd(), 'src'))) {
      const source = readFileSync(file, 'utf8');
      const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );

      const visit = (node: ts.Node) => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tag = node.tagName.getText(sourceFile);
          const isInteractiveRole = node.attributes.properties.some(
            (attribute) =>
              ts.isJsxAttribute(attribute) &&
              attribute.name.getText(sourceFile) === 'role' &&
              attribute.initializer?.getText(sourceFile) === '"button"',
          );

          if ((interactiveTags.has(tag) || isInteractiveRole) && !hasAttribute(node, 'title')) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            failures.push(`${file}:${line + 1} <${tag}>`);
          }
        }
        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }

    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('keeps selected story-volume controls readable when they are also gated', () => {
    const filterStyles = readFileSync(
      resolve(process.cwd(), 'src/components/ui/FilterBar.module.css'),
      'utf8',
    );

    expect(filterStyles).toMatch(
      /\.timeToggle\.timeToggleActive\s*\{[^}]*color:\s*#ffffff;/,
    );
  });
});
