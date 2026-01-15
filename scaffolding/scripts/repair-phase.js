/**
 * Repair Phase
 * 
 * Self-healing script that detects and fixes common scaffolding issues.
 * This is the "magic" that makes the system foolproof.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class PhaseRepair {
  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = workspaceRoot;
    this.fixes = [];
    this.warnings = [];
  }

  log(icon, message) {
    console.log(`${icon} ${message}`);
  }

  fileExists(relativePath) {
    return fs.existsSync(path.join(this.workspaceRoot, relativePath));
  }

  readFile(relativePath) {
    const fullPath = path.join(this.workspaceRoot, relativePath);
    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath, 'utf-8');
    }
    return null;
  }

  writeFile(relativePath, content) {
    const fullPath = path.join(this.workspaceRoot, relativePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content);
  }

  exec(command, options = {}) {
    try {
      return execSync(command, {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
        stdio: 'pipe',
        ...options,
      });
    } catch (error) {
      return null;
    }
  }

  /**
   * Run all repairs for a phase
   */
  async repair(phaseNum) {
    console.log('');
    console.log('═'.repeat(50));
    console.log(`🔧 REPAIR PHASE ${String(phaseNum).padStart(2, '0')}`);
    console.log('═'.repeat(50));
    console.log('');

    const repairMethod = this[`repairPhase${phaseNum}`];
    if (repairMethod) {
      await repairMethod.call(this);
    } else {
      // Generic repairs
      await this.genericRepairs(phaseNum);
    }

    // Summary
    console.log('');
    console.log('─'.repeat(50));
    if (this.fixes.length > 0) {
      console.log(`✅ Applied ${this.fixes.length} fix(es):`);
      this.fixes.forEach(f => console.log(`   - ${f}`));
    } else {
      console.log('ℹ️  No automatic fixes applied');
    }

    if (this.warnings.length > 0) {
      console.log('');
      console.log(`⚠️  ${this.warnings.length} warning(s):`);
      this.warnings.forEach(w => console.log(`   - ${w}`));
    }

    console.log('');
    console.log('Next: Re-run verification');
    console.log(`  node Masterguide/scaffolding/scripts/verify-phase.js ${String(phaseNum).padStart(2, '0')}`);
  }

  /**
   * Generic repairs applicable to any phase
   */
  async genericRepairs(phaseNum) {
    this.log('🔍', 'Running generic repairs...');

    // Fix: Missing __init__.py files
    await this.fixMissingInitFiles();

    // Fix: Common import issues
    await this.fixCommonImports();

    // Fix: Missing directories
    await this.fixMissingDirectories(phaseNum);
  }

  /**
   * Phase 1: Workspace repairs
   */
  async repairPhase1() {
    this.log('🔍', 'Checking workspace structure...');

    // Fix: Missing pnpm-workspace.yaml
    if (!this.fileExists('pnpm-workspace.yaml')) {
      this.writeFile('pnpm-workspace.yaml', `packages:
  - "apps/*"
  - "packages/*"
`);
      this.fixes.push('Created pnpm-workspace.yaml');
    }

    // Fix: Missing turbo.json
    if (!this.fileExists('turbo.json')) {
      this.writeFile('turbo.json', JSON.stringify({
        "$schema": "https://turbo.build/schema.json",
        "pipeline": {
          "build": { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] },
          "lint": {},
          "dev": { "cache": false, "persistent": true },
          "test": {}
        }
      }, null, 2));
      this.fixes.push('Created turbo.json');
    }

    // Fix: Missing root package.json
    if (!this.fileExists('package.json')) {
      this.writeFile('package.json', JSON.stringify({
        "name": "saas-monorepo",
        "private": true,
        "scripts": {
          "dev": "turbo run dev",
          "build": "turbo run build",
          "lint": "turbo run lint",
          "test": "turbo run test"
        },
        "devDependencies": {
          "turbo": "^2.0.0"
        },
        "packageManager": "pnpm@9.0.0"
      }, null, 2));
      this.fixes.push('Created root package.json');
    }
  }

  /**
   * Phase 2: Environment repairs
   */
  async repairPhase2() {
    this.log('🔍', 'Checking environment configuration...');

    // Fix: Missing .env.example
    if (!this.fileExists('.env.example')) {
      this.writeFile('.env.example', `# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:54322/postgres"

# Supabase
SUPABASE_URL="http://localhost:54321"
SUPABASE_ANON_KEY=""
SUPABASE_SERVICE_ROLE_KEY=""

# JWT
JWT_SECRET="your-secret-key-min-32-characters-long"

# App
NODE_ENV="development"
`);
      this.fixes.push('Created .env.example');
    }

    // Fix: Backend config.py missing settings
    const configPath = 'packages/backend/src/config.py';
    if (this.fileExists(configPath)) {
      let config = this.readFile(configPath);
      
      // Check for common missing settings
      if (!config.includes('is_production')) {
        this.warnings.push('config.py may be missing is_production property');
      }
    }
  }

  /**
   * Phase 3: Types repairs
   */
  async repairPhase3() {
    this.log('🔍', 'Checking types package...');

    // Fix: Missing types index
    if (this.fileExists('packages/types/src') && !this.fileExists('packages/types/src/index.ts')) {
      this.writeFile('packages/types/src/index.ts', `// Export all types
export * from './errors';
export * from './auth';
export * from './api';
`);
      this.fixes.push('Created packages/types/src/index.ts');
    }

    // Fix: Missing package.json exports
    if (this.fileExists('packages/types/package.json')) {
      const pkg = JSON.parse(this.readFile('packages/types/package.json'));
      if (!pkg.exports) {
        pkg.exports = {
          ".": {
            "types": "./dist/index.d.ts",
            "import": "./dist/index.js",
            "require": "./dist/index.js"
          }
        };
        this.writeFile('packages/types/package.json', JSON.stringify(pkg, null, 2));
        this.fixes.push('Added exports to packages/types/package.json');
      }
    }
  }

  /**
   * Phase 5: Auth repairs
   */
  async repairPhase5() {
    this.log('🔍', 'Checking auth module...');

    await this.fixMissingInitFiles();

    // Fix: Missing auth __init__.py
    if (this.fileExists('packages/backend/src/auth') && 
        !this.fileExists('packages/backend/src/auth/__init__.py')) {
      this.writeFile('packages/backend/src/auth/__init__.py', `"""Authentication module."""

from src.auth.dependencies import get_current_user, require_tier
from src.auth.jwt import create_access_token, verify_token
from src.auth.middleware import AuthMiddleware

__all__ = [
    "get_current_user",
    "require_tier", 
    "create_access_token",
    "verify_token",
    "AuthMiddleware",
]
`);
      this.fixes.push('Created packages/backend/src/auth/__init__.py');
    }
  }

  /**
   * Fix missing __init__.py files in Python packages
   */
  async fixMissingInitFiles() {
    const pythonDirs = [
      'packages/backend/src',
      'packages/backend/src/auth',
      'packages/backend/src/api',
      'packages/backend/src/api/routes',
      'packages/backend/src/jobs',
      'packages/backend/src/resilience',
      'packages/backend/src/observability',
      'packages/backend/src/integrations',
    ];

    for (const dir of pythonDirs) {
      const initPath = path.join(dir, '__init__.py');
      if (this.fileExists(dir) && !this.fileExists(initPath)) {
        // Create minimal __init__.py
        const moduleName = path.basename(dir);
        this.writeFile(initPath, `"""${moduleName} module."""\n`);
        this.fixes.push(`Created ${initPath}`);
      }
    }
  }

  /**
   * Fix common import issues
   */
  async fixCommonImports() {
    // Check for circular imports in Python
    // This is a simplified check - real detection would be more complex
    
    // Check TypeScript path aliases
    if (this.fileExists('apps/web/tsconfig.json')) {
      const tsconfig = JSON.parse(this.readFile('apps/web/tsconfig.json'));
      if (!tsconfig.compilerOptions?.paths?.['@/*']) {
        this.warnings.push('TypeScript path alias @/* may not be configured');
      }
    }
  }

  /**
   * Fix missing directories for a phase
   */
  async fixMissingDirectories(phaseNum) {
    const phaseDirs = {
      1: ['apps/web', 'packages/backend', 'packages/types'],
      2: ['apps/web/lib', 'packages/backend/src'],
      3: ['packages/types/src', 'packages/backend/src'],
      4: ['supabase/migrations', 'apps/web/lib/supabase'],
      5: ['apps/web/lib/auth', 'packages/backend/src/auth'],
      6: ['packages/backend/src/resilience', 'apps/web/lib/resilience'],
      7: ['packages/backend/src/jobs', 'apps/web/lib/jobs'],
      8: ['packages/backend/src/api', 'packages/backend/src/api/routes'],
      9: ['packages/backend/src/observability', 'apps/web/lib/observability'],
      10: ['packages/backend/src/integrations', 'apps/web/app/api/webhooks'],
      11: ['apps/web/components/ui', 'apps/web/lib/design-tokens'],
    };

    const dirs = phaseDirs[phaseNum] || [];
    for (const dir of dirs) {
      const fullPath = path.join(this.workspaceRoot, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        this.fixes.push(`Created directory: ${dir}`);
      }
    }
  }
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const phaseNum = parseInt(args[0]);

  if (!phaseNum || phaseNum < 1 || phaseNum > 11) {
    console.log(`
Repair Phase - Self-healing for scaffolding issues

Usage:
  node repair-phase.js <phase_number>

Examples:
  node repair-phase.js 1    # Repair Phase 01 (Workspace)
  node repair-phase.js 5    # Repair Phase 05 (Auth)

This script will:
  1. Detect common issues for the specified phase
  2. Automatically fix what it can
  3. Report warnings for manual fixes
  4. Suggest next steps
`);
    process.exit(1);
  }

  const repair = new PhaseRepair();
  repair.repair(phaseNum);
}

module.exports = { PhaseRepair };
