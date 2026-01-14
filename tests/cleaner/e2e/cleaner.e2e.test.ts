/**
 * Cleaner Agent E2E Test
 *
 * Tests the content cleaning pipeline:
 * 1. Search for content using Tavily
 * 2. Clean raw content using the Cleaner agent
 * 3. Save results for manual inspection
 *
 * Run with: npm run test:e2e:cleaner
 * Or: RUN_E2E_TESTS=true npx vitest run tests/cleaner/e2e/cleaner.e2e.test.ts
 */

// Load .env file before anything else
import { config } from 'dotenv';
config();

import { describe, it, expect, beforeAll } from 'vitest';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, Output } from 'ai';

import { tavilySearch, isTavilyConfigured } from '../../../src/ai/tools/tavily';
import { cleanSingleSource } from '../../../src/ai/articles/agents/cleaner';
import { getModel } from '../../../src/ai/config/utils';
import {
  type CleanerE2ETestResult,
  type SearchResultInfo,
  type CleaningResultInfo,
  type ContentComparison,
  type RawContentSection,
  type TokenUsage,
  saveCleanerTestResult,
  logCleanerSummary,
  extractDomain,
} from './save-results';

// ============================================================================
// Test Configuration
// ============================================================================

const TEST_CONFIG = {
  query: 'Elden Ring best starting class for beginners guide',
  gameName: 'Elden Ring',
  maxResults: 1,
  searchSource: 'tavily' as const,
};

// ============================================================================
// Test Helpers
// ============================================================================

function isOpenRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

function createModel() {
  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
  });
  const modelId = getModel('ARTICLE_CLEANER');
  return openrouter(modelId);
}

// ============================================================================
// Test Suite
// ============================================================================

const describeE2E = process.env.RUN_E2E_TESTS === 'true' ? describe : describe.skip;

describeE2E('Cleaner Agent E2E', () => {
  let testResult: Partial<CleanerE2ETestResult> = {};
  let startTime: number;

  beforeAll(() => {
    // Check prerequisites
    if (!isTavilyConfigured()) {
      throw new Error('TAVILY_API_KEY not configured');
    }
    if (!isOpenRouterConfigured()) {
      throw new Error('OPENROUTER_API_KEY not configured');
    }

    startTime = Date.now();
    testResult = {
      metadata: {
        testName: `cleaner-${TEST_CONFIG.gameName.toLowerCase().replace(/\s+/g, '-')}`,
        timestamp: new Date().toISOString(),
        durationMs: 0,
        passed: false,
      },
      input: {
        query: TEST_CONFIG.query,
        gameName: TEST_CONFIG.gameName,
        maxResults: TEST_CONFIG.maxResults,
        searchSource: TEST_CONFIG.searchSource,
      },
    };
  });

  it('should search, clean, and analyze content', async () => {
    // ========================================================================
    // Step 1: Search with Tavily
    // ========================================================================
    console.log('\n🔍 Searching with Tavily...');
    console.log(`   Query: "${TEST_CONFIG.query}"`);

    const searchResponse = await tavilySearch(TEST_CONFIG.query, {
      maxResults: TEST_CONFIG.maxResults,
      includeRawContent: 'markdown',
      includeAnswer: true,
    });

    expect(searchResponse.results.length).toBeGreaterThan(0);

    // Build search results info
    const searchResults: SearchResultInfo[] = searchResponse.results.map((r) => ({
      url: r.url,
      title: r.title,
      domain: extractDomain(r.url),
      contentLength: (r.raw_content ?? r.content ?? '').length,
      hasRawContent: Boolean(r.raw_content),
    }));

    const totalContentChars = searchResults.reduce((sum, r) => sum + r.contentLength, 0);

    testResult.search = {
      stats: {
        resultsReturned: searchResponse.results.length,
        resultsWithContent: searchResults.filter((r) => r.contentLength > 0).length,
        totalContentChars,
        avgContentChars: searchResults.length > 0 ? Math.round(totalContentChars / searchResults.length) : 0,
        answer: searchResponse.answer,
        costUsd: searchResponse.costUsd,
      },
      results: searchResults,
    };

    console.log(`   Found ${searchResponse.results.length} result(s)`);
    console.log(`   Total content: ${totalContentChars.toLocaleString()} chars`);
    if (searchResponse.costUsd !== undefined) {
      console.log(`   Cost: $${searchResponse.costUsd.toFixed(4)}`);
    }

    // ========================================================================
    // Step 2: Clean with Cleaner Agent
    // ========================================================================
    console.log('\n🧹 Cleaning with Cleaner Agent...');

    const model = createModel();
    const modelId = getModel('ARTICLE_CLEANER');
    console.log(`   Model: ${modelId}`);

    const cleaningResults: CleaningResultInfo[] = [];
    const comparisons: ContentComparison[] = [];
    const rawContents: RawContentSection[] = [];

    let totalTokenUsage: TokenUsage = { input: 0, output: 0, actualCostUsd: 0 };
    let totalQualityScore = 0;
    let totalJunkRatio = 0;
    let successCount = 0;

    for (const searchResult of searchResponse.results) {
      const rawContent = searchResult.raw_content ?? searchResult.content ?? '';
      const originalLength = rawContent.length;

      console.log(`\n   Processing: ${searchResult.title.slice(0, 50)}...`);
      console.log(`   URL: ${searchResult.url}`);
      console.log(`   Original length: ${originalLength.toLocaleString()} chars`);

      const cleanResult = await cleanSingleSource(
        {
          url: searchResult.url,
          title: searchResult.title,
          content: rawContent,
          searchSource: TEST_CONFIG.searchSource,
        },
        {
          generateText,
          model,
          gameName: TEST_CONFIG.gameName,
        }
      );

      // Aggregate token usage
      totalTokenUsage = {
        input: totalTokenUsage.input + cleanResult.tokenUsage.input,
        output: totalTokenUsage.output + cleanResult.tokenUsage.output,
        actualCostUsd: (totalTokenUsage.actualCostUsd ?? 0) + (cleanResult.tokenUsage.actualCostUsd ?? 0),
      };

      const domain = extractDomain(searchResult.url);

      if (cleanResult.source) {
        const src = cleanResult.source;
        successCount++;
        totalQualityScore += src.qualityScore;
        totalJunkRatio += src.junkRatio;

        cleaningResults.push({
          url: src.url,
          title: src.title,
          domain: src.domain,
          success: true,
          qualityScore: src.qualityScore,
          qualityNotes: src.qualityNotes,
          contentType: src.contentType,
          summary: src.summary ?? undefined,
          junkRatio: src.junkRatio,
          originalLength,
          cleanedLength: src.cleanedContent.length,
          tokenUsage: cleanResult.tokenUsage,
        });

        comparisons.push({
          url: src.url,
          title: src.title,
          originalLength,
          cleanedLength: src.cleanedContent.length,
          reductionPercent: ((originalLength - src.cleanedContent.length) / originalLength) * 100,
          qualityScore: src.qualityScore,
          contentType: src.contentType,
          summary: src.summary ?? undefined,
        });

        rawContents.push({
          url: src.url,
          title: src.title,
          original: rawContent,
          cleaned: src.cleanedContent,
        });

        console.log(`   ✅ Cleaned: ${src.cleanedContent.length.toLocaleString()} chars`);
        console.log(`   Quality: ${src.qualityScore}/100`);
        console.log(`   Type: ${src.contentType}`);
        console.log(`   Junk ratio: ${(src.junkRatio * 100).toFixed(1)}%`);
        console.log(`   Summary: ${src.summary?.slice(0, 100)}...`);
      } else {
        cleaningResults.push({
          url: searchResult.url,
          title: searchResult.title,
          domain,
          success: false,
          originalLength,
          tokenUsage: cleanResult.tokenUsage,
        });

        comparisons.push({
          url: searchResult.url,
          title: searchResult.title,
          originalLength,
        });

        rawContents.push({
          url: searchResult.url,
          title: searchResult.title,
          original: rawContent,
        });

        console.log(`   ❌ Cleaning failed (content too short or invalid)`);
      }

      if (cleanResult.tokenUsage.actualCostUsd !== undefined) {
        console.log(`   LLM cost: $${cleanResult.tokenUsage.actualCostUsd.toFixed(4)}`);
      }
    }

    // Build cleaning stats
    testResult.cleaning = {
      stats: {
        sourcesAttempted: searchResponse.results.length,
        sourcesSucceeded: successCount,
        sourcesFailed: searchResponse.results.length - successCount,
        totalTokenUsage,
        avgQualityScore: successCount > 0 ? totalQualityScore / successCount : undefined,
        avgJunkRatio: successCount > 0 ? totalJunkRatio / successCount : undefined,
        model: modelId,
      },
      results: cleaningResults,
    };

    testResult.comparison = comparisons;
    testResult.rawContent = rawContents;

    // ========================================================================
    // Step 3: Save Results
    // ========================================================================
    const durationMs = Date.now() - startTime;
    testResult.metadata = {
      ...testResult.metadata!,
      durationMs,
      passed: successCount > 0,
    };

    const filePath = saveCleanerTestResult(testResult as CleanerE2ETestResult);
    console.log(`\n📁 Results saved to: ${filePath}`);

    // Log summary
    logCleanerSummary(testResult as CleanerE2ETestResult);

    // ========================================================================
    // Assertions
    // ========================================================================
    expect(successCount).toBeGreaterThan(0);
    expect(cleaningResults.some((r) => r.success)).toBe(true);

    // Verify we got quality scores
    const successfulResults = cleaningResults.filter((r) => r.success);
    for (const result of successfulResults) {
      expect(result.qualityScore).toBeGreaterThanOrEqual(0);
      expect(result.qualityScore).toBeLessThanOrEqual(100);
      expect(result.contentType).toBeTruthy();
      expect(result.summary).toBeTruthy();
    }

    // Verify token usage was tracked
    expect(totalTokenUsage.input).toBeGreaterThan(0);
    expect(totalTokenUsage.output).toBeGreaterThan(0);
  }, 120000); // 2 minute timeout
});
