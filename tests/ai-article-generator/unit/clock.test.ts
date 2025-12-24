import { describe, it, expect } from 'vitest';

import { systemClock, createMockClock, type Clock } from '../../../src/ai/articles/types';

describe('Clock interface', () => {
  describe('systemClock', () => {
    it('returns current time in milliseconds', () => {
      const before = Date.now();
      const result = systemClock.now();
      const after = Date.now();

      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });

    it('returns different values on subsequent calls', async () => {
      const time1 = systemClock.now();
      await new Promise((resolve) => setTimeout(resolve, 5));
      const time2 = systemClock.now();

      expect(time2).toBeGreaterThan(time1);
    });

    it('satisfies the Clock interface', () => {
      const clock: Clock = systemClock;
      expect(typeof clock.now).toBe('function');
      expect(typeof clock.now()).toBe('number');
    });
  });

  describe('createMockClock', () => {
    it('returns fixed time when no autoAdvance is set', () => {
      const clock = createMockClock(1000000);

      expect(clock.now()).toBe(1000000);
      expect(clock.now()).toBe(1000000);
      expect(clock.now()).toBe(1000000);
    });

    it('advances time by autoAdvance amount on each call', () => {
      const clock = createMockClock(1000000, 100);

      expect(clock.now()).toBe(1000000);
      expect(clock.now()).toBe(1000100);
      expect(clock.now()).toBe(1000200);
      expect(clock.now()).toBe(1000300);
    });

    it('works with autoAdvance of 0 (fixed time)', () => {
      const clock = createMockClock(5000, 0);

      expect(clock.now()).toBe(5000);
      expect(clock.now()).toBe(5000);
    });

    it('works with negative autoAdvance (time going backwards)', () => {
      const clock = createMockClock(1000, -100);

      expect(clock.now()).toBe(1000);
      expect(clock.now()).toBe(900);
      expect(clock.now()).toBe(800);
    });

    it('satisfies the Clock interface', () => {
      const clock: Clock = createMockClock(12345);
      expect(typeof clock.now).toBe('function');
      expect(typeof clock.now()).toBe('number');
    });

    it('enables deterministic duration calculations', () => {
      const clock = createMockClock(0, 500);

      const start = clock.now(); // 0
      // Simulate work (would be 500ms per "tick")
      const middle = clock.now(); // 500
      const end = clock.now(); // 1000

      expect(middle - start).toBe(500);
      expect(end - start).toBe(1000);
      expect(end - middle).toBe(500);
    });

    it('can be used to test timeout scenarios', () => {
      const timeoutMs = 1000;
      const clock = createMockClock(0, 600);

      const startTime = clock.now(); // 0

      // First check: within timeout
      const checkTime1 = clock.now(); // 600
      expect(checkTime1 - startTime).toBeLessThan(timeoutMs);

      // Second check: exceeds timeout
      const checkTime2 = clock.now(); // 1200
      expect(checkTime2 - startTime).toBeGreaterThan(timeoutMs);
    });
  });
});

