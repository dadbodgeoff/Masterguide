/**
 * Generate Next Steps
 * 
 * Creates a personalized NEXT_STEPS.md based on what was scaffolded.
 * This bridges the gap between "scaffolding complete" and "now what?"
 */

const fs = require('fs');
const path = require('path');

class NextStepsGenerator {
  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = workspaceRoot;
    this.configPath = path.join(workspaceRoot, 'scaffold-config.json');
    this.config = this.loadConfig();
  }

  loadConfig() {
    if (fs.existsSync(this.configPath)) {
      return JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
    }
    // Default config if none exists
    return {
      projectName: 'my-saas',
      auth: { provider: 'supabase' },
      database: { provider: 'supabase' },
      payments: { enabled: true, provider: 'stripe' },
      email: { enabled: true, provider: 'sendgrid' },
      features: { workers: true, ai: false },
      deployment: { frontend: 'vercel', backend: 'railway' },
    };
  }

  fileExists(relativePath) {
    return fs.existsSync(path.join(this.workspaceRoot, relativePath));
  }

  generate() {
    const sections = [];
    
    // Header
    sections.push(this.generateHeader());
    
    // Quick Start
    sections.push(this.generateQuickStart());
    
    // Environment Setup
    sections.push(this.generateEnvSetup());
    
    // Database Setup
    sections.push(this.generateDatabaseSetup());
    
    // Auth Setup
    sections.push(this.generateAuthSetup());
    
    // Payments Setup (if enabled)
    if (this.config.payments?.enabled) {
      sections.push(this.generatePaymentsSetup());
    }
    
    // Email Setup (if enabled)
    if (this.config.email?.enabled) {
      sections.push(this.generateEmailSetup());
    }
    
    // Development Workflow
    sections.push(this.generateDevWorkflow());
    
    // First Feature Guide
    sections.push(this.generateFirstFeature());
    
    // Deployment Guide
    sections.push(this.generateDeployment());
    
    // Resources
    sections.push(this.generateResources());
    
    return sections.join('\n\n');
  }

  generateHeader() {
    const name = this.config.projectDisplayName || this.config.projectName || 'Your SaaS';
    return `# 🚀 Next Steps for ${name}

Congratulations! Your enterprise-grade SaaS infrastructure is scaffolded and ready.

This guide will walk you through the remaining setup steps and help you start building features.

**Estimated setup time:** 15-30 minutes

---`;
  }

  generateQuickStart() {
    return `## ⚡ Quick Start (TL;DR)

\`\`\`bash
# 1. Install dependencies
pnpm install

# 2. Copy environment files
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local

# 3. Start local database
supabase start

# 4. Apply migrations
supabase db push

# 5. Start development
pnpm dev
\`\`\`

Then open [http://localhost:3000](http://localhost:3000) 🎉`;
  }

  generateEnvSetup() {
    let envVars = `## 🔐 Environment Setup

### Required Environment Variables

Create \`.env\` in the project root and \`apps/web/.env.local\` for the frontend.

#### Root \`.env\`
\`\`\`bash
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:54322/postgres"
DIRECT_URL="postgresql://postgres:postgres@localhost:54322/postgres"

# Supabase
SUPABASE_URL="http://localhost:54321"
SUPABASE_ANON_KEY="your-anon-key"  # Get from: supabase status
SUPABASE_SERVICE_ROLE_KEY="your-service-key"  # Get from: supabase status

# JWT
JWT_SECRET="your-super-secret-jwt-key-min-32-chars"
`;

    if (this.config.payments?.provider === 'stripe') {
      envVars += `
# Stripe
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
STRIPE_PRICE_PRO="price_..."
STRIPE_PRICE_STUDIO="price_..."
`;
    }

    if (this.config.email?.provider === 'sendgrid') {
      envVars += `
# SendGrid
SENDGRID_API_KEY="SG...."
SENDGRID_FROM_EMAIL="noreply@yourdomain.com"
`;
    }

    envVars += `\`\`\`

#### Frontend \`apps/web/.env.local\`
\`\`\`bash
NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
\`\`\``;

    return envVars;
  }

  generateDatabaseSetup() {
    return `## 🗄️ Database Setup

### Local Development (Supabase CLI)

\`\`\`bash
# Install Supabase CLI if needed
brew install supabase/tap/supabase  # macOS
# or: npm install -g supabase

# Start local Supabase
supabase start

# This will output your local credentials:
# - API URL: http://localhost:54321
# - anon key: eyJ...
# - service_role key: eyJ...

# Apply migrations
supabase db push

# Open Supabase Studio (database GUI)
# Visit: http://localhost:54323
\`\`\`

### Production Database

1. Create a project at [supabase.com](https://supabase.com)
2. Go to Settings → Database → Connection string
3. Copy the connection strings to your production \`.env\`
4. Run migrations: \`supabase db push --linked\``;
  }

  generateAuthSetup() {
    if (this.config.auth?.provider === 'supabase') {
      return `## 🔑 Authentication Setup

### Supabase Auth Configuration

1. **Local Development**: Auth works out of the box with \`supabase start\`

2. **OAuth Providers** (Google, GitHub, etc.):
   - Go to Supabase Dashboard → Authentication → Providers
   - Enable desired providers
   - Add OAuth credentials from each provider
   - Set redirect URL: \`http://localhost:3000/api/auth/callback\`

3. **Email Templates**:
   - Go to Authentication → Email Templates
   - Customize confirmation, magic link, and password reset emails

### Testing Auth

\`\`\`bash
# Start the app
pnpm dev

# Visit http://localhost:3000/login
# Try signing up with email or OAuth
\`\`\``;
    }
    return '';
  }

  generatePaymentsSetup() {
    if (this.config.payments?.provider === 'stripe') {
      return `## 💳 Stripe Setup

### Development Setup

1. **Create Stripe Account**: [dashboard.stripe.com](https://dashboard.stripe.com)

2. **Get API Keys**:
   - Go to Developers → API Keys
   - Copy the test mode keys to \`.env\`

3. **Create Products & Prices**:
   - Go to Products → Add Product
   - Create products for each tier (Pro, Studio, Enterprise)
   - Copy the Price IDs to \`.env\`

4. **Set Up Webhooks**:
   \`\`\`bash
   # Install Stripe CLI
   brew install stripe/stripe-cli/stripe
   
   # Login
   stripe login
   
   # Forward webhooks to local
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   
   # Copy the webhook signing secret to .env
   \`\`\`

### Testing Payments

Use Stripe test cards:
- Success: \`4242 4242 4242 4242\`
- Decline: \`4000 0000 0000 0002\`
- 3D Secure: \`4000 0025 0000 3155\``;
    }
    return '';
  }

  generateEmailSetup() {
    if (this.config.email?.provider === 'sendgrid') {
      return `## 📧 Email Setup (SendGrid)

### Development

Without SendGrid configured, emails log to console. This is fine for development.

### Production Setup

1. Create account at [sendgrid.com](https://sendgrid.com)
2. Go to Settings → API Keys → Create API Key
3. Add to \`.env\`: \`SENDGRID_API_KEY="SG...."\`
4. Verify sender email in Settings → Sender Authentication`;
    }
    return '';
  }

  generateDevWorkflow() {
    return `## 🛠️ Development Workflow

### Starting Development

\`\`\`bash
# Start everything (frontend + backend + database)
pnpm dev

# Or start individually:
pnpm dev --filter @${this.config.projectName || 'project'}/web  # Frontend only
cd packages/backend && uvicorn src.main:app --reload  # Backend only
\`\`\`

### Common Commands

\`\`\`bash
# Run tests
pnpm test

# Lint code
pnpm lint

# Type check
pnpm typecheck

# Format code
pnpm format

# Build for production
pnpm build
\`\`\`

### Database Commands

\`\`\`bash
# Create new migration
supabase migration new my_migration_name

# Apply migrations
supabase db push

# Reset database (careful!)
supabase db reset

# Generate types from database
supabase gen types typescript --local > packages/types/src/database.ts
\`\`\``;
  }

  generateFirstFeature() {
    return `## 🎯 Building Your First Feature

### Example: Adding a "Projects" Feature

1. **Database Migration**
   \`\`\`sql
   -- supabase/migrations/YYYYMMDD_create_projects.sql
   CREATE TABLE projects (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id UUID REFERENCES users(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     description TEXT,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );
   
   -- RLS Policy
   ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "Users can manage own projects" ON projects
     FOR ALL USING (auth.uid() = user_id);
   \`\`\`

2. **Backend API** (packages/backend/src/api/routes/projects.py)
   \`\`\`python
   from fastapi import APIRouter, Depends
   from src.auth.dependencies import CurrentUser
   
   router = APIRouter()
   
   @router.get("")
   async def list_projects(user: CurrentUser):
       # Your logic here
       pass
   \`\`\`

3. **Frontend Page** (apps/web/app/projects/page.tsx)
   \`\`\`typescript
   export default async function ProjectsPage() {
     // Your component here
   }
   \`\`\`

### Pattern Reference

For complex features, reference the pattern docs:
- **Background Jobs**: See \`Masterguide/04-workers/\`
- **File Uploads**: See \`Masterguide/05-data-pipeline/\`
- **AI Integration**: See \`Masterguide/11-ai/\``;
  }

  generateDeployment() {
    const frontend = this.config.deployment?.frontend || 'vercel';
    const backend = this.config.deployment?.backend || 'railway';
    
    return `## 🚀 Deployment

### Frontend (${frontend.charAt(0).toUpperCase() + frontend.slice(1)})

${frontend === 'vercel' ? `\`\`\`bash
# Install Vercel CLI
npm i -g vercel

# Deploy
cd apps/web
vercel

# Set environment variables in Vercel dashboard
\`\`\`` : `Deploy to ${frontend} following their documentation.`}

### Backend (${backend.charAt(0).toUpperCase() + backend.slice(1)})

${backend === 'railway' ? `\`\`\`bash
# Install Railway CLI
npm i -g @railway/cli

# Login and deploy
railway login
cd packages/backend
railway up

# Set environment variables in Railway dashboard
\`\`\`` : `Deploy to ${backend} following their documentation.`}

### Production Checklist

- [ ] All environment variables set
- [ ] Database migrations applied
- [ ] Stripe webhooks configured for production URL
- [ ] Email sender verified
- [ ] Custom domain configured
- [ ] SSL certificates active
- [ ] Error monitoring set up (Sentry recommended)`;
  }

  generateResources() {
    return `## 📚 Resources

### Documentation
- **Pattern Library**: \`Masterguide/INDEX.md\` — All enterprise patterns
- **Troubleshooting**: \`Masterguide/scaffolding/TROUBLESHOOTING.md\`

### External Docs
- [Next.js Documentation](https://nextjs.org/docs)
- [FastAPI Documentation](https://fastapi.tiangolo.com)
- [Supabase Documentation](https://supabase.com/docs)
- [Stripe Documentation](https://stripe.com/docs)

### Getting Help
If you're stuck:
1. Check the pattern docs in \`Masterguide/\`
2. Review \`TROUBLESHOOTING.md\`
3. Search the error message online
4. Ask your AI assistant with full context

---

**Happy building! 🎉**`;
  }

  write() {
    const content = this.generate();
    const outputPath = path.join(this.workspaceRoot, 'NEXT_STEPS.md');
    fs.writeFileSync(outputPath, content);
    console.log(`✅ Generated ${outputPath}`);
    return outputPath;
  }
}

// CLI
if (require.main === module) {
  const generator = new NextStepsGenerator();
  generator.write();
}

module.exports = { NextStepsGenerator };
