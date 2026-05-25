import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  renderTemplate,
  substitute,
  toCamelCase,
  toPascalCase,
} from '../utils/template-renderer';

const TMP_ROOT = path.join(tmpdir(), `qiforge-cli-renderer-${process.pid}`);

function makeTmpDir(name: string): string {
  const dir = path.join(TMP_ROOT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

afterAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe('substitute', () => {
  it('replaces single placeholder', () => {
    expect(substitute('hello {{name}}', { name: 'world' })).toBe('hello world');
  });

  it('replaces multiple placeholders', () => {
    expect(
      substitute('{{a}} + {{b}} = {{c}}', { a: '1', b: '2', c: '3' }),
    ).toBe('1 + 2 = 3');
  });

  it('throws on unknown placeholder (typo detection)', () => {
    expect(() => substitute('hello {{nameTypo}}', { name: 'x' })).toThrow(
      /no value/,
    );
  });

  it('leaves content untouched when no placeholders', () => {
    expect(substitute('plain text', { name: 'x' })).toBe('plain text');
  });
});

describe('toPascalCase / toCamelCase', () => {
  it('converts kebab to PascalCase', () => {
    expect(toPascalCase('my-thing')).toBe('MyThing');
    expect(toPascalCase('single')).toBe('Single');
    expect(toPascalCase('a-b-c')).toBe('ABC');
  });

  it('converts kebab to camelCase', () => {
    expect(toCamelCase('my-thing')).toBe('myThing');
    expect(toCamelCase('single')).toBe('single');
  });
});

describe('renderTemplate', () => {
  it('copies tree, substitutes file content and filenames, strips .tmpl', () => {
    const source = makeTmpDir('source');
    const target = makeTmpDir('target');

    // Build a tiny template tree:
    //   source/
    //   ├── hello.txt.tmpl              ("hi {{name}}")
    //   ├── static.txt                  ("untouched")
    //   └── {{name}}/
    //       └── greeting.txt.tmpl       ("hello from {{name}}")
    writeFileSync(path.join(source, 'hello.txt.tmpl'), 'hi {{name}}');
    writeFileSync(path.join(source, 'static.txt'), 'untouched');
    mkdirSync(path.join(source, '{{name}}'));
    writeFileSync(
      path.join(source, '{{name}}', 'greeting.txt.tmpl'),
      'hello from {{name}}',
    );

    renderTemplate({
      sourceDir: source,
      targetDir: target,
      vars: { name: 'alice' },
      overwrite: true,
    });

    expect(readFileSync(path.join(target, 'hello.txt'), 'utf8')).toBe('hi alice');
    expect(readFileSync(path.join(target, 'static.txt'), 'utf8')).toBe(
      'untouched',
    );
    expect(
      readFileSync(path.join(target, 'alice', 'greeting.txt'), 'utf8'),
    ).toBe('hello from alice');
  });

  it('throws when targetDir is non-empty and overwrite is false', () => {
    const source = makeTmpDir('src2');
    const target = makeTmpDir('dst2');
    writeFileSync(path.join(source, 'x.tmpl'), 'x');
    writeFileSync(path.join(target, 'existing'), 'data');

    expect(() =>
      renderTemplate({
        sourceDir: source,
        targetDir: target,
        vars: {},
      }),
    ).toThrow(/not empty/);
  });
});
