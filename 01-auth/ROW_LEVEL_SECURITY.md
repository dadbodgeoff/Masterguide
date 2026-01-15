# Row Level Security (RLS)

> **Implementation Time**: 2h  
> **Complexity**: Medium  
> **Dependencies**: PostgreSQL (Supabase)

## Problem

Without RLS, any authenticated user can query any row. One bad API endpoint exposes everyone's data. Defense in depth requires database-level protection.

## Solution

PostgreSQL Row Level Security. The database enforces access rules—even if your API has bugs, users can only see their own data.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Request Flow                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  API Request                                                    │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────┐                                                │
│  │ Supabase    │  JWT contains user_id                          │
│  │ Client      │──────────────────────────────────┐             │
│  └─────────────┘                                  │             │
│       │                                           │             │
│       ▼                                           ▼             │
│  ┌─────────────┐                          ┌─────────────┐       │
│  │ PostgreSQL  │                          │ auth.uid()  │       │
│  │             │◀─────────────────────────│ = user_id   │       │
│  │ SELECT *    │                          └─────────────┘       │
│  │ FROM data   │                                                │
│  │ WHERE ...   │  RLS Policy:                                   │
│  │             │  "user_id = auth.uid()"                        │
│  └─────────────┘                                                │
│       │                                                         │
│       ▼                                                         │
│  Only user's rows returned                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation

### 1. Enable RLS on Tables

```sql
-- ALWAYS enable RLS on tables with user data
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
```

### 2. User Profile Policies

```sql
-- Users can only see their own profile
CREATE POLICY "Users can view own profile" 
ON user_profiles
FOR SELECT 
USING (auth.uid() = id);

-- Users can only update their own profile
CREATE POLICY "Users can update own profile" 
ON user_profiles
FOR UPDATE 
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- No direct insert (handled by trigger on auth.users)
-- No delete (cascade from auth.users)
```

### 3. User-Owned Resource Policies

```sql
-- Alert preferences: full CRUD for owner
CREATE POLICY "Users can manage own alerts" 
ON alert_preferences
FOR ALL 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Watchlists: full CRUD for owner
CREATE POLICY "Users can manage own watchlists" 
ON watchlists
FOR ALL 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
```

### 4. Public Read, Owner Write

```sql
-- Predictions: anyone can read, only system can write
CREATE POLICY "Anyone can read predictions" 
ON predictions
FOR SELECT 
USING (true);

-- No insert/update/delete policies = only service role can write
```

### 5. Service Role Bypass

```typescript
// lib/supabase-admin.ts
import { createClient } from '@supabase/supabase-js';

// Service role client bypasses RLS
// ONLY use server-side, NEVER expose to client
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // Secret key
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Usage: Admin operations that need to bypass RLS
async function adminUpdateUser(userId: string, data: object) {
  const { error } = await supabaseAdmin
    .from('user_profiles')
    .update(data)
    .eq('id', userId);
  
  return !error;
}
```

## Common Policy Patterns

### Pattern 1: Owner Only

```sql
-- User owns the resource
CREATE POLICY "owner_only" ON resources
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
```

### Pattern 2: Public Read, Owner Write

```sql
-- Anyone can read
CREATE POLICY "public_read" ON posts
FOR SELECT
USING (true);

-- Only owner can modify
CREATE POLICY "owner_write" ON posts
FOR INSERT
WITH CHECK (auth.uid() = author_id);

CREATE POLICY "owner_update" ON posts
FOR UPDATE
USING (auth.uid() = author_id);

CREATE POLICY "owner_delete" ON posts
FOR DELETE
USING (auth.uid() = author_id);
```

### Pattern 3: Team/Organization Access

```sql
-- Users can access resources in their organization
CREATE POLICY "org_access" ON org_resources
FOR ALL
USING (
  org_id IN (
    SELECT org_id FROM org_members 
    WHERE user_id = auth.uid()
  )
);
```

### Pattern 4: Role-Based Access

```sql
-- Check user role from profile
CREATE POLICY "admin_only" ON admin_resources
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_profiles 
    WHERE id = auth.uid() 
    AND role = 'admin'
  )
);
```

### Pattern 5: Time-Based Access

```sql
-- Only access non-expired resources
CREATE POLICY "not_expired" ON subscriptions
FOR SELECT
USING (
  auth.uid() = user_id 
  AND expires_at > NOW()
);
```

## Testing RLS Policies

```sql
-- Test as a specific user
SET request.jwt.claims = '{"sub": "user-uuid-here"}';

-- Try to select another user's data (should return empty)
SELECT * FROM user_profiles WHERE id != 'user-uuid-here';

-- Reset
RESET request.jwt.claims;
```

### In Application Code

```typescript
// Test that RLS is working
async function testRLS() {
  const supabase = createClient(); // Uses anon key
  
  // This should only return the current user's profile
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*');
  
  console.log('Returned rows:', data?.length); // Should be 1
  
  // This should fail or return empty
  const { data: others } = await supabase
    .from('user_profiles')
    .select('*')
    .neq('id', currentUserId);
  
  console.log('Other users:', others?.length); // Should be 0
}
```

## Common Mistakes

### ❌ Forgetting to Enable RLS

```sql
-- Table created but RLS not enabled = anyone can access everything
CREATE TABLE secrets (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  secret TEXT
);
-- MISSING: ALTER TABLE secrets ENABLE ROW LEVEL SECURITY;
```

### ❌ Missing WITH CHECK

```sql
-- This allows reading own data but inserting for ANY user
CREATE POLICY "bad_policy" ON data
FOR ALL
USING (auth.uid() = user_id);
-- MISSING: WITH CHECK (auth.uid() = user_id)
```

### ❌ Using Service Role in Client

```typescript
// NEVER do this - exposes service role key to browser
const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
```

## Debugging RLS Issues

```sql
-- Check if RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public';

-- List all policies on a table
SELECT * FROM pg_policies WHERE tablename = 'user_profiles';

-- Check current user in policy context
SELECT auth.uid();
SELECT auth.role();
```

## Production Checklist

- [ ] RLS enabled on ALL tables with user data
- [ ] Every table has appropriate policies
- [ ] Policies use `WITH CHECK` for INSERT/UPDATE
- [ ] Service role key is server-side only
- [ ] Tested that users can't access others' data
- [ ] Admin operations use service role explicitly

## Related Patterns

- [Supabase Auth](./SUPABASE_AUTH.md)
- [Tier Entitlements](./TIER_ENTITLEMENTS.md)
