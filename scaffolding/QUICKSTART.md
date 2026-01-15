# Scaffolding Quick Start

> **5-minute guide to get scaffolding running.**

---

## For Humans (Orchestrators)

### First Time Setup

```bash
# 1. Create project directory
mkdir my-saas && cd my-saas

# 2. Clone or copy Masterguide into it
git clone <masterguide-repo> Masterguide

# 3. (Optional) Customize configuration
cp Masterguide/scaffolding/scaffold-config.example.json scaffold-config.json
# Edit scaffold-config.json to your preferences

# 4. Verify tools are installed
node --version   # Need v20+
pnpm --version   # Need v9+
python --version # Need 3.11+
supabase --version
```

### Start Scaffolding

Tell your AI agent:

```
"Read Masterguide/scaffolding/00-MANIFEST.md and begin scaffolding.
Start with the pre-flight checks, then execute Phase 01."
```

### Resume After Break

```
"Run: node Masterguide/scaffolding/scripts/resume-scaffold.js prompt
Then execute whatever it tells you."
```

### Check Progress

```
"Run: node Masterguide/scaffolding/scripts/scaffold-state.js status"
```

### After Completion

```
"Run the smoke test: node Masterguide/scaffolding/scripts/smoke-test.js
Then generate next steps: node Masterguide/scaffolding/scripts/generate-next-steps.js"
```

---

## For AI Agents

### Execution Loop

```bash
# 1. Check current state
node Masterguide/scaffolding/scripts/scaffold-state.js status

# 2. Get instructions for next phase
node Masterguide/scaffolding/scripts/resume-scaffold.js prompt

# 3. Mark phase as started
node Masterguide/scaffolding/scripts/scaffold-state.js start XX

# 4. Execute the phase document (create all files)

# 5. Verify
node Masterguide/scaffolding/scripts/verify-phase.js XX

# 6. If passed, state auto-updates. If failed:
node Masterguide/scaffolding/scripts/repair-phase.js XX
# Then re-verify

# 7. Repeat until all phases complete

# 8. Final validation
node Masterguide/scaffolding/scripts/smoke-test.js
node Masterguide/scaffolding/scripts/generate-next-steps.js
```

### Key Commands

| Command | Purpose |
|---------|---------|
| `scaffold-state.js status` | See current progress |
| `scaffold-state.js start XX` | Mark phase as started |
| `scaffold-state.js complete XX` | Mark phase as done |
| `scaffold-state.js fail XX "msg"` | Mark phase as failed |
| `resume-scaffold.js prompt` | Get agent-friendly instructions |
| `verify-phase.js XX` | Check phase completion |
| `repair-phase.js XX` | Auto-fix common issues |
| `smoke-test.js` | End-to-end validation |
| `generate-next-steps.js` | Create NEXT_STEPS.md |

---

## File Reference

```
Masterguide/scaffolding/
├── 00-MANIFEST.md          # Main orchestration guide
├── 01-WORKSPACE.md         # Phase 1: Monorepo setup
├── 02-ENVIRONMENT.md       # Phase 2: Env config
├── 03-TYPES.md             # Phase 3: Shared types
├── 04-DATABASE.md          # Phase 4: Database schema
├── 05-AUTH.md              # Phase 5: Authentication
├── 06-RESILIENCE.md        # Phase 6: Fault tolerance
├── 07-WORKERS.md           # Phase 7: Job processing
├── 08-API.md               # Phase 8: API routes
├── 09-OBSERVABILITY.md     # Phase 9: Logging/metrics
├── 10-INTEGRATIONS.md      # Phase 10: Stripe/email
├── 11-FRONTEND.md          # Phase 11: UI components
├── PREFLIGHT.md            # Pre-flight checklist
├── TROUBLESHOOTING.md      # Error fixes
├── QUICKSTART.md           # This file
├── scaffold-config.schema.json   # Config schema
├── scaffold-config.example.json  # Example config
├── scaffold-dashboard.html       # Visual dashboard
└── scripts/
    ├── scaffold-state.js         # State management
    ├── resume-scaffold.js        # Resume instructions
    ├── verify-phase.js           # Phase verification
    ├── repair-phase.js           # Self-healing
    ├── smoke-test.js             # E2E validation
    └── generate-next-steps.js    # Post-scaffold guide
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Phase failed" | Run `repair-phase.js XX`, then re-verify |
| "Missing files" | Re-execute the phase document |
| "Import error" | Check `__init__.py` files exist |
| "TypeScript error" | Run `pnpm install` in apps/web |
| "Lost progress" | Check `scaffold-state.json` |
| "Agent confused" | Run `resume-scaffold.js prompt` |

For detailed fixes, see [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).
