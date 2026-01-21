/**
 * Quick script to test cleaner on a specific URL
 * Run with: npx tsx scripts/test-cleaner-url.ts
 */

import { config } from 'dotenv';
config();

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai';
import { cleanSourceTwoStep, type TwoStepCleanerDeps } from '../src/ai/articles/agents/cleaner';
import { getModel } from '../src/ai/config/utils';
import { CLEANER_CONFIG } from '../src/ai/articles/config';

// The URL that was timing out
const TEST_URL = 'https://err.fandom.com/wiki/Merchants';
const TEST_CONTENT = `Test content - we'll fetch this from the URL`;

async function fetchUrlContent(url: string): Promise<string> {
  console.log(`\n📥 Fetching URL: ${url}`);
  const start = Date.now();
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GamerWikiBot/1.0)',
      },
      signal: AbortSignal.timeout(30000),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const text = await response.text();
    console.log(`   ✅ Fetched in ${Date.now() - start}ms`);
    console.log(`   Content length: ${text.length.toLocaleString()} chars`);
    return text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`   ❌ Fetch failed: ${message}`);
    throw err;
  }
}

async function testCleaner() {
  console.log('🧪 Testing Two-Step Cleaner on Specific URL\n');
  console.log('=' .repeat(60));
  
  // Check config
  console.log('\n📋 Cleaner Config:');
  console.log(`   Step 1 Timeout: ${CLEANER_CONFIG.STEP1_TIMEOUT_MS}ms`);
  console.log(`   Step 2 Timeout: ${CLEANER_CONFIG.STEP2_TIMEOUT_MS}ms`);
  console.log(`   Max retries: ${CLEANER_CONFIG.MAX_RETRIES + CLEANER_CONFIG.MAX_DEGENERATE_RETRIES}`);
  console.log(`   Max input chars: ${CLEANER_CONFIG.MAX_INPUT_CHARS.toLocaleString()}`);
  
  const cleanerModelId = getModel('ARTICLE_CLEANER');
  const summarizerModelId = getModel('ARTICLE_SUMMARIZER');
  console.log(`   Cleaner Model: ${cleanerModelId}`);
  console.log(`   Summarizer Model: ${summarizerModelId}`);

  // Try fetching the URL first
  let content: string;
  try {
    content = await fetchUrlContent(TEST_URL);
  } catch {
    console.log('\n⚠️  Using placeholder content since fetch failed');
    content = 'This is placeholder content for testing.';
  }

  // Show content preview
  console.log('\n📄 Content Preview (first 500 chars):');
  console.log('-'.repeat(60));
  console.log(content.slice(0, 500));
  console.log('-'.repeat(60));
  
  // Create models
  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
  });
  const cleanerModel = openrouter(cleanerModelId);
  const summarizerModel = openrouter(summarizerModelId);

  // Test cleaning
  console.log('\n🧹 Testing Two-Step Cleaner Agent...');
  console.log(`   Content length: ${content.length.toLocaleString()} chars`);
  console.log(`   Truncated to: ${Math.min(content.length, CLEANER_CONFIG.MAX_INPUT_CHARS).toLocaleString()} chars`);
  
  const start = Date.now();
  
  try {
    const deps: TwoStepCleanerDeps = {
      generateText,
      cleanerModel,
      summarizerModel,
      gameName: 'Elden Ring',
    };

    const result = await cleanSourceTwoStep(
      {
        url: TEST_URL,
        title: 'Merchants - Elden Ring Wiki',
        content: content,
        searchSource: 'tavily',
      },
      deps
    );

    const duration = Date.now() - start;
    
    console.log(`\n✅ Cleaning completed in ${duration}ms`);
    
    if (result.source) {
      console.log('\n📊 Results:');
      console.log(`   Quality Score: ${result.source.qualityScore}/100`);
      console.log(`   Relevance Score: ${result.source.relevanceScore}/100`);
      console.log(`   Content Type: ${result.source.contentType}`);
      console.log(`   Junk Ratio: ${(result.source.junkRatio * 100).toFixed(1)}%`);
      console.log(`   Summary: ${result.source.summary}`);
      console.log(`   Cleaned Length: ${result.source.cleanedContent.length.toLocaleString()} chars`);
      console.log(`   Quality Notes: ${result.source.qualityNotes}`);
      
      if (result.enhancedSummary) {
        console.log('\n📝 Enhanced Summary:');
        console.log(`   Key Facts: ${result.enhancedSummary.keyFacts.length}`);
        console.log(`   Data Points: ${result.enhancedSummary.dataPoints.length}`);
        console.log(`   Procedures: ${result.enhancedSummary.procedures.length}`);
        console.log(`   Requirements: ${result.enhancedSummary.requirements.length}`);
      }
    } else {
      console.log('\n❌ No source returned (cleaning failed)');
    }

    console.log('\n💰 Token Usage:');
    console.log(`   Step 1 (Cleaning): ${result.cleaningTokenUsage.input.toLocaleString()} in / ${result.cleaningTokenUsage.output.toLocaleString()} out`);
    console.log(`   Step 2 (Summary): ${result.summaryTokenUsage.input.toLocaleString()} in / ${result.summaryTokenUsage.output.toLocaleString()} out`);
    console.log(`   Total: ${result.totalTokenUsage.input.toLocaleString()} in / ${result.totalTokenUsage.output.toLocaleString()} out`);
    console.log(`   Cost: $${result.totalTokenUsage.actualCostUsd?.toFixed(4) ?? 'N/A'}`);

  } catch (err) {
    const duration = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    console.log(`\n❌ Cleaning failed after ${duration}ms`);
    console.log(`   Error: ${message}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Test complete!');
}

testCleaner().catch(console.error);
