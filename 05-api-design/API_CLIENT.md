# TypeScript API Client Pattern

> **Time to implement:** 4-6 hours  
> **Complexity:** Medium  
> **Prerequisites:** TypeScript, TanStack Query (optional)

## The Problem

Frontend API calls become messy:
- Scattered fetch calls with inconsistent error handling
- No type safety on requests/responses
- Manual token refresh logic duplicated everywhere
- No caching strategy

## The Solution

Centralized API client with:
1. Typed namespaces (auth, users, billing, etc.)
2. Automatic token refresh with request deduplication
3. TanStack Query integration for caching
4. Consistent error handling

## Architecture

```
Component → useQuery/useMutation → API Client → Fetch
                                       ↓
                                  401? → Refresh → Retry
```

## Core Implementation

### Types

```typescript
// lib/api/types.ts
export class APIClientError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'APIClientError';
  }
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  subscriptionTier: 'free' | 'pro' | 'enterprise';
}
```

### API Client Class

```typescript
// lib/api/client.ts
interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: Record<string, unknown>;
  params?: Record<string, string | number | boolean | undefined>;
  skipRefresh?: boolean;
}

export class APIClient {
  private baseUrl: string;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private onUnauthorized: () => void;
  
  // Refresh deduplication
  private isRefreshing = false;
  private refreshPromise: Promise<boolean> | null = null;

  constructor(options: {
    baseUrl: string;
    onUnauthorized?: () => void;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.onUnauthorized = options.onUnauthorized || (() => {});
  }

  // ═══════════════════════════════════════════════════════════════
  // TOKEN MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  setTokens(accessToken: string, refreshToken: string): void {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
  }

  clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
  }

  hasTokens(): boolean {
    return this.accessToken !== null && this.refreshToken !== null;
  }

  // ═══════════════════════════════════════════════════════════════
  // TYPED NAMESPACES
  // ═══════════════════════════════════════════════════════════════

  auth = {
    login: (data: { email: string; password: string }) =>
      this.request<{ tokens: TokenPair; user: User }>('/auth/login', {
        method: 'POST',
        body: data,
      }),

    signup: (data: { email: string; password: string; displayName: string }) =>
      this.request<{ tokens: TokenPair; user: User }>('/auth/signup', {
        method: 'POST',
        body: data,
      }),

    logout: () =>
      this.request<void>('/auth/logout', { method: 'POST' }),

    refresh: () =>
      this.request<TokenPair>('/auth/refresh', {
        method: 'POST',
        body: { refreshToken: this.refreshToken },
        skipRefresh: true, // Prevent infinite loop
      }),

    me: () =>
      this.request<User>('/auth/me', { method: 'GET' }),
  };

  users = {
    get: (id: string) =>
      this.request<User>(`/users/${id}`, { method: 'GET' }),

    update: (id: string, data: Partial<User>) =>
      this.request<User>(`/users/${id}`, { method: 'PATCH', body: data }),

    delete: (id: string) =>
      this.request<void>(`/users/${id}`, { method: 'DELETE' }),
  };

  billing = {
    getStatus: () =>
      this.request<{
        tier: string;
        status: string;
        currentPeriodEnd: string | null;
      }>('/billing/status', { method: 'GET' }),

    createCheckout: (data: { tier: string; interval: 'monthly' | 'yearly' }) =>
      this.request<{ checkoutUrl: string }>('/billing/checkout', {
        method: 'POST',
        body: data,
      }),

    createPortal: () =>
      this.request<{ portalUrl: string }>('/billing/portal', {
        method: 'POST',
      }),
  };

  // ═══════════════════════════════════════════════════════════════
  // CORE REQUEST METHOD
  // ═══════════════════════════════════════════════════════════════

  private async request<T>(
    endpoint: string,
    options: RequestOptions
  ): Promise<T> {
    const url = this.buildUrl(endpoint, options.params);
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(url, {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: 'include',
    });

    // Handle 401 - attempt refresh
    if (response.status === 401 && !options.skipRefresh) {
      const refreshed = await this.attemptTokenRefresh();
      if (refreshed) {
        // Retry original request with new token
        return this.request<T>(endpoint, { ...options, skipRefresh: true });
      }
      this.onUnauthorized();
      throw new APIClientError('Unauthorized', 'UNAUTHORIZED', 401);
    }

    // Handle other errors
    if (!response.ok) {
      const error = await this.parseError(response);
      throw error;
    }

    // Handle empty responses
    if (response.status === 204) {
      return undefined as T;
    }

    const data = await response.json();
    return this.transformResponse<T>(data);
  }

  // ═══════════════════════════════════════════════════════════════
  // AUTO-REFRESH WITH DEDUPLICATION
  // ═══════════════════════════════════════════════════════════════

  private async attemptTokenRefresh(): Promise<boolean> {
    if (!this.refreshToken) return false;

    // Deduplicate concurrent refresh attempts
    if (this.isRefreshing) {
      return this.refreshPromise!;
    }

    this.isRefreshing = true;
    this.refreshPromise = this.doRefresh();

    try {
      return await this.refreshPromise;
    } finally {
      this.isRefreshing = false;
      this.refreshPromise = null;
    }
  }

  private async doRefresh(): Promise<boolean> {
    try {
      const tokens = await this.auth.refresh();
      this.setTokens(tokens.accessToken, tokens.refreshToken);
      return true;
    } catch {
      this.clearTokens();
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  private buildUrl(
    endpoint: string,
    params?: Record<string, string | number | boolean | undefined>
  ): string {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    return url.toString();
  }

  private transformResponse<T>(data: unknown): T {
    // Convert snake_case to camelCase
    return this.snakeToCamel(data) as T;
  }

  private snakeToCamel(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      return obj.map(item => this.snakeToCamel(item));
    }
    if (obj !== null && typeof obj === 'object') {
      return Object.fromEntries(
        Object.entries(obj).map(([key, value]) => [
          key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
          this.snakeToCamel(value),
        ])
      );
    }
    return obj;
  }

  private async parseError(response: Response): Promise<APIClientError> {
    try {
      const data = await response.json();
      return new APIClientError(
        data.message || 'Request failed',
        data.code || 'UNKNOWN_ERROR',
        response.status,
        data.details
      );
    } catch {
      return new APIClientError(
        'Request failed',
        'UNKNOWN_ERROR',
        response.status
      );
    }
  }
}

// Singleton export
export const apiClient = new APIClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL || '/api',
  onUnauthorized: () => {
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  },
});
```

## TanStack Query Integration

### Query Key Factory

```typescript
// lib/api/query-keys.ts
export const queryKeys = {
  auth: {
    all: ['auth'] as const,
    me: () => [...queryKeys.auth.all, 'me'] as const,
  },
  users: {
    all: ['users'] as const,
    detail: (id: string) => [...queryKeys.users.all, id] as const,
  },
  billing: {
    all: ['billing'] as const,
    status: () => [...queryKeys.billing.all, 'status'] as const,
  },
} as const;
```

### Hooks

```typescript
// lib/api/hooks/use-auth.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';
import { queryKeys } from '../query-keys';

export function useCurrentUser() {
  return useQuery({
    queryKey: queryKeys.auth.me(),
    queryFn: () => apiClient.auth.me(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { email: string; password: string }) =>
      apiClient.auth.login(data),
    onSuccess: (response) => {
      apiClient.setTokens(
        response.tokens.accessToken,
        response.tokens.refreshToken
      );
      queryClient.setQueryData(queryKeys.auth.me(), response.user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.auth.logout(),
    onSettled: () => {
      apiClient.clearTokens();
      queryClient.clear();
    },
  });
}
```

```typescript
// lib/api/hooks/use-billing.ts
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from '../client';
import { queryKeys } from '../query-keys';

export function useBillingStatus() {
  return useQuery({
    queryKey: queryKeys.billing.status(),
    queryFn: () => apiClient.billing.getStatus(),
    staleTime: 60 * 1000, // 1 minute
  });
}

export function useCreateCheckout() {
  return useMutation({
    mutationFn: (data: { tier: string; interval: 'monthly' | 'yearly' }) =>
      apiClient.billing.createCheckout(data),
    onSuccess: (response) => {
      window.location.href = response.checkoutUrl;
    },
  });
}
```

## Usage in Components

```tsx
// components/UserProfile.tsx
'use client';

import { useCurrentUser, useLogout } from '@/lib/api/hooks/use-auth';

export function UserProfile() {
  const { data: user, isLoading, error } = useCurrentUser();
  const logout = useLogout();

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error loading profile</div>;
  if (!user) return null;

  return (
    <div>
      <h2>{user.displayName}</h2>
      <p>{user.email}</p>
      <p>Plan: {user.subscriptionTier}</p>
      <button onClick={() => logout.mutate()}>
        {logout.isPending ? 'Logging out...' : 'Logout'}
      </button>
    </div>
  );
}
```

```tsx
// components/UpgradeButton.tsx
'use client';

import { useCreateCheckout } from '@/lib/api/hooks/use-billing';

export function UpgradeButton() {
  const checkout = useCreateCheckout();

  return (
    <button
      onClick={() => checkout.mutate({ tier: 'pro', interval: 'monthly' })}
      disabled={checkout.isPending}
    >
      {checkout.isPending ? 'Redirecting...' : 'Upgrade to Pro'}
    </button>
  );
}
```

## Optimistic Updates

```typescript
// lib/api/hooks/use-users.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';
import { queryKeys } from '../query-keys';
import type { User } from '../types';

export function useUpdateUser(userId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<User>) =>
      apiClient.users.update(userId, data),
    
    // Optimistic update
    onMutate: async (newData) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.users.detail(userId) });
      
      const previousUser = queryClient.getQueryData<User>(
        queryKeys.users.detail(userId)
      );

      queryClient.setQueryData<User>(
        queryKeys.users.detail(userId),
        (old) => old ? { ...old, ...newData } : old
      );

      return { previousUser };
    },

    // Rollback on error
    onError: (err, newData, context) => {
      if (context?.previousUser) {
        queryClient.setQueryData(
          queryKeys.users.detail(userId),
          context.previousUser
        );
      }
    },

    // Refetch on success
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.detail(userId) });
    },
  });
}
```

## File Structure

```
lib/api/
├── client.ts           # APIClient class
├── types.ts            # Shared types
├── query-keys.ts       # Query key factory
└── hooks/
    ├── use-auth.ts     # Auth hooks
    ├── use-users.ts    # User hooks
    └── use-billing.ts  # Billing hooks
```

## Environment Variables

```bash
NEXT_PUBLIC_API_URL=https://api.example.com
```

## Checklist

- [ ] APIClient class with typed namespaces
- [ ] Token management (set/clear/has)
- [ ] Auto-refresh with deduplication
- [ ] Error handling with APIClientError
- [ ] Response transformation (snake_case → camelCase)
- [ ] Query key factory
- [ ] TanStack Query hooks per domain
- [ ] Optimistic updates where appropriate
- [ ] Singleton export for client
- [ ] onUnauthorized callback for redirects
