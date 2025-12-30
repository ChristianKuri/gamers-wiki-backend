/**
 * Quick script to test cleaner on a specific URL
 * Run with: npx tsx scripts/test-cleaner-url.ts
 */

import { config } from 'dotenv';
config();

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject } from 'ai';
import { cleanSingleSource } from '../src/ai/articles/agents/cleaner';
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
  console.log('🧪 Testing Cleaner on Specific URL\n');
  console.log('=' .repeat(60));
  
  // Check config
  console.log('\n📋 Cleaner Config:');
  console.log(`   Timeout: ${CLEANER_CONFIG.TIMEOUT_MS}ms`);
  console.log(`   Max retries: 4`);
  console.log(`   Max input chars: ${CLEANER_CONFIG.MAX_INPUT_CHARS.toLocaleString()}`);
  console.log(`   Model: ${getModel('ARTICLE_CLEANER')}`);

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
  
  // Create model
  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
  });
  const modelId = getModel('ARTICLE_CLEANER');
  const model = openrouter(modelId);

  // Test cleaning
  console.log('\n🧹 Testing Cleaner Agent...');
  console.log(`   Content length: ${content.length.toLocaleString()} chars`);
  console.log(`   Truncated to: ${Math.min(content.length, CLEANER_CONFIG.MAX_INPUT_CHARS).toLocaleString()} chars`);
  
  const start = Date.now();
  
  try {
    const result = await cleanSingleSource(
      {
        url: TEST_URL,
        title: 'Merchants - Elden Ring Wiki',
        content: content,
        searchSource: 'tavily',
      },
      {
        generateObject,
        model,
        gameName: 'Elden Ring',
      }
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
    } else {
      console.log('\n❌ No source returned (cleaning failed)');
    }

    console.log('\n💰 Token Usage:');
    console.log(`   Input: ${result.tokenUsage.input.toLocaleString()}`);
    console.log(`   Output: ${result.tokenUsage.output.toLocaleString()}`);
    console.log(`   Cost: $${result.tokenUsage.actualCostUsd?.toFixed(4) ?? 'N/A'}`);

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
