import { describe, it, expect } from 'vitest';

import {
  countContentH2Sections,
  getContentH2Sections,
  parseMarkdownH2Sections,
  stripSourcesSection,
} from '../../../src/ai/articles/markdown-utils';

describe('markdown-utils', () => {
  it('parses H2 sections in order', () => {
    const md = `# Title

## First

Hello

## Second

World
`;

    const sections = parseMarkdownH2Sections(md);
    expect(sections.map((s) => s.heading)).toEqual(['First', 'Second']);
    expect(sections[0]?.content).toContain('Hello');
    expect(sections[1]?.content).toContain('World');
  });

  it('excludes "Sources" from content section counting', () => {
    const md = `# Title

## One

Content

## Sources
- https://example.com
`;

    expect(parseMarkdownH2Sections(md).length).toBe(2);
    expect(countContentH2Sections(md)).toBe(1);
    expect(getContentH2Sections(md).map((s) => s.heading)).toEqual(['One']);
  });

  it('stripSourcesSection removes the Sources block', () => {
    const md = `# Title

## One

Content

## Sources
- https://example.com/a
- https://example.com/b
`;

    const stripped = stripSourcesSection(md);
    expect(stripped).toContain('## One');
    expect(stripped).not.toMatch(/^##\s+Sources\s*$/m);
  });
});


