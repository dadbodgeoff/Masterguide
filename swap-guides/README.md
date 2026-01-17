# Swap Guides

> How to replace components with alternatives while keeping the same patterns

## Available Swaps

| Current | Alternative | Guide |
|---------|-------------|-------|
| Supabase | Firebase | [SUPABASE_TO_FIREBASE.md](./SUPABASE_TO_FIREBASE.md) |
| Supabase | Clerk + Prisma | [SUPABASE_TO_CLERK_PRISMA.md](./SUPABASE_TO_CLERK_PRISMA.md) |
| Stripe | Paddle/LemonSqueezy | [STRIPE_TO_PADDLE.md](./STRIPE_TO_PADDLE.md) |
| SendGrid | Resend | [SENDGRID_TO_RESEND.md](./SENDGRID_TO_RESEND.md) |
| Redis | Upstash | [REDIS_TO_UPSTASH.md](./REDIS_TO_UPSTASH.md) |

## How to Use These Guides

1. **Read the full guide first** — Understand what changes
2. **Check "No Change Needed"** — Most patterns are service-agnostic
3. **Follow migration steps in order** — Dependencies matter
4. **Update STEERING.md files** — Keep agent context accurate
5. **Run verification checklist** — Don't skip tests

## What Stays the Same

These patterns are implementation-agnostic and don't change:

- **Resilience patterns** — Circuit breaker, retry, distributed lock
- **Job state machine** — Works with any queue backend
- **Error handling** — Exception taxonomy, error codes
- **API structure** — Routes, rate limiting, responses
- **Frontend components** — UI layer is service-agnostic
- **Security patterns** — Audit logging, sanitization
- **Type definitions** — Shared types stay the same

## Agent Instructions

When a user asks to swap a component:

1. Read the relevant swap guide
2. Read current implementation files listed in "Must Replace"
3. Create new implementation following the replacement patterns
4. Update files listed in "Must Update"
5. Update relevant STEERING.md files
6. Run verification checklist
7. Commit with clear message: "Swap [old] for [new]"
