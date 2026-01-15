# Design Token System

> **Implementation Time**: 4h  
> **Complexity**: Medium  
> **Dependencies**: Tailwind CSS

## Problem

Colors scattered across components. Inconsistent spacing. Every developer picks different shades. Design debt accumulates. Rebranding becomes a nightmare.

## Solution

Design tokens. Single source of truth for colors, typography, spacing. Semantic naming. Change once, update everywhere.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Design Token System                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐                                            │
│  │  design-tokens  │  Single source of truth                    │
│  │      .ts        │                                            │
│  └────────┬────────┘                                            │
│           │                                                     │
│           ├──────────────────┬──────────────────┐               │
│           │                  │                  │               │
│           ▼                  ▼                  ▼               │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐   │
│  │    Colors       │ │   Typography    │ │    Spacing      │   │
│  │                 │ │                 │ │                 │   │
│  │ neutral.900     │ │ text.display    │ │ spacing.tight   │   │
│  │ primary.500     │ │ text.body       │ │ spacing.relaxed │   │
│  │ risk.critical   │ │ text.metric     │ │ cardPadding     │   │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘   │
│           │                  │                  │               │
│           └──────────────────┴──────────────────┘               │
│                              │                                  │
│                              ▼                                  │
│                    ┌─────────────────┐                          │
│                    │   Components    │                          │
│                    │                 │                          │
│                    │ <Card />        │                          │
│                    │ <Button />      │                          │
│                    │ <Badge />       │                          │
│                    └─────────────────┘                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation

### Design Tokens File

```typescript
// lib/design-tokens.ts

// ============================================================================
// COLOR SYSTEM
// ============================================================================

export const colors = {
  // Neutrals - Dark theme foundation
  neutral: {
    950: '#0a0a0b',  // Deepest background
    900: '#111113',  // Primary background
    850: '#18181b',  // Elevated surfaces
    800: '#1f1f23',  // Cards, panels
    700: '#2a2a30',  // Borders, dividers
    600: '#3f3f46',  // Subtle borders
    500: '#52525b',  // Disabled text
    400: '#71717a',  // Secondary text
    300: '#a1a1aa',  // Body text
    200: '#d4d4d8',  // Primary text
    100: '#e4e4e7',  // Emphasized text
    cream: '#f5f5f4', // Headlines
  },

  // Primary accent
  primary: {
    900: '#134e4a',
    700: '#0f766e',
    500: '#14b8a6',  // Main accent
    400: '#2dd4bf',  // Hover
    300: '#5eead4',  // Active
  },

  // Semantic status colors
  success: {
    bg: 'rgba(34, 197, 94, 0.12)',
    border: 'rgba(34, 197, 94, 0.25)',
    text: '#4ade80',
    solid: '#22c55e',
  },
  warning: {
    bg: 'rgba(234, 179, 8, 0.12)',
    border: 'rgba(234, 179, 8, 0.25)',
    text: '#facc15',
    solid: '#eab308',
  },
  critical: {
    bg: 'rgba(239, 68, 68, 0.12)',
    border: 'rgba(239, 68, 68, 0.25)',
    text: '#f87171',
    solid: '#ef4444',
  },

  // Domain-specific (risk levels)
  risk: {
    low: '#22c55e',
    moderate: '#eab308',
    high: '#f97316',
    critical: '#ef4444',
  },
} as const;

// ============================================================================
// TYPOGRAPHY SYSTEM
// ============================================================================

export const typography = {
  // Page hierarchy
  display: 'text-4xl font-bold tracking-tight text-neutral-cream',
  title: 'text-2xl font-semibold tracking-tight text-neutral-cream',
  heading: 'text-lg font-semibold text-neutral-cream',
  subheading: 'text-base font-medium text-neutral-200',

  // Body text
  body: 'text-sm leading-relaxed text-neutral-300',
  bodyMuted: 'text-sm leading-relaxed text-neutral-400',
  bodySmall: 'text-xs leading-relaxed text-neutral-400',

  // Data display
  metric: 'text-2xl font-bold tabular-nums text-neutral-cream',
  metricLarge: 'text-4xl font-bold tabular-nums tracking-tight text-neutral-cream',

  // Labels
  label: 'text-[11px] font-semibold uppercase tracking-wider text-neutral-500',
  meta: 'text-xs text-neutral-500',

  // Interactive
  link: 'text-sm font-medium text-primary-400 hover:text-primary-300 transition-colors',
} as const;

// ============================================================================
// SPACING SYSTEM
// ============================================================================

export const spacing = {
  // Semantic gaps (Tailwind classes)
  tight: 'gap-1',        // 4px
  default: 'gap-2',      // 8px
  comfortable: 'gap-3',  // 12px
  relaxed: 'gap-4',      // 16px
  loose: 'gap-6',        // 24px

  // Padding presets
  cardPadding: 'p-4',
  cardPaddingCompact: 'p-3',
  sectionPadding: 'px-4 py-3',
  inlinePadding: 'px-2 py-1',
} as const;

// ============================================================================
// COMPONENT TOKENS
// ============================================================================

export const components = {
  // Cards
  card: {
    base: 'bg-neutral-800 border border-neutral-700/60 rounded-xl',
    elevated: 'bg-neutral-800 border border-neutral-700/60 rounded-xl shadow-lg',
    interactive: 'bg-neutral-800 border border-neutral-700/60 rounded-xl hover:border-neutral-600 cursor-pointer transition-all',
  },

  // Buttons
  button: {
    primary: 'bg-primary-600 hover:bg-primary-500 text-white font-medium rounded-lg transition-all',
    secondary: 'bg-neutral-700 hover:bg-neutral-600 text-neutral-200 font-medium rounded-lg border border-neutral-600',
    ghost: 'hover:bg-neutral-700/50 text-neutral-400 hover:text-neutral-200 rounded-lg',
  },

  // Inputs
  input: {
    base: 'bg-neutral-850 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-200',
    focus: 'focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500/60',
  },
} as const;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get risk color based on score (0-100)
 */
export function getRiskColor(score: number): string {
  if (score >= 70) return colors.risk.critical;
  if (score >= 50) return colors.risk.high;
  if (score >= 30) return colors.risk.moderate;
  return colors.risk.low;
}

/**
 * Get risk level with label
 */
export function getRiskLevel(score: number): {
  label: string;
  tone: 'success' | 'warning' | 'critical';
} {
  if (score >= 70) return { label: 'Critical', tone: 'critical' };
  if (score >= 50) return { label: 'High', tone: 'warning' };
  if (score >= 30) return { label: 'Elevated', tone: 'warning' };
  return { label: 'Low', tone: 'success' };
}

/**
 * Format number for display
 */
export function formatMetric(value: number, options?: {
  compact?: boolean;
  decimals?: number;
}): string {
  const { compact = true, decimals = 0 } = options || {};

  if (compact && value >= 1_000_000) {
    return (value / 1_000_000).toFixed(1) + 'M';
  }
  if (compact && value >= 1_000) {
    return (value / 1_000).toFixed(1) + 'K';
  }
  return value.toFixed(decimals);
}

/**
 * Combine class names
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}
```

### Using Tokens in Components

```typescript
// components/ui/Card.tsx
import { components, spacing, cn } from '@/lib/design-tokens';

interface CardProps {
  children: React.ReactNode;
  variant?: 'base' | 'elevated' | 'interactive';
  padding?: 'compact' | 'default' | 'large';
  className?: string;
}

export function Card({
  children,
  variant = 'base',
  padding = 'default',
  className,
}: CardProps) {
  const paddingClass = {
    compact: spacing.cardPaddingCompact,
    default: spacing.cardPadding,
    large: 'p-6',
  }[padding];

  return (
    <div className={cn(components.card[variant], paddingClass, className)}>
      {children}
    </div>
  );
}
```

```typescript
// components/ui/MetricCard.tsx
import { typography, getRiskColor, formatMetric, cn } from '@/lib/design-tokens';
import { Card } from './Card';

interface MetricCardProps {
  label: string;
  value: number;
  isRisk?: boolean;
}

export function MetricCard({ label, value, isRisk }: MetricCardProps) {
  return (
    <Card>
      <span className={typography.label}>{label}</span>
      <span
        className={typography.metric}
        style={isRisk ? { color: getRiskColor(value) } : undefined}
      >
        {formatMetric(value)}
      </span>
    </Card>
  );
}
```

### Tailwind Config Integration

```javascript
// tailwind.config.js
const { colors } = require('./lib/design-tokens');

module.exports = {
  theme: {
    extend: {
      colors: {
        neutral: colors.neutral,
        primary: colors.primary,
        // Map semantic colors
        success: colors.success.solid,
        warning: colors.warning.solid,
        critical: colors.critical.solid,
      },
    },
  },
};
```

### Status Indicators

```typescript
// lib/design-tokens.ts (continued)

export const status = {
  live: {
    dot: 'bg-green-500',
    pulse: 'bg-green-500 animate-ping',
    label: 'Live',
  },
  stale: {
    dot: 'bg-yellow-500',
    pulse: null,
    label: 'Delayed',
  },
  offline: {
    dot: 'bg-red-500',
    pulse: null,
    label: 'Offline',
  },
} as const;

// components/ui/StatusIndicator.tsx
import { status } from '@/lib/design-tokens';

type StatusType = keyof typeof status;

export function StatusIndicator({ type }: { type: StatusType }) {
  const config = status[type];

  return (
    <div className="flex items-center gap-2">
      <span className="relative flex h-2 w-2">
        {config.pulse && (
          <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${config.pulse}`} />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${config.dot}`} />
      </span>
      <span className="text-xs text-neutral-400">{config.label}</span>
    </div>
  );
}
```

## Token Categories

| Category | Purpose | Example |
|----------|---------|---------|
| Colors | Brand, semantic, status | `colors.primary.500` |
| Typography | Text styles | `typography.heading` |
| Spacing | Gaps, padding | `spacing.relaxed` |
| Components | Pre-built patterns | `components.card.base` |
| Status | Live/offline indicators | `status.live.dot` |

## Benefits

1. **Consistency** - Same colors/spacing everywhere
2. **Maintainability** - Change once, update everywhere
3. **Theming** - Easy dark/light mode
4. **Documentation** - Tokens are self-documenting
5. **Collaboration** - Designers and devs speak same language

## Production Checklist

- [ ] All colors defined in tokens
- [ ] Typography scale complete
- [ ] Spacing scale consistent
- [ ] Component variants defined
- [ ] Utility functions for common operations
- [ ] Tailwind config synced with tokens

## Related Patterns

- [PWA Setup](./PWA_SETUP.md)
- [Mobile Components](./MOBILE_COMPONENTS.md)
