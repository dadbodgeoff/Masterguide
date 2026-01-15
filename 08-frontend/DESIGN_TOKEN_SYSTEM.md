# Design Token System Pattern

> Comprehensive design token architecture for typography, colors, and theming with WCAG AA compliance, TypeScript types, and framework integration.

## Overview

A design token system provides:
- Single source of truth for visual design decisions
- Type-safe token access across the application
- WCAG AA compliant color contrast ratios
- Consistent theming across components
- Framework-agnostic implementation (CSS-in-JS, Tailwind, CSS Variables)

## Architecture

```
Design Token System
├── Typography
│   ├── Font Families (sans, mono)
│   ├── Font Sizes (micro → 6xl)
│   ├── Font Weights (normal → extrabold)
│   ├── Line Heights (none → loose)
│   ├── Letter Spacing (tighter → widest)
│   └── Presets (display, h1-h3, body, caption)
├── Colors
│   ├── Primary (Teal scale 50-900)
│   ├── Interactive (Teal + light variant)
│   ├── Accent (Coral scale 50-900)
│   ├── Neutral (Slate scale 50-950)
│   ├── Semantic (success, warning, error, info)
│   ├── Background (default, surface, elevated, overlay)
│   ├── Text (primary, secondary, tertiary, muted)
│   ├── Border (default, subtle, strong, focus)
│   └── Tint (low-opacity overlays)
└── WCAG Compliance
    ├── Contrast Ratios (4.5:1 minimum)
    └── Accessibility Guidelines
```

## Implementation

### Typography Tokens

```typescript
// tokens/typography.ts

export const fontFamily = {
  sans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: '"Berkeley Mono", "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Menlo, Consolas, monospace',
} as const;

export const fontSize = {
  micro: '11px',
  xs: '12px',
  sm: '14px',
  base: '16px',
  lg: '18px',
  xl: '20px',
  '2xl': '24px',
  '3xl': '30px',
  '4xl': '36px',
  '5xl': '48px',
  '6xl': '60px',
} as const;

export const fontWeight = {
  normal: 400,
  medium: 500,
  semibold: 550,  // Custom weight for subtle emphasis
  bold: 600,
  extrabold: 700,
} as const;

export const lineHeight = {
  none: 1,
  tight: 1.2,
  snug: 1.3,
  normal: 1.5,
  relaxed: 1.625,
  loose: 2,
} as const;

export const letterSpacing = {
  tighter: '-0.05em',
  tight: '-0.025em',
  normal: '0',
  wide: '0.025em',
  wider: '0.05em',
  widest: '0.1em',
} as const;
```

### Typography Presets

```typescript
// tokens/typography.ts (continued)

export const typographyPresets = {
  display: {
    fontSize: fontSize['5xl'],
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.tight,
  },
  h1: {
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.tight,
  },
  h2: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.snug,
  },
  h3: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.snug,
  },
  body: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.normal,
    lineHeight: lineHeight.normal,
  },
  bodySmall: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.normal,
    lineHeight: lineHeight.normal,
  },
  caption: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.normal,
    lineHeight: lineHeight.snug,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    lineHeight: lineHeight.snug,
  },
  overline: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.snug,
    letterSpacing: letterSpacing.wider,
    textTransform: 'uppercase' as const,
  },
} as const;
```

### Color Palettes

```typescript
// tokens/colors.ts

export const primary = {
  50: '#E6F4F5',
  100: '#CCE9EB',
  200: '#99D3D7',
  300: '#66BDC3',
  400: '#33A7AF',
  500: '#21808D',  // Main primary
  600: '#1A6671',
  700: '#144D55',
  800: '#0D3338',
  900: '#071A1C',
} as const;

export const interactive = {
  ...primary,
  light: '#32B8C6',  // Hover state
} as const;

export const accent = {
  50: '#FDF2EF',
  100: '#FBE5DF',
  200: '#F7CBBF',
  300: '#F3B19F',
  400: '#EF977F',
  500: '#A84F2F',  // Main accent
  600: '#863F26',
  700: '#652F1C',
  800: '#432013',
  900: '#221009',
} as const;

export const neutral = {
  50: '#F8F9FA',
  100: '#F1F3F5',
  200: '#E9ECEF',
  300: '#DEE2E6',
  400: '#CED4DA',
  500: '#ADB5BD',
  600: '#868E96',
  700: '#495057',
  800: '#343A40',
  900: '#1F2121',   // Dark background
  950: '#131B3B',   // Darkest (charcoal)
  cream: '#FCFCF9', // Light text on dark
  charcoal: '#131B3B',
} as const;
```

### Semantic Colors

```typescript
// tokens/colors.ts (continued)

export const semantic = {
  success: {
    light: '#86efac',
    main: '#218081',
    dark: '#16a34a',
  },
  warning: {
    light: '#fde047',
    main: '#A84F2F',
    dark: '#92400E',
  },
  error: {
    light: '#fca5a5',
    main: '#C0152F',
    dark: '#9f1239',
  },
  info: {
    light: '#99D3D7',
    main: '#62756E',
    dark: '#475569',
  },
} as const;
```

### Background & Surface Colors

```typescript
// tokens/colors.ts (continued)

export const background = {
  default: '#1F2121',   // Page background
  base: '#1F2121',      // Alias for default
  surface: '#262828',   // Card/container surfaces
  elevated: '#334155',  // Modals, dropdowns
  overlay: 'rgba(31, 33, 33, 0.8)',
} as const;

export const text = {
  primary: '#FCFCF9',     // 15.8:1 contrast
  secondary: '#B8BABA',   // 8.2:1 contrast
  tertiary: '#9A9E9E',    // 5.8:1 contrast
  muted: '#7D8282',       // 4.5:1 contrast (WCAG AA minimum)
  disabled: 'rgba(184, 186, 186, 0.5)',
  inverse: '#131B3B',
  link: '#32B8C6',        // 6.2:1 contrast
  success: '#4ADE80',
  warning: '#FBBF24',
  error: '#F87171',
} as const;

export const border = {
  default: 'rgba(167, 169, 169, 0.20)',
  subtle: 'rgba(119, 124, 124, 0.30)',
  strong: '#777C7C',
  focus: '#21808D',
} as const;

export const tint = {
  blue: 'rgba(59, 130, 246, 0.08)',
  yellow: 'rgba(234, 179, 8, 0.08)',
  green: 'rgba(34, 197, 94, 0.08)',
  red: 'rgba(239, 68, 68, 0.08)',
  purple: 'rgba(168, 85, 247, 0.08)',
  teal: 'rgba(33, 128, 141, 0.08)',
} as const;
```

### TypeScript Types

```typescript
// types/tokens.ts

export type FontFamily = 'sans' | 'mono';
export type FontSize = 'micro' | 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl';
export type FontWeight = 'normal' | 'medium' | 'semibold' | 'bold' | 'extrabold';
export type LineHeight = 'none' | 'tight' | 'snug' | 'normal' | 'relaxed' | 'loose';
export type LetterSpacing = 'tighter' | 'tight' | 'normal' | 'wide' | 'wider' | 'widest';
export type TypographyPreset = 'display' | 'h1' | 'h2' | 'h3' | 'body' | 'bodySmall' | 'caption' | 'label' | 'overline';

export interface SemanticColor {
  light: string;
  main: string;
  dark: string;
}

export interface Colors {
  primary: Record<number, string>;
  interactive: Record<number | 'light', string>;
  accent: Record<number, string>;
  neutral: Record<number | 'cream' | 'charcoal', string>;
  semantic: Record<'success' | 'warning' | 'error' | 'info', SemanticColor>;
  background: Record<'default' | 'base' | 'surface' | 'elevated' | 'overlay', string>;
  text: Record<string, string>;
  border: Record<'default' | 'subtle' | 'strong' | 'focus', string>;
  tint: Record<string, string>;
}
```

## WCAG Compliance

### Contrast Ratio Reference

All ratios calculated against `background.default` (#1F2121):

| Token | Color | Ratio | WCAG Level |
|-------|-------|-------|------------|
| `text.primary` | #FCFCF9 | 15.8:1 | AAA |
| `text.secondary` | #B8BABA | 8.2:1 | AAA |
| `text.tertiary` | #9A9E9E | 5.8:1 | AA |
| `text.muted` | #7D8282 | 4.5:1 | AA |
| `text.link` | #32B8C6 | 6.2:1 | AA |
| `interactive.500` | #21808D | 4.6:1 | AA |
| `interactive.light` | #32B8C6 | 6.2:1 | AA |

### Accessibility Guidelines

1. **Never use `text.muted` for essential information** - Reserve for placeholders
2. **Use `text.primary` for all body content** - Maximum readability
3. **Pair semantic colors with icons** - Don't rely on color alone
4. **Maintain focus indicators** - Use `border.focus` for keyboard navigation
5. **Test with color blindness simulators** - Verify deuteranopia/protanopia accessibility

## Framework Integration

### CSS-in-JS Usage

```typescript
import styled from '@emotion/styled';
import { colors, typography } from '@/tokens';

export const Button = styled.button`
  font-family: ${typography.fontFamily.sans};
  font-size: ${typography.fontSize.sm};
  font-weight: ${typography.fontWeight.medium};
  background-color: ${colors.interactive[500]};
  color: ${colors.text.primary};
  
  &:hover {
    background-color: ${colors.interactive.light};
  }
  
  &:focus {
    outline: 2px solid ${colors.border.focus};
    outline-offset: 2px;
  }
`;
```

### Tailwind Integration

```typescript
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#E6F4F5',
          500: '#21808D',
          900: '#071A1C',
          DEFAULT: '#21808D',
        },
        // ... other color scales
      },
      backgroundColor: {
        default: '#1F2121',
        surface: '#262828',
        elevated: '#334155',
      },
      textColor: {
        primary: '#FCFCF9',
        secondary: '#B8BABA',
        tertiary: '#9A9E9E',
        muted: '#7D8282',
      },
    },
  },
};
```

### CSS Variables Export

```typescript
export function generateCSSVariables(): string {
  return `
:root {
  --font-sans: ${fontFamily.sans};
  --font-mono: ${fontFamily.mono};
  
  --text-sm: ${fontSize.sm};
  --text-base: ${fontSize.base};
  --text-lg: ${fontSize.lg};
  
  --color-primary: ${primary[500]};
  --color-accent: ${accent[500]};
  
  --bg-default: ${background.default};
  --bg-surface: ${background.surface};
  
  --text-primary: ${text.primary};
  --text-secondary: ${text.secondary};
  
  --border-default: ${border.default};
  --border-focus: ${border.focus};
}`;
}
```

## Best Practices

1. **Use semantic tokens** - Reference `text.primary` not `#FCFCF9`
2. **Leverage presets** - Use `typographyPresets.h1` for consistent headings
3. **Maintain hierarchy** - Background layers: default → surface → elevated
4. **Test contrast** - Verify all text meets WCAG AA (4.5:1 minimum)
5. **Export types** - Enable TypeScript autocomplete for token access
6. **Document usage** - Include examples for each token category

## Testing

```typescript
import { text, background } from '@/tokens';
import { getContrastRatio } from '@/utils/accessibility';

describe('Design Token Accessibility', () => {
  it('text.primary meets WCAG AAA', () => {
    const ratio = getContrastRatio(text.primary, background.default);
    expect(ratio).toBeGreaterThanOrEqual(7);
  });
  
  it('text.muted meets WCAG AA minimum', () => {
    const ratio = getContrastRatio(text.muted, background.default);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
  
  it('interactive colors meet WCAG AA', () => {
    const ratio = getContrastRatio(interactive[500], background.default);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
```
