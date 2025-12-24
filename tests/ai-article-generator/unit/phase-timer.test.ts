import { describe, it, expect } from 'vitest';

import { PhaseTimer, createPhaseTimer } from '../../../src/ai/articles/phase-timer';
import { createMockClock } from '../../../src/ai/articles/types';

describe('PhaseTimer', () => {
  describe('constructor', () => {
    it('creates a timer with system clock by default', () => {
      const timer = new PhaseTimer();
      expect(timer).toBeInstanceOf(PhaseTimer);
    });

    it('accepts a custom clock', () => {
      const mockClock = createMockClock(1000);
      const timer = new PhaseTimer(mockClock);
      expect(timer).toBeInstanceOf(PhaseTimer);
    });
  });

  describe('start and end', () => {
    it('records duration between start and end', () => {
      const mockClock = createMockClock(1000, 500);
      const timer = new PhaseTimer(mockClock);

      timer.start('scout');
      // Clock advances 500ms on next call
      const duration = timer.end('scout');

      expect(duration).toBe(500);
    });

    it('returns 0 if phase was never started', () => {
      const mockClock = createMockClock(1000);
      const timer = new PhaseTimer(mockClock);

      const duration = timer.end('scout');

      expect(duration).toBe(0);
    });

    it('clears start time after ending', () => {
      const mockClock = createMockClock(1000, 100);
      const timer = new PhaseTimer(mockClock);

      timer.start('scout');
      timer.end('scout');

      expect(timer.isRunning('scout')).toBe(false);
    });

    it('allows restarting a phase', () => {
      const mockClock = createMockClock(1000, 100);
      const timer = new PhaseTimer(mockClock);

      timer.start('scout');
      timer.end('scout');
      timer.start('scout');

      expect(timer.isRunning('scout')).toBe(true);
    });
  });

  describe('getDuration', () => {
    it('returns recorded duration for completed phase', () => {
      const mockClock = createMockClock(1000, 250);
      const timer = new PhaseTimer(mockClock);

      timer.start('editor');
      timer.end('editor');

      expect(timer.getDuration('editor')).toBe(250);
    });

    it('returns 0 for phase that has not been timed', () => {
      const timer = new PhaseTimer();

      expect(timer.getDuration('scout')).toBe(0);
      expect(timer.getDuration('editor')).toBe(0);
      expect(timer.getDuration('specialist')).toBe(0);
      expect(timer.getDuration('validation')).toBe(0);
    });
  });

  describe('getDurations', () => {
    it('returns all phase durations', () => {
      const mockClock = createMockClock(0, 100);
      const timer = new PhaseTimer(mockClock);

      timer.start('scout');
      timer.end('scout'); // 100ms
      timer.start('editor');
      timer.end('editor'); // 100ms
      timer.start('specialist');
      timer.end('specialist'); // 100ms
      timer.start('validation');
      timer.end('validation'); // 100ms

      const durations = timer.getDurations();

      expect(durations.scout).toBe(100);
      expect(durations.editor).toBe(100);
      expect(durations.specialist).toBe(100);
      expect(durations.validation).toBe(100);
    });

    it('returns 0 for untimed phases', () => {
      const mockClock = createMockClock(0, 100);
      const timer = new PhaseTimer(mockClock);

      timer.start('scout');
      timer.end('scout');

      const durations = timer.getDurations();

      expect(durations.scout).toBe(100);
      expect(durations.editor).toBe(0);
      expect(durations.specialist).toBe(0);
      expect(durations.validation).toBe(0);
    });

    it('returns immutable-like object structure', () => {
      const timer = new PhaseTimer();
      const durations = timer.getDurations();

      expect(durations).toHaveProperty('scout');
      expect(durations).toHaveProperty('editor');
      expect(durations).toHaveProperty('specialist');
      expect(durations).toHaveProperty('validation');
    });
  });

  describe('getTotalDuration', () => {
    it('returns sum of all recorded durations', () => {
      const mockClock = createMockClock(0, 100);
      const timer = new PhaseTimer(mockClock);

      timer.start('scout');
      timer.end('scout'); // 100ms
      timer.start('editor');
      timer.end('editor'); // 100ms
      timer.start('specialist');
      timer.end('specialist'); // 100ms

      expect(timer.getTotalDuration()).toBe(300);
    });

    it('returns 0 when no phases have been timed', () => {
      const timer = new PhaseTimer();

      expect(timer.getTotalDuration()).toBe(0);
    });
  });

  describe('isRunning', () => {
    it('returns true for started but not ended phase', () => {
      const timer = new PhaseTimer();

      timer.start('scout');

      expect(timer.isRunning('scout')).toBe(true);
    });

    it('returns false for ended phase', () => {
      const mockClock = createMockClock(0, 100);
      const timer = new PhaseTimer(mockClock);

      timer.start('scout');
      timer.end('scout');

      expect(timer.isRunning('scout')).toBe(false);
    });

    it('returns false for never started phase', () => {
      const timer = new PhaseTimer();

      expect(timer.isRunning('scout')).toBe(false);
    });
  });

  describe('isCompleted', () => {
    it('returns true for phase with recorded duration', () => {
      const mockClock = createMockClock(0, 100);
      const timer = new PhaseTimer(mockClock);

      timer.start('scout');
      timer.end('scout');

      expect(timer.isCompleted('scout')).toBe(true);
    });

    it('returns false for running phase', () => {
      const timer = new PhaseTimer();

      timer.start('scout');

      expect(timer.isCompleted('scout')).toBe(false);
    });

    it('returns false for never started phase', () => {
      const timer = new PhaseTimer();

      expect(timer.isCompleted('scout')).toBe(false);
    });
  });

  describe('reset', () => {
    it('clears all timing data', () => {
      const mockClock = createMockClock(0, 100);
      const timer = new PhaseTimer(mockClock);

      timer.start('scout');
      timer.end('scout');
      timer.start('editor');

      timer.reset();

      expect(timer.isCompleted('scout')).toBe(false);
      expect(timer.isRunning('editor')).toBe(false);
      expect(timer.getTotalDuration()).toBe(0);
    });

    it('allows reuse after reset', () => {
      const mockClock = createMockClock(0, 100);
      const timer = new PhaseTimer(mockClock);

      timer.start('scout');
      timer.end('scout');
      timer.reset();
      timer.start('scout');
      timer.end('scout');

      expect(timer.getDuration('scout')).toBe(100);
    });
  });
});

describe('createPhaseTimer', () => {
  it('creates a PhaseTimer instance', () => {
    const timer = createPhaseTimer();
    expect(timer).toBeInstanceOf(PhaseTimer);
  });

  it('accepts custom clock', () => {
    const mockClock = createMockClock(5000);
    const timer = createPhaseTimer(mockClock);
    expect(timer).toBeInstanceOf(PhaseTimer);
  });
});

describe('PhaseTimer integration scenarios', () => {
  it('simulates real article generation timing flow', () => {
    let time = 0;
    const clock = { now: () => time };
    const timer = new PhaseTimer(clock);

    // Scout phase: 1500ms
    timer.start('scout');
    time += 1500;
    timer.end('scout');

    // Editor phase: 800ms
    timer.start('editor');
    time += 800;
    timer.end('editor');

    // Specialist phase: 3000ms
    timer.start('specialist');
    time += 3000;
    timer.end('specialist');

    // Validation phase: 50ms
    timer.start('validation');
    time += 50;
    timer.end('validation');

    const durations = timer.getDurations();
    expect(durations.scout).toBe(1500);
    expect(durations.editor).toBe(800);
    expect(durations.specialist).toBe(3000);
    expect(durations.validation).toBe(50);
    expect(timer.getTotalDuration()).toBe(5350);
  });

  it('handles non-sequential timing (phase restarted)', () => {
    let time = 0;
    const clock = { now: () => time };
    const timer = new PhaseTimer(clock);

    // Start scout, but then restart it (e.g., retry scenario)
    timer.start('scout');
    time += 500;
    timer.start('scout'); // Restart - original start is overwritten
    time += 700;
    timer.end('scout');

    // Only the second run should be recorded
    expect(timer.getDuration('scout')).toBe(700);
  });
});

