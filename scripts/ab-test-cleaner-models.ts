/**
 * A/B Test: Cleaner Model Comparison
 *
 * Tests multiple LLM models on the same content to compare:
 * - Output quality (cleaned content, summaries, scores)
 * - Cost (actual USD from OpenRouter)
 * - Speed (time to complete)
 * - Zod schema compliance (100% reliability required)
 *
 * Usage:
 *   npx tsx scripts/ab-test-cleaner-models.ts
 *
 * Prerequisites:
 *   - OPENROUTER_API_KEY env var set
 *   - TAVILY_API_KEY env var set (for fetching test content)
 *
 * Results saved to: tests/cleaner/e2e/results/ab-test-{timestamp}.json
 */

import { config } from 'dotenv';
config();

import * as fs from 'fs';
import * as path from 'path';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai';

import { tavilySearch, isTavilyConfigured } from '../src/ai/tools/tavily';
import { CLEANER_CONFIG } from '../src/ai/articles/config';
import { extractDomain } from '../src/ai/articles/source-cache';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Models to compare in A/B test.
 * Only includes models that passed Zod validation in previous runs.
 * 
 * FAILED (removed):
 * - google/gemini-2.0-flash-001 - ZOD_VALIDATION failure
 * - x-ai/grok-code-fast-1 - ZOD_VALIDATION failure
 * - xiaomi/mimo-v2-flash:free - API_ERROR
 * - amazon/nova-2-lite-v1 - ZOD_VALIDATION failure
 * - mistralai/devstral-2512:free - ZOD_VALIDATION failure
 * - deepseek/deepseek-v3.2 - timeout/failure
 */
const MODELS_TO_TEST = [
  // Current production model (baseline)
  'google/gemini-3-flash-preview',
  
  // Google alternatives (all passed!)
  'google/gemini-2.5-flash',
  'google/gemini-2.5-flash-lite',  // BEST VALUE: ~50% cheaper, same quality
  
  // xAI Grok
  'x-ai/grok-4.1-fast',
] as const;

/**
 * Test configuration.
 * Uses a specific URL from our database that we know produces good results.
 */
const TEST_CONFIG = {
  // Specific URL to test (from our DB with known good results)
  // Option 1: powerpyx - 65K chars, 44% junk ratio (cleanest)
  // Option 2: rockpapershotgun - 132K chars, 73% junk ratio (more content)
  // Option 3: eip.gg - 82K chars, 88% junk ratio
  testUrl: 'https://www.powerpyx.com/elden-ring-limgrave-walkthrough/',
  fallbackQuery: 'site:powerpyx.com Elden Ring Limgrave walkthrough',
  gameName: 'Elden Ring',
  // Temperature for cleaner (same for all models)
  temperature: CLEANER_CONFIG.TEMPERATURE,
  // Timeout per model (ms) - increased to 120s for large content
  timeoutMs: 120000,
  // Output directory for results
  outputDir: 'tests/cleaner/e2e/results',
};

// ============================================================================
// Use PRODUCTION cleaner to ensure exact same prompts and schema
// ============================================================================

import { 
  cleanSingleSource,
  type CleanerDeps,
} from '../src/ai/articles/agents/cleaner';
import type { RawSourceInput } from '../src/ai/articles/types';

// ============================================================================
// Types
// ============================================================================

interface ModelTestResult {
  model: string;
  success: boolean;
  zodPassed: boolean;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  actualCostUsd: number | null;
  qualityScore: number | null;
  relevanceScore: number | null;
  cleanedContentLength: number | null;
  summaryLength: number | null;
  detailedSummaryLength: number | null;
  keyFactsCount: number | null;
  dataPointsCount: number | null;
  contentType: string | null;
  error: string | null;
  errorType: 'zod_validation' | 'timeout' | 'api_error' | 'other' | null;
  // Full output for comparison
  summary: string | null;
  detailedSummary: string | null;
  keyFacts: string[] | null;
  dataPoints: string[] | null;
  cleanedContent: string | null;
  qualityNotes: string | null;
}

interface TestContent {
  url: string;
  title: string;
  domain: string;
  rawContent: string;
  rawContentLength: number;
}

interface ABTestResult {
  testContent: TestContent;
  modelResults: ModelTestResult[];
  timestamp: string;
  summary: {
    totalModels: number;
    passedModels: number;
    failedModels: number;
    zodFailures: string[];
    reliableModels: string[];
    costRanking: Array<{ model: string; cost: number; qualityScore: number }>;
  };
}

// ============================================================================
// Test Execution
// ============================================================================

function classifyError(err: unknown): 'zod_validation' | 'timeout' | 'api_error' | 'other' {
  const message = err instanceof Error ? err.message : String(err);
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('zod') || lowerMessage.includes('validation') || lowerMessage.includes('parse')) {
    return 'zod_validation';
  }
  if (lowerMessage.includes('timeout') || lowerMessage.includes('abort')) {
    return 'timeout';
  }
  if (lowerMessage.includes('api') || lowerMessage.includes('429') || lowerMessage.includes('rate')) {
    return 'api_error';
  }
  return 'other';
}

/**
 * Clean content using the PRODUCTION cleaner function.
 * This ensures we use the exact same prompts and schema as production.
 */
async function cleanWithModel(
  model: string,
  content: TestContent,
  openrouter: ReturnType<typeof createOpenRouter>
): Promise<ModelTestResult> {
  const startTime = Date.now();

  try {
    const llmModel = openrouter(model);

    // Use the ACTUAL production cleaner function
    const rawSource: RawSourceInput = {
      url: content.url,
      title: content.title,
      content: content.rawContent,
      searchSource: 'tavily',
    };

    const deps: CleanerDeps = {
      generateText,
      model: llmModel,
      gameName: TEST_CONFIG.gameName,
    };

    const result = await cleanSingleSource(rawSource, deps);

    const durationMs = Date.now() - startTime;

    if (result.source) {
      const src = result.source;
      return {
        model,
        success: true,
        zodPassed: true,
        durationMs,
        inputTokens: result.tokenUsage.input,
        outputTokens: result.tokenUsage.output,
        actualCostUsd: result.tokenUsage.actualCostUsd ?? null,
        qualityScore: src.qualityScore,
        relevanceScore: src.relevanceScore,
        cleanedContentLength: src.cleanedContent.length,
        summaryLength: src.summary?.length ?? 0,
        detailedSummaryLength: src.detailedSummary?.length ?? 0,
        keyFactsCount: src.keyFacts?.length ?? 0,
        dataPointsCount: src.dataPoints?.length ?? 0,
        contentType: src.contentType,
        error: null,
        errorType: null,
        summary: src.summary ?? null,
        detailedSummary: src.detailedSummary ?? null,
        keyFacts: src.keyFacts ? [...src.keyFacts] : null,
        dataPoints: src.dataPoints ? [...src.dataPoints] : null,
        cleanedContent: src.cleanedContent,
        qualityNotes: src.qualityNotes,
      };
    } else {
      // Source was null (content too short or invalid)
      return {
        model,
        success: false,
        zodPassed: true, // Zod passed, but content was filtered
        durationMs,
        inputTokens: result.tokenUsage.input,
        outputTokens: result.tokenUsage.output,
        actualCostUsd: result.tokenUsage.actualCostUsd ?? null,
        qualityScore: null,
        relevanceScore: null,
        cleanedContentLength: null,
        summaryLength: null,
        detailedSummaryLength: null,
        keyFactsCount: null,
        dataPointsCount: null,
        contentType: null,
        error: 'Content filtered (too short or invalid after cleaning)',
        errorType: 'other',
        summary: null,
        detailedSummary: null,
        keyFacts: null,
        dataPoints: null,
        cleanedContent: null,
        qualityNotes: null,
      };
    }
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);
    const errorType = classifyError(err);

    return {
      model,
      success: false,
      zodPassed: errorType !== 'zod_validation',
      durationMs,
      inputTokens: 0,
      outputTokens: 0,
      actualCostUsd: null,
      qualityScore: null,
      relevanceScore: null,
      cleanedContentLength: null,
      summaryLength: null,
      detailedSummaryLength: null,
      keyFactsCount: null,
      dataPointsCount: null,
      contentType: null,
      error: message,
      errorType,
      summary: null,
      detailedSummary: null,
      keyFacts: null,
      dataPoints: null,
      cleanedContent: null,
      qualityNotes: null,
    };
  }
}

async function runABTest(): Promise<ABTestResult> {
  console.log('\n🧪 CLEANER MODEL A/B TEST');
  console.log('='.repeat(60));
  console.log(`Testing ${MODELS_TO_TEST.length} models`);

  // Validate prerequisites
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY not set');
  }
  if (!isTavilyConfigured()) {
    throw new Error('TAVILY_API_KEY not set');
  }

  // Step 1: Fetch test content from Tavily using specific URL
  console.log('\n📥 Fetching test content from Tavily...');
  console.log(`   Target URL: ${TEST_CONFIG.testUrl}`);

  // Use includeDomains to target the specific URL
  const searchResponse = await tavilySearch(TEST_CONFIG.fallbackQuery, {
    maxResults: 5,
    includeRawContent: 'markdown',
    includeAnswer: false,
    includeDomains: ['powerpyx.com'],
  });

  if (searchResponse.results.length === 0) {
    throw new Error('No search results returned from Tavily');
  }

  // Find the exact URL or use the first result
  let targetResult = searchResponse.results.find(r => 
    r.url.includes('limgrave-walkthrough')
  );
  if (!targetResult) {
    console.log('   ⚠️ Exact URL not found, using first result');
    targetResult = searchResponse.results[0];
  }

  const rawContent = targetResult.raw_content ?? targetResult.content ?? '';

  if (rawContent.length < CLEANER_CONFIG.MIN_CONTENT_LENGTH) {
    throw new Error(
      `Content too short: ${rawContent.length} chars (min: ${CLEANER_CONFIG.MIN_CONTENT_LENGTH})`
    );
  }

  const testContent: TestContent = {
    url: targetResult.url,
    title: targetResult.title,
    domain: extractDomain(targetResult.url),
    rawContent,
    rawContentLength: rawContent.length,
  };

  console.log(`   ✅ Got content from: ${testContent.domain}`);
  console.log(`   Title: ${testContent.title}`);
  console.log(`   Raw content: ${testContent.rawContentLength.toLocaleString()} chars`);
  console.log(`   (~${Math.round(testContent.rawContentLength / 4).toLocaleString()} tokens estimated)`);

  // Step 2: Test all models in PARALLEL
  console.log('\n🔬 Testing models in parallel...\n');
  console.log(`   Starting ${MODELS_TO_TEST.length} models simultaneously...`);

  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
  });

  const startTime = Date.now();
  
  // Run all models in parallel
  const modelResults = await Promise.all(
    MODELS_TO_TEST.map(async (model) => {
      console.log(`   ⏳ Started: ${model}`);
      const result = await cleanWithModel(model, testContent, openrouter);
      
      if (result.success) {
        console.log(
          `   ✅ ${model}: ${(result.durationMs / 1000).toFixed(1)}s, ` +
            `$${result.actualCostUsd?.toFixed(6) ?? '?'}, ` +
            `Q:${result.qualityScore}, R:${result.relevanceScore}`
        );
      } else {
        console.log(`   ❌ ${model}: ${result.errorType?.toUpperCase()} - ${result.error?.slice(0, 60)}`);
      }
      
      return result;
    })
  );
  
  const totalDuration = Date.now() - startTime;
  console.log(`\n   ⏱️ All models completed in ${(totalDuration / 1000).toFixed(1)}s (parallel)`);
  console.log(`   (Sequential would have taken ~${modelResults.reduce((sum, r) => sum + r.durationMs, 0) / 1000}s)`);


  // Step 3: Build summary
  const successfulResults = modelResults.filter((r) => r.success);
  const failedResults = modelResults.filter((r) => !r.success);
  const zodFailures = failedResults
    .filter((r) => r.errorType === 'zod_validation')
    .map((r) => r.model);
  const reliableModels = successfulResults.map((r) => r.model);
  
  const costRanking = successfulResults
    .filter((r) => r.actualCostUsd !== null)
    .sort((a, b) => (a.actualCostUsd ?? Infinity) - (b.actualCostUsd ?? Infinity))
    .map((r) => ({
      model: r.model,
      cost: r.actualCostUsd!,
      qualityScore: r.qualityScore!,
    }));

  // Step 4: Print comparison table
  console.log('\n📊 RESULTS COMPARISON');
  console.log('='.repeat(100));

  // Header
  console.log(
    padRight('Model', 35) +
      padRight('Status', 10) +
      padRight('Time', 8) +
      padRight('Cost', 12) +
      padRight('Q', 5) +
      padRight('R', 5) +
      padRight('Cleaned', 10) +
      padRight('Facts', 6) +
      'Type'
  );
  console.log('-'.repeat(100));

  // Sort by success first, then by cost
  const sortedResults = [...modelResults].sort((a, b) => {
    if (a.success !== b.success) return a.success ? -1 : 1;
    if (a.actualCostUsd === null) return 1;
    if (b.actualCostUsd === null) return -1;
    return a.actualCostUsd - b.actualCostUsd;
  });

  for (const r of sortedResults) {
    if (r.success) {
      console.log(
        padRight(r.model, 35) +
          padRight('✅ PASS', 10) +
          padRight(`${(r.durationMs / 1000).toFixed(1)}s`, 8) +
          padRight(`$${r.actualCostUsd?.toFixed(6) ?? '?'}`, 12) +
          padRight(String(r.qualityScore), 5) +
          padRight(String(r.relevanceScore), 5) +
          padRight(`${r.cleanedContentLength?.toLocaleString()}c`, 10) +
          padRight(String(r.keyFactsCount), 6) +
          (r.contentType?.slice(0, 20) ?? '')
      );
    } else {
      console.log(
        padRight(r.model, 35) +
          padRight('❌ FAIL', 10) +
          padRight(`${(r.durationMs / 1000).toFixed(1)}s`, 8) +
          padRight('-', 12) +
          padRight('-', 5) +
          padRight('-', 5) +
          padRight('-', 10) +
          padRight('-', 6) +
          (r.errorType ?? 'unknown')
      );
    }
  }

  // Step 5: Show cost comparison for successful models
  const baseline = modelResults.find((r) => r.model === 'google/gemini-3-flash-preview');
  if (baseline?.actualCostUsd && successfulResults.length > 1) {
    console.log('\n💰 COST COMPARISON (vs baseline: gemini-3-flash-preview)');
    console.log('-'.repeat(70));

    for (const r of costRanking) {
      if (r.model === baseline.model) {
        console.log(`   ${padRight(r.model, 35)} BASELINE ($${r.cost.toFixed(6)})`);
      } else {
        const savings = ((1 - r.cost / baseline.actualCostUsd) * 100).toFixed(1);
        const relativeCost = (r.cost / baseline.actualCostUsd * 100).toFixed(1);
        console.log(
          `   ${padRight(r.model, 35)} ${relativeCost}% of baseline (${savings}% savings), Q:${r.qualityScore}`
        );
      }
    }
  }

  // Step 6: Show reliability summary
  console.log('\n🎯 RELIABILITY SUMMARY');
  console.log('-'.repeat(60));
  console.log(`   Total models tested: ${modelResults.length}`);
  console.log(`   ✅ Passed (100% Zod compliant): ${reliableModels.length}`);
  console.log(`   ❌ Failed: ${failedResults.length}`);
  
  if (zodFailures.length > 0) {
    console.log(`\n   ⚠️ ZOD VALIDATION FAILURES (not recommended):`);
    zodFailures.forEach((m) => console.log(`      - ${m}`));
  }
  
  if (reliableModels.length > 0) {
    console.log(`\n   ✅ RELIABLE MODELS (passed Zod validation):`);
    reliableModels.forEach((m) => console.log(`      - ${m}`));
  }

  // Step 7: Save results to file
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = path.join(process.cwd(), TEST_CONFIG.outputDir);
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const outputPath = path.join(outputDir, `ab-test-${timestamp}.json`);
  
  const fullResult: ABTestResult = {
    testContent: {
      ...testContent,
      rawContent: testContent.rawContent.slice(0, 1000) + '... [truncated]', // Don't save full content
    },
    modelResults,
    timestamp: new Date().toISOString(),
    summary: {
      totalModels: modelResults.length,
      passedModels: reliableModels.length,
      failedModels: failedResults.length,
      zodFailures,
      reliableModels,
      costRanking,
    },
  };
  
  fs.writeFileSync(outputPath, JSON.stringify(fullResult, null, 2));
  console.log(`\n📁 Full results saved to: ${outputPath}`);

  // Return full results
  return fullResult;
}

// ============================================================================
// Utilities
// ============================================================================

function padRight(str: string, len: number): string {
  return str.padEnd(len);
}

// ============================================================================
// Main
// ============================================================================

runABTest()
  .then((result) => {
    console.log('\n' + '='.repeat(60));
    console.log('✅ A/B TEST COMPLETE');
    console.log('='.repeat(60));
    
    const { summary } = result;
    
    // Show recommendation
    if (summary.reliableModels.length > 0 && summary.costRanking.length > 1) {
      const baseline = summary.costRanking.find((r) => r.model === 'google/gemini-3-flash-preview');
      const cheapestReliable = summary.costRanking[0]; // Already sorted by cost
      
      console.log('\n🏆 RECOMMENDATION:');
      
      if (baseline && cheapestReliable && cheapestReliable.model !== baseline.model) {
        const qualityDiff = Math.abs(baseline.qualityScore - cheapestReliable.qualityScore);
        const costSavings = ((1 - cheapestReliable.cost / baseline.cost) * 100).toFixed(0);
        
        if (qualityDiff <= 5) {
          console.log(`   🎯 BEST VALUE: ${cheapestReliable.model}`);
          console.log(`      - ${costSavings}% cheaper than baseline`);
          console.log(`      - Quality difference: only ${qualityDiff} points`);
          console.log(`      - Cost: $${cheapestReliable.cost.toFixed(6)} vs $${baseline.cost.toFixed(6)}`);
        } else if (qualityDiff <= 10) {
          console.log(`   🤔 CONSIDER: ${cheapestReliable.model}`);
          console.log(`      - ${costSavings}% cheaper than baseline`);
          console.log(`      - Quality difference: ${qualityDiff} points (acceptable?)`);
          console.log(`      - Test more samples to confirm`);
        } else {
          console.log(`   ⚠️ ${cheapestReliable.model} is ${costSavings}% cheaper`);
          console.log(`      - BUT quality differs by ${qualityDiff} points`);
          console.log(`      - May not be worth the trade-off`);
        }
      } else if (baseline) {
        console.log(`   Current baseline (gemini-3-flash-preview) is the best option.`);
      }
      
      // Show top 3 value options
      console.log('\n📊 TOP 3 BY VALUE (cost vs quality):');
      summary.costRanking.slice(0, 3).forEach((r, i) => {
        console.log(`   ${i + 1}. ${r.model}: $${r.cost.toFixed(6)}, Q:${r.qualityScore}`);
      });
    }
    
    if (summary.zodFailures.length > 0) {
      console.log('\n⛔ DO NOT USE (failed Zod validation):');
      summary.zodFailures.forEach((m) => console.log(`   - ${m}`));
    }
    
    console.log('\n');
  })
  .catch((err) => {
    console.error('\n❌ A/B test failed:', err);
    process.exit(1);
  });
