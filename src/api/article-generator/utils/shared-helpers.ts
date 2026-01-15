import type { GameArticleDraft } from '../../../ai/articles/types';
import type { StoredCosts, StoredPlan, StoredSources } from '../types';

/**
 * Extract costs data from a draft for database storage.
 */
export function extractStoredCosts(draft: GameArticleDraft): StoredCosts {
  const meta = draft.metadata;
  const tokenUsage = meta.tokenUsage;
  const searchCosts = meta.searchApiCosts;

  // Build phase costs
  const phases: StoredCosts['phases'] = {
    scout: {
      model: draft.models.scout,
      durationMs: meta.phaseDurations.scout,
      tokens: tokenUsage?.scout ? { input: tokenUsage.scout.total.input, output: tokenUsage.scout.total.output } : undefined,
      costUsd: tokenUsage?.scout?.total.actualCostUsd,
    },
    editor: {
      model: draft.models.editor,
      durationMs: meta.phaseDurations.editor,
      tokens: tokenUsage?.editor ? { input: tokenUsage.editor.input, output: tokenUsage.editor.output } : undefined,
      costUsd: tokenUsage?.editor?.actualCostUsd,
    },
    specialist: {
      model: draft.models.specialist,
      durationMs: meta.phaseDurations.specialist,
      tokens: tokenUsage?.specialist ? { input: tokenUsage.specialist.input, output: tokenUsage.specialist.output } : undefined,
      costUsd: tokenUsage?.specialist?.actualCostUsd,
    },
  };

  // Add reviewer if it ran
  if (draft.models.reviewer && meta.phaseDurations.reviewer > 0) {
    phases.reviewer = {
      model: draft.models.reviewer,
      durationMs: meta.phaseDurations.reviewer,
      tokens: tokenUsage?.reviewer ? { input: tokenUsage.reviewer.input, output: tokenUsage.reviewer.output } : undefined,
      costUsd: tokenUsage?.reviewer?.actualCostUsd,
    };
  }

  // Add fixer if it ran (uses reviewer model, tokens included in reviewer totals)
  if (meta.phaseDurations.fixer && meta.phaseDurations.fixer > 0) {
    phases.fixer = {
      model: draft.models.reviewer ?? draft.models.specialist,
      durationMs: meta.phaseDurations.fixer,
    };
  }

  // Build cleaner costs
  const cleaner = tokenUsage?.cleaner ? {
    tokens: { input: tokenUsage.cleaner.total.input, output: tokenUsage.cleaner.total.output },
    costUsd: tokenUsage.cleaner.total.actualCostUsd,
  } : undefined;

  // Build search costs
  const search = searchCosts ? {
    ...(searchCosts.tavilySearchCount > 0 && { 
      tavily: { 
        queries: searchCosts.tavilySearchCount, 
        estimatedCostUsd: searchCosts.tavilyCostUsd 
      } 
    }),
    ...(searchCosts.exaSearchCount > 0 && { 
      exa: { 
        queries: searchCosts.exaSearchCount, 
        costUsd: searchCosts.exaCostUsd 
      } 
    }),
  } : undefined;

  return {
    generationId: meta.correlationId,
    totalDurationMs: meta.totalDurationMs,
    totalCostUsd: meta.totalEstimatedCostUsd,
    phases,
    cleaner,
    search,
    research: {
      queriesExecuted: meta.queriesExecuted,
      sourcesCollected: meta.sourcesCollected,
      confidence: meta.researchConfidence,
    },
    quality: {
      fixerIterations: meta.recovery?.fixerIterations ?? 0,
      issuesFixed: meta.recovery?.fixesApplied?.filter(f => f.success).length ?? 0,
      finalApproved: draft.reviewerApproved ?? true,
      remainingIssues: draft.reviewerIssues?.length ?? 0,
    },
    generatedAt: meta.generatedAt,
  };
}

/**
 * Extract plan from a draft for database storage.
 */
export function extractStoredPlan(draft: GameArticleDraft): StoredPlan {
  return {
    // NOTE: title is now from Metadata Agent output (draft.title), not plan
    title: draft.title,
    gameName: draft.plan.gameName,
    categorySlug: draft.plan.categorySlug,
    sections: draft.plan.sections.map(s => ({
      headline: s.headline,
      goal: s.goal,
      researchQueries: [...s.researchQueries],
      mustCover: [...s.mustCover],
    })),
    requiredElements: [...(draft.plan.requiredElements ?? [])],
  };
}

/**
 * Extract sources with domain analysis from a draft for database storage.
 */
export function extractStoredSources(sources: readonly string[]): StoredSources {
  const domainBreakdown: Record<string, number> = {};
  
  for (const source of sources) {
    try {
      const url = new URL(source);
      const domain = url.hostname.replace(/^www\./, '');
      domainBreakdown[domain] = (domainBreakdown[domain] || 0) + 1;
    } catch {
      // Invalid URL, skip
    }
  }
  
  const sortedDomains = Object.entries(domainBreakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([domain]) => domain);
  
  return {
    count: sources.length,
    uniqueDomains: sortedDomains.length,
    topDomains: sortedDomains.slice(0, 10),
    domainBreakdown,
    urls: [...sources],
  };
}
