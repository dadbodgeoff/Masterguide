# Pre-Flight Checklist

> **Run this BEFORE starting any scaffolding.**

---

## 🤖 Agent Instructions

**Before executing ANY scaffolding phase, verify ALL items below.**

If any check fails, STOP and help the user fix it before proceeding.

---

## Step 0: Configuration (Optional but Recommended)

Before scaffolding, the user can customize what gets built:

```bash
# Copy the example config
cp Masterguide/scaffolding/scaffold-config.example.json scaffold-config.json

# Edit to customize:
# - projectName: Your project name
# - auth.provider: "supabase", "clerk", or "custom"
# - payments.provider: "stripe", "lemonsqueezy", or "none"
# - features: Enable/disable workers, AI, file upload, etc.
```

**If no config exists**, scaffolding uses sensible defaults (Supabase + Stripe).

---

## Required Tools

### Node.js (v20+)

```bash
node --version
# Expected: v20.x.x or higher
```

**If missing or wrong version:**
- Install from https://nodejs.org/ (LTS version)
- Or use nvm: `nvm install 20 && nvm use 20`

### pnpm (v9+)

```bash
pnpm --version
# Expected: 9.x.x or higher
```

**If missing:**
```bash
npm install -g pnpm
```

### Python (v3.11+)

```bash
python --version
# Expected: Python 3.11.x or higher
```

**If missing or wrong version:**
- Install from https://python.org/
- Or use pyenv: `pyenv install 3.11 && pyenv global 3.11`

### Supabase CLI

```bash
supabase --version
# Expected: Any version (1.x+)
```

**If missing:**
```bash
# macOS
brew install supabase/tap/supabase

# Windows (scoop)
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# npm (any platform)
npm install -g supabase
```

### Git

```bash
git --version
# Expected: Any version
```

---

## Directory State

### Must be empty OR only contain Masterguide

```bash
ls -la
# Expected: Empty, or only "Masterguide" folder
```

**If not empty:**
- Create a new directory for the project
- Clone Masterguide into it
- Run scaffolding from the parent directory

### Correct working directory

The scaffolding creates files in the CURRENT directory, not inside Masterguide.

```
your-project/           ← You should be HERE
├── Masterguide/        ← Reference docs live here
├── scaffold-config.json ← Your config (optional)
├── apps/               ← Scaffolding creates this
├── packages/           ← Scaffolding creates this
└── ...
```

---

## Environment Preparation

### Copy .env.example (after Phase 01)

After Phase 01 completes, before Phase 02:

```bash
cp .env.example .env
```

Then edit `.env` with real values (or keep defaults for local dev).

### Supabase Project (optional for local dev)

For local development:
```bash
supabase start
# This starts local Supabase, no account needed
```

For production, create a project at https://supabase.com/

---

## Pre-Flight Verification Script

Run this to check everything at once:

```bash
echo "=== Pre-Flight Check ===" && \
echo -n "Node: " && node --version && \
echo -n "pnpm: " && pnpm --version && \
echo -n "Python: " && python --version && \
echo -n "Supabase: " && supabase --version && \
echo -n "Git: " && git --version && \
echo "=== All checks passed ==="
```

**Expected output:**
```
=== Pre-Flight Check ===
Node: v20.x.x
pnpm: 9.x.x
Python: Python 3.11.x
Supabase: 1.x.x
Git: git version 2.x.x
=== All checks passed ===
```

---

## Initialize Scaffold State

After pre-flight passes, initialize the state tracker:

```bash
node Masterguide/scaffolding/scripts/scaffold-state.js status
```

This creates `scaffold-state.json` which tracks progress across sessions.

---

## Ready to Start

Once all checks pass, tell the user:

> "Pre-flight checks complete. Ready to begin scaffolding."
> 
> "Run `node Masterguide/scaffolding/scripts/resume-scaffold.js prompt` to get started."

Then proceed to [01-WORKSPACE.md](./01-WORKSPACE.md).
