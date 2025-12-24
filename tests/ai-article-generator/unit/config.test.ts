import { describe, it, expect } from 'vitest';

import { GENERATOR_CONFIG, CONFIG, SPECIALIST_CONFIG, SCOUT_CONFIG, EDITOR_CONFIG } from '../../../src/ai/articles/config';

describe('GENERATOR_CONFIG', () => {
  describe('progress constants', () => {
    it('has SPECIALIST_PROGRESS_START defined', () => {
      expect(GENERATOR_CONFIG.SPECIALIST_PROGRESS_START).toBeDefined();
      expect(typeof GENERATOR_CONFIG.SPECIALIST_PROGRESS_START).toBe('number');
    });

    it('has SPECIALIST_PROGRESS_END defined', () => {
      expect(GENERATOR_CONFIG.SPECIALIST_PROGRESS_END).toBeDefined();
      expect(typeof GENERATOR_CONFIG.SPECIALIST_PROGRESS_END).toBe('number');
    });

    it('progress range is valid (START < END)', () => {
      expect(GENERATOR_CONFIG.SPECIALIST_PROGRESS_START).toBeLessThan(
        GENERATOR_CONFIG.SPECIALIST_PROGRESS_END
      );
    });

    it('progress values are in percentage range (0-100)', () => {
      expect(GENERATOR_CONFIG.SPECIALIST_PROGRESS_START).toBeGreaterThanOrEqual(0);
      expect(GENERATOR_CONFIG.SPECIALIST_PROGRESS_START).toBeLessThanOrEqual(100);
      expect(GENERATOR_CONFIG.SPECIALIST_PROGRESS_END).toBeGreaterThanOrEqual(0);
      expect(GENERATOR_CONFIG.SPECIALIST_PROGRESS_END).toBeLessThanOrEqual(100);
    });

    it('progress range allows room for other phases (not 0-100)', () => {
      // Specialist phase should not take up the full progress bar
      // Leave room for scout, editor, and validation phases
      expect(GENERATOR_CONFIG.SPECIALIST_PROGRESS_START).toBeGreaterThan(0);
      expect(GENERATOR_CONFIG.SPECIALIST_PROGRESS_END).toBeLessThan(100);
    });
  });

  describe('other generator config', () => {
    it('has DEFAULT_TIMEOUT_MS defined', () => {
      expect(GENERATOR_CONFIG.DEFAULT_TIMEOUT_MS).toBeDefined();
      expect(typeof GENERATOR_CONFIG.DEFAULT_TIMEOUT_MS).toBe('number');
    });

    it('has DEFAULT_OPENROUTER_BASE_URL defined', () => {
      expect(GENERATOR_CONFIG.DEFAULT_OPENROUTER_BASE_URL).toBeDefined();
      expect(typeof GENERATOR_CONFIG.DEFAULT_OPENROUTER_BASE_URL).toBe('string');
      expect(GENERATOR_CONFIG.DEFAULT_OPENROUTER_BASE_URL).toMatch(/^https:\/\//);
    });
  });
});

describe('CONFIG unified export', () => {
  it('includes generator config', () => {
    expect(CONFIG.generator).toBe(GENERATOR_CONFIG);
  });

  it('includes all expected configs', () => {
    expect(CONFIG.scout).toBeDefined();
    expect(CONFIG.editor).toBeDefined();
    expect(CONFIG.specialist).toBeDefined();
    expect(CONFIG.retry).toBeDefined();
    expect(CONFIG.generator).toBeDefined();
  });
});

describe('SPECIALIST_CONFIG', () => {
  describe('batch research configuration', () => {
    it('has BATCH_CONCURRENCY defined', () => {
      expect(SPECIALIST_CONFIG.BATCH_CONCURRENCY).toBeDefined();
      expect(typeof SPECIALIST_CONFIG.BATCH_CONCURRENCY).toBe('number');
    });

    it('BATCH_CONCURRENCY is reasonable (1-10)', () => {
      expect(SPECIALIST_CONFIG.BATCH_CONCURRENCY).toBeGreaterThanOrEqual(1);
      expect(SPECIALIST_CONFIG.BATCH_CONCURRENCY).toBeLessThanOrEqual(10);
    });

    it('has BATCH_DELAY_MS defined', () => {
      expect(SPECIALIST_CONFIG.BATCH_DELAY_MS).toBeDefined();
      expect(typeof SPECIALIST_CONFIG.BATCH_DELAY_MS).toBe('number');
    });

    it('BATCH_DELAY_MS is non-negative', () => {
      expect(SPECIALIST_CONFIG.BATCH_DELAY_MS).toBeGreaterThanOrEqual(0);
    });
  });

  describe('temperature', () => {
    it('has TEMPERATURE defined', () => {
      expect(SPECIALIST_CONFIG.TEMPERATURE).toBeDefined();
      expect(typeof SPECIALIST_CONFIG.TEMPERATURE).toBe('number');
    });

    it('TEMPERATURE is in valid range (0-1)', () => {
      expect(SPECIALIST_CONFIG.TEMPERATURE).toBeGreaterThanOrEqual(0);
      expect(SPECIALIST_CONFIG.TEMPERATURE).toBeLessThanOrEqual(1);
    });
  });
});

describe('SCOUT_CONFIG', () => {
  describe('temperature', () => {
    it('has TEMPERATURE defined', () => {
      expect(SCOUT_CONFIG.TEMPERATURE).toBeDefined();
      expect(typeof SCOUT_CONFIG.TEMPERATURE).toBe('number');
    });

    it('TEMPERATURE is in valid range (0-1)', () => {
      expect(SCOUT_CONFIG.TEMPERATURE).toBeGreaterThanOrEqual(0);
      expect(SCOUT_CONFIG.TEMPERATURE).toBeLessThanOrEqual(1);
    });

    it('TEMPERATURE is lower than Specialist (more factual)', () => {
      expect(SCOUT_CONFIG.TEMPERATURE).toBeLessThanOrEqual(SPECIALIST_CONFIG.TEMPERATURE);
    });
  });
});

describe('EDITOR_CONFIG', () => {
  describe('temperature', () => {
    it('has TEMPERATURE defined', () => {
      expect(EDITOR_CONFIG.TEMPERATURE).toBeDefined();
      expect(typeof EDITOR_CONFIG.TEMPERATURE).toBe('number');
    });

    it('TEMPERATURE is in valid range (0-1)', () => {
      expect(EDITOR_CONFIG.TEMPERATURE).toBeGreaterThanOrEqual(0);
      expect(EDITOR_CONFIG.TEMPERATURE).toBeLessThanOrEqual(1);
    });

    it('TEMPERATURE is between Scout and Specialist (balanced)', () => {
      expect(EDITOR_CONFIG.TEMPERATURE).toBeGreaterThanOrEqual(SCOUT_CONFIG.TEMPERATURE);
      expect(EDITOR_CONFIG.TEMPERATURE).toBeLessThanOrEqual(SPECIALIST_CONFIG.TEMPERATURE);
    });
  });
});

