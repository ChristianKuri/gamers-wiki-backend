import { describe, it, expect } from 'vitest';

import {
  normalizeQuery,
  normalizeUrl,
  ResearchPoolBuilder,
  createEmptyResearchPool,
  deduplicateQueries,
  collectUrls,
  extractResearchForQueries,
  processSearchResults,
} from '../../../src/ai/articles/research-pool';
import type { CategorizedSearchResult, ResearchPool } from '../../../src/ai/articles/types';

// ============================================================================
// Test Fixtures
// ============================================================================

const createMockSearchResult = (
  query: string,
  category: CategorizedSearchResult['category'],
  urls: string[] = ['https://example.com/1', 'https://example.com/2']
): CategorizedSearchResult => ({
  query,
  answer: `Answer for ${query}`,
  results: urls.map((url, i) => ({
    title: `Result ${i + 1}`,
    url,
    content: `Content for result ${i + 1}`,
    score: 1 - i * 0.1,
  })),
  category,
  timestamp: Date.now(),
});

// ============================================================================
// normalizeQuery Tests
// ============================================================================

describe('normalizeQuery', () => {
  it('converts to lowercase', () => {
    expect(normalizeQuery('HELLO WORLD')).toBe('hello world');
    expect(normalizeQuery('Elden Ring')).toBe('elden ring');
  });

  it('trims whitespace', () => {
    expect(normalizeQuery('  hello  ')).toBe('hello');
    expect(normalizeQuery('\thello\n')).toBe('hello');
  });

  it('normalizes multiple spaces to single space', () => {
    expect(normalizeQuery('hello    world')).toBe('hello world');
    expect(normalizeQuery('a   b   c')).toBe('a b c');
  });

  it('handles combined normalization', () => {
    expect(normalizeQuery('  ELDEN   RING   Guide  ')).toBe('elden ring guide');
  });

  it('handles empty string', () => {
    expect(normalizeQuery('')).toBe('');
    expect(normalizeQuery('   ')).toBe('');
  });
});

// ============================================================================
// normalizeUrl Tests
// ============================================================================

describe('normalizeUrl', () => {
  it('returns normalized URL for valid http URLs', () => {
    const url = normalizeUrl('http://example.com/page');
    expect(url).toBe('http://example.com/page');
  });

  it('returns normalized URL for valid https URLs', () => {
    const url = normalizeUrl('https://example.com/page');
    expect(url).toBe('https://example.com/page');
  });

  it('removes hash fragments', () => {
    const url = normalizeUrl('https://example.com/page#section');
    expect(url).toBe('https://example.com/page');
  });

  it('preserves query parameters', () => {
    const url = normalizeUrl('https://example.com/page?foo=bar');
    expect(url).toBe('https://example.com/page?foo=bar');
  });

  it('returns null for non-http protocols', () => {
    expect(normalizeUrl('ftp://example.com')).toBeNull();
    expect(normalizeUrl('file:///path/to/file')).toBeNull();
    expect(normalizeUrl('javascript:void(0)')).toBeNull();
  });

  it('returns null for invalid URLs', () => {
    expect(normalizeUrl('not a url')).toBeNull();
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('://missing-protocol.com')).toBeNull();
  });

  it('preserves trailing slashes', () => {
    const url = normalizeUrl('https://example.com/path/');
    expect(url).toBe('https://example.com/path/');
  });
});

// ============================================================================
// ResearchPoolBuilder Tests
// ============================================================================

describe('ResearchPoolBuilder', () => {
  describe('constructor', () => {
    it('creates empty pool by default', () => {
      const builder = new ResearchPoolBuilder();
      expect(builder.urlCount).toBe(0);
      expect(builder.queryCount).toBe(0);
    });

    it('initializes from existing pool', () => {
      const existing = createEmptyResearchPool();
      const builder = new ResearchPoolBuilder(existing);
      expect(builder.urlCount).toBe(0);
    });

    it('preserves existing pool data', () => {
      const existingResult = createMockSearchResult('existing query', 'overview');
      const existingBuilder = new ResearchPoolBuilder();
      existingBuilder.add(existingResult);
      const existingPool = existingBuilder.build();

      const newBuilder = new ResearchPoolBuilder(existingPool);
      expect(newBuilder.has('existing query')).toBe(true);
      expect(newBuilder.queryCount).toBe(1);
    });
  });

  describe('add', () => {
    it('adds overview results to overview findings', () => {
      const builder = new ResearchPoolBuilder();
      const result = createMockSearchResult('overview query', 'overview');
      builder.add(result);

      const pool = builder.build();
      expect(pool.scoutFindings.overview).toHaveLength(1);
      expect(pool.scoutFindings.overview[0].query).toBe('overview query');
    });

    it('adds category-specific results to categorySpecific findings', () => {
      const builder = new ResearchPoolBuilder();
      const result = createMockSearchResult('category query', 'category-specific');
      builder.add(result);

      const pool = builder.build();
      expect(pool.scoutFindings.categorySpecific).toHaveLength(1);
    });

    it('adds recent results to recent findings', () => {
      const builder = new ResearchPoolBuilder();
      const result = createMockSearchResult('recent query', 'recent');
      builder.add(result);

      const pool = builder.build();
      expect(pool.scoutFindings.recent).toHaveLength(1);
    });

    it('adds section-specific results only to queryCache (not scoutFindings)', () => {
      const builder = new ResearchPoolBuilder();
      const result = createMockSearchResult('section query', 'section-specific');
      builder.add(result);

      const pool = builder.build();
      expect(pool.scoutFindings.overview).toHaveLength(0);
      expect(pool.scoutFindings.categorySpecific).toHaveLength(0);
      expect(pool.scoutFindings.recent).toHaveLength(0);
      expect(pool.queryCache.has('section query')).toBe(true);
    });

    it('skips duplicate queries (case insensitive)', () => {
      const builder = new ResearchPoolBuilder();
      builder.add(createMockSearchResult('Hello World', 'overview'));
      builder.add(createMockSearchResult('hello world', 'overview'));
      builder.add(createMockSearchResult('HELLO WORLD', 'overview'));

      expect(builder.queryCount).toBe(1);
    });

    it('tracks unique URLs from results', () => {
      const builder = new ResearchPoolBuilder();
      builder.add(createMockSearchResult('query', 'overview', [
        'https://example.com/1',
        'https://example.com/2',
      ]));

      expect(builder.urlCount).toBe(2);
    });

    it('deduplicates URLs across multiple results', () => {
      const builder = new ResearchPoolBuilder();
      builder.add(createMockSearchResult('query1', 'overview', ['https://a.com', 'https://b.com']));
      builder.add(createMockSearchResult('query2', 'overview', ['https://b.com', 'https://c.com']));

      expect(builder.urlCount).toBe(3); // a.com, b.com, c.com
    });

    it('filters out invalid URLs', () => {
      const builder = new ResearchPoolBuilder();
      builder.add({
        query: 'test',
        answer: 'answer',
        results: [
          { title: 'Valid', url: 'https://valid.com', content: 'content' },
          { title: 'Invalid', url: 'not-a-url', content: 'content' },
          { title: 'FTP', url: 'ftp://files.com', content: 'content' },
        ],
        category: 'overview',
        timestamp: Date.now(),
      });

      expect(builder.urlCount).toBe(1);
    });

    it('supports method chaining', () => {
      const builder = new ResearchPoolBuilder();
      const result = builder
        .add(createMockSearchResult('q1', 'overview'))
        .add(createMockSearchResult('q2', 'overview'));

      expect(result).toBe(builder);
      expect(builder.queryCount).toBe(2);
    });
  });

  describe('addAll', () => {
    it('adds multiple results at once', () => {
      const builder = new ResearchPoolBuilder();
      const results = [
        createMockSearchResult('query1', 'overview'),
        createMockSearchResult('query2', 'category-specific'),
        createMockSearchResult('query3', 'recent'),
      ];

      builder.addAll(results);

      expect(builder.queryCount).toBe(3);
    });

    it('skips duplicates when adding all', () => {
      const builder = new ResearchPoolBuilder();
      builder.add(createMockSearchResult('query1', 'overview'));
      builder.addAll([
        createMockSearchResult('query1', 'overview'), // duplicate
        createMockSearchResult('query2', 'overview'),
      ]);

      expect(builder.queryCount).toBe(2);
    });

    it('supports method chaining', () => {
      const builder = new ResearchPoolBuilder();
      const result = builder.addAll([createMockSearchResult('q', 'overview')]);
      expect(result).toBe(builder);
    });
  });

  describe('has', () => {
    it('returns true for existing query', () => {
      const builder = new ResearchPoolBuilder();
      builder.add(createMockSearchResult('existing query', 'overview'));

      expect(builder.has('existing query')).toBe(true);
    });

    it('returns true for case-variant of existing query', () => {
      const builder = new ResearchPoolBuilder();
      builder.add(createMockSearchResult('Hello World', 'overview'));

      expect(builder.has('hello world')).toBe(true);
      expect(builder.has('HELLO WORLD')).toBe(true);
    });

    it('returns false for non-existing query', () => {
      const builder = new ResearchPoolBuilder();

      expect(builder.has('non-existent')).toBe(false);
    });
  });

  describe('find', () => {
    it('returns result for existing query', () => {
      const builder = new ResearchPoolBuilder();
      const result = createMockSearchResult('find me', 'overview');
      builder.add(result);

      const found = builder.find('find me');
      expect(found).not.toBeNull();
      expect(found?.query).toBe('find me');
    });

    it('finds with case-insensitive matching', () => {
      const builder = new ResearchPoolBuilder();
      builder.add(createMockSearchResult('Case Query', 'overview'));

      expect(builder.find('case query')).not.toBeNull();
      expect(builder.find('CASE QUERY')).not.toBeNull();
    });

    it('returns null for non-existing query', () => {
      const builder = new ResearchPoolBuilder();

      expect(builder.find('not found')).toBeNull();
    });
  });

  describe('urlCount', () => {
    it('returns 0 for empty builder', () => {
      const builder = new ResearchPoolBuilder();
      expect(builder.urlCount).toBe(0);
    });

    it('returns correct count after adding results', () => {
      const builder = new ResearchPoolBuilder();
      builder.add(createMockSearchResult('q', 'overview', ['https://a.com', 'https://b.com']));
      expect(builder.urlCount).toBe(2);
    });
  });

  describe('queryCount', () => {
    it('returns 0 for empty builder', () => {
      const builder = new ResearchPoolBuilder();
      expect(builder.queryCount).toBe(0);
    });

    it('returns correct count after adding results', () => {
      const builder = new ResearchPoolBuilder();
      builder.add(createMockSearchResult('q1', 'overview'));
      builder.add(createMockSearchResult('q2', 'overview'));
      expect(builder.queryCount).toBe(2);
    });
  });

  describe('build', () => {
    it('returns frozen overview array', () => {
      const builder = new ResearchPoolBuilder();
      builder.add(createMockSearchResult('q', 'overview'));
      const pool = builder.build();

      expect(Object.isFrozen(pool.scoutFindings.overview)).toBe(true);
    });

    it('returns frozen categorySpecific array', () => {
      const builder = new ResearchPoolBuilder();
      builder.add(createMockSearchResult('q', 'category-specific'));
      const pool = builder.build();

      expect(Object.isFrozen(pool.scoutFindings.categorySpecific)).toBe(true);
    });

    it('returns frozen recent array', () => {
      const builder = new ResearchPoolBuilder();
      builder.add(createMockSearchResult('q', 'recent'));
      const pool = builder.build();

      expect(Object.isFrozen(pool.scoutFindings.recent)).toBe(true);
    });

    it('returns proper allUrls set', () => {
      const builder = new ResearchPoolBuilder();
      builder.add(createMockSearchResult('q', 'overview', ['https://a.com']));
      const pool = builder.build();

      expect(pool.allUrls instanceof Set).toBe(true);
      expect(pool.allUrls.has('https://a.com/')).toBe(true);
    });

    it('returns proper queryCache map', () => {
      const builder = new ResearchPoolBuilder();
      builder.add(createMockSearchResult('test query', 'overview'));
      const pool = builder.build();

      expect(pool.queryCache instanceof Map).toBe(true);
      expect(pool.queryCache.has('test query')).toBe(true);
    });
  });
});

// ============================================================================
// createEmptyResearchPool Tests
// ============================================================================

describe('createEmptyResearchPool', () => {
  it('returns pool with empty findings', () => {
    const pool = createEmptyResearchPool();

    expect(pool.scoutFindings.overview).toHaveLength(0);
    expect(pool.scoutFindings.categorySpecific).toHaveLength(0);
    expect(pool.scoutFindings.recent).toHaveLength(0);
  });

  it('returns pool with empty allUrls', () => {
    const pool = createEmptyResearchPool();
    expect(pool.allUrls.size).toBe(0);
  });

  it('returns pool with empty queryCache', () => {
    const pool = createEmptyResearchPool();
    expect(pool.queryCache.size).toBe(0);
  });
});

// ============================================================================
// deduplicateQueries Tests
// ============================================================================

describe('deduplicateQueries', () => {
  it('removes exact duplicates', () => {
    const queries = ['hello', 'world', 'hello', 'world'];
    const deduped = deduplicateQueries(queries);

    expect(deduped).toEqual(['hello', 'world']);
  });

  it('removes case-insensitive duplicates', () => {
    const queries = ['Hello', 'HELLO', 'hello'];
    const deduped = deduplicateQueries(queries);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toBe('Hello'); // preserves first occurrence
  });

  it('preserves order of first occurrences', () => {
    const queries = ['first', 'second', 'FIRST', 'third', 'SECOND'];
    const deduped = deduplicateQueries(queries);

    expect(deduped).toEqual(['first', 'second', 'third']);
  });

  it('normalizes whitespace before comparison', () => {
    const queries = ['hello world', '  hello   world  ', 'hello    world'];
    const deduped = deduplicateQueries(queries);

    expect(deduped).toHaveLength(1);
  });

  it('returns empty array for empty input', () => {
    expect(deduplicateQueries([])).toEqual([]);
  });

  it('returns single item for single input', () => {
    expect(deduplicateQueries(['only'])).toEqual(['only']);
  });
});

// ============================================================================
// collectUrls Tests
// ============================================================================

describe('collectUrls', () => {
  it('returns array of URLs from pool', () => {
    const builder = new ResearchPoolBuilder();
    builder.add(createMockSearchResult('q', 'overview', ['https://a.com', 'https://b.com']));
    const pool = builder.build();

    const urls = collectUrls(pool);

    expect(urls).toHaveLength(2);
    expect(urls).toContain('https://a.com/');
    expect(urls).toContain('https://b.com/');
  });

  it('returns empty array for empty pool', () => {
    const pool = createEmptyResearchPool();
    const urls = collectUrls(pool);

    expect(urls).toEqual([]);
  });
});

// ============================================================================
// extractResearchForQueries Tests
// ============================================================================

describe('extractResearchForQueries', () => {
  it('extracts matching results from pool', () => {
    const builder = new ResearchPoolBuilder();
    builder.add(createMockSearchResult('query1', 'section-specific'));
    builder.add(createMockSearchResult('query2', 'section-specific'));
    builder.add(createMockSearchResult('query3', 'section-specific'));
    const pool = builder.build();

    const results = extractResearchForQueries(['query1', 'query2'], pool, false);

    expect(results).toHaveLength(2);
    expect(results.some((r) => r.query === 'query1')).toBe(true);
    expect(results.some((r) => r.query === 'query2')).toBe(true);
  });

  it('includes overview findings when includeOverview is true', () => {
    const builder = new ResearchPoolBuilder();
    builder.add(createMockSearchResult('overview query', 'overview'));
    builder.add(createMockSearchResult('section query', 'section-specific'));
    const pool = builder.build();

    const results = extractResearchForQueries(['section query'], pool, true);

    expect(results.some((r) => r.category === 'overview')).toBe(true);
    expect(results.some((r) => r.query === 'section query')).toBe(true);
  });

  it('excludes overview findings when includeOverview is false', () => {
    const builder = new ResearchPoolBuilder();
    builder.add(createMockSearchResult('overview query', 'overview'));
    builder.add(createMockSearchResult('section query', 'section-specific'));
    const pool = builder.build();

    const results = extractResearchForQueries(['section query'], pool, false);

    expect(results.some((r) => r.category === 'overview')).toBe(false);
  });

  it('returns empty array when no queries match', () => {
    const pool = createEmptyResearchPool();
    const results = extractResearchForQueries(['nonexistent'], pool, false);

    expect(results).toHaveLength(0);
  });

  it('handles case-insensitive query matching', () => {
    const builder = new ResearchPoolBuilder();
    builder.add(createMockSearchResult('Hello World', 'section-specific'));
    const pool = builder.build();

    const results = extractResearchForQueries(['hello world'], pool, false);

    expect(results).toHaveLength(1);
  });
});

// ============================================================================
// processSearchResults Tests
// ============================================================================

describe('processSearchResults', () => {
  it('creates CategorizedSearchResult with correct structure', () => {
    const rawResults = {
      answer: 'AI summary',
      results: [
        { title: 'Title 1', url: 'https://example.com/1', content: 'Content 1', score: 0.9 },
        { title: 'Title 2', url: 'https://example.com/2', content: 'Content 2', score: 0.8 },
      ],
    };

    const result = processSearchResults('test query', 'overview', rawResults);

    expect(result.query).toBe('test query');
    expect(result.category).toBe('overview');
    expect(result.answer).toBe('AI summary');
    expect(result.results).toHaveLength(2);
    expect(result.timestamp).toBeDefined();
  });

  it('normalizes URLs in results', () => {
    const rawResults = {
      results: [
        { title: 'T', url: 'https://example.com/page#fragment', content: 'C' },
      ],
    };

    const result = processSearchResults('q', 'overview', rawResults);

    expect(result.results[0].url).toBe('https://example.com/page');
  });

  it('filters out invalid URLs', () => {
    const rawResults = {
      results: [
        { title: 'Valid', url: 'https://valid.com', content: 'Content' },
        { title: 'Invalid', url: 'not-a-url', content: 'Content' },
        { title: 'FTP', url: 'ftp://files.com', content: 'Content' },
      ],
    };

    const result = processSearchResults('q', 'overview', rawResults);

    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe('Valid');
  });

  it('handles null answer', () => {
    const rawResults = {
      answer: null,
      results: [],
    };

    const result = processSearchResults('q', 'overview', rawResults);

    expect(result.answer).toBeNull();
  });

  it('handles missing answer', () => {
    const rawResults = {
      results: [],
    };

    const result = processSearchResults('q', 'overview', rawResults);

    expect(result.answer).toBeNull();
  });

  it('preserves score when provided', () => {
    const rawResults = {
      results: [{ title: 'T', url: 'https://example.com', content: 'C', score: 0.95 }],
    };

    const result = processSearchResults('q', 'overview', rawResults);

    expect(result.results[0].score).toBe(0.95);
  });

  it('handles missing content gracefully', () => {
    const rawResults = {
      results: [{ title: 'T', url: 'https://example.com' }],
    };

    const result = processSearchResults('q', 'overview', rawResults);

    expect(result.results[0].content).toBe('');
  });

  it('adds timestamp to result', () => {
    const before = Date.now();
    const result = processSearchResults('q', 'overview', { results: [] });
    const after = Date.now();

    expect(result.timestamp).toBeGreaterThanOrEqual(before);
    expect(result.timestamp).toBeLessThanOrEqual(after);
  });

  it('works with all category types', () => {
    const categories: CategorizedSearchResult['category'][] = [
      'overview',
      'category-specific',
      'recent',
      'section-specific',
    ];

    for (const category of categories) {
      const result = processSearchResults('q', category, { results: [] });
      expect(result.category).toBe(category);
    }
  });
});

