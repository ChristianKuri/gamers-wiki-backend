import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createContextualLogger,
  generateCorrelationId,
  type LoggingContext,
} from '../../../src/utils/logger';

// Mock the base logger to capture output
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

// Store original console methods
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};

describe('generateCorrelationId', () => {
  it('generates a non-empty string', () => {
    const id = generateCorrelationId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('generates unique IDs on each call', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateCorrelationId());
    }
    // All 100 should be unique
    expect(ids.size).toBe(100);
  });

  it('has expected format (timestamp-random)', () => {
    const id = generateCorrelationId();
    expect(id).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
  });

  it('contains timestamp component', () => {
    const beforeMs = Date.now();
    const id = generateCorrelationId();
    const afterMs = Date.now();

    // Extract timestamp portion (before the dash)
    const timestampPart = id.split('-')[0];
    const decodedTimestamp = parseInt(timestampPart, 36);

    // Timestamp should be within the test window
    expect(decodedTimestamp).toBeGreaterThanOrEqual(beforeMs);
    expect(decodedTimestamp).toBeLessThanOrEqual(afterMs);
  });
});

describe('createContextualLogger', () => {
  beforeEach(() => {
    // Redirect console for testing
    console.log = mockLogger.info;
    console.warn = mockLogger.warn;
    console.error = mockLogger.error;
    vi.clearAllMocks();
  });

  afterAll(() => {
    // Restore console
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });

  describe('basic logging', () => {
    it('includes correlation ID in log messages', () => {
      const context: LoggingContext = { correlationId: 'test-123' };
      const log = createContextualLogger('[Test]', context);

      log.info('Test message');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('[test-123]')
      );
    });

    it('includes prefix in log messages', () => {
      const context: LoggingContext = { correlationId: 'abc' };
      const log = createContextualLogger('[MyModule]', context);

      log.info('Hello');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('[MyModule]')
      );
    });

    it('includes message content', () => {
      const context: LoggingContext = { correlationId: 'x' };
      const log = createContextualLogger('[M]', context);

      log.info('Specific message here');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Specific message here')
      );
    });
  });

  describe('log levels', () => {
    it('logs info level correctly', () => {
      const context: LoggingContext = { correlationId: 'id' };
      const log = createContextualLogger('[T]', context);

      log.info('Info message');

      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('logs warn level correctly', () => {
      const context: LoggingContext = { correlationId: 'id' };
      const log = createContextualLogger('[T]', context);

      log.warn('Warning message');

      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('logs error level correctly', () => {
      const context: LoggingContext = { correlationId: 'id' };
      const log = createContextualLogger('[T]', context);

      log.error('Error message');

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('logs debug level correctly', () => {
      const context: LoggingContext = { correlationId: 'id' };
      const log = createContextualLogger('[T]', context);

      // debug uses console.log as fallback
      log.debug('Debug message');

      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe('context property', () => {
    it('exposes the logging context', () => {
      const context: LoggingContext = {
        correlationId: 'my-corr-id',
        gameName: 'Test Game',
        custom: 123,
      };
      const log = createContextualLogger('[Test]', context);

      expect(log.context).toBe(context);
      expect(log.context.correlationId).toBe('my-corr-id');
      expect(log.context.gameName).toBe('Test Game');
    });
  });

  describe('child logger', () => {
    it('creates child with inherited context', () => {
      const context: LoggingContext = { correlationId: 'parent-id', game: 'Test' };
      const parent = createContextualLogger('[Parent]', context);

      const child = parent.child({ phase: 'scout' });

      expect(child.context.correlationId).toBe('parent-id');
      expect(child.context.game).toBe('Test');
      expect(child.context.phase).toBe('scout');
    });

    it('child uses same correlation ID as parent', () => {
      const context: LoggingContext = { correlationId: 'shared-id' };
      const parent = createContextualLogger('[P]', context);
      const child = parent.child({ level: 2 });

      child.info('Child message');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('[shared-id]')
      );
    });

    it('child can override parent context values', () => {
      const context: LoggingContext = { correlationId: 'id', value: 'original' };
      const parent = createContextualLogger('[P]', context);

      const child = parent.child({ value: 'overridden' });

      expect(child.context.value).toBe('overridden');
    });

    it('modifying child does not affect parent', () => {
      const context: LoggingContext = { correlationId: 'id', shared: true };
      const parent = createContextualLogger('[P]', context);
      const child = parent.child({ extra: 'data' });

      expect(parent.context).not.toHaveProperty('extra');
      expect(child.context.extra).toBe('data');
    });

    it('supports nested children', () => {
      const context: LoggingContext = { correlationId: 'root' };
      const root = createContextualLogger('[Root]', context);
      const level1 = root.child({ level: 1 });
      const level2 = level1.child({ level: 2 });

      expect(level2.context.correlationId).toBe('root');
      expect(level2.context.level).toBe(2);
    });
  });

  describe('structured logging', () => {
    it('includes event name in structured log', () => {
      const context: LoggingContext = { correlationId: 'struct-test' };
      const log = createContextualLogger('[Struct]', context);

      log.structured('info', {
        event: 'phase_complete',
        message: 'Done',
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('[phase_complete]')
      );
    });

    it('includes correlation ID in structured log', () => {
      const context: LoggingContext = { correlationId: 'corr-456' };
      const log = createContextualLogger('[S]', context);

      log.structured('info', { event: 'test_event' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('[corr-456]')
      );
    });

    it('includes message in structured log when provided', () => {
      const context: LoggingContext = { correlationId: 'id' };
      const log = createContextualLogger('[S]', context);

      log.structured('info', {
        event: 'my_event',
        message: 'Human readable message',
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Human readable message')
      );
    });

    it('includes additional data in structured log', () => {
      const context: LoggingContext = { correlationId: 'id' };
      const log = createContextualLogger('[S]', context);

      log.structured('info', {
        event: 'metrics',
        duration: 1500,
        sources: 25,
      });

      const call = mockLogger.info.mock.calls[0][0];
      expect(call).toContain('1500');
      expect(call).toContain('25');
    });

    it('logs at correct level for warn', () => {
      const context: LoggingContext = { correlationId: 'id' };
      const log = createContextualLogger('[S]', context);

      log.structured('warn', { event: 'warning_event' });

      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('logs at correct level for error', () => {
      const context: LoggingContext = { correlationId: 'id' };
      const log = createContextualLogger('[S]', context);

      log.structured('error', { event: 'error_event' });

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});

describe('LoggingContext usage patterns', () => {
  it('supports article generation context', () => {
    const context: LoggingContext = {
      correlationId: generateCorrelationId(),
      gameName: 'Elden Ring',
      categorySlug: 'beginner-guide',
    };

    const log = createContextualLogger('[ArticleGen]', context);
    const scoutLog = log.child({ phase: 'scout' });
    const editorLog = log.child({ phase: 'editor' });
    const specialistLog = log.child({ phase: 'specialist' });

    // All loggers share the same correlation ID
    expect(scoutLog.context.correlationId).toBe(context.correlationId);
    expect(editorLog.context.correlationId).toBe(context.correlationId);
    expect(specialistLog.context.correlationId).toBe(context.correlationId);

    // Each has its own phase
    expect(scoutLog.context.phase).toBe('scout');
    expect(editorLog.context.phase).toBe('editor');
    expect(specialistLog.context.phase).toBe('specialist');
  });

  it('supports adding metrics to context', () => {
    const context: LoggingContext = { correlationId: 'metrics-test' };
    const log = createContextualLogger('[Metrics]', context);

    // Create child with metrics after phase completes
    const withMetrics = log.child({
      durationMs: 2500,
      sourcesFound: 30,
      queriesExecuted: 8,
    });

    expect(withMetrics.context.durationMs).toBe(2500);
    expect(withMetrics.context.sourcesFound).toBe(30);
    expect(withMetrics.context.queriesExecuted).toBe(8);
  });
});

