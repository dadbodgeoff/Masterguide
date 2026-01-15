# Troubleshooting Guide

> **Common issues and how to fix them.**

---

## 🤖 Agent Instructions

When a user encounters an error, check this guide FIRST before attempting to debug manually.

---

## Pre-Flight Issues

### "node: command not found"

**Problem**: Node.js not installed or not in PATH.

**Fix**:
```bash
# Install Node.js 20 LTS from https://nodejs.org/
# Or use nvm:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20
```

### "pnpm: command not found"

**Problem**: pnpm not installed.

**Fix**:
```bash
npm install -g pnpm
```

### "python: command not found" (Windows)

**Problem**: Python not in PATH, or need to use `python3`.

**Fix**:
```bash
# Try python3 instead
python3 --version

# Or add Python to PATH during installation
# Re-run Python installer, check "Add to PATH"
```

### "supabase: command not found"

**Problem**: Supabase CLI not installed.

**Fix**:
```bash
# macOS
brew install supabase/tap/supabase

# Windows
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# Any platform via npm
npm install -g supabase
```

---

## Phase 01 Issues

### "ENOENT: no such file or directory, open 'package.json'"

**Problem**: Running commands before creating package.json.

**Fix**: Create package.json first, then run pnpm install.

### "ERR_PNPM_OUTDATED_LOCKFILE"

**Problem**: Lockfile out of sync.

**Fix**:
```bash
rm pnpm-lock.yaml
pnpm install
```

### "Cannot find module '@project/types'"

**Problem**: Types package not built yet.

**Fix**:
```bash
pnpm --filter @project/types build
```

### Files created inside Masterguide/ instead of project root

**Problem**: Agent created files in wrong location.

**Fix**:
1. Delete the incorrectly placed files
2. Clarify to agent: "Create files in the project root directory, NOT inside Masterguide/"
3. Re-run the phase

---

## Phase 02 Issues

### "Cannot find module 'zod'"

**Problem**: Dependencies not installed.

**Fix**:
```bash
cd apps/web
pnpm install
```

### "Invalid environment variables" error on startup

**Problem**: Missing required env vars.

**Fix**:
1. Copy .env.example to .env: `cp .env.example .env`
2. Fill in required values (or use dummy values for local dev)
3. Required vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET

### Python config.py import error

**Problem**: Pydantic settings not installed.

**Fix**:
```bash
cd packages/backend
pip install pydantic-settings
# Or if using venv:
source .venv/bin/activate
pip install -e ".[dev]"
```

---

## Phase 03 Issues

### "Module '"@project/types"' has no exported member 'ErrorCode'"

**Problem**: index.ts not updated to export new files.

**Fix**: Ensure packages/types/src/index.ts includes:
```typescript
export * from './errors';
export * from './auth';
export * from './jobs';
export * from './api';
```

Then rebuild:
```bash
pnpm --filter @project/types build
```

### Python exceptions.py syntax error

**Problem**: Dataclass syntax issue (usually Python version).

**Fix**: Ensure Python 3.11+:
```bash
python --version
# Must be 3.11 or higher
```

---

## Phase 04 Issues

### "supabase start" fails

**Problem**: Docker not running or ports in use.

**Fix**:
```bash
# Ensure Docker is running
docker ps

# If ports in use, stop existing Supabase
supabase stop

# Start fresh
supabase start
```

### "relation 'users' does not exist"

**Problem**: Migrations not applied.

**Fix**:
```bash
supabase db push
```

### "permission denied for table users"

**Problem**: RLS policies blocking access.

**Fix**: Ensure you're using the service role key for admin operations, not the anon key.

---

## Phase 05 Issues

### "Cannot find module '@/lib/supabase/client'"

**Problem**: Path alias not resolving.

**Fix**: Check apps/web/tsconfig.json has:
```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

### JWT token errors

**Problem**: JWT_SECRET not set or too short.

**Fix**: Ensure .env has:
```
JWT_SECRET=your-secret-key-at-least-32-characters-long
```

---

## Phase 06 Issues

### "Redis connection refused"

**Problem**: Redis not running (this is OK for local dev).

**Fix**: The resilience patterns gracefully degrade without Redis. For local dev, this is fine. For production:
```bash
# Start Redis locally
docker run -d -p 6379:6379 redis

# Or set REDIS_URL in .env
REDIS_URL=redis://localhost:6379
```

---

## Phase 07 Issues

### "Invalid state transition"

**Problem**: Job state machine rejecting transition.

**Fix**: This is working as intended. Jobs can only transition:
- QUEUED → PROCESSING
- PROCESSING → COMPLETED | PARTIAL | FAILED

Check the current job status before transitioning.

---

## Phase 08 Issues

### "No module named 'src.auth'"

**Problem**: Python module path issue.

**Fix**: Run from packages/backend directory:
```bash
cd packages/backend
python -m uvicorn src.main:app --reload
```

### Next.js API route 404

**Problem**: Route file in wrong location.

**Fix**: Ensure route files are at:
- `apps/web/app/api/jobs/route.ts` (not `routes.ts`)
- `apps/web/app/api/jobs/[jobId]/route.ts`

---

## Phase 09 Issues

### "No module named 'structlog'"

**Problem**: Python dependencies not installed.

**Fix**:
```bash
cd packages/backend
pip install structlog
# Or reinstall all:
pip install -e ".[dev]"
```

---

## Phase 10 Issues

### "Invalid Stripe API key"

**Problem**: Stripe not configured (this is OK for scaffolding).

**Fix**: The Stripe service checks `settings.stripe_enabled` and gracefully handles missing keys. For actual payments, add to .env:
```
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

### Webhook signature verification failed

**Problem**: Wrong webhook secret or payload modified.

**Fix**:
1. Get webhook secret from Stripe Dashboard → Webhooks
2. Ensure raw body is passed to verification (not parsed JSON)
3. Check STRIPE_WEBHOOK_SECRET in .env matches

---

## Phase 11 Issues

### "Cannot find module 'clsx'"

**Problem**: UI dependencies not installed.

**Fix**:
```bash
cd apps/web
pnpm add clsx tailwind-merge
```

### Tailwind classes not applying

**Problem**: Tailwind not processing files.

**Fix**: Check tailwind.config.js content paths:
```javascript
content: [
  './app/**/*.{js,ts,jsx,tsx,mdx}',
  './components/**/*.{js,ts,jsx,tsx,mdx}',
  './lib/**/*.{js,ts,jsx,tsx,mdx}',
],
```

---

## General Issues

### "EACCES: permission denied"

**Problem**: File permission issue.

**Fix**:
```bash
# Fix ownership (replace with your user)
sudo chown -R $(whoami) .

# Or fix specific file
chmod 644 <filename>
```

### "Port 3000 already in use"

**Problem**: Another process using the port.

**Fix**:
```bash
# Find and kill process
lsof -i :3000
kill -9 <PID>

# Or use different port
pnpm dev -- -p 3001
```

### Agent created duplicate/wrong files

**Problem**: Agent misunderstood instructions.

**Fix**:
1. Run verification: `node Masterguide/scaffolding/scripts/verify-phase.js <phase>`
2. Delete incorrect files
3. Re-run phase with clearer instructions

### "I don't know what phase I'm on"

**Problem**: Lost track of progress.

**Fix**:
```bash
# Check all phases
node Masterguide/scaffolding/scripts/verify-phase.js --all

# Look for checkpoint files
ls -la .scaffolding/
```

---

## Recovery Procedures

### Reset a single phase

```bash
# Example: Reset Phase 05 (Auth)
rm -rf apps/web/lib/auth/
rm -rf apps/web/app/api/auth/
rm -rf packages/backend/src/auth/
rm .scaffolding/.phase-05-complete

# Then re-run Phase 05
```

### Reset everything and start over

```bash
# Nuclear option - delete all scaffolded files
rm -rf apps/ packages/ supabase/ .scaffolding/
rm -f package.json pnpm-workspace.yaml turbo.json tsconfig.base.json
rm -f .gitignore .env .env.example README.md

# Keep only Masterguide
# Then start fresh with Phase 01
```

### Verify entire scaffold

```bash
node Masterguide/scaffolding/scripts/verify-phase.js --all
```

---

## Still Stuck?

If none of the above helps:

1. **Check the phase document** — re-read the "IMPORTANT" section
2. **Run verification** — see exactly what's missing
3. **Check file locations** — files might be in wrong directory
4. **Check imports** — one file might reference another that doesn't exist yet
5. **Start fresh** — sometimes easier than debugging

The scaffolding system is deterministic. If you follow the phases in order and create all files exactly as specified, it will work.
