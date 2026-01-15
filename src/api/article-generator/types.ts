import type { DocumentQueryOptions } from '../../../types/strapi';
import type { ArticleGenerationPhase } from '../../../ai/articles/types';

/**
 * SSE Event Types for article generation progress streaming.
 */
export type SSEEventType = 'progress' | 'complete' | 'error' | 'start';

export interface SSEProgressEvent {
  type: 'progress';
  phase: ArticleGenerationPhase;
  progress: number;
  message?: string;
  timestamp: string;
}

export interface SSEStartEvent {
  type: 'start';
  game: { documentId: string; name: string; slug: string };
  timestamp: string;
}

export interface SSECompleteEvent {
  type: 'complete';
  post: { id: number; documentId: string };
  draft: {
    title: string;
    categorySlug: string;
    excerpt: string;
    description: string;
    markdown: string;
    sources: readonly string[];
  };
  metadata: {
    totalDurationMs: number;
    totalCostUsd?: number;
    sourcesCollected: number;
    researchConfidence: string;
  };
  game: { documentId: string; name: string; slug: string };
  published: boolean;
  timestamp: string;
}

export interface SSEErrorEvent {
  type: 'error';
  code: string;
  message: string;
  timestamp: string;
}

export type SSEEvent = SSEProgressEvent | SSEStartEvent | SSECompleteEvent | SSEErrorEvent;

/**
 * Strapi document types used by the article generator.
 */
export interface CategoryDocument {
  id: number;
  documentId: string;
  name: string;
  slug: string;
  systemPrompt?: string | null;
  locale: string;
}

export interface AuthorDocument {
  id: number;
  documentId: string;
  name: string;
  slug: string;
  locale: string;
}

export interface PostDocument {
  id: number;
  documentId: string;
}

/**
 * Type for Strapi document service - using generics for better type safety.
 * Note: Strapi 5's document service has limited TypeScript support, so some type assertions are needed.
 * Keep this in sync with patterns used in game-fetcher.
 */
export type StrapiDocumentService<T> = {
  findMany(options?: DocumentQueryOptions): Promise<T[]>;
  findOne(options: { documentId: string } & DocumentQueryOptions): Promise<T | null>;
  create(options: { data: Partial<T>; locale?: string; status?: 'draft' | 'published' }): Promise<T>;
  update(options: { documentId: string; data: Partial<T>; locale?: string }): Promise<T>;
  publish(options: { documentId: string; locale?: string }): Promise<T>;
};

/**
 * Cost breakdown by phase stored in the database.
 */
export interface PhaseCost {
  model: string;
  durationMs: number;
  tokens?: { input: number; output: number };
  costUsd?: number;
}

/**
 * All cost and performance data stored in the database.
 */
export interface StoredCosts {
  /** Correlation ID for log tracing */
  generationId: string;
  /** Total generation duration in ms */
  totalDurationMs: number;
  /** Total estimated cost (LLM + Search + Cleaner) */
  totalCostUsd?: number;
  /** Cost and performance breakdown by phase */
  phases: {
    scout: PhaseCost;
    editor: PhaseCost;
    specialist: PhaseCost;
    reviewer?: PhaseCost;
    fixer?: PhaseCost;
  };
  /** Cleaner costs (content extraction/summarization) */
  cleaner?: {
    tokens: { input: number; output: number };
    costUsd?: number;
  };
  /** Search API costs */
  search?: {
    tavily?: { queries: number; estimatedCostUsd: number };
    exa?: { queries: number; costUsd: number };
  };
  /** Research statistics */
  research: {
    queriesExecuted: number;
    sourcesCollected: number;
    confidence: string;
  };
  /** Quality metrics from review/fix cycle */
  quality: {
    fixerIterations: number;
    issuesFixed: number;
    finalApproved: boolean;
    remainingIssues: number;
  };
  /** ISO timestamp when generation completed */
  generatedAt: string;
}

/**
 * Article plan stored in the database.
 */
export interface StoredPlan {
  title: string;
  gameName: string;
  categorySlug: string;
  sections: Array<{
    headline: string;
    goal: string;
    researchQueries: string[];
    mustCover: string[];
  }>;
  requiredElements: string[];
}

/**
 * Sources data stored in the database with domain analysis.
 */
export interface StoredSources {
  count: number;
  uniqueDomains: number;
  topDomains: string[];
  domainBreakdown: Record<string, number>;
  urls: string[];
}
