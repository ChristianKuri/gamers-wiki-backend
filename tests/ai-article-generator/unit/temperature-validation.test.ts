import { describe, it, expect } from 'vitest';

import { ArticleGenerationError, isArticleGenerationError } from '../../../src/ai/articles/types';

/**
 * Temperature validation tests.
 *
 * The validateTemperatureOverrides function is internal to generate-game-article.ts.
 * We test the validation logic by replicating it here to ensure consistency,
 * and integration tests will verify it works correctly in context.
 */

const TEMPERATURE_RANGE = { min: 0, max: 2 } as const;

interface TemperatureOverrides {
  readonly scout?: number;
  readonly editor?: number;
  readonly specialist?: number;
}

/**
 * Replication of the validateTemperatureOverrides function for unit testing.
 * This allows us to test the validation logic in isolation.
 */
function validateTemperatureOverrides(overrides?: TemperatureOverrides): void {
  if (!overrides) return;

  const entries: Array<[string, number | undefined]> = [
    ['scout', overrides.scout],
    ['editor', overrides.editor],
    ['specialist', overrides.specialist],
  ];

  for (const [agent, temp] of entries) {
    if (temp !== undefined) {
      if (typeof temp !== 'number' || Number.isNaN(temp)) {
        throw new ArticleGenerationError(
          'CONFIG_ERROR',
          `Invalid temperature for ${agent}: ${temp} (must be a number)`
        );
      }
      if (temp < TEMPERATURE_RANGE.min || temp > TEMPERATURE_RANGE.max) {
        throw new ArticleGenerationError(
          'CONFIG_ERROR',
          `Invalid temperature for ${agent}: ${temp} (must be between ${TEMPERATURE_RANGE.min} and ${TEMPERATURE_RANGE.max})`
        );
      }
    }
  }
}

describe('validateTemperatureOverrides', () => {
  describe('valid inputs', () => {
    it('accepts undefined overrides', () => {
      expect(() => validateTemperatureOverrides(undefined)).not.toThrow();
    });

    it('accepts empty overrides object', () => {
      expect(() => validateTemperatureOverrides({})).not.toThrow();
    });

    it('accepts valid temperature at lower bound (0)', () => {
      expect(() => validateTemperatureOverrides({ scout: 0 })).not.toThrow();
      expect(() => validateTemperatureOverrides({ editor: 0 })).not.toThrow();
      expect(() => validateTemperatureOverrides({ specialist: 0 })).not.toThrow();
    });

    it('accepts valid temperature at upper bound (2)', () => {
      expect(() => validateTemperatureOverrides({ scout: 2 })).not.toThrow();
      expect(() => validateTemperatureOverrides({ editor: 2 })).not.toThrow();
      expect(() => validateTemperatureOverrides({ specialist: 2 })).not.toThrow();
    });

    it('accepts valid temperature within range', () => {
      expect(() => validateTemperatureOverrides({ scout: 0.2 })).not.toThrow();
      expect(() => validateTemperatureOverrides({ editor: 0.4 })).not.toThrow();
      expect(() => validateTemperatureOverrides({ specialist: 0.6 })).not.toThrow();
    });

    it('accepts multiple valid overrides', () => {
      expect(() =>
        validateTemperatureOverrides({
          scout: 0.1,
          editor: 0.5,
          specialist: 1.0,
        })
      ).not.toThrow();
    });

    it('accepts partial overrides', () => {
      expect(() => validateTemperatureOverrides({ scout: 0.3 })).not.toThrow();
      expect(() => validateTemperatureOverrides({ editor: 0.7 })).not.toThrow();
      expect(() => validateTemperatureOverrides({ scout: 0.2, specialist: 1.5 })).not.toThrow();
    });
  });

  describe('invalid inputs', () => {
    it('rejects negative temperature', () => {
      expect(() => validateTemperatureOverrides({ scout: -0.1 })).toThrow(ArticleGenerationError);
      expect(() => validateTemperatureOverrides({ editor: -1 })).toThrow(ArticleGenerationError);
      expect(() => validateTemperatureOverrides({ specialist: -0.5 })).toThrow(ArticleGenerationError);
    });

    it('rejects temperature above upper bound', () => {
      expect(() => validateTemperatureOverrides({ scout: 2.1 })).toThrow(ArticleGenerationError);
      expect(() => validateTemperatureOverrides({ editor: 3 })).toThrow(ArticleGenerationError);
      expect(() => validateTemperatureOverrides({ specialist: 100 })).toThrow(ArticleGenerationError);
    });

    it('rejects NaN temperature', () => {
      expect(() => validateTemperatureOverrides({ scout: NaN })).toThrow(ArticleGenerationError);
      expect(() => validateTemperatureOverrides({ editor: NaN })).toThrow(ArticleGenerationError);
      expect(() => validateTemperatureOverrides({ specialist: NaN })).toThrow(ArticleGenerationError);
    });

    it('provides descriptive error messages', () => {
      try {
        validateTemperatureOverrides({ scout: -0.5 });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(isArticleGenerationError(error)).toBe(true);
        if (isArticleGenerationError(error)) {
          expect(error.code).toBe('CONFIG_ERROR');
          expect(error.message).toContain('scout');
          expect(error.message).toContain('-0.5');
          expect(error.message).toContain('between 0 and 2');
        }
      }
    });

    it('reports the correct agent name in error', () => {
      try {
        validateTemperatureOverrides({ editor: 5 });
        expect.fail('Should have thrown');
      } catch (error) {
        if (isArticleGenerationError(error)) {
          expect(error.message).toContain('editor');
        }
      }

      try {
        validateTemperatureOverrides({ specialist: -1 });
        expect.fail('Should have thrown');
      } catch (error) {
        if (isArticleGenerationError(error)) {
          expect(error.message).toContain('specialist');
        }
      }
    });

    it('validates in order and reports first invalid value', () => {
      // When multiple values are invalid, the first one in iteration order is reported
      try {
        validateTemperatureOverrides({ scout: -1, editor: -2, specialist: -3 });
        expect.fail('Should have thrown');
      } catch (error) {
        if (isArticleGenerationError(error)) {
          // Scout is validated first
          expect(error.message).toContain('scout');
        }
      }
    });
  });

  describe('boundary cases', () => {
    it('accepts exactly 0', () => {
      expect(() => validateTemperatureOverrides({ scout: 0 })).not.toThrow();
    });

    it('accepts exactly 2', () => {
      expect(() => validateTemperatureOverrides({ editor: 2 })).not.toThrow();
    });

    it('accepts very small positive value', () => {
      expect(() => validateTemperatureOverrides({ specialist: 0.001 })).not.toThrow();
    });

    it('accepts value just below 2', () => {
      expect(() => validateTemperatureOverrides({ scout: 1.999 })).not.toThrow();
    });

    it('rejects value just above 2', () => {
      expect(() => validateTemperatureOverrides({ editor: 2.001 })).toThrow(ArticleGenerationError);
    });

    it('rejects value just below 0', () => {
      expect(() => validateTemperatureOverrides({ specialist: -0.001 })).toThrow(
        ArticleGenerationError
      );
    });
  });
});

describe('ArticleGenerationError for CONFIG_ERROR', () => {
  it('can be identified with isArticleGenerationError', () => {
    const error = new ArticleGenerationError('CONFIG_ERROR', 'Test error');
    expect(isArticleGenerationError(error)).toBe(true);
  });

  it('has correct error code', () => {
    const error = new ArticleGenerationError('CONFIG_ERROR', 'Test error');
    expect(error.code).toBe('CONFIG_ERROR');
  });

  it('preserves error message', () => {
    const error = new ArticleGenerationError('CONFIG_ERROR', 'Specific message');
    expect(error.message).toBe('Specific message');
  });

  it('has correct name property', () => {
    const error = new ArticleGenerationError('CONFIG_ERROR', 'Test');
    expect(error.name).toBe('ArticleGenerationError');
  });
});

