# AI Prompt Templating Engine Pattern

> **Time to implement:** 4-6 hours  
> **Complexity:** Medium  
> **Prerequisites:** YAML parser, AI API access

## The Problem

AI prompts become inconsistent and insecure:
- Hardcoded prompts scattered across codebase
- No brand consistency in generated content
- Prompt injection vulnerabilities
- Token budget overruns

## The Solution

Template-based prompt engine with:
1. YAML-defined templates with placeholders
2. Brand kit injection (colors, fonts, tone)
3. Security hardening (input sanitization)
4. Token-efficient brand context blocks

## Architecture

```
User Input → Sanitize → Load Template → Inject Brand → Build Prompt
                                            ↓
                                    [BRAND: Colors | Font | Tone]
```

## Core Implementation

### Types

```typescript
// lib/prompt-engine/types.ts
export enum AssetType {
  THUMBNAIL = 'thumbnail',
  BANNER = 'banner',
  SOCIAL_POST = 'social_post',
  EMAIL_HEADER = 'email_header',
}

export interface PromptTemplate {
  name: string;
  version: string;
  basePrompt: string;
  placeholders: string[];
  qualityModifiers: string[];
}

export interface VibeTemplate {
  key: string;
  name: string;
  description: string;
  prompt: string;
  previewTags: string[];
}

export interface VibeBasedTemplate {
  name: string;
  version: string;
  category: string;
  assetType: AssetType;
  dimensions: { width: number; height: number };
  vibes: Record<string, VibeTemplate>;
  placeholders: string[];
  qualityModifiers: string[];
}

export interface BrandKitContext {
  primaryColors: string[];
  accentColors: string[];
  headlineFont?: string;
  bodyFont?: string;
  tone?: string;
  tagline?: string;
}

export interface ResolvedBrandContext {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  gradient?: string;
  font?: string;
  tone?: string;
  intensity: 'subtle' | 'balanced' | 'strong';
}
```

### Security: Input Sanitization

```typescript
// lib/prompt-engine/sanitizer.ts
const MAX_INPUT_LENGTH = 500;
const SANITIZE_PATTERN = /[<>{}\[\]\\|`~]/g;

const INJECTION_PATTERNS = [
  /ignore\s+(previous|above|all)/i,
  /disregard\s+(previous|above|all)/i,
  /forget\s+(previous|above|all)/i,
  /system\s*:/i,
  /assistant\s*:/i,
  /user\s*:/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
  /<<SYS>>/i,
  /<\/SYS>>/i,
  /###\s*(instruction|system|human|assistant)/i,
];

export function sanitizeInput(input: string): string {
  // Length check
  if (input.length > MAX_INPUT_LENGTH) {
    input = input.slice(0, MAX_INPUT_LENGTH);
  }

  // Remove dangerous characters
  input = input.replace(SANITIZE_PATTERN, '');

  // Check for injection attempts
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      throw new Error('Potential prompt injection detected');
    }
  }

  return input.trim();
}

export function sanitizePlaceholders(
  placeholders: Record<string, string>
): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(placeholders)) {
    sanitized[key] = sanitizeInput(value);
  }

  return sanitized;
}
```

### Brand Context Resolver

```typescript
// lib/prompt-engine/brand-resolver.ts
export class BrandContextResolver {
  resolve(
    brandKit: BrandKitContext,
    customization?: {
      primaryColorIndex?: number;
      secondaryColorIndex?: number;
      accentColorIndex?: number;
      useGradient?: boolean;
      typographyLevel?: 'headline' | 'body';
      fontWeight?: string;
      intensity?: 'subtle' | 'balanced' | 'strong';
    }
  ): ResolvedBrandContext {
    const opts = customization || {};

    // Resolve colors
    const primaryColor = this.resolveColor(
      brandKit.primaryColors,
      opts.primaryColorIndex ?? 0
    );
    const secondaryColor = this.resolveColor(
      brandKit.primaryColors,
      opts.secondaryColorIndex ?? 1
    );
    const accentColor = this.resolveColor(
      brandKit.accentColors,
      opts.accentColorIndex ?? 0
    );

    // Resolve gradient
    const gradient = opts.useGradient && primaryColor && secondaryColor
      ? `${primaryColor}→${secondaryColor}`
      : undefined;

    // Resolve typography
    const fontName = opts.typographyLevel === 'body'
      ? brandKit.bodyFont
      : brandKit.headlineFont;
    const font = fontName
      ? `${fontName} ${opts.fontWeight || '700'}`
      : undefined;

    return {
      primaryColor,
      secondaryColor,
      accentColor,
      gradient,
      font,
      tone: brandKit.tone,
      intensity: opts.intensity || 'balanced',
    };
  }

  private resolveColor(colors: string[], index: number): string | undefined {
    if (!colors.length) return undefined;
    const safeIndex = Math.max(0, Math.min(index, colors.length - 1));
    return colors[safeIndex];
  }
}

/**
 * Generate compact brand context block (~50-80 tokens)
 */
export function toCompactBrandBlock(ctx: ResolvedBrandContext): string {
  const parts: string[] = [];

  // Colors
  const colors = [ctx.primaryColor, ctx.secondaryColor, ctx.accentColor]
    .filter(Boolean);
  if (colors.length) {
    parts.push(`Colors: ${colors.join(', ')}`);
  }

  // Gradient
  if (ctx.gradient) {
    parts.push(`Gradient: ${ctx.gradient}`);
  }

  // Font
  if (ctx.font) {
    parts.push(`Font: ${ctx.font}`);
  }

  // Tone
  if (ctx.tone) {
    parts.push(`Tone: ${ctx.tone}`);
  }

  if (!parts.length) return '';

  return `[BRAND: ${ctx.intensity} - ${parts.join(' | ')}]`;
}
```

### Template Loader

```typescript
// lib/prompt-engine/template-loader.ts
import yaml from 'js-yaml';
import fs from 'fs/promises';
import path from 'path';

const TEMPLATE_DIR = path.join(process.cwd(), 'prompts');
const ALLOWED_DIRS = ['prompts', 'templates'];

// Thread-safe cache
const templateCache = new Map<string, PromptTemplate | VibeBasedTemplate>();

export async function loadTemplate(templateName: string): Promise<PromptTemplate> {
  const cacheKey = `basic:${templateName}`;

  if (templateCache.has(cacheKey)) {
    return templateCache.get(cacheKey) as PromptTemplate;
  }

  const templatePath = validatePath(templateName);
  const content = await fs.readFile(templatePath, 'utf-8');
  const data = yaml.load(content) as Record<string, unknown>;

  const template: PromptTemplate = {
    name: (data.name as string) || templateName,
    version: (data.version as string) || '1.0.0',
    basePrompt: data.base_prompt as string,
    placeholders: (data.placeholders as string[]) || [],
    qualityModifiers: (data.quality_modifiers as string[]) || [],
  };

  // Validate placeholders exist in prompt
  for (const placeholder of template.placeholders) {
    if (!template.basePrompt.includes(`{${placeholder}}`)) {
      throw new Error(`Placeholder {${placeholder}} not found in template`);
    }
  }

  templateCache.set(cacheKey, template);
  return template;
}

export async function loadVibeTemplate(templateName: string): Promise<VibeBasedTemplate> {
  const cacheKey = `vibe:${templateName}`;

  if (templateCache.has(cacheKey)) {
    return templateCache.get(cacheKey) as VibeBasedTemplate;
  }

  const templatePath = validatePath(templateName);
  const content = await fs.readFile(templatePath, 'utf-8');
  const data = yaml.load(content) as Record<string, unknown>;

  const vibesData = data.vibes as Record<string, Record<string, unknown>>;
  const vibes: Record<string, VibeTemplate> = {};

  for (const [key, vibeData] of Object.entries(vibesData)) {
    vibes[key] = {
      key: (vibeData.key as string) || key,
      name: vibeData.name as string,
      description: vibeData.description as string,
      prompt: vibeData.prompt as string,
      previewTags: (vibeData.preview_tags as string[]) || [],
    };
  }

  const template: VibeBasedTemplate = {
    name: (data.name as string) || templateName,
    version: (data.version as string) || '1.0.0',
    category: data.category as string,
    assetType: data.asset_type as AssetType,
    dimensions: data.dimensions as { width: number; height: number },
    vibes,
    placeholders: (data.placeholders as string[]) || [],
    qualityModifiers: (data.quality_modifiers as string[]) || [],
  };

  templateCache.set(cacheKey, template);
  return template;
}

function validatePath(templateName: string): string {
  // Prevent directory traversal
  const normalized = path.normalize(templateName).replace(/^(\.\.(\/|\\|$))+/, '');
  
  if (normalized.includes('..')) {
    throw new Error('Invalid template path');
  }

  const fullPath = path.join(TEMPLATE_DIR, `${normalized}.yaml`);
  
  // Ensure path is within allowed directories
  const isAllowed = ALLOWED_DIRS.some(dir => 
    fullPath.startsWith(path.join(process.cwd(), dir))
  );

  if (!isAllowed) {
    throw new Error('Template path not in allowed directory');
  }

  return fullPath;
}

export function clearTemplateCache(): void {
  templateCache.clear();
}
```

### Prompt Engine

```typescript
// lib/prompt-engine/engine.ts
const INTENSITY_MODIFIERS = {
  subtle: 'subtly incorporate',
  balanced: 'use',
  strong: 'prominently feature',
};

export class PromptEngine {
  private brandResolver = new BrandContextResolver();

  /**
   * Build prompt from basic template
   */
  async buildPrompt(
    templateName: string,
    placeholders: Record<string, string>,
    brandKit?: BrandKitContext,
    brandCustomization?: Parameters<BrandContextResolver['resolve']>[1]
  ): Promise<string> {
    // Sanitize inputs
    const sanitizedPlaceholders = sanitizePlaceholders(placeholders);

    // Load template
    const template = await loadTemplate(templateName);

    // Build base prompt with placeholders
    let prompt = template.basePrompt;
    for (const [key, value] of Object.entries(sanitizedPlaceholders)) {
      prompt = prompt.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }

    // Inject brand context
    if (brandKit) {
      const resolved = this.brandResolver.resolve(brandKit, brandCustomization);
      const brandBlock = toCompactBrandBlock(resolved);
      
      if (brandBlock) {
        const modifier = INTENSITY_MODIFIERS[resolved.intensity];
        prompt = `${prompt}\n\n${modifier} the following brand guidelines:\n${brandBlock}`;
      }
    }

    // Add quality modifiers
    if (template.qualityModifiers.length) {
      prompt = `${prompt}\n\nQuality: ${template.qualityModifiers.join(', ')}`;
    }

    return prompt;
  }

  /**
   * Build prompt from vibe-based template
   */
  async buildVibePrompt(
    templateName: string,
    vibeKey: string,
    placeholders: Record<string, string>,
    brandKit?: BrandKitContext,
    brandCustomization?: Parameters<BrandContextResolver['resolve']>[1]
  ): Promise<string> {
    // Sanitize inputs
    const sanitizedPlaceholders = sanitizePlaceholders(placeholders);

    // Load template
    const template = await loadVibeTemplate(templateName);
    const vibe = template.vibes[vibeKey];

    if (!vibe) {
      throw new Error(`Vibe "${vibeKey}" not found in template "${templateName}"`);
    }

    // Build prompt with placeholders
    let prompt = vibe.prompt;
    for (const [key, value] of Object.entries(sanitizedPlaceholders)) {
      prompt = prompt.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }

    // Inject brand context
    if (brandKit) {
      const resolved = this.brandResolver.resolve(brandKit, brandCustomization);
      const brandBlock = toCompactBrandBlock(resolved);
      
      if (brandBlock) {
        const modifier = INTENSITY_MODIFIERS[resolved.intensity];
        prompt = `${prompt}\n\n${modifier} the following brand guidelines:\n${brandBlock}`;
      }
    }

    // Add quality modifiers
    if (template.qualityModifiers.length) {
      prompt = `${prompt}\n\nQuality: ${template.qualityModifiers.join(', ')}`;
    }

    return prompt;
  }

  /**
   * List available vibes for a template
   */
  async listVibes(templateName: string): Promise<Array<{ key: string; name: string; description: string }>> {
    const template = await loadVibeTemplate(templateName);
    return Object.values(template.vibes).map(v => ({
      key: v.key,
      name: v.name,
      description: v.description,
    }));
  }
}

// Singleton
export const promptEngine = new PromptEngine();
```

## Example Templates

### Basic Template

```yaml
# prompts/thumbnail_basic.yaml
name: thumbnail_basic
version: "1.0.0"
base_prompt: |
  Create a YouTube thumbnail for a {topic} video.
  The thumbnail should feature {subject} with {emotion} expression.
  Style: {style}

placeholders:
  - topic
  - subject
  - emotion
  - style

quality_modifiers:
  - high quality
  - professional lighting
  - vibrant colors
  - 4K resolution
```

### Vibe-Based Template

```yaml
# prompts/thumbnail_gaming.yaml
name: thumbnail_gaming
version: "2.0.0"
category: gaming
asset_type: thumbnail
dimensions:
  width: 1920
  height: 1080

placeholders:
  - game_name
  - subject
  - emotion

quality_modifiers:
  - ultra detailed
  - cinematic lighting
  - 8K quality

vibes:
  neon_glow:
    key: neon_glow
    name: "Neon Glow"
    description: "Cyberpunk-inspired with vibrant neon lighting"
    prompt: |
      Create a {game_name} thumbnail with neon cyberpunk aesthetics.
      Feature {subject} with {emotion} expression.
      Neon lights, glowing edges, dark background with color pops.
    preview_tags:
      - neon
      - cyberpunk
      - glowing

  cinematic_drama:
    key: cinematic_drama
    name: "Cinematic Drama"
    description: "Movie poster style with dramatic lighting"
    prompt: |
      Create a {game_name} thumbnail in cinematic movie poster style.
      Feature {subject} with {emotion} expression.
      Dramatic lighting, lens flare, epic composition.
    preview_tags:
      - cinematic
      - dramatic
      - epic
```

## Usage

```typescript
// Generate thumbnail prompt
const prompt = await promptEngine.buildVibePrompt(
  'thumbnail_gaming',
  'neon_glow',
  {
    game_name: 'Cyberpunk 2077',
    subject: 'character with katana',
    emotion: 'intense',
  },
  {
    primaryColors: ['#FF00FF', '#00FFFF'],
    accentColors: ['#FFFF00'],
    headlineFont: 'Orbitron',
    tone: 'edgy',
  },
  {
    useGradient: true,
    intensity: 'strong',
  }
);

// Result:
// Create a Cyberpunk 2077 thumbnail with neon cyberpunk aesthetics.
// Feature character with katana with intense expression.
// Neon lights, glowing edges, dark background with color pops.
//
// prominently feature the following brand guidelines:
// [BRAND: strong - Colors: #FF00FF, #00FFFF, #FFFF00 | Gradient: #FF00FF→#00FFFF | Font: Orbitron 700 | Tone: edgy]
//
// Quality: ultra detailed, cinematic lighting, 8K quality
```

## Checklist

- [ ] Input sanitization (length, characters, injection)
- [ ] YAML template loading with caching
- [ ] Path validation (prevent traversal)
- [ ] Placeholder substitution
- [ ] Brand context resolution
- [ ] Compact brand block generation (~50-80 tokens)
- [ ] Intensity modifiers (subtle/balanced/strong)
- [ ] Quality modifiers appending
- [ ] Vibe-based template support
- [ ] Template validation (placeholders exist)
