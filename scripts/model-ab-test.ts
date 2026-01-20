#!/usr/bin/env npx tsx
/**
 * Model A/B Test Script
 *
 * Simple E2E A/B testing tool for comparing LLM model outputs.
 * Runs the same prompts against multiple models in parallel.
 *
 * Usage:
 *   npx tsx scripts/model-ab-test.ts --config ./path/to/config.json
 *   npx tsx scripts/model-ab-test.ts --config ./tests/ab-configs/scout-simon.json
 *
 * Supports TWO config formats:
 *
 * FORMAT 1: Simple (systemPrompt + userPrompt)
 * {
 *   "systemPrompt": "You are...",
 *   "userPrompt": "Your task...",
 *   "models": ["model-1", "model-2"],
 *   "temperature": 0.7,
 *   "maxTokens": 4096
 * }
 *
 * FORMAT 2: OpenRouter-style (messages array + optional schema)
 * {
 *   "models": ["model-1", "model-2"],
 *   "input": [
 *     { "role": "system", "content": "You are..." },
 *     { "role": "user", "content": "Your task..." }
 *   ],
 *   "text": {
 *     "format": {
 *       "type": "json_schema",
 *       "name": "response",
 *       "schema": { ... }
 *     }
 *   },
 *   "temperature": 0.7,
 *   "maxTokens": 4096
 * }
 *
 * Output:
 *   - Creates a timestamped folder with:
 *     - input.json: The config used
 *     - summary.json: Per-model metrics (time, cost, tokens)
 *     - models/{model-id}/output.txt: Raw output per model
 */

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, generateObject } from 'ai';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

// ============================================================================
// Minimal dotenv loader (no deps)
// ============================================================================

function loadEnvFile(): void {
  const envPaths = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '.env.local'),
    resolve(__dirname, '../.env'),
    resolve(__dirname, '../.env.local'),
  ];

  for (const envPath of envPaths) {
    if (!existsSync(envPath)) continue;
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      const rawValue = trimmed.slice(idx + 1).trim();
      const value = rawValue.replace(/^["']|["']$/g, '');
      if (key && !process.env[key]) process.env[key] = value;
    }
  }
}

// Load .env before anything else
loadEnvFile();

// ============================================================================
// Message Type (compatible with ai-sdk)
// ============================================================================

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ============================================================================
// Types
// ============================================================================

/** Reasoning configuration (OpenRouter unified format) */
interface ReasoningConfig {
  /** Enable reasoning at "medium" effort level */
  enabled?: boolean;
  /** Effort level: "xhigh", "high", "medium", "low", "minimal", "none" */
  effort?: 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none';
  /** Max tokens for reasoning (Anthropic/Gemini style) */
  max_tokens?: number;
  /** Exclude reasoning from response (model still uses it internally) */
  exclude?: boolean;
}

/** Simple format config */
interface SimpleConfig {
  systemPrompt: string;
  userPrompt: string;
  models: string[];
  testName?: string;
  temperature?: number;
  maxTokens?: number;
  outputDir?: string;
  reasoning?: ReasoningConfig;
}

/** Message in OpenRouter format */
interface InputMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
}

/** JSON Schema format for structured output */
interface JsonSchemaFormat {
  type: 'json_schema';
  name: string;
  schema: Record<string, unknown>;
}

/** OpenRouter-style format config */
interface OpenRouterStyleConfig {
  models: string[];
  input: InputMessage[];
  text?: {
    format?: JsonSchemaFormat;
  };
  testName?: string;
  temperature?: number;
  maxTokens?: number;
  outputDir?: string;
  reasoning?: ReasoningConfig;
}

type ABTestConfig = SimpleConfig | OpenRouterStyleConfig;

interface ModelResult {
  modelId: string;
  success: boolean;
  output: string | null;
  error: string | null;
  durationMs: number;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  costUsd: number | null;
}

interface ABTestSummary {
  testName: string;
  timestamp: string;
  totalDurationMs: number;
  config: {
    inputFormat: 'simple' | 'openrouter';
    hasStructuredOutput: boolean;
    reasoning?: ReasoningConfig;
    messageCount?: number;
    systemPromptLength?: number;
    userPromptLength?: number;
    temperature: number;
    maxTokens: number;
  };
  models: ModelResult[];
  comparison: {
    fastestModel: string;
    fastestTimeMs: number;
    cheapestModel: string;
    cheapestCostUsd: number;
    avgDurationMs: number;
    avgCostUsd: number;
  };
}

// ============================================================================
// Config Detection & Normalization
// ============================================================================

function isOpenRouterStyle(config: ABTestConfig): config is OpenRouterStyleConfig {
  return 'input' in config && Array.isArray(config.input);
}

function extractMessagesFromConfig(config: ABTestConfig): Message[] {
  if (isOpenRouterStyle(config)) {
    return config.input.map((msg) => {
      // Handle content that might be a string or array
      let content: string;
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        // Extract text from content array
        content = msg.content
          .filter((part) => part.type === 'text' || part.type === 'input_text')
          .map((part) => part.text ?? '')
          .join('\n');
      } else {
        content = String(msg.content);
      }

      return {
        role: msg.role,
        content,
      } as Message;
    });
  }

  // Simple format - convert to messages
  const simpleConfig = config as SimpleConfig;
  const messages: Message[] = [];
  if (simpleConfig.systemPrompt) {
    messages.push({ role: 'system', content: simpleConfig.systemPrompt });
  }
  messages.push({ role: 'user', content: simpleConfig.userPrompt });
  return messages;
}

function getSchema(config: ABTestConfig): Record<string, unknown> | null {
  if (isOpenRouterStyle(config) && config.text?.format?.type === 'json_schema') {
    return config.text.format.schema;
  }
  return null;
}

// ============================================================================
// Dynamic Zod Schema from JSON Schema
// ============================================================================

function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  const type = schema.type as string;

  if (type === 'object') {
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = (schema.required ?? []) as string[];

    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, propSchema] of Object.entries(properties)) {
      let fieldSchema = jsonSchemaToZod(propSchema);
      if (!required.includes(key)) {
        fieldSchema = fieldSchema.optional();
      }
      shape[key] = fieldSchema;
    }

    return z.object(shape);
  }

  if (type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined;
    const itemSchema = items ? jsonSchemaToZod(items) : z.unknown();
    let arraySchema = z.array(itemSchema);

    if (typeof schema.minItems === 'number') {
      arraySchema = arraySchema.min(schema.minItems);
    }
    if (typeof schema.maxItems === 'number') {
      arraySchema = arraySchema.max(schema.maxItems);
    }

    return arraySchema;
  }

  if (type === 'string') {
    let strSchema = z.string();
    if (typeof schema.minLength === 'number') {
      strSchema = strSchema.min(schema.minLength);
    }
    if (typeof schema.maxLength === 'number') {
      strSchema = strSchema.max(schema.maxLength);
    }
    if (Array.isArray(schema.enum)) {
      return z.enum(schema.enum as [string, ...string[]]);
    }
    return strSchema;
  }

  if (type === 'number' || type === 'integer') {
    let numSchema = z.number();
    if (type === 'integer') {
      numSchema = numSchema.int();
    }
    if (typeof schema.minimum === 'number') {
      numSchema = numSchema.min(schema.minimum);
    }
    if (typeof schema.maximum === 'number') {
      numSchema = numSchema.max(schema.maximum);
    }
    return numSchema;
  }

  if (type === 'boolean') {
    return z.boolean();
  }

  if (type === 'null') {
    return z.null();
  }

  // Fallback for complex or unknown types
  return z.unknown();
}

// ============================================================================
// OpenRouter Client
// ============================================================================

function createClient() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is required');
  }
  return createOpenRouter({ apiKey });
}

// ============================================================================
// Cost Extraction
// ============================================================================

function extractCost(result: { providerMetadata?: Record<string, unknown> }): number | null {
  const openrouterMeta = result.providerMetadata?.openrouter as Record<string, unknown> | undefined;
  const usage = openrouterMeta?.usage as Record<string, unknown> | undefined;
  const cost = usage?.cost;
  return typeof cost === 'number' ? cost : null;
}

// ============================================================================
// Single Model Test
// ============================================================================

async function testModel(
  openrouter: ReturnType<typeof createOpenRouter>,
  modelId: string,
  messages: Message[],
  schema: Record<string, unknown> | null,
  temperature: number,
  maxTokens: number,
  reasoning?: ReasoningConfig
): Promise<ModelResult> {
  const startTime = Date.now();

  try {
    console.log(`  [${modelId}] Starting...`);

    let resultText: string;
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;
    let providerMetadata: Record<string, unknown> | undefined;

    // Build provider options for OpenRouter (includes reasoning config)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const providerOptions: any = reasoning
      ? {
          openrouter: {
            reasoning,
          },
        }
      : undefined;

    if (schema) {
      // Use generateObject for structured output
      const zodSchema = jsonSchemaToZod(schema);
      const result = await generateObject({
        model: openrouter(modelId),
        messages,
        schema: zodSchema,
        temperature,
        maxOutputTokens: maxTokens,
        providerOptions,
      });

      resultText = JSON.stringify(result.object, null, 2);
      usage = result.usage as { inputTokens?: number; outputTokens?: number };
      providerMetadata = result.providerMetadata as Record<string, unknown>;
    } else {
      // Use generateText for plain text output
      const result = await generateText({
        model: openrouter(modelId),
        messages,
        temperature,
        maxOutputTokens: maxTokens,
        providerOptions,
      });

      resultText = result.text;
      usage = result.usage;
      providerMetadata = result.providerMetadata;
    }

    const durationMs = Date.now() - startTime;
    const costUsd = extractCost({ providerMetadata });

    console.log(`  [${modelId}] ✓ Complete in ${(durationMs / 1000).toFixed(1)}s`);
    if (costUsd !== null) {
      console.log(`  [${modelId}]   Cost: $${costUsd.toFixed(4)}`);
    }

    return {
      modelId,
      success: true,
      output: resultText,
      error: null,
      durationMs,
      tokens: {
        input: usage?.inputTokens ?? 0,
        output: usage?.outputTokens ?? 0,
        total: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
      },
      costUsd,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.log(`  [${modelId}] ✗ Failed: ${errorMessage}`);

    return {
      modelId,
      success: false,
      output: null,
      error: errorMessage,
      durationMs,
      tokens: { input: 0, output: 0, total: 0 },
      costUsd: null,
    };
  }
}

// ============================================================================
// Run A/B Test
// ============================================================================

async function runABTest(config: ABTestConfig): Promise<ABTestSummary> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  const temperature = config.temperature ?? 0.7;
  const maxTokens = config.maxTokens ?? 4096;
  const isOpenRouter = isOpenRouterStyle(config);
  const schema = getSchema(config);
  // Enable reasoning by default (can be disabled with reasoning: { enabled: false })
  const reasoning: ReasoningConfig = config.reasoning ?? { enabled: true };

  // Build reasoning display string
  const reasoningDisplay =
    reasoning.enabled === false
      ? 'No (disabled)'
      : reasoning.effort
        ? `Yes (effort: ${reasoning.effort})`
        : reasoning.max_tokens
          ? `Yes (max_tokens: ${reasoning.max_tokens})`
          : 'Yes (enabled)';

  console.log('\n========================================');
  console.log('Model A/B Test');
  console.log('========================================');
  console.log(`Format: ${isOpenRouter ? 'OpenRouter-style' : 'Simple'}`);
  console.log(`Models: ${config.models.length}`);
  console.log(`Structured Output: ${schema ? 'Yes' : 'No'}`);
  console.log(`Reasoning: ${reasoningDisplay}`);
  console.log(`Temperature: ${temperature}`);
  console.log(`Max Tokens: ${maxTokens}`);
  console.log('----------------------------------------\n');

  const openrouter = createClient();
  const messages = extractMessagesFromConfig(config);

  // Run all models in parallel
  console.log('Running models in parallel...\n');
  const results = await Promise.all(
    config.models.map((modelId) => testModel(openrouter, modelId, messages, schema, temperature, maxTokens, reasoning))
  );

  const totalDurationMs = Date.now() - startTime;

  // Calculate comparison metrics
  const successfulResults = results.filter((r) => r.success);
  const withCosts = successfulResults.filter((r) => r.costUsd !== null);

  const fastestResult = successfulResults.reduce(
    (min, r) => (r.durationMs < min.durationMs ? r : min),
    successfulResults[0] ?? { modelId: 'none', durationMs: Infinity }
  );

  const cheapestResult = withCosts.reduce(
    (min, r) => ((r.costUsd ?? Infinity) < (min.costUsd ?? Infinity) ? r : min),
    withCosts[0] ?? { modelId: 'none', costUsd: null }
  );

  const avgDurationMs =
    successfulResults.length > 0
      ? successfulResults.reduce((sum, r) => sum + r.durationMs, 0) / successfulResults.length
      : 0;

  const avgCostUsd =
    withCosts.length > 0 ? withCosts.reduce((sum, r) => sum + (r.costUsd ?? 0), 0) / withCosts.length : 0;

  // Build config summary
  const configSummary: ABTestSummary['config'] = {
    inputFormat: isOpenRouter ? 'openrouter' : 'simple',
    hasStructuredOutput: schema !== null,
    reasoning,
    temperature,
    maxTokens,
  };

  if (isOpenRouter) {
    configSummary.messageCount = messages.length;
  } else {
    const simpleConfig = config as SimpleConfig;
    configSummary.systemPromptLength = simpleConfig.systemPrompt?.length ?? 0;
    configSummary.userPromptLength = simpleConfig.userPrompt?.length ?? 0;
  }

  return {
    testName: config.testName ?? 'model-ab-test',
    timestamp,
    totalDurationMs,
    config: configSummary,
    models: results,
    comparison: {
      fastestModel: fastestResult.modelId,
      fastestTimeMs: fastestResult.durationMs,
      cheapestModel: cheapestResult.modelId,
      cheapestCostUsd: cheapestResult.costUsd ?? 0,
      avgDurationMs,
      avgCostUsd,
    },
  };
}

// ============================================================================
// Save Results
// ============================================================================

function saveResults(config: ABTestConfig, summary: ABTestSummary): string {
  const baseDir = config.outputDir ?? join(__dirname, '..', 'tests', 'e2e-results', 'model-ab');

  // Create timestamped folder
  const folderName = `${summary.testName}-${summary.timestamp.replace(/[:.]/g, '-').slice(0, 19)}`;
  const runDir = join(baseDir, folderName);

  mkdirSync(runDir, { recursive: true });

  // Save input.json (the original config)
  const inputPath = join(runDir, 'input.json');
  writeFileSync(inputPath, JSON.stringify(config, null, 2), 'utf-8');

  // Save summary.json (without full outputs)
  const summaryPath = join(runDir, 'summary.json');
  const summaryForFile = {
    ...summary,
    models: summary.models.map((m) => ({
      ...m,
      output: m.output ? `[${m.output.length} chars - see models/${sanitizeModelId(m.modelId)}/output.txt]` : null,
    })),
  };
  writeFileSync(summaryPath, JSON.stringify(summaryForFile, null, 2), 'utf-8');

  // Save all-outputs.json (consolidated file with all outputs)
  const allOutputsPath = join(runDir, 'all-outputs.json');
  const allOutputs = summary.models.map((result) => {
    // Parse output as JSON if possible
    let parsedOutput: unknown = null;
    if (result.output) {
      try {
        parsedOutput = JSON.parse(result.output);
      } catch {
        parsedOutput = result.output; // Keep as string if not valid JSON
      }
    }

    return {
      model: result.modelId,
      success: result.success,
      error: result.error,
      durationMs: result.durationMs,
      durationSec: Number((result.durationMs / 1000).toFixed(2)),
      costUsd: result.costUsd,
      tokens: result.tokens,
      output: parsedOutput,
    };
  });
  writeFileSync(allOutputsPath, JSON.stringify(allOutputs, null, 2), 'utf-8');

  // Save per-model outputs
  const modelsDir = join(runDir, 'models');
  for (const result of summary.models) {
    const modelDir = join(modelsDir, sanitizeModelId(result.modelId));
    mkdirSync(modelDir, { recursive: true });

    // Save output.txt (or output.json for structured output)
    const isJson = result.output?.startsWith('{') || result.output?.startsWith('[');
    const outputExt = isJson ? 'json' : 'txt';
    const outputPath = join(modelDir, `output.${outputExt}`);
    writeFileSync(outputPath, result.output ?? `[ERROR: ${result.error}]`, 'utf-8');

    // Save metadata.json
    const metadataPath = join(modelDir, 'metadata.json');
    writeFileSync(
      metadataPath,
      JSON.stringify(
        {
          modelId: result.modelId,
          success: result.success,
          error: result.error,
          durationMs: result.durationMs,
          tokens: result.tokens,
          costUsd: result.costUsd,
          outputLength: result.output?.length ?? 0,
        },
        null,
        2
      ),
      'utf-8'
    );
  }

  return runDir;
}

function sanitizeModelId(modelId: string): string {
  return modelId.replace(/[/\\:*?"<>|]/g, '_');
}

// ============================================================================
// Print Summary
// ============================================================================

function printSummary(summary: ABTestSummary): void {
  console.log('\n========================================');
  console.log('Results Summary');
  console.log('========================================\n');

  console.log(`Total Duration: ${(summary.totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`Models Tested: ${summary.models.length}`);
  console.log(`Successful: ${summary.models.filter((m) => m.success).length}`);
  console.log(`Failed: ${summary.models.filter((m) => !m.success).length}`);

  console.log('\n--- Per-Model Results ---\n');

  // Sort by duration
  const sorted = [...summary.models].sort((a, b) => a.durationMs - b.durationMs);

  for (const result of sorted) {
    const status = result.success ? '✓' : '✗';
    const duration = (result.durationMs / 1000).toFixed(1);
    const cost = result.costUsd !== null ? `$${result.costUsd.toFixed(4)}` : 'N/A';
    const tokens = `${result.tokens.input}→${result.tokens.output}`;
    const outputLen = result.output?.length ?? 0;

    console.log(`${status} ${result.modelId}`);
    console.log(`    Time: ${duration}s | Cost: ${cost} | Tokens: ${tokens} | Output: ${outputLen} chars`);
    if (result.error) {
      console.log(`    Error: ${result.error}`);
    }
  }

  console.log('\n--- Comparison ---\n');
  console.log(`Fastest: ${summary.comparison.fastestModel} (${(summary.comparison.fastestTimeMs / 1000).toFixed(1)}s)`);
  console.log(`Cheapest: ${summary.comparison.cheapestModel} ($${summary.comparison.cheapestCostUsd.toFixed(4)})`);
  console.log(`Avg Duration: ${(summary.comparison.avgDurationMs / 1000).toFixed(1)}s`);
  console.log(`Avg Cost: $${summary.comparison.avgCostUsd.toFixed(4)}`);
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Find --config argument
  const configIndex = args.indexOf('--config');
  if (configIndex === -1 || !args[configIndex + 1]) {
    console.error('Usage: npx tsx scripts/model-ab-test.ts --config ./path/to/config.json');
    console.error('\n=== FORMAT 1: Simple ===');
    console.error(
      JSON.stringify(
        {
          testName: 'my-test',
          systemPrompt: 'You are...',
          userPrompt: 'Your task...',
          models: ['model-1', 'model-2'],
          temperature: 0.7,
          maxTokens: 4096,
        },
        null,
        2
      )
    );
    console.error('\n=== FORMAT 2: OpenRouter-style (with optional schema) ===');
    console.error(
      JSON.stringify(
        {
          testName: 'my-test',
          models: ['model-1', 'model-2'],
          input: [
            { role: 'system', content: 'You are...' },
            { role: 'user', content: 'Your task...' },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'response',
              schema: {
                type: 'object',
                properties: {
                  answer: { type: 'string' },
                },
                required: ['answer'],
              },
            },
          },
          temperature: 0.7,
          maxTokens: 4096,
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  const configPath = args[configIndex + 1];

  // Load config
  if (!existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    process.exit(1);
  }

  let config: ABTestConfig;
  try {
    const configContent = readFileSync(configPath, 'utf-8');
    config = JSON.parse(configContent);
  } catch (error) {
    console.error(`Failed to parse config file: ${error}`);
    process.exit(1);
  }

  // Validate config
  if (!config.models?.length) {
    console.error('Config must include models[] array');
    process.exit(1);
  }

  const isOpenRouter = isOpenRouterStyle(config);
  if (!isOpenRouter) {
    const simple = config as SimpleConfig;
    if (!simple.systemPrompt && !simple.userPrompt) {
      console.error('Simple config must include systemPrompt and/or userPrompt');
      process.exit(1);
    }
  } else {
    const orConfig = config as OpenRouterStyleConfig;
    if (!orConfig.input?.length) {
      console.error('OpenRouter-style config must include input[] array');
      process.exit(1);
    }
  }

  // Run test
  const summary = await runABTest(config);

  // Save results
  const outputDir = saveResults(config, summary);
  console.log(`\n📁 Results saved to: ${outputDir}`);

  // Print summary
  printSummary(summary);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
