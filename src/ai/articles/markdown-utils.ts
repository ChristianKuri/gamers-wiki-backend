export interface MarkdownH2Section {
  readonly heading: string;
  readonly content: string;
}

function normalizeHeading(heading: string): string {
  return heading.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function isSourcesSectionHeading(heading: string): boolean {
  return normalizeHeading(heading) === 'sources';
}

/**
 * Parses "## " sections from markdown in a simple, predictable way.
 *
 * - Only looks for H2 headings that start a line: `## `
 * - Keeps section order as it appears
 * - Does not attempt full markdown parsing (good enough for our controlled output)
 */
export function parseMarkdownH2Sections(markdown: string): MarkdownH2Section[] {
  const lines = markdown.split('\n');

  const sections: MarkdownH2Section[] = [];
  let currentHeading: string | undefined;
  let currentContent: string[] = [];

  const pushIfAny = () => {
    if (!currentHeading) return;
    sections.push({
      heading: currentHeading,
      content: currentContent.join('\n').trim(),
    });
  };

  for (const line of lines) {
    if (line.startsWith('## ')) {
      pushIfAny();
      currentHeading = line.slice(3).trim();
      currentContent = [];
      continue;
    }

    if (currentHeading) {
      currentContent.push(line);
    }
  }

  pushIfAny();
  return sections;
}

export function getContentH2Sections(markdown: string): MarkdownH2Section[] {
  return parseMarkdownH2Sections(markdown).filter((s) => !isSourcesSectionHeading(s.heading));
}

export function countContentH2Sections(markdown: string): number {
  return getContentH2Sections(markdown).length;
}

/**
 * Removes the Sources section (if present) so content-quality checks don't get
 * tripped by URLs and boilerplate.
 */
export function stripSourcesSection(markdown: string): string {
  const idx = markdown.search(/^##\s+Sources\s*$/mi);
  if (idx === -1) return markdown;
  return markdown.slice(0, idx).trimEnd();
}


