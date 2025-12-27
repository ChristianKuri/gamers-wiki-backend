import { describe, it, expect, vi } from 'vitest';

import { ProgressTracker, createNoOpProgressTracker } from '../../../src/ai/articles/progress-tracker';
import { GENERATOR_CONFIG } from '../../../src/ai/articles/config';
import type { ArticleGenerationPhase, ArticleProgressCallback } from '../../../src/ai/articles/types';

describe('ProgressTracker', () => {
  describe('constructor', () => {
    it('creates tracker with optional callback', () => {
      const tracker = new ProgressTracker();
      expect(tracker.hasCallback).toBe(false);
    });

    it('creates tracker with callback', () => {
      const callback = vi.fn();
      const tracker = new ProgressTracker(callback);
      expect(tracker.hasCallback).toBe(true);
    });

    it('accepts custom config overrides', () => {
      const callback = vi.fn();
      const tracker = new ProgressTracker(callback, {
        specialistProgressStart: 20,
        specialistProgressEnd: 80,
      });

      tracker.reportSectionProgress(1, 2, 'Test');

      // With custom config: 20 + (1/2 * 60) = 50
      expect(callback).toHaveBeenCalledWith('specialist', 50, 'Writing section 1/2: Test');
    });
  });

  describe('startPhase', () => {
    it('calls callback with 0% progress', () => {
      const callback = vi.fn();
      const tracker = new ProgressTracker(callback);

      tracker.startPhase('scout');

      expect(callback).toHaveBeenCalledWith('scout', 0, expect.any(String));
    });

    it('uses default message for scout phase', () => {
      const callback = vi.fn();
      const tracker = new ProgressTracker(callback);

      tracker.startPhase('scout');

      expect(callback).toHaveBeenCalledWith('scout', 0, 'Starting research phase');
    });

    it('uses default message for editor phase', () => {
      const callback = vi.fn();
      const tracker = new ProgressTracker(callback);

      tracker.startPhase('editor');

      expect(callback).toHaveBeenCalledWith('editor', 0, 'Planning article structure');
    });

    it('uses default message for specialist phase', () => {
      const callback = vi.fn();
      const tracker = new ProgressTracker(callback);

      tracker.startPhase('specialist');

      expect(callback).toHaveBeenCalledWith('specialist', 0, 'Writing article sections');
    });

    it('uses default message for validation phase', () => {
      const callback = vi.fn();
      const tracker = new ProgressTracker(callback);

      tracker.startPhase('validation');

      expect(callback).toHaveBeenCalledWith('validation', 0, 'Validating article quality');
    });

    it('accepts custom message', () => {
      const callback = vi.fn();
      const tracker = new ProgressTracker(callback);

      tracker.startPhase('scout', 'Custom research message');

      expect(callback).toHaveBeenCalledWith('scout', 0, 'Custom research message');
    });

    it('does not throw when no callback provided', () => {
      const tracker = new ProgressTracker();

      expect(() => tracker.startPhase('scout')).not.toThrow();
    });
  });

  describe('completePhase', () => {
    it('calls callback with 100% progress', () => {
      const callback = vi.fn();
      const tracker = new ProgressTracker(callback);

      tracker.completePhase('scout', 'Found 25 sources');

      expect(callback).toHaveBeenCalledWith('scout', 100, 'Found 25 sources');
    });

    it('does not throw when no callback provided', () => {
      const tracker = new ProgressTracker();

      expect(() => tracker.completePhase('scout', 'Done')).not.toThrow();
    });

    it('works for all phases', () => {
      const callback = vi.fn();
      const tracker = new ProgressTracker(callback);

      const phases: ArticleGenerationPhase[] = ['scout', 'editor', 'specialist', 'validation'];

      phases.forEach((phase) => {
        tracker.completePhase(phase, `Completed ${phase}`);
      });

      expect(callback).toHaveBeenCalledTimes(4);
      phases.forEach((phase) => {
        expect(callback).toHaveBeenCalledWith(phase, 100, `Completed ${phase}`);
      });
    });
  });

  describe('reportSectionProgress', () => {
    it('calculates progress based on config defaults', () => {
      const callback = vi.fn();
      const tracker = new ProgressTracker(callback);

      // Using default config: start=10, end=90
      // For section 1 of 4: 10 + (1/4 * 80) = 30
      tracker.reportSectionProgress(1, 4, 'Introduction');

      expect(callback).toHaveBeenCalledWith('specialist', 30, 'Writing section 1/4: Introduction');
    });

    it('calculates correct progress for first section', () => {
      const callback = vi.fn();
      const tracker = new ProgressTracker(callback);

      tracker.reportSectionProgress(1, 5, 'First');

      // 10 + (1/5 * 80) = 10 + 16 = 26
      expect(callback).toHaveBeenCalledWith('specialist', 26, 'Writing section 1/5: First');
    });

    it('calculates correct progress for last section', () => {
      const callback = vi.fn();
      const tracker = new ProgressTracker(callback);

      tracker.reportSectionProgress(5, 5, 'Last');

      // 10 + (5/5 * 80) = 10 + 80 = 90
      expect(callback).toHaveBeenCalledWith('specialist', 90, 'Writing section 5/5: Last');
    });

    it('calculates correct progress for middle section', () => {
      const callback = vi.fn();
      const tracker = new ProgressTracker(callback);

      tracker.reportSectionProgress(2, 4, 'Middle');

      // 10 + (2/4 * 80) = 10 + 40 = 50
      expect(callback).toHaveBeenCalledWith('specialist', 50, 'Writing section 2/4: Middle');
    });

    it('includes headline in message', () => {
      const callback = vi.fn();
      const tracker = new ProgressTracker(callback);

      tracker.reportSectionProgress(1, 3, 'Common Mistakes to Avoid');

      expect(callback).toHaveBeenCalledWith(
        'specialist',
        expect.any(Number),
        'Writing section 1/3: Common Mistakes to Avoid'
      );
    });

    it('respects custom progress bounds', () => {
      const callback = vi.fn();
      const tracker = new ProgressTracker(callback, {
        specialistProgressStart: 0,
        specialistProgressEnd: 100,
      });

      tracker.reportSectionProgress(1, 2, 'Test');

      // 0 + (1/2 * 100) = 50
      expect(callback).toHaveBeenCalledWith('specialist', 50, 'Writing section 1/2: Test');
    });

    it('does not throw when no callback provided', () => {
      const tracker = new ProgressTracker();

      expect(() => tracker.reportSectionProgress(1, 5, 'Test')).not.toThrow();
    });
  });

  describe('report', () => {
    it('calls callback with arbitrary phase and progress', () => {
      const callback = vi.fn();
      const tracker = new ProgressTracker(callback);

      tracker.report('editor', 42, 'Midway through planning');

      expect(callback).toHaveBeenCalledWith('editor', 42, 'Midway through planning');
    });

    it('works without message', () => {
      const callback = vi.fn();
      const tracker = new ProgressTracker(callback);

      tracker.report('scout', 75);

      expect(callback).toHaveBeenCalledWith('scout', 75, undefined);
    });

    it('does not throw when no callback provided', () => {
      const tracker = new ProgressTracker();

      expect(() => tracker.report('scout', 50, 'Test')).not.toThrow();
    });
  });

  describe('hasCallback', () => {
    it('returns false when no callback', () => {
      const tracker = new ProgressTracker();
      expect(tracker.hasCallback).toBe(false);
    });

    it('returns true when callback provided', () => {
      const tracker = new ProgressTracker(() => {});
      expect(tracker.hasCallback).toBe(true);
    });
  });
});

describe('createNoOpProgressTracker', () => {
  it('creates a tracker without callback', () => {
    const tracker = createNoOpProgressTracker();
    expect(tracker.hasCallback).toBe(false);
  });

  it('allows all operations without throwing', () => {
    const tracker = createNoOpProgressTracker();

    expect(() => {
      tracker.startPhase('scout');
      tracker.completePhase('scout', 'Done');
      tracker.reportSectionProgress(1, 3, 'Test');
      tracker.report('editor', 50, 'Midway');
    }).not.toThrow();
  });
});

describe('ProgressTracker default config values', () => {
  it('uses GENERATOR_CONFIG values by default', () => {
    const callback = vi.fn();
    const tracker = new ProgressTracker(callback);

    // Section 1 of 1 should hit the end value
    tracker.reportSectionProgress(1, 1, 'Only');

    // Progress = start + (1/1 * (end - start)) = end
    const expectedProgress = GENERATOR_CONFIG.SPECIALIST_PROGRESS_END;
    expect(callback).toHaveBeenCalledWith('specialist', expectedProgress, expect.any(String));
  });

  it('start phase uses correct start percentage', () => {
    const callback = vi.fn();
    const tracker = new ProgressTracker(callback);

    // For section 0 of N (edge case), would be:
    // start + (0/N * range) = start
    // But we don't have 0 sections, so test with 1 section at position approaching start
    tracker.reportSectionProgress(1, 1000, 'First of many');

    // 10 + (1/1000 * 80) ≈ 10
    expect(callback).toHaveBeenCalledWith('specialist', expect.any(Number), expect.any(String));
    const [, progress] = callback.mock.calls[0];
    expect(progress).toBeGreaterThanOrEqual(GENERATOR_CONFIG.SPECIALIST_PROGRESS_START);
  });
});

