# Scaffolding Manifest

> **Purpose**: Autonomous infrastructure provisioning system for enterprise-grade SaaS scaffolding.

---

## 🚀 What Makes This Different

This isn't a boilerplate. It's an **autonomous scaffolding system** with:

- **Configuration Layer** — Customize before execution (auth provider, payments, features)
- **State Persistence** — Resume from any point, track progress across sessions
- **Self-Healing** — Automatic detection and repair of common issues
- **Visual Dashboard** — See progress at a glance
- **Smoke Testing** — End-to-end validation that everything works together
- **Guided Handoff** — Personalized next steps after completion

---

## 🤖 Agent Instructions

**You are reading this because a user wants you to scaffold a new SaaS project.**

### Quick Start (For Agents)

```bash
# 1. Check current state
node Masterguide/scaffolding/scripts/scaffold-state.js status

# 2. Get resume instructions
node Masterguide/scaffolding/scripts/resume-scaffold.js prompt

# 3. Execute the indicated phase document

# 4. After each phase, verify and update state
node Masterguide/scaffolding/scripts/verify-phase.js XX
node Masterguide/scaffolding/scripts/scaffold-state.js complete XX
```

### Before Starting

1. **Run pre-flight checks** — Open [PREFLIGHT.md](./PREFLIGHT.md) and verify all tools are installed.

2. **Check for existing state** — Run `node Masterguide/scaffolding/scripts/scaffold-state.js status`

3. **Check for config** — If `scaffold-config.json` exists in project root, use those settings.

### Execution Protocol

1. **Check state first** — Always run `scaffold-state.js status` to see where you are.

2. **Get instructions** — Run `resume-scaffold.js prompt` for exactly what to do next.

3. **Execute one phase at a time** — Open the indicated phase document and follow it exactly.

4. **Update state after each phase**:
   ```bash
   # Before starting a phase
   node Masterguide/scaffolding/scripts/scaffold-state.js start XX
   
   # After verification passes
   node Masterguide/scaffolding/scripts/scaffold-state.js complete XX
   
   # If phase fails
   node Masterguide/scaffolding/scripts/scaffold-state.js fail XX "error message"
   ```

5. **If something fails** — Run the repair script:
   ```bash
   node Masterguide/scaffolding/scripts/repair-phase.js XX
   ```

### If Something Goes Wrong

1. **Run repair** — `node Masterguide/scaffolding/scripts/repair-phase.js XX`
2. **Check troubleshooting** — [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
3. **Re-run verification** — See exactly what's missing
4. **Don't guess** — If stuck, ask the user rather than improvising

---

## 📁 System Files

| File | Purpose |
|------|---------|
| `scaffold-config.json` | User configuration (auth, payments, features) |
| `scaffold-config.schema.json` | Configuration schema with validation |
| `scaffold-config.example.json` | Example configuration to copy |
| `scaffold-state.json` | Progress tracking (auto-generated) |
| `scaffold-dashboard.html` | Visual progress dashboard |
| `PREFLIGHT.md` | Pre-flight checklist |
| `TROUBLESHOOTING.md` | Error fixes |
| `NEXT_STEPS.md` | Post-scaffold guidance (auto-generated) |

### Scripts

| Script | Purpose |
|--------|---------|
| `scripts/scaffold-state.js` | State management (status, start, complete, fail) |
| `scripts/resume-scaffold.js` | Generate resume instructions |
| `scripts/verify-phase.js` | Verify phase completion |
| `scripts/repair-phase.js` | Auto-fix common issues |
| `scripts/smoke-test.js` | End-to-end validation |
| `scripts/generate-next-steps.js` | Generate NEXT_STEPS.md |

---

## 📋 Execution Order

| Phase | Document | Time | Produces |
|-------|----------|------|----------|
| 01 | [01-WORKSPACE](./01-WORKSPACE.md) | 10m | Monorepo structure, tooling, git |
| 02 | [02-ENVIRONMENT](./02-ENVIRONMENT.md) | 5m | Env validation, config management |
| 03 | [03-TYPES](./03-TYPES.md) | 10m | Shared types, exceptions, error codes |
| 04 | [04-DATABASE](./04-DATABASE.md) | 10m | Schema foundation, migrations, RLS |
| 05 | [05-AUTH](./05-AUTH.md) | 15m | Auth infrastructure, middleware, JWT |
| 06 | [06-RESILIENCE](./06-RESILIENCE.md) | 15m | Circuit breakers, retries, locks |
| 07 | [07-WORKERS](./07-WORKERS.md) | 15m | Job system, state machine, DLQ |
| 08 | [08-API](./08-API.md) | 10m | API foundation, middleware, rate limiting |
| 09 | [09-OBSERVABILITY](./09-OBSERVABILITY.md) | 10m | Logging, metrics, health checks |
| 10 | [10-INTEGRATIONS](./10-INTEGRATIONS.md) | 10m | Stripe, webhooks, email stubs |
| 11 | [11-FRONTEND](./11-FRONTEND.md) | 15m | Design tokens, components, PWA |

**Total Time**: ~2 hours for complete enterprise foundation

### Dependencies

```
01-WORKSPACE (required for all)
    └── 02-ENVIRONMENT
        └── 03-TYPES
            ├── 04-DATABASE
            ├── 05-AUTH (requires 04)
            ├── 06-RESILIENCE
            ├── 07-WORKERS (requires 06)
            ├── 08-API (requires 05, 06)
            ├── 09-OBSERVABILITY
            ├── 10-INTEGRATIONS (requires 05, 07)
            └── 11-FRONTEND (requires 02)
```

---

## 🎯 Complete Workflow

### Phase 0: Configuration (Optional)

```bash
# Copy example config
cp Masterguide/scaffolding/scaffold-config.example.json scaffold-config.json

# Edit to customize (auth provider, payments, features, etc.)
# The scaffolding will adapt based on your choices
```

### Phase 1-11: Execution

```bash
# Check status
node Masterguide/scaffolding/scripts/scaffold-state.js status

# Get next phase instructions
node Masterguide/scaffolding/scripts/resume-scaffold.js prompt

# Execute phase (agent reads and follows the phase document)

# Verify
node Masterguide/scaffolding/scripts/verify-phase.js XX

# Update state
node Masterguide/scaffolding/scripts/scaffold-state.js complete XX

# Repeat until all phases complete
```

### Phase 12: Validation

```bash
# Run smoke test
node Masterguide/scaffolding/scripts/smoke-test.js

# Generate next steps guide
node Masterguide/scaffolding/scripts/generate-next-steps.js

# Open dashboard to see final status
# Open scaffold-dashboard.html in browser
```

### Phase 13: Handoff

After scaffolding completes:
1. Read `NEXT_STEPS.md` for personalized setup instructions
2. Configure environment variables
3. Start development with `pnpm dev`
4. Begin building your specific SaaS features

---

## 👤 Orchestrator Quick Reference

**For the human directing the AI agents:**

### First Time Setup

```
"Copy scaffold-config.example.json to scaffold-config.json in the project root.
Edit it to match your preferences (auth provider, payment provider, etc.).
Then run the pre-flight checks in PREFLIGHT.md."
```

### Starting Scaffolding

```
"Read the scaffolding manifest at Masterguide/scaffolding/00-MANIFEST.md.
Check the scaffold state, then execute the next phase."
```

### Resuming After Break

```
"Run: node Masterguide/scaffolding/scripts/resume-scaffold.js prompt
Then execute whatever it tells you."
```

### Checking Progress

```
"Run: node Masterguide/scaffolding/scripts/scaffold-state.js status
Show me the current state of scaffolding."
```

### If Phase Fails

```
"Run the repair script: node Masterguide/scaffolding/scripts/repair-phase.js XX
Then re-run verification."
```

### After All Phases Complete

```
"Run the smoke test: node Masterguide/scaffolding/scripts/smoke-test.js
Then generate next steps: node Masterguide/scaffolding/scripts/generate-next-steps.js"
```

### Suggested Batching

For optimal context management, batch phases like this:

| Session | Phases | Why |
|---------|--------|-----|
| 1 | 01-02 | Foundation + config (low complexity) |
| 2 | 03-04 | Types + database (related, schema-heavy) |
| 3 | 05 | Auth alone (complex, many files) |
| 4 | 06-07 | Resilience + workers (related patterns) |
| 5 | 08-09 | API + observability (related, middleware) |
| 6 | 10-11 | Integrations + frontend (finishing touches) |

---

## 📊 Visual Dashboard

Open `scaffold-dashboard.html` in a browser to see:
- Overall progress with percentage
- Status of each phase (completed, failed, pending)
- Error history
- Time metrics
- Next action to take

To update the dashboard:
1. Run `scaffold-state.js status` to ensure state is current
2. Open `scaffold-dashboard.html`
3. Click "Load scaffold-state.json" and select the file

---

## ✅ Final Checklist

After all 11 phases complete:

- [ ] All phases show "completed" in state
- [ ] Smoke test passes
- [ ] NEXT_STEPS.md generated
- [ ] Environment variables documented
- [ ] Ready for domain-specific development

---

## 📚 Related Documentation

- [PREFLIGHT.md](./PREFLIGHT.md) - Pre-flight checklist
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Common errors and fixes
- [scaffold-config.schema.json](./scaffold-config.schema.json) - Configuration schema
- [../INDEX.md](../INDEX.md) - Full pattern index
- [../00-foundations/](../00-foundations/) - Foundation patterns
- [../03-resilience/](../03-resilience/) - Resilience patterns
- [../04-workers/](../04-workers/) - Worker patterns
