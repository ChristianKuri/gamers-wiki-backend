# PR #10: Image Curation System - Complete Technical Documentation

## Overview

PR #10 introduces a comprehensive **Image Curation System** for the Gamers Wiki article generation pipeline. This system automatically selects, validates, processes, and inserts images into AI-generated articles with a focus on quality, relevance, and proper attribution.

**Key Statistics:**
- 51 files changed
- +14,316 lines added / -413 lines removed
- 14 new test files

---

## Architecture

The system follows a multi-stage pipeline:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           IMAGE PHASE PIPELINE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────────────────────┐ │
│  │ Image Pool  │───▶│ Image Curator│───▶│ Candidate Processor             │ │
│  │ (Aggregate) │    │   (LLM)      │    │ (Dimension + Quality Validation)│ │
│  └─────────────┘    └──────────────┘    └─────────────────────────────────┘ │
│        │                                           │                        │
│        ▼                                           ▼                        │
│  ┌─────────────┐                        ┌─────────────────────────────────┐ │
│  │   Sources:  │                        │ Image Processing (Sharp)        │ │
│  │  • IGDB     │                        │ • Hero: 1280x720 WebP           │ │
│  │  • Tavily   │                        │ • Sections: Max 800px WebP      │ │
│  │  • Exa      │                        └─────────────────────────────────┘ │
│  │  • Source   │                                   │                        │
│  │    Articles │                                   ▼                        │
│  └─────────────┘                        ┌─────────────────────────────────┐ │
│                                         │ Strapi Upload                   │ │
│                                         │ • Media Library integration     │ │
│                                         │ • Folder organization           │ │
│                                         │ • Attribution metadata          │ │
│                                         └─────────────────────────────────┘ │
│                                                    │                        │
│                                                    ▼                        │
│                                         ┌─────────────────────────────────┐ │
│                                         │ Markdown Inserter               │ │
│                                         │ • H2 header matching            │ │
│                                         │ • Caption/alt text              │ │
│                                         └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Image Pool System (`image-pool.ts`)

### Purpose
Aggregates images from multiple sources into a unified pool for the curator to select from.

### Image Sources

| Source | Priority | Description |
|--------|----------|-------------|
| `igdb` | Highest | Official screenshots, artworks, covers from IGDB API |
| `source` | Medium | Images extracted from cleaned source articles |
| `tavily` | Lower | Images from Tavily web search results |
| `exa` | Lower | Images from Exa semantic search results |

### Source Quality Scoring (Tiebreaker)
```typescript
const SOURCE_QUALITY = {
  IGDB_ARTWORK: 100,      // Best: official promotional art
  IGDB_SCREENSHOT: 80,    // Official in-game screenshots
  SOURCE_HIGH_QUALITY: 65, // Images from high-quality gaming sites
  IGDB_COVER: 60,         // Box art/cover images
  SOURCE_DEFAULT: 55,     // Default for extracted source images
  WEB_HIGH_QUALITY: 50,   // Images from known gaming domains
  WEB_DEFAULT: 40,        // Generic web images
  SOURCE_LOW_QUALITY: 35, // Images from reddit, tumblr, etc.
  WEB_LOW_QUALITY: 20,    // Low-quality web sources
};
```

### High-Quality Gaming Domains
```typescript
HIGH_QUALITY_DOMAINS: [
  'ign.com', 'gamespot.com', 'polygon.com', 'kotaku.com',
  'eurogamer.net', 'pcgamer.com', 'rockpapershotgun.com',
  'gamesradar.com', 'fextralife.com', 'game8.co', 'gamewith.net',
  'neoseeker.com', 'gematsu.com', 'pushsquare.com',
  'nintendolife.com', 'dualshockers.com',
]
```

### URL Filtering Logic
Images are filtered out if they match:
- **Excluded domains**: Pinterest, Facebook, Twitter, Instagram, TikTok, LinkedIn
- **File patterns**: `.svg`, `.gif`, tracking pixels, ad images
- **Path patterns**: `/icon`, `/favicon`, `/sprites/`, `/avatar`, `/thumbs/`
- **Small dimensions in URL**: `w=50`, `h=99` (below 200px threshold)
- **Video thumbnails**: `ytimg.com`

### Key Functions
- `addIGDBImages(pool, screenshots, artworks, cover)`: Adds official game images
- `addWebImages(pool, images, query, source)`: Adds Tavily/Exa images
- `addSourceImages(pool, images, sourceUrl, domain)`: Adds extracted source images
- `getImagesForSection(pool, limit)`: Returns candidates for LLM evaluation

---

## 2. Image Curator Agent (`agents/image-curator.ts`)

### Purpose
AI agent that selects the most relevant images for each article section using text-based relevance scoring.

### Configuration
```typescript
IMAGE_CURATOR_CONFIG = {
  ENABLED_BY_CATEGORY: { guides: true, reviews: true, news: true, lists: true },
  MAX_IMAGES_PER_ARTICLE: 6,
  TEXT_CANDIDATES_PER_SECTION: 30,  // Candidates sent to LLM
  TEXT_TOP_RESULTS: 5,              // Top results after LLM scoring
  SECTION_CURATOR_CONCURRENCY: 3,   // Max concurrent LLM calls
  TEMPERATURE: 0.2,                  // Low for consistent selection
  TIMEOUT_MS: 60000,
  PHASE_TIMEOUT_MS: 120000,
  UPLOAD_CONCURRENCY: 3,
}
```

### Output Schema
```typescript
interface ImageCuratorOutput {
  heroCandidates: HeroCandidateOutput[];      // Ranked hero candidates
  sectionSelections: SectionSelectionOutput[]; // Section → ranked candidates
  tokenUsage: TokenUsage;
}

interface HeroCandidateOutput {
  image: CollectedImage;
  altText: string;        // SEO-optimized alt text
  relevanceScore: number; // 0-100
  reasoning: string;      // Why this image was selected
}

interface SectionSelectionOutput {
  sectionHeadline: string;
  sectionIndex: number;
  candidates: SectionCandidateOutput[];
}
```

### Selection Strategy
1. **Hero Image**: Selects from all pool images, prioritizing:
   - Visual impact for featured display
   - Relevance to article title
   - Official IGDB artwork/screenshots

2. **Section Images**: For each H2 section:
   - Matches images to section content
   - Considers `sourceQuery` and `nearestHeader` metadata
   - Returns ranked candidates (curator doesn't download, just ranks)

---

## 3. Image Quality Checker Agent (`agents/image-quality-checker.ts`)

### Purpose
Vision-based AI validation for watermarks and image clarity using LLM vision capabilities.

### Configuration
```typescript
IMAGE_QUALITY_VALIDATION_CONFIG = {
  ENABLED: false,           // Off for sections (expensive)
  ENABLED_FOR_HERO: true,   // On for hero (most important image)
  MAX_CANDIDATES_PER_SECTION: 3,
  MIN_CLARITY_SCORE: 50,    // 0-100 scale
  MODEL_ID: 'google/gemini-2.5-flash-lite',
  TEMPERATURE: 0.1,
  TIMEOUT_MS: 30000,
}
```

### Validation Output
```typescript
interface ImageQualityResult {
  hasWatermark: boolean;   // Stock photo watermarks, site logos
  clarityScore: number;    // 0-100 (blur, compression artifacts)
  passed: boolean;         // No watermark AND clarity >= MIN_CLARITY_SCORE
  reasoning: string;       // LLM explanation
}
```

### Hero Validation Flow
When `ENABLED_FOR_HERO: true`:
1. Dimension validation passes first
2. Image buffer sent to vision LLM
3. If watermark detected → try next candidate
4. If clarity too low → try next candidate
5. Continue until valid candidate or exhausted

---

## 4. Image Candidate Processor (`services/image-candidate-processor.ts`)

### Purpose
Downloads and validates candidate images for dimensions, selecting the first valid image per slot.

### Key Features
- **Download-Once Pattern**: Downloads image once, reuses buffer for validation + upload
- **IGDB Dimension Inference**: Skips download for known IGDB size tokens
- **Cross-Section Deduplication**: Hero image excluded from section selection

### Configuration
```typescript
IMAGE_DIMENSION_CONFIG = {
  HERO_MIN_WIDTH: 800,          // Hero images must be >= 800px wide
  SECTION_MIN_WIDTH: 500,       // Section images >= 500px
  MAX_HERO_CANDIDATES: 10,
  MAX_SECTION_CANDIDATES: 3,
  DIMENSION_PROBE_TIMEOUT_MS: 15000,
  DIMENSION_PROBE_RETRIES: 1,
}
```

### IGDB Size Token Mapping
```typescript
IGDB_SIZE_MAP = {
  't_1080p': { width: 1920, height: 1080 },
  't_720p': { width: 1280, height: 720 },
  't_screenshot_huge': { width: 1280, height: 720 },
  't_screenshot_big': { width: 889, height: 500 },
  't_cover_big': { width: 264, height: 374 },
  // ... more sizes
}
```

### Processing Flow
```typescript
// Hero processing with quality validation
async function processHeroCandidates(candidates, options):
  for each candidate:
    1. If IGDB with known size → infer dimensions (no download)
    2. Download image
    3. Validate dimensions with Sharp
    4. If qualityValidator provided → run watermark/clarity check
    5. Return first valid with buffer for upload

// Section processing
async function processAllSectionCandidates(selections, options):
  for each section (sequential to accumulate exclusions):
    1. Skip if URL already used (hero or previous section)
    2. Download and validate dimensions
    3. Add selected URL to exclusion set
    4. Return with buffer for upload
```

---

## 5. Image Downloader (`services/image-downloader.ts`)

### Purpose
Secure image downloading with SSRF protection and retry logic.

### Security Features

#### SSRF Protection (`url-validator.ts`)
```typescript
// Blocked IP ranges:
- 10.x.x.x (Private)
- 172.16-31.x.x (Private)
- 192.168.x.x (Private)
- 169.254.x.x (Link-local, includes AWS metadata)
- 127.x.x.x (Loopback)
- 0.x.x.x (Current network)
- localhost, ::1
- metadata.google.internal (GCP metadata)

// Protocol requirements:
- HTTPS required for untrusted domains
- HTTP allowed only for: images.igdb.com
```

#### Magic Byte Validation
```typescript
const IMAGE_MAGIC_BYTES = {
  'image/jpeg': [0xFF, 0xD8, 0xFF],
  'image/png': [0x89, 0x50, 0x4E, 0x47],
  'image/gif': [0x47, 0x49, 0x46],
  'image/webp': [0x52, 0x49, 0x46, 0x46], // RIFF + WEBP check
};
```

#### Manual Redirect Handling
Redirects are handled manually (not followed automatically) to:
1. Validate each redirect URL for SSRF
2. Limit redirect chain depth (default: 5)
3. Prevent redirect loops

### Configuration
```typescript
IMAGE_DOWNLOADER_CONFIG = {
  USER_AGENT: 'GamersWiki/1.0 (Article Image Generator; +https://gamers.wiki)',
  TIMEOUT_MS: 30000,
  MAX_SIZE_BYTES: 10 * 1024 * 1024,  // 10MB
  MAX_RETRIES: 3,
  INITIAL_RETRY_DELAY_MS: 1000,
  RETRY_BACKOFF_MULTIPLIER: 2,       // Exponential backoff
}
```

### Retry Logic
- Retries on: 429, 500, 502, 503, 504 status codes
- Exponential backoff: 1000ms → 2000ms → 4000ms
- Respects `Retry-After` header

---

## 6. Hero Image Processing (`hero-image.ts`)

### Purpose
Processes hero images for consistent dimensions and format using Sharp.

### Default Configuration
```typescript
DEFAULT_CONFIG = {
  width: 1280,
  height: 720,    // 16:9 aspect ratio
  quality: 85,
  format: 'webp', // ~30% smaller than JPEG
}
```

### Processing Pipeline
```typescript
async function processHeroImage(options):
  1. Get source buffer (use provided or download)
  2. Validate format (jpeg, png, webp, gif, tiff, avif)
  3. Resize with Sharp:
     - fit: 'cover'
     - position: 'center'
  4. Convert to WebP (or JPEG if requested)
  5. Return processed buffer + metadata
```

### Section Image Processing
```typescript
DEFAULT_SECTION_CONFIG = {
  maxWidth: 800,   // Resize if larger
  quality: 85,
  format: 'webp',
}

// Maintains aspect ratio (fit: 'inside')
// Only resizes if width > maxWidth
```

### IGDB URL Enhancement
```typescript
function getHighResIGDBUrl(url, size):
  // Converts: t_screenshot_big → t_1080p
  // Only modifies URLs from images.igdb.com
```

---

## 7. Image Uploader (`services/image-uploader.ts`)

### Purpose
Uploads processed images to Strapi's Media Library with metadata.

### Upload Methods
1. **URL Upload**: Downloads + uploads (with SSRF protection)
2. **Buffer Upload**: Direct buffer upload (no re-download)

### Source Attribution Storage
Attribution is stored in `provider_metadata.imageAttribution` (not in caption):
```typescript
interface ImageSourceMetadata {
  sourceUrl?: string;       // Original image URL
  sourceDomain?: string;    // e.g., "ign.com"
  imageSource?: 'igdb' | 'tavily' | 'exa' | 'source' | 'web';
}

// Stored as:
provider_metadata: {
  ...existingS3Metadata,
  imageAttribution: {
    sourceUrl, sourceDomain, imageSource
  }
}
```

### Filename Sanitization
```typescript
function sanitizeFilename(filename):
  - Lowercase
  - Replace non-alphanumeric with hyphens
  - Collapse multiple hyphens
  - Max 100 characters

// Example: "Dark Souls III: Boss Guide" → "dark-souls-iii-boss-guide"
```

---

## 8. Folder Service (`services/folder-service.ts`)

### Purpose
Creates hierarchical folder structure in Strapi Media Library for image organization.

### Folder Structure
```
/images/
  └── {game_slug}/
      └── {article_slug}/
          ├── dark-souls-iii-boss-guide-hero.webp
          ├── dark-souls-iii-boss-guide-ornstein-0.webp
          └── ...
```

### Race Condition Handling
```typescript
async function getOrCreateFolderByPath(deps, path):
  1. Try to find existing folder
  2. If not found, create it
  3. If unique constraint error → retry find
  4. Return folder { id, path }
```

---

## 9. Image Inserter (`image-inserter.ts`)

### Purpose
Inserts uploaded images into article markdown at appropriate positions.

### Insertion Logic
1. **Hero Image**: NOT inserted into markdown - used as `Post.featuredImage`
2. **Section Images**: Inserted after H2 headers

### Header Matching
Uses fuzzy matching from `headline-utils.ts`:
```typescript
// Match priority:
1. Exact match (case-sensitive)
2. Normalized match (lowercase, no punctuation)
3. Partial match (only if >60% similarity)
```

### Markdown Output
```markdown
## Boss Strategy

Some content here...

![Ornstein charging his lightning spear attack](https://cdn.example.com/image.webp)
*Optional caption here*

More content...
```

### Text Sanitization
```typescript
function sanitizeMarkdownText(text):
  - Escape brackets: [ ] → \[ \]
  - Replace newlines with spaces
  - Collapse multiple spaces
```

---

## 10. Image Extractor (`utils/image-extractor.ts`)

### Purpose
Extracts images from source articles with anti-hallucination validation.

### Extraction Pipeline
```
Raw HTML/Markdown → Pre-Extract URLs (Allowlist) → Clean Content → Parse Markdown Images → Validate Against Allowlist → Extract Context
```

### URL Extraction Patterns
- Markdown: `![alt](url)`
- HTML img: `<img src="...">`
- Lazy-load: `data-src`, `data-lazy-src`, `data-original`
- Responsive: `srcset`
- Background: `url(...)`
- Plain URLs: `https://....(jpg|png|webp|gif)`

### Context Extraction
For each validated image:
```typescript
interface SourceImage {
  url: string;
  description: string;        // Cleaned from alt text or filename
  nearestHeader?: string;     // H2/H3 above the image
  contextParagraph?: string;  // Surrounding text (max 500 chars)
  position: number;           // For ordering
}
```

### Filename Cleaning
```typescript
// Input: "clair-obscur-expedition-33-screenshot.jpg"
// Output: "Clair Obscur Expedition 33 Screenshot"

function cleanDescription(description):
  - Remove file extension
  - Replace hyphens/underscores with spaces
  - Title case if all lowercase
```

### Anti-Hallucination
Only images with URLs found in the **raw content** (pre-extraction) are kept. This prevents the LLM from generating fake image URLs during content cleaning.

---

## 11. Image Phase Orchestrator (`image-phase.ts`)

### Purpose
Main orchestration module that coordinates the entire image pipeline.

### Phase Steps
```typescript
async function runImagePhase(input, deps):
  // STEP 1: Build Image Pool
  - Add IGDB images (screenshots, artworks, cover)
  - Add source images from cleanedSources
  - Add web images from searchImagePool

  // STEP 1.5: Create Folder Structure
  - /images/{game_slug}/{article_slug}

  // STEP 2: Run Image Curator (LLM)
  - Select hero candidates (ranked by relevance)
  - Select section candidates (per H2)

  // STEP 2.5: Process Candidates
  - Download and validate dimensions
  - Run quality check for hero (if enabled)
  - Select first valid per slot

  // STEP 3: Process Hero Image
  - Resize to 1280x720
  - Convert to WebP
  - Upload to Strapi

  // STEP 4: Upload Section Images (Batched)
  - Concurrency: IMAGE_CURATOR_CONFIG.UPLOAD_CONCURRENCY
  - Use buffers (no re-download)

  // STEP 5: Insert into Markdown
  - Hero → featuredImage (not in markdown)
  - Sections → after H2 headers
```

### Result Structure
```typescript
interface ImagePhaseResult {
  markdown: string;           // Updated with images
  imagesAdded: boolean;
  imageCount: number;
  heroImage?: ImageUploadResult;
  heroImageFailed?: boolean;
  sectionImages: ImageUploadResult[];
  failedSections?: string[];
  tokenUsage: TokenUsage;
  poolSummary: { total, igdb, web };
}
```

---

## 12. Configuration (`config.ts`)

All image-related configuration is centralized:

```typescript
// Image Curator
IMAGE_CURATOR_CONFIG: { ... }

// Quality Validation
IMAGE_QUALITY_VALIDATION_CONFIG: { ... }

// Image Pool
IMAGE_POOL_CONFIG: {
  MIN_URL_DIMENSION: 200,
  MIN_IMAGE_WIDTH: 200,
  MIN_IMAGE_HEIGHT: 150,
  EXCLUDED_DOMAINS: [...],
  HIGH_QUALITY_DOMAINS: [...],
  KNOWN_IMAGE_CDNS: [...],
}

// Image Downloader
IMAGE_DOWNLOADER_CONFIG: {
  USER_AGENT, TIMEOUT_MS, MAX_SIZE_BYTES,
  MAX_RETRIES, INITIAL_RETRY_DELAY_MS,
  RETRY_BACKOFF_MULTIPLIER
}

// Image Dimensions
IMAGE_DIMENSION_CONFIG: {
  HERO_MIN_WIDTH: 800,
  SECTION_MIN_WIDTH: 500,
  MAX_HERO_CANDIDATES: 10,
  MAX_SECTION_CANDIDATES: 3,
  DIMENSION_PROBE_TIMEOUT_MS: 15000,
  DIMENSION_PROBE_RETRIES: 1,
}
```

### Runtime Validation
Configuration is validated at module load time:
- Min/max constraints
- Positive/non-negative values
- Temperature ranges (0-2)

---

## 13. URL Utilities (`utils/url-utils.ts`)

### Key Functions
```typescript
// Extract domain without www
extractDomain('https://www.example.com/path') → 'example.com'

// Normalize for protocol and fragments
normalizeUrl('http://example.com#section') → 'https://example.com'

// Strict domain check (prevents path injection)
isFromDomain('https://images.igdb.com/...', 'images.igdb.com') → true
isFromDomain('https://evil.com/images.igdb.com/...', 'images.igdb.com') → false

// IGDB URL deduplication (same image at different sizes)
normalizeImageUrlForDedupe('https://images.igdb.com/.../t_1080p/abc123.jpg')
// Returns: 'igdb:abc123' (not a URL, just an identifier)
```

---

## 14. Headline Utilities (`utils/headline-utils.ts`)

### Purpose
Consistent headline matching across image-curator and image-inserter.

### Matching Algorithm
```typescript
function findMatchingHeadline(target, headlineMap, logger):
  // 1. Exact match (case-sensitive)
  // 2. Normalized match (lowercase, no punctuation)
  // 3. Partial match (only if >60% similarity)

  const PARTIAL_MATCH_THRESHOLD = 0.6;
```

### Example
```typescript
const sections = new Map([['Boss Strategy', 10], ['Weapons Guide', 25]]);
findMatchingHeadline('boss strategy', sections);
// Returns: { headline: 'Boss Strategy', lineNumber: 10, matchType: 'normalized' }
```

---

## 15. Dimension Service (`services/image-dimensions.ts`)

### Purpose
Determines image dimensions with optional IGDB inference.

### Strategy
1. **IGDB Inference** (instant, no download):
   - Parse URL for size token (`t_1080p`, `t_screenshot_big`, etc.)
   - Return known dimensions from `IGDB_SIZE_MAP`

2. **Download + Probe** (fallback):
   - Download image
   - Use Sharp to extract metadata
   - Retry on transient failures

```typescript
interface ImageDimensions {
  width: number;
  height: number;
  inferred: boolean;  // true if from IGDB URL, false if measured
}
```

---

## Database Migrations

The PR includes migrations for storing image metadata:

### domain_qualities table
```sql
CREATE TABLE domain_qualities (
  domain VARCHAR(255) UNIQUE,
  avg_quality FLOAT,
  avg_relevance FLOAT,
  sample_count INTEGER,
  -- ...
);
```

### source_contents table
```sql
CREATE TABLE source_contents (
  url VARCHAR(2048) UNIQUE,
  cleaned_content TEXT,
  images JSONB,  -- Extracted source images
  quality_score INTEGER,
  relevance_score INTEGER,
  -- ...
);
```

---

## Error Handling

### Graceful Degradation
- **No IGDB images**: Falls back to web search images
- **Download failure**: Tries next candidate
- **Dimension too small**: Tries next candidate
- **Quality check fails**: Tries next candidate
- **Upload failure**: Continues with other images, logs failed sections
- **Folder creation fails**: Uploads to root folder

### Abort Signal Support
- All async operations check `signal?.aborted`
- Prevents orphan uploads on timeout
- Fast response to cancellation

---

## Test Coverage

14 new test files added:
- `image-pool.test.ts`
- `image-curator.test.ts`
- `image-quality-checker.test.ts`
- `image-candidate-processor.test.ts`
- `image-downloader.test.ts`
- `image-uploader.test.ts`
- `image-dimensions.test.ts`
- `image-inserter.test.ts`
- `image-extractor.test.ts`
- `url-validator.test.ts`
- `url-utils.test.ts`
- `headline-utils.test.ts`
- `folder-service.test.ts`
- `image-phase.test.ts`

---

## Performance Optimizations

1. **Download-Once Pattern**: Image buffers are reused for validation and upload
2. **IGDB Dimension Inference**: No download needed for known IGDB sizes
3. **Batched Uploads**: Configurable concurrency (default: 3)
4. **Vision Validation Off by Default**: Only enabled for hero image
5. **Text-Based Curator**: 30 candidates evaluated via text metadata, not vision

---

## Security Measures

1. **SSRF Protection**: Comprehensive URL validation before download
2. **Magic Byte Validation**: Verify file type matches content
3. **Manual Redirect Handling**: Each redirect validated for SSRF
4. **Size Limits**: 10MB max file size
5. **Protocol Enforcement**: HTTPS required except for trusted domains
6. **Domain Exclusions**: Social media, ad networks, tracking pixels filtered

---

This comprehensive documentation covers all aspects of the Image Curation System implemented in PR #10, from high-level architecture to implementation details across all 14+ new modules.
