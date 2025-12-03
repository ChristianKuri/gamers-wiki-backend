/**
 * AI Model Comparison Test: Game Descriptions
 * 
 * Tests multiple AI models for game description generation.
 * Compares output quality, speed, and allows cost comparison on OpenRouter.
 * 
 * Usage:
 *   npm run test:ai:game-descriptions
 *   # or
 *   npx tsx scripts/test-ai-game-descriptions.ts
 * 
 * Requirements:
 *   - OPENROUTER_API_KEY in .env file or environment
 *   - Run from gamers-wiki-backend directory
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';

// Load .env file manually (no external dependencies needed)
function loadEnvFile() {
  const envPaths = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '.env.local'),
    resolve(__dirname, '../.env'),
    resolve(__dirname, '../.env.local'),
  ];

  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=');
          const value = valueParts.join('=').replace(/^["']|["']$/g, '');
          if (key && !process.env[key]) {
            process.env[key] = value;
          }
        }
      }
      console.log(`📁 Loaded env from: ${envPath}`);
      return;
    }
  }
}

loadEnvFile();

import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { gameDescriptionsConfig } from '../src/ai/config';
import type { GameDescriptionContext, SupportedLocale } from '../src/ai/config';

// ============================================================================
// CONFIGURATION - Edit these values to customize your tests
// ============================================================================

/** Models to test - add or remove as needed */
const MODELS_TO_TEST = [
  'google/gemini-3-pro-preview',
  'google/gemini-2.5-flash',
  'moonshotai/kimi-k2-thinking',
  'deepseek/deepseek-v3.2',
  'openai/gpt-5.1',
  'openai/gpt-5-mini',
  'minimax/minimax-m2',
];

/** Test game context - Baldur's Gate III */
const TEST_CONTEXT: GameDescriptionContext = {
  name: "Baldur's Gate III",
  igdbDescription: "Baldur's Gate 3 is a story-rich, party-based RPG set in the universe of Dungeons & Dragons, where your choices shape a tale of fellowship and betrayal, survival and sacrifice, and the lure of absolute power.",
  genres: ['Role-playing (RPG)', 'Turn-based strategy', 'Adventure'],
  platforms: ['PC', 'PlayStation 5', 'Xbox Series X|S', 'Mac'],
  releaseDate: 'August 3, 2023',
  developer: 'Larian Studios',
  publisher: 'Larian Studios',
};

/** Language to test */
const TEST_LOCALE: SupportedLocale = 'en';

// ============================================================================
// TEST RUNNER
// ============================================================================

interface TestResult {
  model: string;
  success: boolean;
  duration: number;
  output?: string;
  error?: string;
  wordCount?: number;
  charCount?: number;
}

const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || '',
});

async function testModel(model: string): Promise<TestResult> {
  const startTime = Date.now();
  
  try {
    const prompt = gameDescriptionsConfig.buildPrompt(TEST_CONTEXT, TEST_LOCALE);
    
    const { text } = await generateText({
      model: openrouter(model),
      system: gameDescriptionsConfig.systemPrompt,
      prompt,
    });

    const output = text.trim();
    const duration = Date.now() - startTime;

    return {
      model,
      success: true,
      duration,
      output,
      wordCount: output.split(/\s+/).length,
      charCount: output.length,
    };
  } catch (error) {
    return {
      model,
      success: false,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function printSeparator(char = '=', length = 80) {
  console.log(char.repeat(length));
}

function printHeader(title: string) {
  console.log('\n');
  printSeparator();
  console.log(`  ${title}`);
  printSeparator();
}

// ============================================================================
// RESULTS STORAGE
// ============================================================================

const RESULTS_DIR = resolve(__dirname, 'test-results', 'game-descriptions');

function getTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function saveResults(results: TestResult[], testConfig: { game: string; locale: string }) {
  // Ensure directory exists
  if (!existsSync(RESULTS_DIR)) {
    mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const timestamp = getTimestamp();

  // Save JSON for programmatic access
  const jsonPath = resolve(RESULTS_DIR, `${timestamp}.json`);
  const jsonData = {
    timestamp: new Date().toISOString(),
    testConfig,
    models: MODELS_TO_TEST,
    results: results.map(r => ({
      ...r,
      durationFormatted: formatDuration(r.duration),
    })),
  };
  writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2));

  // Save Markdown for human reading
  const mdPath = resolve(RESULTS_DIR, `${timestamp}.md`);
  let markdown = `# AI Model Test: Game Descriptions\n\n`;
  markdown += `**Date:** ${new Date().toLocaleString()}\n`;
  markdown += `**Game:** ${testConfig.game}\n`;
  markdown += `**Language:** ${testConfig.locale}\n\n`;
  markdown += `## Summary\n\n`;
  markdown += `| Model | Duration | Words | Status |\n`;
  markdown += `|-------|----------|-------|--------|\n`;

  for (const r of results) {
    const status = r.success ? '✅' : '❌';
    const words = r.success ? r.wordCount : 'N/A';
    markdown += `| ${r.model} | ${formatDuration(r.duration)} | ${words} | ${status} |\n`;
  }

  markdown += `\n## Detailed Outputs\n\n`;

  for (const r of results) {
    markdown += `### ${r.model}\n\n`;
    if (r.success) {
      markdown += `- **Duration:** ${formatDuration(r.duration)}\n`;
      markdown += `- **Words:** ${r.wordCount}\n`;
      markdown += `- **Characters:** ${r.charCount}\n\n`;
      markdown += `**Output:**\n\n${r.output}\n\n`;
    } else {
      markdown += `**Error:** ${r.error}\n\n`;
    }
    markdown += `---\n\n`;
  }

  writeFileSync(mdPath, markdown);

  return { jsonPath, mdPath };
}

async function runTests() {
  // Check for API key
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('❌ Error: OPENROUTER_API_KEY environment variable is not set');
    console.log('\nSet it with:');
    console.log('  export OPENROUTER_API_KEY="your-key-here"');
    process.exit(1);
  }

  printHeader('🎮 AI Model Test: Game Descriptions Generation');
  
  console.log('\n📋 Test Configuration:');
  console.log(`   Game: ${TEST_CONTEXT.name}`);
  console.log(`   Language: ${TEST_LOCALE}`);
  console.log(`   Models to test: ${MODELS_TO_TEST.length}`);
  console.log(`   Developer: ${TEST_CONTEXT.developer}`);
  console.log(`   Genres: ${TEST_CONTEXT.genres?.join(', ')}`);

  const results: TestResult[] = [];

  // Run tests sequentially (to avoid rate limits and get accurate timing)
  for (let i = 0; i < MODELS_TO_TEST.length; i++) {
    const model = MODELS_TO_TEST[i];
    console.log(`\n⏳ [${i + 1}/${MODELS_TO_TEST.length}] Testing: ${model}...`);
    
    const result = await testModel(model);
    results.push(result);

    if (result.success) {
      console.log(`   ✅ Success in ${formatDuration(result.duration)} (${result.wordCount} words)`);
    } else {
      console.log(`   ❌ Failed: ${result.error}`);
    }
  }

  // Print detailed results
  printHeader('📊 RESULTS');

  for (const result of results) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`📦 MODEL: ${result.model}`);
    console.log(`${'─'.repeat(80)}`);
    
    if (result.success) {
      console.log(`⏱️  Duration: ${formatDuration(result.duration)}`);
      console.log(`📝 Words: ${result.wordCount} | Characters: ${result.charCount}`);
      console.log(`\n📄 OUTPUT:\n`);
      console.log(result.output);
    } else {
      console.log(`❌ ERROR: ${result.error}`);
    }
  }

  // Print summary table
  printHeader('📈 SUMMARY');
  
  console.log('\n┌─────────────────────────────────────────┬───────────┬────────┬────────┐');
  console.log('│ Model                                   │ Duration  │ Words  │ Status │');
  console.log('├─────────────────────────────────────────┼───────────┼────────┼────────┤');
  
  for (const result of results) {
    const modelName = result.model.length > 39 
      ? result.model.substring(0, 36) + '...' 
      : result.model.padEnd(39);
    const duration = formatDuration(result.duration).padStart(9);
    const words = result.success ? String(result.wordCount).padStart(6) : '   N/A';
    const status = result.success ? '  ✅  ' : '  ❌  ';
    
    console.log(`│ ${modelName} │ ${duration} │ ${words} │${status}│`);
  }
  
  console.log('└─────────────────────────────────────────┴───────────┴────────┴────────┘');

  // Ranking by speed (successful only)
  const successfulResults = results.filter(r => r.success);
  if (successfulResults.length > 0) {
    console.log('\n🏆 Speed Ranking (fastest first):');
    const sorted = [...successfulResults].sort((a, b) => a.duration - b.duration);
    sorted.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.model} - ${formatDuration(r.duration)}`);
    });
  }

  // Save results to files
  const { jsonPath, mdPath } = saveResults(results, {
    game: TEST_CONTEXT.name,
    locale: TEST_LOCALE,
  });

  console.log('\n📁 Results saved to:');
  console.log(`   📄 ${mdPath}`);
  console.log(`   📊 ${jsonPath}`);
  console.log('\n💰 Check costs at: https://openrouter.ai/activity');
  console.log('\n✅ Tests complete!\n');
}

// Run the tests
runTests().catch(console.error);

