import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { findTemplate, loadTemplateCatalog } from '../utils/template-catalog';

describe('loadTemplateCatalog (real bundled catalog)', () => {
  const templatesDir = path.resolve(__dirname, '..', 'templates');

  it('loads the shipped catalog with the basic template present', () => {
    const catalog = loadTemplateCatalog(templatesDir);
    const names = catalog.map((t) => t.name);
    expect(names).toContain('basic');
    const basic = catalog.find((t) => t.name === 'basic')!;
    expect(basic.description.length).toBeGreaterThan(0);
  });
});

describe('loadTemplateCatalog (fixtures)', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(path.join(tmpdir(), 'qiforge-cli-catalog-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('throws when manifest is missing', () => {
    expect(() => loadTemplateCatalog(workspace)).toThrow(/Template manifest not found/);
  });

  it('throws when manifest references a missing directory', () => {
    writeFileSync(
      path.join(workspace, 'index.json'),
      JSON.stringify({
        templates: [{ name: 'ghost', description: 'Missing on disk', tags: [] }],
      }),
    );
    expect(() => loadTemplateCatalog(workspace)).toThrow(/directory is missing/);
  });

  it('throws on a malformed name', () => {
    writeFileSync(
      path.join(workspace, 'index.json'),
      JSON.stringify({
        templates: [{ name: 'BadName', description: 'invalid', tags: [] }],
      }),
    );
    expect(() => loadTemplateCatalog(workspace)).toThrow(/kebab-case/);
  });

  it('returns parsed entries for a well-formed catalog', () => {
    mkdirSync(path.join(workspace, 'foo'));
    writeFileSync(
      path.join(workspace, 'index.json'),
      JSON.stringify({
        templates: [{ name: 'foo', description: 'Foo template', tags: ['x'] }],
      }),
    );
    const catalog = loadTemplateCatalog(workspace);
    expect(catalog).toEqual([{ name: 'foo', description: 'Foo template', tags: ['x'] }]);
  });
});

describe('findTemplate', () => {
  const catalog = [
    { name: 'basic', description: 'a', tags: [] },
    { name: 'rich', description: 'b', tags: [] },
  ];

  it('returns the matching entry', () => {
    expect(findTemplate(catalog, 'basic').name).toBe('basic');
  });

  it('throws and lists available names on unknown', () => {
    expect(() => findTemplate(catalog, 'missing')).toThrow(/Available: basic, rich/);
  });
});
