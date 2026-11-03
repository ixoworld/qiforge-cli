import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import path from 'path';

export type TemplateVars = Record<string, string>;

/**
 * Substitute `{{key}}` occurrences in `content` with `vars[key]`. Unknown keys
 * throw — catching typos at scaffold time is preferable to silent empty
 * substitutions that surface as broken generated code.
 */
export function substitute(content: string, vars: TemplateVars): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in vars)) {
      throw new Error(`Template placeholder {{${key}}} has no value in vars (keys: ${Object.keys(vars).join(', ')})`);
    }
    return vars[key]!;
  });
}

export interface RenderTemplateOptions {
  /** Source directory containing `.tmpl` files + literal copies. */
  sourceDir: string;
  /** Target directory to render into (created if missing). */
  targetDir: string;
  /** Placeholder values for {{key}} substitution. */
  vars: TemplateVars;
  /** If false, throw when targetDir is non-empty. Default false. */
  overwrite?: boolean;
}

/**
 * Template entries stored under another name because `npm publish` never
 * ships a file called `.gitignore` (npm-packlist drops it from every package),
 * so a template that kept it under its real name would scaffold projects with
 * no ignore file at all — and with secrets in `.dev.vars`.
 */
const RENAMED_ENTRIES: Readonly<Record<string, string>> = {
  _gitignore: '.gitignore',
};

/** The file name a template entry renders to (after `.tmpl` is stripped). */
export function renderedEntryName(entry: string, vars: TemplateVars): string {
  const name = substitute(entry, vars).replace(/\.tmpl$/, '');
  return RENAMED_ENTRIES[name] ?? name;
}

/**
 * Recursively copy a template tree, substituting `{{key}}` in file contents
 * AND filenames, and stripping a trailing `.tmpl` extension. Entries in
 * `RENAMED_ENTRIES` (e.g. `_gitignore`) land under their real name.
 *
 * Example: `{{name}}.plugin.ts.tmpl` with `vars.name = 'climate'`
 *          → `climate.plugin.ts`
 */
export function renderTemplate(opts: RenderTemplateOptions): void {
  const { sourceDir, targetDir, vars, overwrite = false } = opts;

  if (!existsSync(sourceDir)) {
    throw new Error(`Template source directory not found: ${sourceDir}`);
  }
  if (existsSync(targetDir) && !overwrite && readdirSync(targetDir).length > 0) {
    throw new Error(`Target directory not empty and overwrite is false: ${targetDir}`);
  }
  mkdirSync(targetDir, { recursive: true });

  for (const entry of readdirSync(sourceDir)) {
    const srcPath = path.join(sourceDir, entry);
    const dstPath = path.join(targetDir, renderedEntryName(entry, vars));

    if (statSync(srcPath).isDirectory()) {
      renderTemplate({ sourceDir: srcPath, targetDir: dstPath, vars, overwrite });
      continue;
    }

    if (entry.endsWith('.tmpl')) {
      const content = readFileSync(srcPath, 'utf8');
      writeFileSync(dstPath, substitute(content, vars));
    } else {
      writeFileSync(dstPath, readFileSync(srcPath));
    }
  }
}

/**
 * Render one `.tmpl` file of a template into `targetDir`, overwriting the
 * file there. Used to re-render a file whose values are only known after the
 * rest of the tree was scaffolded (e.g. the wrangler configs once the oracle
 * is provisioned).
 */
export function renderTemplateFile(opts: {
  sourceFile: string;
  targetDir: string;
  vars: TemplateVars;
}): string {
  const { sourceFile, targetDir, vars } = opts;
  if (!existsSync(sourceFile)) {
    throw new Error(`Template file not found: ${sourceFile}`);
  }
  const dstPath = path.join(targetDir, renderedEntryName(path.basename(sourceFile), vars));
  writeFileSync(dstPath, substitute(readFileSync(sourceFile, 'utf8'), vars));
  return dstPath;
}

/** kebab-case → PascalCase: `my-thing` → `MyThing`. */
export function toPascalCase(input: string): string {
  return input
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');
}

/** kebab-case → camelCase: `my-thing` → `myThing`. */
export function toCamelCase(input: string): string {
  const pascal = toPascalCase(input);
  return pascal[0] ? pascal[0].toLowerCase() + pascal.slice(1) : '';
}
