# TypeScript Strict Mode

> **Implementation Time**: 1h  
> **Complexity**: Low  
> **Dependencies**: typescript 5+

## Problem

Loose TypeScript catches fewer bugs. `any` types leak through. Runtime errors that could have been compile-time errors.

## Solution

Strict mode + additional safety flags. Catch errors at build time, not in production.

## Configuration

### tsconfig.base.json (Root)

```json
{
  "compilerOptions": {
    // Target modern JS
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    
    // STRICT MODE - The important part
    "strict": true,                        // Enables all strict checks
    "noUncheckedIndexedAccess": true,      // array[0] is T | undefined
    "noImplicitOverride": true,            // Require 'override' keyword
    "noPropertyAccessFromIndexSignature": true,
    "exactOptionalPropertyTypes": true,    // undefined !== missing
    
    // Additional safety
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    
    // Interop
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    
    // Output
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

### What Each Flag Does

| Flag | Effect | Example |
|------|--------|---------|
| `strict` | Enables all strict type checks | `null` not assignable to `string` |
| `noUncheckedIndexedAccess` | Array access returns `T \| undefined` | `arr[0]?.name` required |
| `noImplicitOverride` | Must use `override` keyword | `override toString()` |
| `exactOptionalPropertyTypes` | `undefined` ≠ missing property | `{ a?: string }` vs `{ a: undefined }` |
| `noImplicitReturns` | All code paths must return | No silent `undefined` returns |

## Path Aliases

### tsconfig.json (App)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@/components/*": ["./components/*"],
      "@/lib/*": ["./lib/*"],
      "@/hooks/*": ["./hooks/*"]
    }
  }
}
```

### Usage

```typescript
// Before (fragile)
import { Button } from '../../../components/ui/Button';

// After (clean)
import { Button } from '@/components/ui/Button';
```

## Type Patterns

### 1. Branded Types (Prevent ID Mixups)

```typescript
// types/branded.ts
declare const brand: unique symbol;

type Brand<T, B> = T & { [brand]: B };

export type UserId = Brand<string, 'UserId'>;
export type PredictionId = Brand<string, 'PredictionId'>;

// Usage - compiler prevents mixing IDs
function getPrediction(id: PredictionId): Promise<Prediction>;
function getUser(id: UserId): Promise<User>;

// This fails at compile time:
const userId: UserId = 'user_123' as UserId;
getPrediction(userId); // ❌ Type error!
```

### 2. Exhaustive Switch

```typescript
// Ensure all enum cases handled
type Status = 'pending' | 'active' | 'completed' | 'failed';

function getStatusColor(status: Status): string {
  switch (status) {
    case 'pending': return 'yellow';
    case 'active': return 'blue';
    case 'completed': return 'green';
    case 'failed': return 'red';
    default:
      // This line ensures exhaustiveness
      const _exhaustive: never = status;
      throw new Error(`Unhandled status: ${_exhaustive}`);
  }
}
```

### 3. Result Type (No Exceptions)

```typescript
// types/result.ts
export type Result<T, E = Error> = 
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// Usage
async function fetchUser(id: string): Promise<Result<User, 'NOT_FOUND' | 'NETWORK_ERROR'>> {
  try {
    const user = await db.users.find(id);
    if (!user) return err('NOT_FOUND');
    return ok(user);
  } catch {
    return err('NETWORK_ERROR');
  }
}

// Caller must handle both cases
const result = await fetchUser('123');
if (!result.ok) {
  // TypeScript knows result.error is 'NOT_FOUND' | 'NETWORK_ERROR'
  console.error(result.error);
  return;
}
// TypeScript knows result.value is User
console.log(result.value.name);
```

### 4. Zod for Runtime Validation

```typescript
// schemas.ts
import { z } from 'zod';

export const PredictionSchema = z.object({
  id: z.string(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  riskScore: z.number().int().min(0).max(100),
  createdAt: z.string().datetime(),
});

export type Prediction = z.infer<typeof PredictionSchema>;

// Usage - validate external data
function handleWebhook(body: unknown): Prediction {
  return PredictionSchema.parse(body); // Throws if invalid
}

// Or safe parse
const result = PredictionSchema.safeParse(body);
if (!result.success) {
  console.error(result.error.issues);
}
```

## Common Strict Mode Fixes

### Fix 1: Object Index Access

```typescript
// ❌ Error with noUncheckedIndexedAccess
const items = ['a', 'b', 'c'];
const first = items[0].toUpperCase(); // items[0] is string | undefined

// ✅ Fix: Check first
const first = items[0];
if (first) {
  console.log(first.toUpperCase());
}

// ✅ Or use non-null assertion (when you're sure)
const first = items[0]!.toUpperCase();
```

### Fix 2: Optional Properties

```typescript
// ❌ Error with exactOptionalPropertyTypes
interface Config {
  timeout?: number;
}
const config: Config = { timeout: undefined }; // Error!

// ✅ Fix: Omit the property or use a different type
const config: Config = {}; // OK
// Or
interface Config {
  timeout?: number | undefined; // Explicitly allow undefined
}
```

### Fix 3: Implicit Any in Callbacks

```typescript
// ❌ Error with strict
items.map(item => item.name); // 'item' implicitly has 'any' type

// ✅ Fix: Type the parameter
items.map((item: Item) => item.name);
// Or type the array
const items: Item[] = [];
items.map(item => item.name); // item is inferred as Item
```

## Production Checklist

- [ ] `strict: true` in tsconfig
- [ ] `noUncheckedIndexedAccess: true` enabled
- [ ] No `any` types (use `unknown` + type guards)
- [ ] Zod schemas for external data
- [ ] Path aliases configured
- [ ] CI fails on type errors

## Related Patterns

- [Monorepo Structure](./MONOREPO_STRUCTURE.md)
- [Environment Config](./ENVIRONMENT_CONFIG.md)
