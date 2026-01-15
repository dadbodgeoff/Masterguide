/**
 * Smoke Test
 * 
 * End-to-end validation that the entire scaffolded system works together.
 * This is the final gate before declaring scaffolding complete.
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

class SmokeTest {
  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = workspaceRoot;
    this.results = [];
    this.passed = 0;
    this.failed = 0;
    this.skipped = 0;
  }

  log(icon, message) {
    console.log(`${icon} ${message}`);
  }

  async runTest(name, testFn, options = {}) {
    const { skip = false, skipReason = '' } = options;
    
    if (skip) {
      this.log('⏭️', `SKIP: ${name} (${skipReason})`);
      this.results.push({ name, status: 'skipped', reason: skipReason });
      this.skipped++;
      return;
    }
    
    try {
      await testFn();
      this.log('✅', `PASS: ${name}`);
      this.results.push({ name, status: 'passed' });
      this.passed++;
    } catch (error) {
      this.log('❌', `FAIL: ${name}`);
      this.log('  ', `Error: ${error.message}`);
      this.results.push({ name, status: 'failed', error: error.message });
      this.failed++;
    }
  }

  exec(command, options = {}) {
    const { cwd = this.workspaceRoot, silent = true } = options;
    try {
      const result = execSync(command, {
        cwd,
        encoding: 'utf-8',
        stdio: silent ? 'pipe' : 'inherit',
      });
      return { success: true, output: result };
    } catch (error) {
      return { success: false, error: error.message, output: error.stdout };
    }
  }

  fileExists(relativePath) {
    return fs.existsSync(path.join(this.workspaceRoot, relativePath));
  }

  dirExists(relativePath) {
    const fullPath = path.join(this.workspaceRoot, relativePath);
    return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
  }

  async run() {
    console.log('');
    console.log('═'.repeat(60));
    console.log('🧪 SCAFFOLD SMOKE TEST');
    console.log('═'.repeat(60));
    console.log('');

    // ============================================
    // STRUCTURE TESTS
    // ============================================
    console.log('📁 Structure Tests');
    console.log('─'.repeat(40));

    await this.runTest('Monorepo root exists', () => {
      if (!this.fileExists('turbo.json')) throw new Error('turbo.json not found');
      if (!this.fileExists('pnpm-workspace.yaml')) throw new Error('pnpm-workspace.yaml not found');
    });

    await this.runTest('Frontend app exists', () => {
      if (!this.dirExists('apps/web')) throw new Error('apps/web not found');
      if (!this.fileExists('apps/web/package.json')) throw new Error('apps/web/package.json not found');
    });

    await this.runTest('Backend package exists', () => {
      if (!this.dirExists('packages/backend')) throw new Error('packages/backend not found');
      if (!this.fileExists('packages/backend/pyproject.toml') && 
          !this.fileExists('packages/backend/requirements.txt')) {
        throw new Error('Backend Python config not found');
      }
    });

    await this.runTest('Types package exists', () => {
      if (!this.dirExists('packages/types')) throw new Error('packages/types not found');
    });

    console.log('');

    // ============================================
    // CONFIGURATION TESTS
    // ============================================
    console.log('⚙️  Configuration Tests');
    console.log('─'.repeat(40));

    await this.runTest('Environment config exists', () => {
      const hasWebEnv = this.fileExists('apps/web/lib/env.ts') || 
                        this.fileExists('apps/web/lib/env/index.ts');
      const hasBackendEnv = this.fileExists('packages/backend/src/config.py');
      if (!hasWebEnv) throw new Error('Frontend env config not found');
      if (!hasBackendEnv) throw new Error('Backend config.py not found');
    });

    await this.runTest('TypeScript config valid', () => {
      if (!this.fileExists('tsconfig.json')) throw new Error('Root tsconfig.json not found');
    });

    console.log('');

    // ============================================
    // DATABASE TESTS
    // ============================================
    console.log('🗄️  Database Tests');
    console.log('─'.repeat(40));

    await this.runTest('Supabase migrations exist', () => {
      if (!this.dirExists('supabase/migrations')) throw new Error('supabase/migrations not found');
      const migrations = fs.readdirSync(path.join(this.workspaceRoot, 'supabase/migrations'));
      if (migrations.length === 0) throw new Error('No migration files found');
    });

    await this.runTest('Supabase client configured', () => {
      const hasClient = this.fileExists('apps/web/lib/supabase/client.ts');
      const hasServer = this.fileExists('apps/web/lib/supabase/server.ts');
      if (!hasClient) throw new Error('Supabase client.ts not found');
      if (!hasServer) throw new Error('Supabase server.ts not found');
    });

    console.log('');

    // ============================================
    // AUTH TESTS
    // ============================================
    console.log('🔐 Auth Tests');
    console.log('─'.repeat(40));

    await this.runTest('Frontend auth module exists', () => {
      if (!this.dirExists('apps/web/lib/auth')) throw new Error('apps/web/lib/auth not found');
    });

    await this.runTest('Backend auth module exists', () => {
      if (!this.dirExists('packages/backend/src/auth')) throw new Error('packages/backend/src/auth not found');
    });

    console.log('');

    // ============================================
    // API TESTS
    // ============================================
    console.log('🌐 API Tests');
    console.log('─'.repeat(40));

    await this.runTest('Backend API module exists', () => {
      if (!this.dirExists('packages/backend/src/api')) throw new Error('packages/backend/src/api not found');
    });

    await this.runTest('Frontend API routes exist', () => {
      const hasJobsRoute = this.fileExists('apps/web/app/api/jobs/route.ts');
      const hasHealthRoute = this.fileExists('apps/web/app/api/health/route.ts');
      if (!hasJobsRoute && !hasHealthRoute) throw new Error('No API routes found');
    });

    console.log('');

    // ============================================
    // RESILIENCE TESTS
    // ============================================
    console.log('🛡️  Resilience Tests');
    console.log('─'.repeat(40));

    await this.runTest('Resilience module exists', () => {
      if (!this.dirExists('packages/backend/src/resilience')) {
        throw new Error('packages/backend/src/resilience not found');
      }
    });

    console.log('');

    // ============================================
    // JOBS TESTS
    // ============================================
    console.log('⚡ Jobs Tests');
    console.log('─'.repeat(40));

    await this.runTest('Jobs module exists', () => {
      if (!this.dirExists('packages/backend/src/jobs')) {
        throw new Error('packages/backend/src/jobs not found');
      }
    });

    console.log('');

    // ============================================
    // FRONTEND TESTS
    // ============================================
    console.log('🎨 Frontend Tests');
    console.log('─'.repeat(40));

    await this.runTest('UI components exist', () => {
      if (!this.dirExists('apps/web/components/ui')) {
        throw new Error('apps/web/components/ui not found');
      }
    });

    await this.runTest('Design tokens exist', () => {
      if (!this.dirExists('apps/web/lib/design-tokens')) {
        throw new Error('apps/web/lib/design-tokens not found');
      }
    });

    console.log('');

    // ============================================
    // BUILD TESTS
    // ============================================
    console.log('🔨 Build Tests');
    console.log('─'.repeat(40));

    await this.runTest('pnpm install succeeds', () => {
      const result = this.exec('pnpm install --frozen-lockfile', { silent: true });
      // Allow fresh install too
      if (!result.success) {
        const freshResult = this.exec('pnpm install', { silent: true });
        if (!freshResult.success) throw new Error('pnpm install failed');
      }
    }, { skip: !this.fileExists('pnpm-lock.yaml'), skipReason: 'No lockfile yet' });

    await this.runTest('TypeScript compiles', () => {
      const result = this.exec('pnpm exec tsc --noEmit', { cwd: path.join(this.workspaceRoot, 'apps/web') });
      if (!result.success) throw new Error('TypeScript compilation failed');
    }, { skip: !this.fileExists('apps/web/tsconfig.json'), skipReason: 'No tsconfig' });

    await this.runTest('ESLint passes', () => {
      const result = this.exec('pnpm lint', { cwd: path.join(this.workspaceRoot, 'apps/web') });
      if (!result.success) throw new Error('ESLint failed');
    }, { skip: !this.fileExists('apps/web/.eslintrc.json') && !this.fileExists('apps/web/eslint.config.js'), skipReason: 'No ESLint config' });

    await this.runTest('Python imports work', () => {
      const testScript = `
import sys
sys.path.insert(0, 'packages/backend')
try:
    from src.config import settings
    from src.exceptions import AppError
    print('Imports OK')
except ImportError as e:
    print(f'Import failed: {e}')
    sys.exit(1)
`;
      const result = this.exec(`python -c "${testScript.replace(/\n/g, '; ').replace(/"/g, '\\"')}"`, { silent: true });
      if (!result.success) throw new Error('Python imports failed');
    }, { skip: !this.fileExists('packages/backend/src/config.py'), skipReason: 'No Python config' });

    console.log('');

    // ============================================
    // RESULTS
    // ============================================
    console.log('═'.repeat(60));
    console.log('📊 RESULTS');
    console.log('═'.repeat(60));
    console.log('');
    console.log(`  ✅ Passed:  ${this.passed}`);
    console.log(`  ❌ Failed:  ${this.failed}`);
    console.log(`  ⏭️  Skipped: ${this.skipped}`);
    console.log('');

    if (this.failed === 0) {
      console.log('🎉 ALL TESTS PASSED!');
      console.log('');
      console.log('The enterprise scaffold is complete and validated.');
      console.log('You can now begin feature development.');
      console.log('');
      console.log('Next steps:');
      console.log('  1. Configure your .env files');
      console.log('  2. Run `supabase start` for local database');
      console.log('  3. Run `pnpm dev` to start development');
      console.log('  4. Read NEXT_STEPS.md for guidance');
      return true;
    } else {
      console.log('⚠️  SOME TESTS FAILED');
      console.log('');
      console.log('Review the failures above and:');
      console.log('  1. Check TROUBLESHOOTING.md for common fixes');
      console.log('  2. Re-run failed phases');
      console.log('  3. Run this smoke test again');
      return false;
    }
  }
}

// CLI
if (require.main === module) {
  const test = new SmokeTest();
  test.run().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { SmokeTest };
