# Phase 11: Frontend Foundation

> **Time**: 15 minutes  
> **Prerequisites**: [02-ENVIRONMENT](./02-ENVIRONMENT.md)  
> **Produces**: Design tokens, base components, providers, PWA setup

---

## 🤖 Agent Execution Context

**What you're doing**: Creating the frontend foundation — design tokens, reusable UI components, provider composition, and PWA configuration. This is the last scaffolding phase.

**Expected state BEFORE execution**:
- Phase 02 complete (env validation exists)
- Phase 05 complete (auth context exists)
- `apps/web/` has Next.js app structure
- Tailwind CSS configured (from Phase 01)

**What you'll create**:
- `apps/web/lib/design-tokens/tokens.ts` — Colors, spacing, typography
- `apps/web/lib/design-tokens/index.ts` — Token exports
- `apps/web/components/ui/button.tsx` — Button component
- `apps/web/components/ui/input.tsx` — Input component
- `apps/web/components/ui/card.tsx` — Card component
- `apps/web/components/ui/index.ts` — Component exports
- `apps/web/lib/utils.ts` — Utility functions (cn, formatDate, etc.)
- `apps/web/components/providers/index.tsx` — Provider composition
- `apps/web/lib/api/client.ts` — API client with error handling
- `apps/web/public/manifest.json` — PWA manifest
- UPDATE `apps/web/app/layout.tsx` — Add Providers wrapper
- UPDATE `apps/web/tailwind.config.js` — Add design token colors

**Execution approach**:
1. Create `apps/web/lib/design-tokens/` directory
2. Create token files
3. Create `apps/web/components/ui/` directory
4. Create all UI components
5. Create lib/utils.ts
6. Create `apps/web/components/providers/` directory
7. Create providers/index.tsx
8. Create `apps/web/lib/api/` directory
9. Create API client
10. Create PWA manifest
11. Update layout.tsx to wrap with Providers
12. Update tailwind.config.js with design tokens

**IMPORTANT**:
- Components use `cn()` utility for class merging — create utils.ts first
- Need to install `clsx` and `tailwind-merge` packages
- Providers wraps AuthProvider from Phase 05
- API client uses error types from Phase 03

**New dependencies needed**:
```bash
pnpm add clsx tailwind-merge --filter @project/web
```

**After completion, tell the user**:
- "Phase 11 complete. Frontend foundation ready."
- "Design tokens, Button/Input/Card components, and API client created."
- "🎉 SCAFFOLDING COMPLETE! The enterprise foundation is ready."
- "Next: Configure .env, run `supabase start`, then `pnpm dev`."

---

## Skip Conditions

Skip this phase if ANY of these exist:
- `apps/web/lib/design-tokens/` directory exists
- `apps/web/components/ui/` has multiple components

## Purpose

Create frontend foundation including:
- Design token system (colors, spacing, typography)
- Base UI components (Button, Input, Card)
- Provider composition (Auth, Theme)
- PWA manifest and service worker setup
- API client with error handling

---

## Artifacts to Create

### 1. apps/web/lib/design-tokens/tokens.ts

```typescript
/**
 * Design tokens for consistent styling.
 */

export const colors = {
  // Brand colors
  primary: {
    50: '#f0f9ff',
    100: '#e0f2fe',
    200: '#bae6fd',
    300: '#7dd3fc',
    400: '#38bdf8',
    500: '#0ea5e9',
    600: '#0284c7',
    700: '#0369a1',
    800: '#075985',
    900: '#0c4a6e',
  },
  
  // Neutral colors
  gray: {
    50: '#f9fafb',
    100: '#f3f4f6',
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    600: '#4b5563',
    700: '#374151',
    800: '#1f2937',
    900: '#111827',
  },
  
  // Semantic colors
  success: {
    light: '#d1fae5',
    DEFAULT: '#10b981',
    dark: '#065f46',
  },
  warning: {
    light: '#fef3c7',
    DEFAULT: '#f59e0b',
    dark: '#92400e',
  },
  error: {
    light: '#fee2e2',
    DEFAULT: '#ef4444',
    dark: '#991b1b',
  },
  info: {
    light: '#dbeafe',
    DEFAULT: '#3b82f6',
    dark: '#1e40af',
  },
} as const;

export const spacing = {
  px: '1px',
  0: '0',
  0.5: '0.125rem',
  1: '0.25rem',
  1.5: '0.375rem',
  2: '0.5rem',
  2.5: '0.625rem',
  3: '0.75rem',
  3.5: '0.875rem',
  4: '1rem',
  5: '1.25rem',
  6: '1.5rem',
  7: '1.75rem',
  8: '2rem',
  9: '2.25rem',
  10: '2.5rem',
  12: '3rem',
  14: '3.5rem',
  16: '4rem',
  20: '5rem',
  24: '6rem',
  28: '7rem',
  32: '8rem',
} as const;

export const typography = {
  fontFamily: {
    sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
    mono: ['JetBrains Mono', 'Menlo', 'Monaco', 'monospace'],
  },
  fontSize: {
    xs: ['0.75rem', { lineHeight: '1rem' }],
    sm: ['0.875rem', { lineHeight: '1.25rem' }],
    base: ['1rem', { lineHeight: '1.5rem' }],
    lg: ['1.125rem', { lineHeight: '1.75rem' }],
    xl: ['1.25rem', { lineHeight: '1.75rem' }],
    '2xl': ['1.5rem', { lineHeight: '2rem' }],
    '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
    '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
  },
  fontWeight: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
} as const;

export const borderRadius = {
  none: '0',
  sm: '0.125rem',
  DEFAULT: '0.25rem',
  md: '0.375rem',
  lg: '0.5rem',
  xl: '0.75rem',
  '2xl': '1rem',
  full: '9999px',
} as const;

export const shadows = {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  DEFAULT: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
} as const;

export const transitions = {
  fast: '150ms ease',
  DEFAULT: '200ms ease',
  slow: '300ms ease',
} as const;
```

### 2. apps/web/lib/design-tokens/index.ts

```typescript
export * from './tokens';
```

### 3. apps/web/components/ui/button.tsx

```typescript
'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading, disabled, children, ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';
    
    const variants = {
      primary: 'bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500',
      secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200 focus:ring-gray-500',
      outline: 'border border-gray-300 bg-transparent hover:bg-gray-50 focus:ring-gray-500',
      ghost: 'bg-transparent hover:bg-gray-100 focus:ring-gray-500',
      danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
    };
    
    const sizes = {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-4 py-2 text-sm',
      lg: 'px-6 py-3 text-base',
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading && (
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

export { Button };
```


### 4. apps/web/components/ui/input.tsx

```typescript
'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'block w-full rounded-lg border px-3 py-2 text-sm',
            'focus:outline-none focus:ring-2 focus:ring-offset-0',
            'disabled:bg-gray-50 disabled:cursor-not-allowed',
            'placeholder:text-gray-400',
            error
              ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
              : 'border-gray-300 focus:border-primary-500 focus:ring-primary-500',
            className
          )}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          {...props}
        />
        {error && (
          <p id={`${inputId}-error`} className="mt-1 text-sm text-red-600">
            {error}
          </p>
        )}
        {hint && !error && (
          <p id={`${inputId}-hint`} className="mt-1 text-sm text-gray-500">
            {hint}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export { Input };
```

### 5. apps/web/components/ui/card.tsx

```typescript
import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface CardProps extends HTMLAttributes<HTMLDivElement> {}

function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-gray-200 bg-white shadow-sm',
        className
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: CardProps) {
  return (
    <div
      className={cn('px-6 py-4 border-b border-gray-100', className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-lg font-semibold text-gray-900', className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn('text-sm text-gray-500 mt-1', className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: CardProps) {
  return <div className={cn('px-6 py-4', className)} {...props} />;
}

function CardFooter({ className, ...props }: CardProps) {
  return (
    <div
      className={cn('px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl', className)}
      {...props}
    />
  );
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
```

### 6. apps/web/components/ui/index.ts

```typescript
export { Button, type ButtonProps } from './button';
export { Input, type InputProps } from './input';
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './card';
```

### 7. apps/web/lib/utils.ts

```typescript
/**
 * Utility functions.
 */

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names with Tailwind CSS conflict resolution.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a date for display.
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format a relative time (e.g., "2 hours ago").
 */
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(d);
}

/**
 * Truncate text with ellipsis.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
```

### 8. apps/web/components/providers/index.tsx

```typescript
'use client';

import { type ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth/context';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <AuthProvider>
      {children}
    </AuthProvider>
  );
}
```

### 9. apps/web/lib/api/client.ts

```typescript
/**
 * API client with error handling.
 */

import { isApiError, type ApiError, type ErrorCodeType } from '@project/types';

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      if (isApiError(data)) {
        throw new ApiClientError(
          data.error.message,
          data.error.code as ErrorCodeType,
          response.status,
          data.error.details
        );
      }
      throw new ApiClientError(
        'An unexpected error occurred',
        'INTERNAL_ERROR',
        response.status
      );
    }

    return data;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public code: ErrorCodeType,
    public status: number,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export const apiClient = new ApiClient();
```

### 10. apps/web/public/manifest.json

```json
{
  "name": "SaaS App",
  "short_name": "SaaS",
  "description": "Enterprise-grade SaaS application",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#0ea5e9",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

### 11. Update apps/web/app/layout.tsx

```typescript
import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'SaaS App',
  description: 'Enterprise-grade SaaS application',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#0ea5e9',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

### 12. Update apps/web/tailwind.config.js

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'Monaco', 'monospace'],
      },
    },
  },
  plugins: [],
};
```

### 13. Update apps/web/package.json dependencies

Add these dependencies:

```json
{
  "dependencies": {
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.3.0"
  }
}
```

---

## Verification

After creating all files, run:

```bash
node Masterguide/scaffolding/scripts/verify-phase.js 11
```

### ⛔ STOP AND VERIFY — FINAL PHASE

**This is the last scaffolding phase. Ensure verification passes before proceeding.**

If verification fails, check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common fixes.

**Manual checks if needed:**

```bash
# 1. Install new dependencies
cd apps/web
pnpm add clsx tailwind-merge

# 2. Verify components compile
pnpm lint

# 3. Build the app
pnpm build

# 4. Start dev server and check components render
pnpm dev
# Visit http://localhost:3000
```

**Success Criteria**:
- [ ] Design tokens exported correctly
- [ ] Button, Input, Card components render
- [ ] Providers wrap the app
- [ ] API client handles errors
- [ ] PWA manifest present
- [ ] Tailwind config uses design tokens
- [ ] App builds without errors
- [ ] Verification script shows PASSED

---

## 🎉 Scaffolding Complete!

You have now scaffolded a complete enterprise-grade SaaS foundation.

### What's Been Created

1. **Workspace**: Monorepo with Turborepo, pnpm, TypeScript
2. **Environment**: Type-safe config validation
3. **Types**: Shared types, error codes, exception taxonomy
4. **Database**: Schema, migrations, RLS policies
5. **Auth**: JWT handling, middleware, tier entitlements
6. **Resilience**: Circuit breaker, retry, distributed locks
7. **Workers**: Job state machine, queue, DLQ
8. **API**: Routes, rate limiting, idempotency
9. **Observability**: Structured logging, metrics, health checks
10. **Integrations**: Stripe, webhooks, email
11. **Frontend**: Design tokens, components, providers

### Next Steps

1. **Run verification** for each phase
2. **Configure environment** variables in `.env`
3. **Start Supabase** locally: `supabase start`
4. **Apply migrations**: `supabase db push`
5. **Start development**: `pnpm dev`
6. **Await domain context** from user to begin feature implementation

### Reference Documentation

For deeper understanding of any pattern, see:
- [../INDEX.md](../INDEX.md) - Full pattern index
- Individual pattern docs in parent directories
