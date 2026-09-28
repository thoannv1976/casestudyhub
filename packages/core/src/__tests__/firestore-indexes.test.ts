import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COLLECTIONS } from '@casestudyhub/shared';

/**
 * Every query that needs a composite index has one.
 *
 * This is the one gap the other three layers cannot cover. The Firestore
 * emulator answers any query it is given, index or no index, so a query that
 * needs one passes every test here and then fails on the first real user -
 * which is how this project shipped a broken screen to production before.
 *
 * So the check is made against the source itself: find every query, work out
 * whether Firestore would need a composite index for it, and look that index
 * up in `firebase/firestore.indexes.json`.
 */

const ROOT = join(import.meta.dirname, '../../../..');
const SOURCE_DIRS = ['packages/core/src', 'apps/web/src'];

interface Query {
  file: string;
  line: number;
  collection: string;
  filters: { field: string; op: string }[];
  orderBy: string[];
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules' || entry === '.next') continue;
      out.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** Reads a balanced `(...)` starting at `open`, returning its contents and end. */
function balanced(src: string, open: number): { body: string; end: number } {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') {
      depth -= 1;
      if (depth === 0) return { body: src.slice(open + 1, i), end: i + 1 };
    }
  }
  return { body: '', end: src.length };
}

/**
 * Walks one query chain from `.collection(...)` onwards.
 *
 * Written as a walker rather than a regular expression because the chains are
 * often inside a `Promise.all([...])`, where a regular expression happily runs
 * past the end of one query and swallows the filters of the next - which reads
 * as a query with eight filters that nobody wrote.
 */
function readChain(
  src: string,
  start: number,
): { query: Omit<Query, 'file' | 'line'>; end: number } {
  const { body: collectionArg, end: afterCollection } = balanced(src, start);
  const collection = collectionArg.trim().replace(/^COLLECTIONS\./, '');

  const filters: { field: string; op: string }[] = [];
  const orderBy: string[] = [];

  let at = afterCollection;
  for (;;) {
    const rest = src.slice(at);
    const method =
      /^\s*\.(where|orderBy|limit|select|startAfter|endBefore|offset|doc|get|count)\s*\(/.exec(
        rest,
      );
    if (!method) break;

    const open = at + method[0].length - 1;
    const { body, end } = balanced(src, open);
    at = end;

    if (method[1] === 'where') {
      const parsed = /^\s*'([^']+)'\s*,\s*'([^']+)'/.exec(body);
      if (parsed) filters.push({ field: parsed[1]!, op: parsed[2]! });
    } else if (method[1] === 'orderBy') {
      const parsed = /^\s*'([^']+)'/.exec(body);
      if (parsed) orderBy.push(parsed[1]!);
    } else if (method[1] === 'get' || method[1] === 'count' || method[1] === 'doc') {
      break;
    }
  }

  return { query: { collection, filters, orderBy }, end: at };
}

function queriesIn(file: string): Query[] {
  const src = readFileSync(file, 'utf8');
  const found: Query[] = [];

  for (let at = src.indexOf('.collection('); at !== -1; at = src.indexOf('.collection(', at + 1)) {
    const open = at + '.collection'.length;
    const { query } = readChain(src, open);
    if (query.filters.length === 0 && query.orderBy.length === 0) continue;
    found.push({
      ...query,
      file: relative(ROOT, file),
      line: src.slice(0, at).split('\n').length,
    });
  }

  return found;
}

/**
 * Firestore serves a single-field query from the indexes it keeps by itself.
 * Anything wider - a second field, or a sort on a field other than the one
 * being filtered - needs an index somebody declared.
 */
function needsCompositeIndex(query: Query): boolean {
  const fields = new Set(query.filters.map((filter) => filter.field));
  if (fields.size > 1) return true;
  if (query.orderBy.length === 0) return false;
  return query.orderBy.some((field) => !fields.has(field)) && fields.size > 0;
}

interface DeclaredIndex {
  collectionGroup: string;
  fields: { fieldPath: string }[];
}

const declared: DeclaredIndex[] = (
  JSON.parse(readFileSync(join(ROOT, 'firebase/firestore.indexes.json'), 'utf8')) as {
    indexes: DeclaredIndex[];
  }
).indexes;

function isCovered(query: Query): boolean {
  const wanted = new Set([...query.filters.map((f) => f.field), ...query.orderBy]);
  return declared.some((index) => {
    if (index.collectionGroup !== query.collection) return false;
    const has = new Set(index.fields.map((field) => field.fieldPath));
    return wanted.size === has.size && [...wanted].every((field) => has.has(field));
  });
}

describe('composite indexes', () => {
  const queries = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir))).flatMap(queriesIn);

  it('finds the queries to check, so an empty pass cannot look like a green one', () => {
    expect(queries.length).toBeGreaterThan(20);
    expect(queries.some((query) => needsCompositeIndex(query))).toBe(true);
  });

  it('declares an index for every query that needs one', () => {
    const uncovered = queries
      .filter(needsCompositeIndex)
      .filter((query) => !isCovered(query))
      .map(
        (query) =>
          `${query.file}:${query.line} ${query.collection} ` +
          `where=[${query.filters.map((f) => `${f.field} ${f.op}`).join(', ')}]` +
          (query.orderBy.length ? ` orderBy=[${query.orderBy.join(', ')}]` : ''),
      );

    expect(uncovered, `queries with no composite index:\n  ${uncovered.join('\n  ')}`).toEqual([]);
  });

  it('names collections that exist', () => {
    const known = new Set(Object.values(COLLECTIONS));
    const unknown = declared
      .map((index) => index.collectionGroup)
      .filter((name) => !known.has(name as (typeof COLLECTIONS)[keyof typeof COLLECTIONS]));
    expect(unknown, `indexes on collections the code does not use: ${unknown.join(', ')}`).toEqual(
      [],
    );
  });
});
