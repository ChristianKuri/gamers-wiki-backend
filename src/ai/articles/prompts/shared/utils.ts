/**
 * Detects the likely article type from the user instruction.
 * Used to tailor search queries and avoid irrelevant content.
 */
export function detectArticleIntent(instruction: string | null | undefined): 'guides' | 'reviews' | 'news' | 'lists' | 'general' {
  if (!instruction) return 'general';

  const lowerInstruction = instruction.toLowerCase();

  // Guide indicators
  if (
    lowerInstruction.includes('guide') ||
    lowerInstruction.includes('how to') ||
    lowerInstruction.includes('walkthrough') ||
    lowerInstruction.includes('tutorial') ||
    lowerInstruction.includes('tips') ||
    lowerInstruction.includes('beginner') ||
    lowerInstruction.includes('strategy') ||
    lowerInstruction.includes('build')
  ) {
    return 'guides';
  }

  // Review indicators
  if (
    lowerInstruction.includes('review') ||
    lowerInstruction.includes('opinion') ||
    lowerInstruction.includes('analysis') ||
    lowerInstruction.includes('worth') ||
    lowerInstruction.includes('critique')
  ) {
    return 'reviews';
  }

  // News indicators
  if (
    lowerInstruction.includes('news') ||
    lowerInstruction.includes('announcement') ||
    lowerInstruction.includes('update') ||
    lowerInstruction.includes('release') ||
    lowerInstruction.includes('launch')
  ) {
    return 'news';
  }

  // List indicators
  if (
    lowerInstruction.includes('best') ||
    lowerInstruction.includes('top') ||
    lowerInstruction.includes('ranking') ||
    lowerInstruction.includes('list') ||
    lowerInstruction.includes('compared')
  ) {
    return 'lists';
  }

  return 'general';
}
