# Database Migration Patterns

> **Implementation Time**: 2h  
> **Complexity**: Low  
> **Dependencies**: Supabase CLI

## Problem

Schema changes break production. Migrations run in wrong order. No rollback plan. Team members have different local schemas.

## Solution

Numbered migrations. Atomic changes. Safe patterns for zero-downtime deploys.

## Migration Structure

```
supabase/
├── migrations/
│   ├── 001_initial.sql
│   ├── 002_add_user_profiles.sql
│   ├── 003_add_predictions.sql
│   ├── 004_add_indexes.sql
│   └── 005_add_functions.sql
├── seed.sql
└── config.toml
```

## Migration Naming

```
{number}_{description}.sql

001_initial.sql
002_add_user_profiles.sql
003_add_predictions_table.sql
004_add_country_index.sql
005_fix_trigger_bug.sql
```

## Safe Migration Patterns

### 1. Adding a Column (Safe)

```sql
-- 003_add_country_code.sql

-- Add nullable column first (no lock)
ALTER TABLE predictions 
ADD COLUMN country_code VARCHAR(10);

-- Add index concurrently (no lock)
CREATE INDEX CONCURRENTLY idx_predictions_country 
ON predictions(country_code);

-- Backfill in batches (separate migration or script)
-- UPDATE predictions SET country_code = 'US' WHERE id IN (SELECT id FROM predictions WHERE country_code IS NULL LIMIT 1000);
```

### 2. Adding NOT NULL Column (Two-Step)

```sql
-- Step 1: 003_add_status_nullable.sql
ALTER TABLE orders 
ADD COLUMN status VARCHAR(20) DEFAULT 'pending';

-- Step 2: 004_make_status_not_null.sql (after backfill)
ALTER TABLE orders 
ALTER COLUMN status SET NOT NULL;
```

### 3. Renaming a Column (Safe)

```sql
-- 005_rename_column.sql

-- Add new column
ALTER TABLE users ADD COLUMN display_name VARCHAR(255);

-- Copy data
UPDATE users SET display_name = name;

-- In next migration (after code deploys):
-- ALTER TABLE users DROP COLUMN name;
```

### 4. Adding an Index (Safe)

```sql
-- 006_add_index.sql

-- CONCURRENTLY prevents table lock
CREATE INDEX CONCURRENTLY idx_events_date 
ON events(event_date);

-- For unique indexes
CREATE UNIQUE INDEX CONCURRENTLY idx_users_email 
ON users(email);
```

### 5. Creating a Table

```sql
-- 007_create_watchlists.sql

CREATE TABLE watchlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    countries TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_watchlists_user ON watchlists(user_id);

-- RLS
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own watchlists" 
ON watchlists FOR ALL 
USING (auth.uid() = user_id);
```

### 6. Adding a Function

```sql
-- 008_add_increment_function.sql

CREATE OR REPLACE FUNCTION increment_counter(
    p_user_id UUID,
    p_date DATE
) RETURNS VOID AS $$
BEGIN
    UPDATE user_profiles
    SET 
        counter = CASE 
            WHEN counter_date = p_date THEN counter + 1
            ELSE 1
        END,
        counter_date = p_date,
        updated_at = NOW()
    WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql;
```

### 7. Adding a Trigger

```sql
-- 009_add_updated_at_trigger.sql

-- Generic updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to table
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
```

## Dangerous Operations

### ❌ Avoid in Production

```sql
-- DANGEROUS: Locks table
ALTER TABLE large_table ADD COLUMN new_col VARCHAR(255) NOT NULL DEFAULT 'value';

-- DANGEROUS: Full table scan
UPDATE large_table SET column = 'value';

-- DANGEROUS: Drops data
DROP TABLE important_data;
ALTER TABLE users DROP COLUMN email;

-- DANGEROUS: Locks table
CREATE INDEX idx_name ON large_table(column); -- Missing CONCURRENTLY
```

### ✅ Safe Alternatives

```sql
-- Safe: Add nullable, then backfill, then add constraint
ALTER TABLE large_table ADD COLUMN new_col VARCHAR(255);
-- Backfill in batches
ALTER TABLE large_table ALTER COLUMN new_col SET NOT NULL;

-- Safe: Batch updates
DO $$
DECLARE
    batch_size INT := 1000;
BEGIN
    LOOP
        UPDATE large_table 
        SET column = 'value' 
        WHERE id IN (
            SELECT id FROM large_table 
            WHERE column IS NULL 
            LIMIT batch_size
        );
        EXIT WHEN NOT FOUND;
        COMMIT;
    END LOOP;
END $$;

-- Safe: Concurrent index
CREATE INDEX CONCURRENTLY idx_name ON large_table(column);
```

## Supabase CLI Commands

```bash
# Create new migration
supabase migration new add_feature_x

# Apply migrations locally
supabase db reset

# Push to remote
supabase db push

# Pull remote schema
supabase db pull

# Check migration status
supabase migration list
```

## Migration Checklist

Before deploying:
- [ ] Migration is idempotent (can run twice safely)
- [ ] No table locks on large tables
- [ ] Indexes created with CONCURRENTLY
- [ ] New columns are nullable or have defaults
- [ ] RLS policies added for new tables
- [ ] Tested on copy of production data

## Rollback Strategy

```sql
-- 010_add_feature.sql
-- UP
ALTER TABLE users ADD COLUMN feature_flag BOOLEAN DEFAULT false;

-- To rollback, create new migration:
-- 011_rollback_feature.sql
ALTER TABLE users DROP COLUMN feature_flag;
```

## Production Checklist

- [ ] Migrations numbered sequentially
- [ ] Each migration is atomic
- [ ] No breaking changes without multi-step deploy
- [ ] Indexes use CONCURRENTLY
- [ ] Large data changes batched
- [ ] RLS policies included

## Related Patterns

- [Row Level Security](../01-auth/ROW_LEVEL_SECURITY.md)
- [Atomic Operations](./ATOMIC_OPERATIONS.md)
