/**
 * Test: Summarizer Model Comparison (using pre-cleaned DB content)
 *
 * Compares summary quality between different models using ALREADY CLEANED content
 * from the database. No cleaning step needed - just pure summarization comparison.
 *
 * Usage:
 *   npx tsx scripts/test-two-step-cleaner.ts
 */

import { config } from 'dotenv';
config();

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, Output } from 'ai';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

import { CLEANER_CONFIG } from '../src/ai/articles/config';
import { createTokenUsageFromResult, type TokenUsage } from '../src/ai/articles/types';
import { withRetry } from '../src/ai/articles/retry';

// ============================================================================
// Configuration
// ============================================================================

const TEST_CONFIG = {
  gameName: 'Clair Obscur: Expedition 33',
  // Models to compare for summarization
  summarizerModels: [
    'google/gemini-2.5-flash-lite',
    'google/gemini-3-flash-preview',
  ] as const,
  outputDir: 'tests/cleaner/e2e/results',
  // Pre-cleaned content from DB (source_contents id=742) - has detailed_summary!
  cleanedContent: {
    id: 742,
    url: 'https://game8.co/games/Clair-Obscur-Expedition-33/archives/514371',
    title: 'All Pictos and Luminas',
  },
  // DB historical summary for comparison
  dbSummary: {
    summary: 'This guide provides a comprehensive list of all Pictos and Luminas in Clair Obscur: Expedition 33, detailing their stats, costs, and effects.',
    detailedSummary: `Clair Obscur: Expedition 33 features a robust equipment system centered on Pictos and Luminas. Pictos are items that provide both passive stat bonuses (Speed, Critical Rate, Defense, and Health) and unique passive effects called Luminas. Each character can equip up to three Pictos at once. To 'Master' a Picto and unlock its Lumina for use by other characters without the Picto being equipped, a player must win 4 battles with that Picto active. Once mastered, the Lumina can be equipped using Lumina Points, which are equal to the character's current level.

The guide lists over 100 specific Pictos with diverse effects. For example, 'AP Discount' reduces skill costs by 1 AP but costs 30 Lumina Points to equip, while 'Cheater' allows a character to play twice in a row for a high cost of 40 points. Offensive Pictos like 'At Death's Door' provide a 50% damage boost when health is below 10%, and 'Augmented Counter III' increases counterattack damage by 75%. Defensive options include 'Anti-Burn' and 'Anti-Freeze' for status immunity, or 'Second Chance,' which revives a character with 100% health once per battle.

Upgrading Pictos is achieved by collecting duplicates found in the overworld, dropped by bosses, or purchased from Gestral Merchants using Chromas. Higher levels increase the substat bonuses provided by the Picto. The 1.5.0 update introduced a Lumina Sets feature, allowing players to save up to 50 different loadouts. New Game Plus (NG+) is noted as the most efficient way to level Pictos, as they carry over between playthroughs.`,
    keyFacts: [
      "Characters can equip a maximum of 3 Pictos at a time to gain stat bonuses and Lumina effects.",
      "Mastering a Picto requires winning 4 battles with it equipped, which unlocks its Lumina for other characters.",
      "Lumina Points are used to equip mastered effects; a character's total points equal their level.",
      "Pictos are upgraded by obtaining duplicates, which increases their level and substat values.",
      "The 1.5.0 update added the ability to save up to 50 different Lumina loadouts.",
      "Pictos can be obtained via overworld exploration, boss drops, or Gestral Merchants (some require winning a duel).",
      "The 'Painted Power' Picto allows damage to exceed the standard 9,999 cap."
    ],
    dataPoints: [
      "Patch 1.5.0", "50 loadouts", "4 battles to master", "3 Pictos max", "9,999 damage cap",
      "100% health (Second Chance)", "30 Lumina Points (AP Discount)", "40 Lumina Points (Cheater)",
      "50% damage (At Death's Door)", "75% counter damage (Augmented Counter III)",
      "100% Critical Rate (The One)", "600% damage (Feint)", "Chromas (currency)"
    ],
  },
  // Increased timeout for large content
  timeoutMs: 180000, // 3 minutes
};

// ============================================================================
// Enhanced Summary Schema (same as cleaner.ts)
// ============================================================================

const EnhancedSummarySchema = z.object({
  summary: z
    .string()
    .min(50)
    .max(500)
    .describe('A concise 2-3 sentence summary capturing the main topic and purpose of the content.'),
  detailedSummary: z
    .string()
    .min(500)
    .max(15000)
    .describe('A comprehensive 5-8 paragraph summary preserving ALL specific information.'),
  keyFacts: z
    .array(z.string())
    .min(3)
    .max(15)
    .describe('5-15 key facts as bullet points with concrete information.'),
  dataPoints: z
    .array(z.string())
    .min(0)
    .max(30)
    .describe('All specific data points: stats, names, numbers, etc.'),
  procedures: z
    .array(z.string())
    .min(0)
    .max(20)
    .describe('Step-by-step procedures or strategies mentioned.'),
  requirements: z
    .array(z.string())
    .min(0)
    .max(10)
    .describe('Prerequisites or requirements mentioned.'),
});

// ============================================================================
// Prompts (same as cleaner.ts enhanced summarizer)
// ============================================================================

function getEnhancedSummarySystemPrompt(): string {
  return `You are an expert summarizer for video game content. Your job is to create HIGHLY DETAILED and ACCURATE summaries.

Your summaries will be used by writers who may NOT read the original content. You must preserve ALL important information.

=== SUMMARY (2-3 sentences) ===
Capture:
- What type of content this is (guide, walkthrough, wiki, news)
- The main topic or subject
- The scope (e.g., "covers the entire Limgrave region" or "focuses on boss strategies")

=== DETAILED SUMMARY (5-8 paragraphs) ===
This is your most important output. Include:

PARAGRAPH 1: Overview
- What the content covers
- Who it's for (beginners, completionists, speedrunners)
- Overall structure of the content

PARAGRAPHS 2-6: Main Content (preserve EVERYTHING)
- Every major topic, section, or area covered
- ALL character names, NPC names, boss names mentioned
- ALL item names, weapon names, ability names
- ALL location names, area names, dungeon names
- ALL numbers: damage values, health pools, costs, distances, percentages
- ALL strategies, tactics, or tips provided
- ALL warnings, cautions, or things to avoid
- Specific step-by-step procedures when provided

PARAGRAPH 7-8: Additional Details
- Quest requirements or prerequisites
- Rewards and drops mentioned
- Related content or follow-up topics
- Version or patch information if mentioned

=== KEY FACTS (5-15 bullet points) ===
Each fact MUST be specific and actionable:
✓ "Margit has 4,174 HP and is weak to Bleed damage"
✓ "The Spirit Calling Bell is obtained from Renna at Church of Elleh at night"
✓ "Gatefront Ruins contains Map: Limgrave, West and the Whetstone Knife"
✓ "Tree Sentinel drops Golden Halberd (Str 30, Dex 14, Fai 12)"
✗ "There are many bosses in this area" (too vague)
✗ "The game has good combat" (not actionable)

=== DATA POINTS (exhaustive list) ===
Extract EVERY specific piece of data:
- Character/NPC names: "Melina", "Varré", "Renna", "Patches"
- Boss names: "Margit", "Godrick", "Tree Sentinel"
- Item names: "Flask of Crimson Tears", "Whetstone Knife"
- Location names: "Church of Elleh", "Gatefront Ruins", "Limgrave"
- Stats: "4,174 HP", "30 Strength", "2,000 Runes"
- Percentages: "50% damage reduction", "25% drop rate"

=== PROCEDURES (step-by-step) ===
Capture any procedural content:
- "1. Go to Church of Elleh at night 2. Speak to Renna 3. Receive Spirit Calling Bell"
- "To defeat Tree Sentinel: Use Torrent, stay at medium range, punish after charge attacks"

=== REQUIREMENTS ===
List any prerequisites:
- "Requires meeting Melina first"
- "Must have Stonesword Key"
- "Available after defeating Margit"`;
}

function getEnhancedSummaryUserPrompt(title: string, cleanedContent: string, gameName?: string): string {
  const gameContext = gameName 
    ? `\nGame: "${gameName}"` 
    : '';

  return `Create a HIGHLY DETAILED and ACCURATE summary of this video game content.

Writers will use your summary WITHOUT reading the original - include ALL important information.
${gameContext}

Title: ${title}
Content Length: ${cleanedContent.length} characters

=== CLEANED CONTENT ===
${cleanedContent}
=== END CONTENT ===

Extract:
1. summary: 2-3 sentence overview
2. detailedSummary: 5-8 paragraphs preserving ALL specific information
3. keyFacts: 5-15 specific, actionable facts with names and numbers
4. dataPoints: ALL names, numbers, stats, percentages mentioned
5. procedures: Any step-by-step instructions or strategies
6. requirements: Prerequisites and conditions

BE EXHAUSTIVE - Missing information means writers won't have it.`;
}

// ============================================================================
// Types
// ============================================================================

interface SummarizerTestResult {
  model: string;
  duration: number;
  cost: number;
  summary: string | null;
  detailedSummary: string | null;
  keyFactsCount: number;
  dataPointsCount: number;
  proceduresCount: number;
  requirementsCount: number;
  detailedSummaryLength: number;
  enhancedSummary: z.infer<typeof EnhancedSummarySchema> | null;
  tokenUsage: TokenUsage;
  error?: string;
}

// ============================================================================
// Fetch cleaned content from DB (embedded for test)
// ============================================================================

async function fetchCleanedContentFromDb(): Promise<string> {
  // This is the cleaned content from DB id=742 (30,107 chars)
  // Full Pictos and Luminas guide
  const cleanedContent = `# All Pictos and Luminas

Check our list of all the Pictos in Clair Obscur: Expedition 33, their Lumina points, Bonus Stats, Cost, and how to upgrade and get them, here!

## List of All Pictos and Luminas

### All Pictos, Stats, and Lumina Points

| Pictos | Details | Cost |
| :--- | :--- | :--- |
| Accelerating Heal | Lumina: Healing an ally also applies Rush for 1 turn. Type: Support. Bonus Stats: 329 Health, 65 Speed | 5 |
| Accelerating Last Stand | Lumina: Gain Rush if fighting alone. Type: Support. Bonus Stats: 168 Health, 34 Speed | 3 |
| Accelerating Shots | Lumina: 20% chance to gain Rush on Free Aim shot. Type: Support. Bonus Stats: Health, Defense | 3 |
| Accelerating Tint | Lumina: Healing Tints also apply Rush. Type: Support. Bonus Stats: Health, Speed | 5 |
| Aegis Revival | Lumina: +1 Shield on being revived. Type: Defensive. Bonus Stats: Defense, Speed | 5 |
| Alternating Critical | Lumina: On Critical hit, 100% increased damage of the next non-Critical hit. Type: Offensive. Bonus Stats: 293 Speed, 50% Critical Rate | 10 |
| Anti-Blight | Lumina: Immune to Blight. Type: Defensive. Bonus Stats: Health, Defense | 10 |
| Anti-Burn | Lumina: Immune to Burn. Type: Defensive. Bonus Stats: Health, Defense | 15 |
| Anti-Charm | Lumina: Immune to Charm. Type: Defensive. Bonus Stats: 599 Health, 240 Defense | 10 |
| Anti-Freeze | Lumina: Immune to Freeze. Type: Defensive. Bonus Stats: Health, Defense | 15 |
| Anti-Stun | Lumina: Immune to Stun. Type: Defensive. Bonus Stats: Health, Defense | 5 |
| AP Discount | Lumina: Skills cost 1 less AP. Type: Support. Bonus Stats: 1,055 Speed | 30 |
| At Death's Door | Lumina: Deal 50% more damage if Health is below 10%. Type: Offensive. Bonus Stats: 96 Defense, 11% Critical Rate | 5 |
| Attack Lifesteal | Lumina: Recover 15% Health on Base Attack. Type: Defensive. Bonus Stats: 44 Health, 32 Speed | 15 |
| Augmented Aim | Lumina: 50% increased Free Aim damage. Type: Offensive. Bonus Stats: 39 Speed, 5% Critical Rate | 3 |
| Augmented Attack | Lumina: 50% increased Base Attack damage. Type: Offensive. Bonus Stats: 8 Defense, 10 Speed | 7 |
| Augmented Counter I | Lumina: 25% increased Counterattack damage. Type: Offensive. Bonus Stats: 90 Health, 4% Critical Rate | 3 |
| Augmented Counter II | Lumina: 50% increased Counterattack damage. Type: Offensive. Bonus Stats: 208 Defense, 15% Critical Rate | 5 |
| Augmented Counter III | Lumina: 75% increased Counterattack damage. Type: Offensive. Bonus Stats: Defense, Critical Rate | 7 |
| Augmented First Strike | Lumina: 50% increased damage on the first hit. Once per battle. Type: Offensive. Bonus Stats: 51 Speed, 5% Critical Rate | 5 |
| Auto Death | Lumina: Kill self on battle start. Type: Support. Bonus Stats: 26% Critical Rate | 1 |
| Auto Powerful | Lumina: Apply Powerful for 3 turns on battle start. Type: Support. Bonus Stats: Speed, Critical Rate | 10 |
| Auto Regen | Lumina: Apply Regen for 3 turns on battle start. Type: Defensive. Bonus Stats: 479 Defense, Critical Rate | 10 |
| Auto Rush | Lumina: Apply Rush for 3 turns on battle start. Type: Offensive. Bonus Stats: 112 Speed, 7% Critical Rate | 10 |
| Auto Shell | Lumina: Apply Shell for 3 turns on battle start. Type: Defensive. Bonus Stats: 411 Health | 10 |
| Base Shield | Lumina: +1 Shield if not affected by any Shield on turn start. Type: Defensive. Bonus Stats: Speed, Critical Rate | 20 |
| Beneficial Contamination | Lumina: +2 AP on applying a Status Effect. Once per turn. Type: Support. Bonus Stats: Defense, Speed | 15 |
| Break Specialist | Lumina: Break damage is increased by 50%, but base damage is reduced by 20%. Type: Support. Bonus Stats: Health, Speed | 1 |
| Breaker | Lumina: 25% increased Break damage. Type: Offensive. Bonus Stats: 26 Speed, 9% Critical Rate | 10 |
| Breaking Attack | Lumina: Base Attack can Break. Type: Offensive. Bonus Stats: Speed, Critical Rate | 10 |
| Cheater | Lumina: Always play twice in a row. Type: Support. Bonus Stats: 1198 Health, 400 Speed | 40 |
| Clea's Death | Lumina: On death, allies gain 25% increased damage until they die. Type: Offensive. Bonus Stats: 726 Speed, 37% Critical Rate | 15 |
| Clea's Life | Lumina: On turn start, if no damage taken since last turn, recover 100% Health. Type: Defensive. Bonus Stats: Health | 30 |
| Cleansing Tint | Lumina: Healing Tints also remove all Status Effects from the target. Type: Support. Bonus Stats: 35 Health, 6 Defense | 5 |
| Combo Attack I | Lumina: Base Attack has 1 extra hit. Type: Offensive. Bonus Stats: 93 Speed, 6% Crit Rate | 10 |
| Combo Attack II | Lumina: Base Attack has 1 extra hit. Type: Offensive. Bonus Stats: 836 Speed, 16% Critical Rate | 20 |
| Combo Attack III | Lumina: Base Attack has 1 extra hit. Type: Offensive. Bonus Stats: 619 Speed, 14% Critical Rate | 40 |
| Confident | Lumina: Take 50% less damage, but can't be Healed. Type: Defensive. Bonus Stats: 41 Speed, 10% Crit Rate | 20 |
| Confident Fighter | Lumina: 30% increased damage, but can't be Healed. Type: Offensive. Bonus Stats: 222 Health, 20% Crit Rate | 15 |
| Consuming Attack | Lumina: Base attack consumes up to 100 Burns to deal 10% more damage per Burn consumed. Type: Offensive. Bonus Stats: 836 Speed, 16% Critical Rate | 10 |
| Critical Burn | Lumina: 25% increased Critical Chance on Burning enemies. Type: Offensive. Bonus Stats: 8 Speed, 6% Critical Rate | 5 |
| Damage Share | Lumina: 50% damage taken is redirected to other allies (if possible). Type: Defensive. Bonus Stats: 2,612 Health, 1,489 Defense | 30 |
| Dead Energy I | Lumina: +3 AP on killing an enemy. Type: Support. Bonus Stats: 162 Speed, 17% Crit Rate | 2 |
| Dead Energy II | Lumina: +3 AP on killing an enemy. Type: Support. Bonus Stats: 4 Speed, 9% Critical Rate | 2 |
| Death Bomb | Lumina: On Death, deal damage to all enemies. Type: Offensive. Bonus Stats: 43 Speed, 10% Crit Rate | 5 |
| Dodger | Lumina: Gain 1 AP on Perfect Dodge. Once per turn. Type: Support. Bonus Stats: 12 Speed, 3% Critical Rate | 1 |
| Double Burn | Lumina: On applying a Burn stack, apply a second one. Type: Offensive/Support. Bonus Stats: 132 Speed, 7% Crit Rate | 30 |
| Double Mark | Lumina: Mark requires 1 more hit to be removed. Type: Support. Bonus Stats: 236 Speed | 20 |
| Double Third | Lumina: Every third hit of a Skill deals double damage. Type: Offensive. Bonus Stats: 2,757 Health, 279 Speed, 16% Critical Rate | 10 |
| Energy Master | Lumina: Every AP gain is increased by 1. Type: Support. Bonus Stats: 4,970 Health | 40 |
| Feint | Lumina: Start each turn with 4 Barbapapa stacks. Every 5th hit with a Skill deals 600% more damage. Type: Offensive. Bonus Stats: 66% Critical Rate | 15 |
| First Life | Lumina: 25% increased damage until death. 20% decreased damage on death. (Once). Type: Offensive. Bonus Stats: 4,722 Defense | 15 |
| First Strike | Lumina: Play first. Type: Support. Bonus Stats: 41 Speed, 10% Crit Rate | 10 |
| Frenzy | Lumina: Each successive Skill hit deals 10% more damage. Type: Offensive. Bonus Stats: 1,572 Defense, 557 Speed | 20 |
| Glass Canon | Lumina: Deal 25% more damage, but take 25% more damage. Type: Offensive. Bonus Stats: 175 Speed | 10 |
| Gradient Overcharge | Lumina: On turn start, consume 3 Gradient Charges (if able) to deal 200% more damage this turn. Type: Offensive. Bonus Stats: 5,514 Health | 15 |
| Gradient Parry | Lumina: +5% of a gradient charge on Parry. Type: Support. Bonus Stats: 557 Speed, 32% Critical Rate | 10 |
| Longer Break | Lumina: Breaks last 1 more turn but the target can't be Broken twice. Type: Offensive. Bonus Stats: 2,757 Health, 786 Defense, 279 Speed | 10 |
| Painted Power | Lumina: Damage can exceed 9,999. Type: Offensive. Bonus Stats: 1,844 Health | 5 |
| Pro Retreat | Lumina: Allows Flee to be instantaneous. Type: Support. Bonus Stats: 2,485 Health, 503 Speed | 40 |
| Recovery | Lumina: Recovers 10% Health on turn start. Type: Defensive. Bonus Stats: 2,000 Health, 324 Defense | 10 |
| Second Chance | Lumina: Revive with 100% Health. Once per battle. Type: Defensive. Bonus Stats: 1,107 Health, 8% Critical Rate | 40 |
| SOS Healing Tint | Lumina: Consume a Healing Tint when falling below 50% Health. Type: Defensive. Bonus Stats: 1,572 Defense | 10 |
| Survivor | Lumina: Survive fatal damage with 1 Health. Once per battle. Type: Defensive. Bonus Stats: 439 Speed, 12% Critical Rate | 20 |
| The One | Lumina: Max Health is reduced to 1. Type: Support. Bonus Stats: 108% Critical Rate | 1 |
| Trigger-Happy | Lumina: After shooting 10 times in the same turn, gain +2 AP (once). And following Shots this turn deal 200% more damage. Type: Offensive. Bonus Stats: 1,114 Speed | 20 |

## Lumina Sets Feature Guide

### Save Up to 50 Different Loadouts
With the 1.5.0 update, you can now save up to 50 different Lumina loadouts for adapting to plenty of different fighting tactics at any moment.

## How to Upgrade Pictos

### Duplicates Level Up Pictos
You can upgrade Pictos by obtaining their duplicates, which effectively increases their level and substats. This is crucial when it comes to optimizing your characters' utility and damage potential, as the substats gained from Pictos increase alongside its level.

You can get dupes from overworld exploration, or directly from Merchants! Going into New Game+ is the easiest way to level your as you keep your Pictos in NG+.

## How to Unlock Lumina of Pictos

### Win 4 Battles to Unlock Luminas
You can unlock the Lumina of any Pictos by winning 4 battles using it, otherwise known as Mastering it. All mastered Pictos will have their Luminas unlocked, letting your other characters equip its passive effect using Lumina Points! You can check if you've mastered your Pictos if their icons are colored!

Keep in mind, however, that your other characters can only equip the passive effects of your mastered Pictos, and not their substat bonuses!

## What Are Luminas and Pictos?

### Pictos Are Equipment That Grant Buffs
Pictos is a type of equipment that your characters can equip to gain bonus stats and a passive effect called Lumina. Pictos also get better stats the higher their level.

Each character can only equip a maximum of 3 Pictos, so players will have to decide carefully which Pictos benefit their characters more.

#### List of Bonus Stats Available
- Speed
- Critical Rate%
- Defense
- Health

### Lumina Uses Points to Grant Effects
Over time during the course of the game, characters can learn a Picto's Lumina as long as they have it equipped. Once learned, players can use these Luminas in other characters without needing to equip the corresponding Picto but at the cost of using Lumina Points.

The amount of Lumina Points your characters will have will be equal to their level. If you want to equip more Luminas, you'll need to level up your characters.

## How to Get Pictos and Luminas

### Ways to Get Pictos and Their Luminas
1. Purchased From Gestral Merchants: Bought using Chromas. Some require winning a fight against the merchant first.
2. Obtained as a Drop From Enemies: Defeating Bosses or certain enemies.
3. Found by Exploring the Area: Picked up on the ground during progression.`;

  return cleanedContent;
}

// ============================================================================
// Main Test
// ============================================================================

async function main() {
  console.log('\n🧪 SUMMARIZER MODEL COMPARISON TEST');
  console.log('='.repeat(70));
  console.log('📌 Using PRE-CLEANED content from database (no cleaning step)');

  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY not set');
  }

  const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

  // Get pre-cleaned content
  const cleanedContent = await fetchCleanedContentFromDb();
  console.log(`\n📄 Source: ${TEST_CONFIG.cleanedContent.title}`);
  console.log(`   URL: ${TEST_CONFIG.cleanedContent.url}`);
  console.log(`   Cleaned content: ${cleanedContent.length.toLocaleString()} chars`);

  // ========================================================================
  // Run summarizer tests in parallel
  // ========================================================================
  console.log('\n📌 Testing summarizer models on SAME cleaned content...');
  console.log(`   Models: ${TEST_CONFIG.summarizerModels.join(', ')}`);
  console.log(`   Timeout: ${TEST_CONFIG.timeoutMs / 1000}s`);

  const results: SummarizerTestResult[] = await Promise.all(
    TEST_CONFIG.summarizerModels.map(async (model) => {
      console.log(`   ⏳ Started: ${model}`);
      const start = Date.now();

      try {
        const result = await withRetry(
          async () => {
            const timeoutSignal = AbortSignal.timeout(TEST_CONFIG.timeoutMs);
            return generateText({
              model: openrouter(model),
              output: Output.object({
                schema: EnhancedSummarySchema,
              }),
              temperature: CLEANER_CONFIG.TEMPERATURE,
              abortSignal: timeoutSignal,
              system: getEnhancedSummarySystemPrompt(),
              prompt: getEnhancedSummaryUserPrompt(
                TEST_CONFIG.cleanedContent.title,
                cleanedContent,
                TEST_CONFIG.gameName
              ),
            });
          },
          {
            context: `Summarizer test: ${model}`,
          }
        );

        const duration = Date.now() - start;
        const tokenUsage = createTokenUsageFromResult(result);
        const output = result.output;

        console.log(`   ✅ ${model}: ${(duration / 1000).toFixed(1)}s, $${tokenUsage.actualCostUsd?.toFixed(6) ?? '?'}`);
        
        return {
          model,
          duration,
          cost: tokenUsage.actualCostUsd ?? 0,
          summary: output.summary,
          detailedSummary: output.detailedSummary,
          keyFactsCount: output.keyFacts.length,
          dataPointsCount: output.dataPoints.length,
          proceduresCount: output.procedures.length,
          requirementsCount: output.requirements.length,
          detailedSummaryLength: output.detailedSummary.length,
          enhancedSummary: output,
          tokenUsage,
        };
      } catch (err) {
        const duration = Date.now() - start;
        const message = err instanceof Error ? err.message : String(err);
        console.log(`   ❌ ${model}: ${message}`);
        return {
          model,
          duration,
          cost: 0,
          summary: null,
          detailedSummary: null,
          keyFactsCount: 0,
          dataPointsCount: 0,
          proceduresCount: 0,
          requirementsCount: 0,
          detailedSummaryLength: 0,
          enhancedSummary: null,
          tokenUsage: { input: 0, output: 0 },
          error: message,
        };
      }
    })
  );

  // ========================================================================
  // Comparison Table (including DB historical)
  // ========================================================================
  console.log('\n📊 SUMMARIZER COMPARISON (including DB historical)');
  console.log('='.repeat(90));

  const successResults = results.filter(r => !r.error);
  const db = TEST_CONFIG.dbSummary;
  
  console.log(`
| Metric               | DB (gemini-3 historical)     | ${successResults[0]?.model.padEnd(26) ?? 'N/A'} | ${successResults[1]?.model.padEnd(26) ?? 'N/A'} |
|----------------------|------------------------------|------------------------------|------------------------------|
| Summary Length       | ${db.summary.length.toString().padEnd(26)} | ${(successResults[0]?.summary?.length ?? 0).toString().padEnd(26)} | ${(successResults[1]?.summary?.length ?? 0).toString().padEnd(26)} |
| Detailed Summary Len | ${db.detailedSummary.length.toLocaleString().padEnd(26)} | ${(successResults[0]?.detailedSummaryLength ?? 0).toLocaleString().padEnd(26)} | ${(successResults[1]?.detailedSummaryLength ?? 0).toLocaleString().padEnd(26)} |
| Key Facts            | ${db.keyFacts.length.toString().padEnd(26)} | ${(successResults[0]?.keyFactsCount ?? 0).toString().padEnd(26)} | ${(successResults[1]?.keyFactsCount ?? 0).toString().padEnd(26)} |
| Data Points          | ${db.dataPoints.length.toString().padEnd(26)} | ${(successResults[0]?.dataPointsCount ?? 0).toString().padEnd(26)} | ${(successResults[1]?.dataPointsCount ?? 0).toString().padEnd(26)} |
| Procedures           | N/A                          | ${(successResults[0]?.proceduresCount ?? 0).toString().padEnd(26)} | ${(successResults[1]?.proceduresCount ?? 0).toString().padEnd(26)} |
| Requirements         | N/A                          | ${(successResults[0]?.requirementsCount ?? 0).toString().padEnd(26)} | ${(successResults[1]?.requirementsCount ?? 0).toString().padEnd(26)} |
| Cost                 | (historical)                 | $${(successResults[0]?.cost ?? 0).toFixed(6).padEnd(23)} | $${(successResults[1]?.cost ?? 0).toFixed(6).padEnd(23)} |
| Duration             | (historical)                 | ${((successResults[0]?.duration ?? 0) / 1000).toFixed(1)}s                        | ${((successResults[1]?.duration ?? 0) / 1000).toFixed(1)}s                        |
`);

  // Cost comparison
  if (successResults.length >= 2 && successResults[0].cost > 0) {
    const costDiff = ((successResults[1].cost - successResults[0].cost) / successResults[0].cost * 100).toFixed(1);
    console.log(`💰 Cost: ${successResults[1].model} is ${Math.abs(parseFloat(costDiff))}% ${parseFloat(costDiff) > 0 ? 'more expensive' : 'cheaper'} than ${successResults[0].model}`);
  }

  // ========================================================================
  // DB Historical Summary Display
  // ========================================================================
  console.log('\n' + '='.repeat(90));
  console.log('MODEL: DB HISTORICAL (gemini-3-flash-preview)');
  console.log('='.repeat(90));
  
  console.log(`\n📋 SUMMARY (${db.summary.length} chars):`);
  console.log(db.summary);
  
  console.log(`\n📖 DETAILED SUMMARY (${db.detailedSummary.length.toLocaleString()} chars):`);
  console.log(db.detailedSummary);
  
  console.log(`\n✅ KEY FACTS (${db.keyFacts.length}):`);
  db.keyFacts.forEach((fact, i) => console.log(`  ${i + 1}. ${fact}`));
  
  console.log(`\n📊 DATA POINTS (${db.dataPoints.length}):`);
  db.dataPoints.forEach((dp, i) => console.log(`  ${i + 1}. ${dp}`));

  // ========================================================================
  // Detailed Summary Comparison
  // ========================================================================
  console.log('\n📝 DETAILED SUMMARY QUALITY COMPARISON');
  console.log('='.repeat(70));

  for (const result of successResults) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`MODEL: ${result.model}`);
    console.log(`${'='.repeat(70)}`);
    
    console.log(`\n📋 SUMMARY (${result.summary?.length ?? 0} chars):`);
    console.log(result.summary ?? 'N/A');
    
    console.log(`\n📖 DETAILED SUMMARY (${result.detailedSummaryLength.toLocaleString()} chars):`);
    console.log(result.detailedSummary ?? 'N/A');
    
    console.log(`\n✅ KEY FACTS (${result.keyFactsCount}):`);
    result.enhancedSummary?.keyFacts.forEach((fact, i) => console.log(`  ${i + 1}. ${fact}`));
    
    console.log(`\n📊 DATA POINTS (${result.dataPointsCount}):`);
    result.enhancedSummary?.dataPoints.forEach((dp, i) => console.log(`  ${i + 1}. ${dp}`));
    
    console.log(`\n📝 PROCEDURES (${result.proceduresCount}):`);
    result.enhancedSummary?.procedures.forEach((proc, i) => console.log(`  ${i + 1}. ${proc}`));
    
    console.log(`\n⚠️ REQUIREMENTS (${result.requirementsCount}):`);
    result.enhancedSummary?.requirements.forEach((req, i) => console.log(`  ${i + 1}. ${req}`));
  }

  // ========================================================================
  // Save Results
  // ========================================================================
  const outputDir = path.resolve(TEST_CONFIG.outputDir);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(outputDir, `summarizer-comparison-${timestamp}.json`);
  
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    source: TEST_CONFIG.cleanedContent,
    cleanedContentLength: cleanedContent.length,
    results: results.map(r => ({
      ...r,
      enhancedSummary: r.enhancedSummary ?? null,
    })),
  }, null, 2));

  console.log(`\n📄 Results saved to: ${outputPath}`);
  console.log('\n✅ Test complete!');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
