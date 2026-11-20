import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { operations } from '../src/core/operations.ts';
import type { OperationContext } from '../src/core/ops/contract.ts';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import type { PageFilters } from '../src/core/types.ts';

const op = operations.find(op => op.name === 'list_slugs')!;
const emptyList = (seen: PageFilters[]): OperationContext => ({
  remote: false,
  engine: { listPages: async (filters: PageFilters) => { seen.push(filters); return []; } },
} as unknown as OperationContext);

describe('Carlos fork list_slugs compatibility', () => {
  test('registers a read operation and forwards regex, sort, and pagination', async () => {
    expect(op.scope).toBe('read');
    expect(op.mutating).toBe(false);
    const seen: PageFilters[] = [];
    expect(await op.handler(emptyList(seen), { pattern: String.raw`^journal/\d+`, limit: 8, offset: 2, sort_by: 'title', sort_order: 'desc', type: 'journal' })).toEqual([]);
    expect(seen).toMatchObject([{ slugRegex: '^journal/[0-9]+', limit: 8, offset: 2, sort: 'title_desc', type: 'journal', listColumnsOnly: true }]);
  });

  test('rejects invalid patterns before reaching the database', async () => {
    const seen: PageFilters[] = [];
    await expect(op.handler(emptyList(seen), { pattern: '' })).rejects.toMatchObject({ code: 'invalid_params' });
    expect(seen).toEqual([]);
  });
});

describe('legacy regex through the shared engine (synthetic in-memory data)', () => {
  const engine = new PGLiteEngine();
  const put = (slug: string, title: string, sourceId: string, hidden = false) => engine.putPage(slug, {
    type: 'note', title, compiled_truth: `Synthetic body for ${title}.`, frontmatter: hidden ? { visibility: 'private' } : {},
  }, { sourceId });

  beforeAll(async () => {
    await engine.connect({});
    await engine.initSchema();
    await engine.executeRaw("INSERT INTO sources (id, name) VALUES ('legacy-other', 'legacy-other')");
    await put('journal/20', 'B', 'default');
    await put('journal/10', 'A', 'default');
    await put('journal/30', 'Private', 'default', true);
    await put('journal/40', 'Other source', 'legacy-other');
    await put('journal/50', 'Deleted page', 'default');
    await engine.softDeletePage('journal/50', { sourceId: 'default' });
    await put('other/60', 'Non-matching page', 'default');
  }, 120_000);
  afterAll(async () => { await engine.disconnect(); }, 30_000);

  test('regex and ordering apply before paging without leaking other sources or private/deleted pages', async () => {
    const rows = await engine.listPages({
      slugRegex: '^journal/[0-9]+$', sourceId: 'default', excludePrivate: true,
      sort: 'title_desc', limit: 1, offset: 1, listColumnsOnly: true,
    });
    expect(rows.map(row => row.slug)).toEqual(['journal/10']);
    expect(rows[0]?.compiled_truth).toBe('');
  });

  test('returns the legacy five-field array shape and body via the canonical reader', async () => {
    const ctx = { engine, config: {}, logger: console, dryRun: false, remote: false, sourceId: 'default' } as OperationContext;
    const rows = await op.handler(ctx, { pattern: '^journal/10$', limit: 1 });
    expect(rows).toEqual([{ slug: 'journal/10', title: 'A', type: 'note', updated_at: expect.anything(), text: 'Synthetic body for A.' }]);
  });
});
