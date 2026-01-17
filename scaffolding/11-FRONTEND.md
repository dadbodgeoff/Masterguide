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


---

## Component Testing Additions

> These artifacts establish frontend component testing patterns using Vitest and Testing Library.

### 14. apps/web/tests/components/button.test.tsx

```typescript
/**
 * Button component tests.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../utils';
import { Button } from '@/components/ui/button';

describe('Button', () => {
  it('renders children correctly', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument();
  });

  it('applies variant styles', () => {
    const { rerender } = render(<Button variant="primary">Primary</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-primary-600');

    rerender(<Button variant="danger">Danger</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-red-600');

    rerender(<Button variant="outline">Outline</Button>);
    expect(screen.getByRole('button')).toHaveClass('border');
  });

  it('applies size styles', () => {
    const { rerender } = render(<Button size="sm">Small</Button>);
    expect(screen.getByRole('button')).toHaveClass('px-3', 'py-1.5');

    rerender(<Button size="lg">Large</Button>);
    expect(screen.getByRole('button')).toHaveClass('px-6', 'py-3');
  });

  it('shows loading spinner when isLoading', () => {
    render(<Button isLoading>Loading</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button.querySelector('svg')).toBeInTheDocument();
  });

  it('is disabled when disabled prop is true', () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('calls onClick handler when clicked', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick when disabled', () => {
    const handleClick = vi.fn();
    render(<Button disabled onClick={handleClick}>Click</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('does not call onClick when loading', () => {
    const handleClick = vi.fn();
    render(<Button isLoading onClick={handleClick}>Click</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('forwards ref correctly', () => {
    const ref = vi.fn();
    render(<Button ref={ref}>Button</Button>);
    expect(ref).toHaveBeenCalled();
    expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLButtonElement);
  });
});
```

### 15. apps/web/tests/components/input.test.tsx

```typescript
/**
 * Input component tests.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../utils';
import { Input } from '@/components/ui/input';

describe('Input', () => {
  it('renders with label', () => {
    render(<Input label="Email" />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it('generates id from label', () => {
    render(<Input label="First Name" />);
    const input = screen.getByLabelText(/first name/i);
    expect(input).toHaveAttribute('id', 'first-name');
  });

  it('uses provided id over generated', () => {
    render(<Input label="Email" id="custom-id" />);
    const input = screen.getByLabelText(/email/i);
    expect(input).toHaveAttribute('id', 'custom-id');
  });

  it('shows error message', () => {
    render(<Input label="Email" error="Invalid email" />);
    expect(screen.getByText(/invalid email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows hint when no error', () => {
    render(<Input label="Email" hint="We'll never share your email" />);
    expect(screen.getByText(/we'll never share/i)).toBeInTheDocument();
  });

  it('hides hint when error is present', () => {
    render(<Input label="Email" hint="Hint text" error="Error text" />);
    expect(screen.queryByText(/hint text/i)).not.toBeInTheDocument();
    expect(screen.getByText(/error text/i)).toBeInTheDocument();
  });

  it('applies error styles when error is present', () => {
    render(<Input label="Email" error="Invalid" />);
    const input = screen.getByLabelText(/email/i);
    expect(input).toHaveClass('border-red-300');
  });

  it('handles value changes', () => {
    const handleChange = vi.fn();
    render(<Input label="Email" onChange={handleChange} />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    expect(handleChange).toHaveBeenCalled();
  });

  it('is disabled when disabled prop is true', () => {
    render(<Input label="Email" disabled />);
    expect(screen.getByLabelText(/email/i)).toBeDisabled();
  });

  it('forwards ref correctly', () => {
    const ref = vi.fn();
    render(<Input label="Email" ref={ref} />);
    expect(ref).toHaveBeenCalled();
    expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLInputElement);
  });

  it('sets aria-describedby for error', () => {
    render(<Input label="Email" id="email" error="Invalid" />);
    const input = screen.getByLabelText(/email/i);
    expect(input).toHaveAttribute('aria-describedby', 'email-error');
  });

  it('sets aria-describedby for hint', () => {
    render(<Input label="Email" id="email" hint="Hint" />);
    const input = screen.getByLabelText(/email/i);
    expect(input).toHaveAttribute('aria-describedby', 'email-hint');
  });
});
```

### 16. apps/web/tests/components/card.test.tsx

```typescript
/**
 * Card component tests.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '../utils';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText(/card content/i)).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<Card className="custom-class">Content</Card>);
    expect(screen.getByText(/content/i).parentElement).toHaveClass('custom-class');
  });

  it('has default styles', () => {
    render(<Card data-testid="card">Content</Card>);
    const card = screen.getByTestId('card');
    expect(card).toHaveClass('rounded-xl', 'border', 'bg-white', 'shadow-sm');
  });
});

describe('CardHeader', () => {
  it('renders children', () => {
    render(<CardHeader>Header content</CardHeader>);
    expect(screen.getByText(/header content/i)).toBeInTheDocument();
  });

  it('has border-bottom style', () => {
    render(<CardHeader data-testid="header">Header</CardHeader>);
    expect(screen.getByTestId('header')).toHaveClass('border-b');
  });
});

describe('CardTitle', () => {
  it('renders as h3', () => {
    render(<CardTitle>Title</CardTitle>);
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Title');
  });

  it('has correct styles', () => {
    render(<CardTitle>Title</CardTitle>);
    expect(screen.getByRole('heading')).toHaveClass('text-lg', 'font-semibold');
  });
});

describe('CardDescription', () => {
  it('renders description text', () => {
    render(<CardDescription>Description text</CardDescription>);
    expect(screen.getByText(/description text/i)).toBeInTheDocument();
  });

  it('has muted text style', () => {
    render(<CardDescription data-testid="desc">Desc</CardDescription>);
    expect(screen.getByTestId('desc')).toHaveClass('text-gray-500');
  });
});

describe('CardContent', () => {
  it('renders children', () => {
    render(<CardContent>Main content</CardContent>);
    expect(screen.getByText(/main content/i)).toBeInTheDocument();
  });

  it('has padding', () => {
    render(<CardContent data-testid="content">Content</CardContent>);
    expect(screen.getByTestId('content')).toHaveClass('px-6', 'py-4');
  });
});

describe('CardFooter', () => {
  it('renders children', () => {
    render(<CardFooter>Footer content</CardFooter>);
    expect(screen.getByText(/footer content/i)).toBeInTheDocument();
  });

  it('has background and border-top', () => {
    render(<CardFooter data-testid="footer">Footer</CardFooter>);
    const footer = screen.getByTestId('footer');
    expect(footer).toHaveClass('border-t', 'bg-gray-50');
  });
});

describe('Card composition', () => {
  it('renders full card structure', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Card Title</CardTitle>
          <CardDescription>Card description</CardDescription>
        </CardHeader>
        <CardContent>Main content here</CardContent>
        <CardFooter>Footer actions</CardFooter>
      </Card>
    );

    expect(screen.getByRole('heading', { name: /card title/i })).toBeInTheDocument();
    expect(screen.getByText(/card description/i)).toBeInTheDocument();
    expect(screen.getByText(/main content here/i)).toBeInTheDocument();
    expect(screen.getByText(/footer actions/i)).toBeInTheDocument();
  });
});
```

### 17. apps/web/tests/lib/utils.test.ts

```typescript
/**
 * Utility function tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cn, formatDate, formatRelativeTime, truncate } from '@/lib/utils';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    expect(cn('foo', false && 'bar', 'baz')).toBe('foo baz');
  });

  it('handles arrays', () => {
    expect(cn(['foo', 'bar'])).toBe('foo bar');
  });

  it('handles objects', () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe('foo baz');
  });

  it('resolves Tailwind conflicts', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('handles undefined and null', () => {
    expect(cn('foo', undefined, null, 'bar')).toBe('foo bar');
  });
});

describe('formatDate', () => {
  it('formats Date object', () => {
    const date = new Date('2024-03-15');
    expect(formatDate(date)).toBe('Mar 15, 2024');
  });

  it('formats ISO string', () => {
    expect(formatDate('2024-03-15T00:00:00Z')).toBe('Mar 15, 2024');
  });

  it('handles different months', () => {
    expect(formatDate('2024-01-01')).toContain('Jan');
    expect(formatDate('2024-12-25')).toContain('Dec');
  });
});

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-03-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for recent times', () => {
    const date = new Date('2024-03-15T11:59:30Z');
    expect(formatRelativeTime(date)).toBe('just now');
  });

  it('returns minutes ago', () => {
    const date = new Date('2024-03-15T11:45:00Z');
    expect(formatRelativeTime(date)).toBe('15m ago');
  });

  it('returns hours ago', () => {
    const date = new Date('2024-03-15T09:00:00Z');
    expect(formatRelativeTime(date)).toBe('3h ago');
  });

  it('returns days ago', () => {
    const date = new Date('2024-03-13T12:00:00Z');
    expect(formatRelativeTime(date)).toBe('2d ago');
  });

  it('returns formatted date for older dates', () => {
    const date = new Date('2024-03-01T12:00:00Z');
    expect(formatRelativeTime(date)).toBe('Mar 1, 2024');
  });

  it('handles string input', () => {
    expect(formatRelativeTime('2024-03-15T11:59:30Z')).toBe('just now');
  });
});

describe('truncate', () => {
  it('returns original string if shorter than maxLength', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('returns original string if equal to maxLength', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('truncates and adds ellipsis', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
  });

  it('handles very short maxLength', () => {
    expect(truncate('hello', 4)).toBe('h...');
  });

  it('handles empty string', () => {
    expect(truncate('', 10)).toBe('');
  });
});
```

### 18. apps/web/tests/lib/api-client.test.ts

```typescript
/**
 * API client tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient, ApiClientError } from '@/lib/api/client';

describe('ApiClient', () => {
  let client: ApiClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new ApiClient('/api');
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('get', () => {
    it('makes GET request', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: 'test' }),
      });

      const result = await client.get('/users');

      expect(fetchMock).toHaveBeenCalledWith('/api/users', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(result).toEqual({ data: 'test' });
    });
  });

  describe('post', () => {
    it('makes POST request with body', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: '123' }),
      });

      const result = await client.post('/users', { name: 'Test' });

      expect(fetchMock).toHaveBeenCalledWith('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });
      expect(result).toEqual({ id: '123' });
    });

    it('makes POST request without body', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      await client.post('/action');

      expect(fetchMock).toHaveBeenCalledWith('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: undefined,
      });
    });
  });

  describe('put', () => {
    it('makes PUT request', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ updated: true }),
      });

      await client.put('/users/123', { name: 'Updated' });

      expect(fetchMock).toHaveBeenCalledWith('/api/users/123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });
    });
  });

  describe('delete', () => {
    it('makes DELETE request', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ deleted: true }),
      });

      await client.delete('/users/123');

      expect(fetchMock).toHaveBeenCalledWith('/api/users/123', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  describe('error handling', () => {
    it('throws ApiClientError for API errors', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: {
            message: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: { field: 'email' },
          },
        }),
      });

      await expect(client.get('/users')).rejects.toThrow(ApiClientError);

      try {
        await client.get('/users');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError);
        const apiError = error as ApiClientError;
        expect(apiError.message).toBe('Validation failed');
        expect(apiError.code).toBe('VALIDATION_ERROR');
        expect(apiError.status).toBe(400);
        expect(apiError.details).toEqual({ field: 'email' });
      }
    });

    it('throws generic error for non-API errors', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ unexpected: 'format' }),
      });

      await expect(client.get('/users')).rejects.toThrow('An unexpected error occurred');
    });
  });
});

describe('ApiClientError', () => {
  it('has correct properties', () => {
    const error = new ApiClientError('Test error', 'TEST_CODE', 400, { key: 'value' });

    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.status).toBe(400);
    expect(error.details).toEqual({ key: 'value' });
    expect(error.name).toBe('ApiClientError');
  });

  it('is instanceof Error', () => {
    const error = new ApiClientError('Test', 'CODE', 400);
    expect(error).toBeInstanceOf(Error);
  });
});
```

---

## Updated Verification

After creating all files including component tests, run:

```bash
node Masterguide/scaffolding/scripts/verify-phase.js 11
```

**Additional manual checks:**

```bash
# 1. Install test dependencies
cd apps/web
pnpm add -D @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom

# 2. Run component tests
pnpm test

# 3. Run with coverage
pnpm test -- --coverage
```

**Updated Success Criteria**:
- [ ] All original criteria pass
- [ ] Button component tests pass
- [ ] Input component tests pass
- [ ] Card component tests pass
- [ ] Utility function tests pass
- [ ] API client tests pass
- [ ] Test coverage > 80% for components
