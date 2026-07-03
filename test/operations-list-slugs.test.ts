import { describe, expect, test } from 'bun:test';
import { operations, operationsByName } from '../src/core/operations.ts';

/**
 * Tests for the list_slugs operation — regex-based slug querying.
 * Uses a mock engine to avoid database dependency.
 */

function findOp(name: string) {
  const op = operations.find(o => o.name === name);
  if (!op) throw new Error(`operation ${name} not found`);
  return op;
}

function mockEngine(results: any[] = []) {
  return {
    listSlugsByRegex: async (_pattern: string, _opts?: any) => results,
  } as any;
}

function mockCtx(engine: any) {
  return {
    engine,
    config: {} as any,
    logger: { info: () => {}, warn: () => {}, error: () => {} } as any,
    dryRun: false,
    remote: false,
  } as any;
}

describe('list_slugs operation', () => {
  test('operation is registered in operations array', () => {
    expect(operationsByName['list_slugs']).toBeDefined();
    const op = findOp('list_slugs');
    expect(op.scope).toBe('read');
  });

  test('pattern is required param', () => {
    const op = findOp('list_slugs');
    expect(op.params.pattern.required).toBe(true);
  });

  test('returns results with slug/title/type/text fields', async () => {
    const mockResults = [
      { slug: 'journal/2019-01-02', title: '2019-01-02', type: 'journal', updated_at: '2026-07-03', compiled_truth: 'diary entry' },
    ];
    const op = findOp('list_slugs');
    const result = await op.handler(mockCtx(mockEngine(mockResults)), { pattern: '^journal/2019' });
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].slug).toBe('journal/2019-01-02');
    expect(result[0].text).toBe('diary entry');
    expect(result[0].type).toBe('journal');
  });

  test('regex preprocessor converts \\d to [0-9]', async () => {
    let capturedPattern = '';
    const engine = {
      listSlugsByRegex: async (pattern: string) => { capturedPattern = pattern; return []; },
    } as any;
    const op = findOp('list_slugs');
    await op.handler(mockCtx(engine), { pattern: '^journal/\\d{4}-' });
    expect(capturedPattern).toBe('^journal/[0-9]{4}-');
  });

  test('empty results returns empty array', async () => {
    const op = findOp('list_slugs');
    const result = await op.handler(mockCtx(mockEngine([])), { pattern: '^nomatch' });
    expect(result).toEqual([]);
  });
});
