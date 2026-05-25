import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { z } from 'zod';

export const TemplateEntrySchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*[a-z0-9]$/, 'Template name must be kebab-case'),
  description: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

export type TemplateEntry = z.infer<typeof TemplateEntrySchema>;

const CatalogFileSchema = z.object({
  templates: z.array(TemplateEntrySchema).min(1),
});

/**
 * Read and validate `templates/index.json`. Throws if the manifest is missing,
 * malformed, or empty. Also verifies that every advertised template has a
 * matching directory under the templates root.
 */
export function loadTemplateCatalog(templatesDir: string): TemplateEntry[] {
  const manifestPath = path.join(templatesDir, 'index.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Template manifest not found at ${manifestPath}`);
  }

  const raw = readFileSync(manifestPath, 'utf8');
  const parsed = CatalogFileSchema.parse(JSON.parse(raw));

  for (const entry of parsed.templates) {
    const dir = path.join(templatesDir, entry.name);
    if (!existsSync(dir)) {
      throw new Error(
        `Template "${entry.name}" is listed in index.json but its directory is missing at ${dir}`,
      );
    }
  }

  return parsed.templates;
}

/** Find an entry by name; throws with the list of available names on miss. */
export function findTemplate(
  catalog: TemplateEntry[],
  name: string,
): TemplateEntry {
  const match = catalog.find((t) => t.name === name);
  if (!match) {
    const available = catalog.map((t) => t.name).join(', ');
    throw new Error(`Unknown template "${name}". Available: ${available}`);
  }
  return match;
}
