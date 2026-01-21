#!/usr/bin/env npx tsx
/**
 * Prompt A/B Test Script
 *
 * Compare two different prompts using the SAME model.
 * Useful for testing prompt improvements (e.g., new system prompt vs old).
 *
 * Usage:
 *   npx tsx scripts/prompt-ab-test.ts --config ./path/to/config.json
 *
 * Supports TWO config formats:
 *
 * FORMAT 1: Shared user content, different system prompts (most common)
 * {
 *   "testName": "summarizer-comparison",
 *   "model": "google/gemini-3-flash-preview",
 *   "promptA": {
 *     "name": "Old prompt (Elden Ring examples)",
 *     "systemPrompt": "You are an expert..."
 *   },
 *   "promptB": {
 *     "name": "New prompt (multi-genre)",
 *     "systemPrompt": "You are an expert..."
 *   },
 *   "userContent": "Create a summary of...",
 *   "text": { "format": { "type": "json_schema", "schema": {...} } },
 *   "temperature": 0.1,
 *   "maxTokens": 8192
 * }
 *
 * FORMAT 2: Full input arrays (when user content also differs)
 * {
 *   "testName": "full-comparison",
 *   "model": "google/gemini-3-flash-preview",
 *   "promptA": {
 *     "name": "Prompt A",
 *     "input": [
 *       { "role": "system", "content": "..." },
 *       { "role": "user", "content": "..." }
 *     ]
 *   },
 *   "promptB": {
 *     "name": "Prompt B",
 *     "input": [
 *       { "role": "system", "content": "..." },
 *       { "role": "user", "content": "..." }
 *     ]
 *   },
 *   "text": { "format": { "type": "json_schema", "schema": {...} } },
 *   "temperature": 0.1,
 *   "maxTokens": 8192
 * }
 *
 * Output:
 *   - Creates a timestamped folder with:
 *     - input.json: The config used
 *     - summary.json: Comparison metrics
 *     - prompt-a/output.json: Output from prompt A
 *     - prompt-b/output.json: Output from prompt B
 *     - side-by-side.md: Human-readable comparison
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
// Types
// ============================================================================

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
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

/** Prompt definition - either systemPrompt or full input array */
interface PromptDefinition {
  name: string;
  /** Simple: just the system prompt (combined with shared userContent) */
  systemPrompt?: string;
  /** Full: complete input array (system + user messages) */
  input?: InputMessage[];
}

/** Prompt A/B Test Config */
interface PromptABTestConfig {
  testName?: string;
  model: string;
  promptA: PromptDefinition;
  promptB: PromptDefinition;
  /** Shared user content (used when prompts only have systemPrompt) */
  userContent?: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  text?: {
    format?: JsonSchemaFormat;
  };
  temperature?: number;
  maxTokens?: number;
  outputDir?: string;
}

interface PromptResult {
  promptName: string;
  promptLabel: 'A' | 'B';
  success: boolean;
  output: unknown | null;
  outputText: string | null;
  error: string | null;
  durationMs: number;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  costUsd: number | null;
}

interface PromptABTestSummary {
  testName: string;
  timestamp: string;
  totalDurationMs: number;
  config: {
    model: string;
    hasStructuredOutput: boolean;
    promptASystemLength: number;
    promptBSystemLength: number;
    userContentLength: number;
    temperature: number;
    maxTokens: number;
  };
  results: {
    promptA: PromptResult;
    promptB: PromptResult;
  };
  comparison: {
    bothSucceeded: boolean;
    fasterPrompt: 'A' | 'B' | 'tie';
    timeDifferenceMs: number;
    costDifferenceUsd: number;
  };
}

// ============================================================================
// Message Extraction
// ============================================================================

function extractUserContent(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === 'text' || part.type === 'input_text')
      .map((part) => part.text ?? '')
      .join('\n');
  }
  return String(content);
}

function buildMessagesFromPrompt(
  prompt: PromptDefinition,
  sharedUserContent?: string | Array<{ type: string; text?: string }>
): Message[] {
  // Full input array takes precedence
  if (prompt.input && prompt.input.length > 0) {
    return prompt.input.map((msg) => ({
      role: msg.role,
      content: extractUserContent(msg.content as string | Array<{ type: string; text?: string }>),
    }));
  }

  // Simple format: systemPrompt + shared userContent
  if (prompt.systemPrompt) {
    const messages: Message[] = [{ role: 'system', content: prompt.systemPrompt }];

    if (sharedUserContent) {
      messages.push({
        role: 'user',
        content: extractUserContent(sharedUserContent),
      });
    }

    return messages;
  }

  throw new Error(`Prompt "${prompt.name}" must have either systemPrompt or input array`);
}

function getSystemPromptLength(prompt: PromptDefinition): number {
  if (prompt.systemPrompt) {
    return prompt.systemPrompt.length;
  }
  if (prompt.input) {
    const systemMsg = prompt.input.find((m) => m.role === 'system');
    if (systemMsg) {
      return extractUserContent(systemMsg.content as string | Array<{ type: string; text?: string }>).length;
    }
  }
  return 0;
}

function getUserContentLength(config: PromptABTestConfig): number {
  // If using shared userContent
  if (config.userContent) {
    return extractUserContent(config.userContent).length;
  }
  // If using full input arrays, get from promptA (assuming same user content)
  if (config.promptA.input) {
    const userMsg = config.promptA.input.find((m) => m.role === 'user');
    if (userMsg) {
      return extractUserContent(userMsg.content as string | Array<{ type: string; text?: string }>).length;
    }
  }
  return 0;
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
// Single Prompt Test
// ============================================================================

async function testPrompt(
  openrouter: ReturnType<typeof createOpenRouter>,
  modelId: string,
  prompt: PromptDefinition,
  promptLabel: 'A' | 'B',
  messages: Message[],
  schema: Record<string, unknown> | null,
  temperature: number,
  maxTokens: number
): Promise<PromptResult> {
  const startTime = Date.now();

  try {
    console.log(`  [Prompt ${promptLabel}: ${prompt.name}] Starting...`);

    let resultObject: unknown = null;
    let resultText: string;
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;
    let providerMetadata: Record<string, unknown> | undefined;

    if (schema) {
      // Use generateObject for structured output
      const zodSchema = jsonSchemaToZod(schema);
      const result = await generateObject({
        model: openrouter(modelId),
        messages,
        schema: zodSchema,
        temperature,
        maxOutputTokens: maxTokens,
      });

      resultObject = result.object;
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
      });

      resultText = result.text;
      resultObject = result.text;
      usage = result.usage;
      providerMetadata = result.providerMetadata;
    }

    const durationMs = Date.now() - startTime;
    const costUsd = extractCost({ providerMetadata });

    console.log(`  [Prompt ${promptLabel}] ✓ Complete in ${(durationMs / 1000).toFixed(1)}s`);
    if (costUsd !== null) {
      console.log(`  [Prompt ${promptLabel}]   Cost: $${costUsd.toFixed(4)}`);
    }

    return {
      promptName: prompt.name,
      promptLabel,
      success: true,
      output: resultObject,
      outputText: resultText,
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

    console.log(`  [Prompt ${promptLabel}] ✗ Failed: ${errorMessage}`);

    return {
      promptName: prompt.name,
      promptLabel,
      success: false,
      output: null,
      outputText: null,
      error: errorMessage,
      durationMs,
      tokens: { input: 0, output: 0, total: 0 },
      costUsd: null,
    };
  }
}

// ============================================================================
// Run Prompt A/B Test
// ============================================================================

async function runPromptABTest(config: PromptABTestConfig): Promise<PromptABTestSummary> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  const temperature = config.temperature ?? 0.1;
  const maxTokens = config.maxTokens ?? 8192;
  const schema = config.text?.format?.type === 'json_schema' ? config.text.format.schema : null;

  console.log('\n========================================');
  console.log('Prompt A/B Test');
  console.log('========================================');
  console.log(`Model: ${config.model}`);
  console.log(`Prompt A: ${config.promptA.name}`);
  console.log(`Prompt B: ${config.promptB.name}`);
  console.log(`Structured Output: ${schema ? 'Yes' : 'No'}`);
  console.log(`Temperature: ${temperature}`);
  console.log(`Max Tokens: ${maxTokens}`);
  console.log('----------------------------------------\n');

  const openrouter = createClient();

  // Build messages for each prompt
  const messagesA = buildMessagesFromPrompt(config.promptA, config.userContent);
  const messagesB = buildMessagesFromPrompt(config.promptB, config.userContent);

  // Run prompts in parallel for faster results
  console.log('Running prompts in parallel...\n');

  const [resultA, resultB] = await Promise.all([
    testPrompt(
      openrouter,
      config.model,
      config.promptA,
      'A',
      messagesA,
      schema,
      temperature,
      maxTokens
    ),
    testPrompt(
      openrouter,
      config.model,
      config.promptB,
      'B',
      messagesB,
      schema,
      temperature,
      maxTokens
    ),
  ]);

  const totalDurationMs = Date.now() - startTime;

  // Calculate comparison
  const bothSucceeded = resultA.success && resultB.success;
  let fasterPrompt: 'A' | 'B' | 'tie' = 'tie';
  if (bothSucceeded) {
    if (resultA.durationMs < resultB.durationMs - 500) {
      fasterPrompt = 'A';
    } else if (resultB.durationMs < resultA.durationMs - 500) {
      fasterPrompt = 'B';
    }
  }

  const timeDifferenceMs = Math.abs(resultA.durationMs - resultB.durationMs);
  const costDifferenceUsd = Math.abs((resultA.costUsd ?? 0) - (resultB.costUsd ?? 0));

  return {
    testName: config.testName ?? 'prompt-ab-test',
    timestamp,
    totalDurationMs,
    config: {
      model: config.model,
      hasStructuredOutput: schema !== null,
      promptASystemLength: getSystemPromptLength(config.promptA),
      promptBSystemLength: getSystemPromptLength(config.promptB),
      userContentLength: getUserContentLength(config),
      temperature,
      maxTokens,
    },
    results: {
      promptA: resultA,
      promptB: resultB,
    },
    comparison: {
      bothSucceeded,
      fasterPrompt,
      timeDifferenceMs,
      costDifferenceUsd,
    },
  };
}

// ============================================================================
// Generate Side-by-Side Comparison
// ============================================================================

function generateSideBySideMarkdown(config: PromptABTestConfig, summary: PromptABTestSummary): string {
  const { promptA, promptB } = summary.results;

  let md = `# Prompt A/B Test Results

**Test Name:** ${summary.testName}
**Timestamp:** ${summary.timestamp}
**Model:** ${config.model}
**Temperature:** ${summary.config.temperature}

---

## Summary

| Metric | Prompt A | Prompt B |
|--------|----------|----------|
| Name | ${promptA.promptName} | ${promptB.promptName} |
| Success | ${promptA.success ? '✓' : '✗'} | ${promptB.success ? '✓' : '✗'} |
| Duration | ${(promptA.durationMs / 1000).toFixed(1)}s | ${(promptB.durationMs / 1000).toFixed(1)}s |
| Cost | ${promptA.costUsd !== null ? '$' + promptA.costUsd.toFixed(4) : 'N/A'} | ${promptB.costUsd !== null ? '$' + promptB.costUsd.toFixed(4) : 'N/A'} |
| Input Tokens | ${promptA.tokens.input} | ${promptB.tokens.input} |
| Output Tokens | ${promptA.tokens.output} | ${promptB.tokens.output} |
| System Prompt Length | ${summary.config.promptASystemLength} chars | ${summary.config.promptBSystemLength} chars |

**Faster:** ${summary.comparison.fasterPrompt === 'tie' ? 'Tie' : `Prompt ${summary.comparison.fasterPrompt}`} (${(summary.comparison.timeDifferenceMs / 1000).toFixed(1)}s difference)

---

## Prompt A Output: ${promptA.promptName}

`;

  if (promptA.success && promptA.output) {
    md += '```json\n' + JSON.stringify(promptA.output, null, 2) + '\n```\n';
  } else {
    md += `**Error:** ${promptA.error}\n`;
  }

  md += `
---

## Prompt B Output: ${promptB.promptName}

`;

  if (promptB.success && promptB.output) {
    md += '```json\n' + JSON.stringify(promptB.output, null, 2) + '\n```\n';
  } else {
    md += `**Error:** ${promptB.error}\n`;
  }

  // Add key differences section for structured output
  if (promptA.success && promptB.success && promptA.output && promptB.output) {
    md += `
---

## Manual Evaluation Checklist

Use this checklist to compare the outputs:

- [ ] **Completeness**: Which output captured more information?
- [ ] **Accuracy**: Are there any factual errors in either output?
- [ ] **Specificity**: Which output has more specific details (names, numbers)?
- [ ] **Structure**: Which output is better organized?
- [ ] **Actionability**: Which output would be more useful for a writer?

**Winner:** _____________________

**Notes:**

`;
  }

  return md;
}

// ============================================================================
// Save Results
// ============================================================================

function saveResults(config: PromptABTestConfig, summary: PromptABTestSummary): string {
  const baseDir = config.outputDir ?? join(__dirname, '..', 'tests', 'e2e-results', 'prompt-ab');

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
    results: {
      promptA: { ...summary.results.promptA, output: '[see prompt-a/output.json]', outputText: undefined },
      promptB: { ...summary.results.promptB, output: '[see prompt-b/output.json]', outputText: undefined },
    },
  };
  writeFileSync(summaryPath, JSON.stringify(summaryForFile, null, 2), 'utf-8');

  // Save prompt-a output
  const promptADir = join(runDir, 'prompt-a');
  mkdirSync(promptADir, { recursive: true });
  if (summary.results.promptA.output) {
    writeFileSync(
      join(promptADir, 'output.json'),
      JSON.stringify(summary.results.promptA.output, null, 2),
      'utf-8'
    );
  }
  writeFileSync(
    join(promptADir, 'metadata.json'),
    JSON.stringify(
      {
        name: summary.results.promptA.promptName,
        success: summary.results.promptA.success,
        error: summary.results.promptA.error,
        durationMs: summary.results.promptA.durationMs,
        tokens: summary.results.promptA.tokens,
        costUsd: summary.results.promptA.costUsd,
      },
      null,
      2
    ),
    'utf-8'
  );

  // Save prompt-b output
  const promptBDir = join(runDir, 'prompt-b');
  mkdirSync(promptBDir, { recursive: true });
  if (summary.results.promptB.output) {
    writeFileSync(
      join(promptBDir, 'output.json'),
      JSON.stringify(summary.results.promptB.output, null, 2),
      'utf-8'
    );
  }
  writeFileSync(
    join(promptBDir, 'metadata.json'),
    JSON.stringify(
      {
        name: summary.results.promptB.promptName,
        success: summary.results.promptB.success,
        error: summary.results.promptB.error,
        durationMs: summary.results.promptB.durationMs,
        tokens: summary.results.promptB.tokens,
        costUsd: summary.results.promptB.costUsd,
      },
      null,
      2
    ),
    'utf-8'
  );

  // Save side-by-side.md for easy comparison
  const sideBySide = generateSideBySideMarkdown(config, summary);
  writeFileSync(join(runDir, 'side-by-side.md'), sideBySide, 'utf-8');

  // Save all-outputs.json (consolidated)
  const allOutputsPath = join(runDir, 'all-outputs.json');
  writeFileSync(
    allOutputsPath,
    JSON.stringify(
      {
        promptA: {
          name: summary.results.promptA.promptName,
          success: summary.results.promptA.success,
          output: summary.results.promptA.output,
          durationMs: summary.results.promptA.durationMs,
          costUsd: summary.results.promptA.costUsd,
        },
        promptB: {
          name: summary.results.promptB.promptName,
          success: summary.results.promptB.success,
          output: summary.results.promptB.output,
          durationMs: summary.results.promptB.durationMs,
          costUsd: summary.results.promptB.costUsd,
        },
      },
      null,
      2
    ),
    'utf-8'
  );

  return runDir;
}

// ============================================================================
// Print Summary
// ============================================================================

function printSummary(summary: PromptABTestSummary): void {
  const { promptA, promptB } = summary.results;

  console.log('\n========================================');
  console.log('Results Summary');
  console.log('========================================\n');

  console.log(`Total Duration: ${(summary.totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`Model: ${summary.config.model}`);
  console.log(`Both Succeeded: ${summary.comparison.bothSucceeded ? 'Yes' : 'No'}`);

  console.log('\n--- Prompt A: ' + promptA.promptName + ' ---\n');
  console.log(`  Status: ${promptA.success ? '✓ Success' : '✗ Failed'}`);
  console.log(`  Duration: ${(promptA.durationMs / 1000).toFixed(1)}s`);
  console.log(`  Cost: ${promptA.costUsd !== null ? '$' + promptA.costUsd.toFixed(4) : 'N/A'}`);
  console.log(`  Tokens: ${promptA.tokens.input} → ${promptA.tokens.output}`);
  if (promptA.error) {
    console.log(`  Error: ${promptA.error}`);
  }

  console.log('\n--- Prompt B: ' + promptB.promptName + ' ---\n');
  console.log(`  Status: ${promptB.success ? '✓ Success' : '✗ Failed'}`);
  console.log(`  Duration: ${(promptB.durationMs / 1000).toFixed(1)}s`);
  console.log(`  Cost: ${promptB.costUsd !== null ? '$' + promptB.costUsd.toFixed(4) : 'N/A'}`);
  console.log(`  Tokens: ${promptB.tokens.input} → ${promptB.tokens.output}`);
  if (promptB.error) {
    console.log(`  Error: ${promptB.error}`);
  }

  console.log('\n--- Comparison ---\n');
  console.log(
    `Faster Prompt: ${summary.comparison.fasterPrompt === 'tie' ? 'Tie' : 'Prompt ' + summary.comparison.fasterPrompt}`
  );
  console.log(`Time Difference: ${(summary.comparison.timeDifferenceMs / 1000).toFixed(1)}s`);
  console.log(`Cost Difference: $${summary.comparison.costDifferenceUsd.toFixed(4)}`);

  console.log('\n📝 Check the side-by-side.md file for easy comparison of outputs.');
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Find --config argument
  const configIndex = args.indexOf('--config');
  if (configIndex === -1 || !args[configIndex + 1]) {
    console.error('Usage: npx tsx scripts/prompt-ab-test.ts --config ./path/to/config.json');
    console.error('\n=== FORMAT 1: Shared user content, different system prompts ===');
    console.error(
      JSON.stringify(
        {
          testName: 'summarizer-comparison',
          model: 'google/gemini-3-flash-preview',
          promptA: {
            name: 'Old prompt',
            systemPrompt: 'You are an expert...',
          },
          promptB: {
            name: 'New prompt',
            systemPrompt: 'You are an expert...',
          },
          userContent: 'Create a summary of...',
          text: {
            format: {
              type: 'json_schema',
              name: 'response',
              schema: {
                type: 'object',
                properties: {
                  summary: { type: 'string' },
                },
                required: ['summary'],
              },
            },
          },
          temperature: 0.1,
          maxTokens: 8192,
        },
        null,
        2
      )
    );
    console.error('\n=== FORMAT 2: Full input arrays ===');
    console.error(
      JSON.stringify(
        {
          testName: 'full-comparison',
          model: 'google/gemini-3-flash-preview',
          promptA: {
            name: 'Prompt A',
            input: [
              { role: 'system', content: 'You are...' },
              { role: 'user', content: 'Your task...' },
            ],
          },
          promptB: {
            name: 'Prompt B',
            input: [
              { role: 'system', content: 'You are...' },
              { role: 'user', content: 'Your task...' },
            ],
          },
          temperature: 0.1,
          maxTokens: 8192,
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

  let config: PromptABTestConfig;
  try {
    const configContent = readFileSync(configPath, 'utf-8');
    config = JSON.parse(configContent);
  } catch (error) {
    console.error(`Failed to parse config file: ${error}`);
    process.exit(1);
  }

  // Validate config
  if (!config.model) {
    console.error('Config must include a model');
    process.exit(1);
  }

  if (!config.promptA || !config.promptB) {
    console.error('Config must include promptA and promptB');
    process.exit(1);
  }

  // Validate prompt definitions
  for (const [label, prompt] of [
    ['A', config.promptA],
    ['B', config.promptB],
  ] as const) {
    if (!prompt.name) {
      console.error(`Prompt ${label} must have a name`);
      process.exit(1);
    }
    if (!prompt.systemPrompt && !prompt.input?.length) {
      console.error(`Prompt ${label} must have either systemPrompt or input array`);
      process.exit(1);
    }
  }

  // If using simple format, ensure userContent is provided
  if (config.promptA.systemPrompt && !config.promptA.input && !config.userContent) {
    console.error('When using systemPrompt format, userContent is required');
    process.exit(1);
  }

  // Run test
  const summary = await runPromptABTest(config);

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
