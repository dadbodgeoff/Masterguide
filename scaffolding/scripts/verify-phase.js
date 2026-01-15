#!/usr/bin/env node

/**
 * Phase Verification Script
 * 
 * Usage: node verify-phase.js <phase-number>
 * Example: node verify-phase.js 01
 * 
 * Checks that all expected files exist and basic validation passes.
 * Returns exit code 0 on success, 1 on failure.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PHASES = {
  '01': {
    name: 'Workspace Setup',
    files: [
      'package.json',
      'pnpm-workspace.yaml',
      'turbo.json',
      'tsconfig.base.json',
      '.gitignore',
      '.env.example',
      'apps/web/package.json',
      'apps/web/tsconfig.json',
      'apps/web/next.config.js',
      'apps/web/tailwind.config.js',
      'apps/web/app/layout.tsx',
      'apps/web/app/page.tsx',
      'apps/web/app/globals.css',
      'packages/types/package.json',
      'packages/types/tsconfig.json',
      'packages/types/src/index.ts',
      'packages/types/src/common.ts',
      'packages/backend/pyproject.toml',
      'packages/backend/src/__init__.py',
      'packages/backend/src/main.py',
      'packages/backend/Dockerfile',
      'supabase/config.toml',
      'README.md',
    ],
    commands: [
      { cmd: 'node -e "require(\'./package.json\')"', name: 'package.json valid JSON' },
    ],
  },
  '02': {
    name: 'Environment Configuration',
    files: [
      'apps/web/lib/env.ts',
      'packages/backend/src/config.py',
    ],
    commands: [
      { cmd: 'node -e "require(\'zod\')"', name: 'zod installed', cwd: 'apps/web' },
    ],
  },
  '03': {
    name: 'Shared Types & Exceptions',
    files: [
      'packages/types/src/errors.ts',
      'packages/types/src/auth.ts',
      'packages/types/src/jobs.ts',
      'packages/types/src/api.ts',
      'packages/backend/src/exceptions.py',
      'packages/backend/src/exception_handlers.py',
    ],
    commands: [],
  },
  '04': {
    name: 'Database Foundation',
    files: [
      'supabase/migrations/00001_initial_schema.sql',
      'supabase/migrations/00002_rls_policies.sql',
      'supabase/seed.sql',
      'apps/web/lib/supabase/client.ts',
      'apps/web/lib/supabase/server.ts',
      'apps/web/lib/supabase/admin.ts',
      'apps/web/lib/supabase/middleware.ts',
      'apps/web/middleware.ts',
      'packages/backend/src/database.py',
    ],
    commands: [],
  },
  '05': {
    name: 'Authentication Infrastructure',
    files: [
      'apps/web/lib/auth/context.tsx',
      'apps/web/lib/auth/hooks.ts',
      'apps/web/lib/auth/server.ts',
      'apps/web/app/api/auth/callback/route.ts',
      'packages/backend/src/auth/__init__.py',
      'packages/backend/src/auth/jwt.py',
      'packages/backend/src/auth/dependencies.py',
      'packages/backend/src/auth/middleware.py',
      'packages/backend/src/auth/entitlements.py',
    ],
    commands: [],
  },
  '06': {
    name: 'Resilience Patterns',
    files: [
      'packages/backend/src/resilience/__init__.py',
      'packages/backend/src/resilience/circuit_breaker.py',
      'packages/backend/src/resilience/retry.py',
      'packages/backend/src/resilience/distributed_lock.py',
      'packages/backend/src/resilience/shutdown.py',
      'apps/web/lib/resilience/retry.ts',
    ],
    commands: [],
  },
  '07': {
    name: 'Job Processing System',
    files: [
      'packages/backend/src/jobs/__init__.py',
      'packages/backend/src/jobs/models.py',
      'packages/backend/src/jobs/service.py',
      'packages/backend/src/jobs/queue.py',
      'packages/backend/src/jobs/worker.py',
      'apps/web/lib/jobs/client.ts',
    ],
    commands: [],
  },
  '08': {
    name: 'API Foundation',
    files: [
      'packages/backend/src/api/__init__.py',
      'packages/backend/src/api/router.py',
      'packages/backend/src/api/routes/__init__.py',
      'packages/backend/src/api/routes/health.py',
      'packages/backend/src/api/routes/jobs.py',
      'packages/backend/src/api/routes/users.py',
      'packages/backend/src/api/middleware.py',
      'packages/backend/src/api/responses.py',
      'apps/web/app/api/jobs/route.ts',
      'apps/web/app/api/jobs/[jobId]/route.ts',
      'apps/web/app/api/health/route.ts',
    ],
    commands: [],
  },
  '09': {
    name: 'Observability',
    files: [
      'packages/backend/src/observability/__init__.py',
      'packages/backend/src/observability/logging.py',
      'packages/backend/src/observability/middleware.py',
      'packages/backend/src/observability/metrics.py',
      'packages/backend/src/observability/health.py',
      'apps/web/lib/observability/logger.ts',
    ],
    commands: [],
  },
  '10': {
    name: 'Third-Party Integrations',
    files: [
      'packages/backend/src/integrations/__init__.py',
      'packages/backend/src/integrations/stripe_service.py',
      'packages/backend/src/integrations/email_service.py',
      'packages/backend/src/integrations/webhook_handler.py',
      'apps/web/app/api/webhooks/stripe/route.ts',
    ],
    commands: [],
  },
  '11': {
    name: 'Frontend Foundation',
    files: [
      'apps/web/lib/design-tokens/tokens.ts',
      'apps/web/lib/design-tokens/index.ts',
      'apps/web/components/ui/button.tsx',
      'apps/web/components/ui/input.tsx',
      'apps/web/components/ui/card.tsx',
      'apps/web/components/ui/index.ts',
      'apps/web/lib/utils.ts',
      'apps/web/components/providers/index.tsx',
      'apps/web/lib/api/client.ts',
      'apps/web/public/manifest.json',
    ],
    commands: [
      { cmd: 'node -e "require(\'clsx\')"', name: 'clsx installed', cwd: 'apps/web' },
      { cmd: 'node -e "require(\'tailwind-merge\')"', name: 'tailwind-merge installed', cwd: 'apps/web' },
    ],
  },
};

function checkFile(filePath) {
  const fullPath = path.resolve(process.cwd(), filePath);
  return fs.existsSync(fullPath);
}

function runCommand(cmd, cwd = '.') {
  try {
    execSync(cmd, { cwd: path.resolve(process.cwd(), cwd), stdio: 'pipe' });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function checkAllPhases() {
  console.log('\n🔍 Checking all phases...\n');
  
  const results = [];
  
  for (const [num, phase] of Object.entries(PHASES)) {
    const checkpointFile = path.resolve(process.cwd(), '.scaffolding', `.phase-${num}-complete`);
    const hasCheckpoint = fs.existsSync(checkpointFile);
    
    // Quick file check
    const missingFiles = phase.files.filter(f => !checkFile(f));
    const status = missingFiles.length === 0 ? '✅' : hasCheckpoint ? '⚠️' : '❌';
    
    results.push({
      num,
      name: phase.name,
      status,
      missing: missingFiles.length,
      total: phase.files.length,
      hasCheckpoint,
    });
  }
  
  console.log('Phase Status:');
  console.log('-'.repeat(60));
  
  for (const r of results) {
    const checkpoint = r.hasCheckpoint ? '📍' : '  ';
    console.log(`${r.status} ${checkpoint} Phase ${r.num}: ${r.name} (${r.total - r.missing}/${r.total} files)`);
  }
  
  console.log('-'.repeat(60));
  
  const complete = results.filter(r => r.status === '✅').length;
  console.log(`\n${complete}/${results.length} phases complete`);
}

// Integration with scaffold-state.js
function updateScaffoldState(phaseNum, passed) {
  try {
    const { ScaffoldState } = require('./scaffold-state');
    const state = new ScaffoldState().init();
    
    if (passed) {
      state.completePhase(parseInt(phaseNum));
      console.log(`\n📊 State updated: Phase ${phaseNum} marked complete`);
    }
    // Don't auto-fail - let the user decide to retry
  } catch (e) {
    // scaffold-state.js not available, skip state update
  }
}

function verifyPhaseWithState(phaseNum) {
  const phase = PHASES[phaseNum];
  if (!phase) {
    console.error(`❌ Unknown phase: ${phaseNum}`);
    console.log(`Available phases: ${Object.keys(PHASES).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n🔍 Verifying Phase ${phaseNum}: ${phase.name}\n`);
  
  let allPassed = true;
  const missing = [];
  const failed = [];

  // Check files
  console.log('📁 Checking files...');
  for (const file of phase.files) {
    if (checkFile(file)) {
      console.log(`   ✅ ${file}`);
    } else {
      console.log(`   ❌ ${file} (MISSING)`);
      missing.push(file);
      allPassed = false;
    }
  }

  // Run commands
  if (phase.commands.length > 0) {
    console.log('\n⚙️  Running checks...');
    for (const { cmd, name, cwd } of phase.commands) {
      const result = runCommand(cmd, cwd);
      if (result.success) {
        console.log(`   ✅ ${name}`);
      } else {
        console.log(`   ❌ ${name} (FAILED)`);
        failed.push({ name, error: result.error });
        allPassed = false;
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  if (allPassed) {
    console.log(`✅ Phase ${phaseNum} PASSED`);
    
    // Create checkpoint file
    const checkpointDir = path.resolve(process.cwd(), '.scaffolding');
    if (!fs.existsSync(checkpointDir)) {
      fs.mkdirSync(checkpointDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(checkpointDir, `.phase-${phaseNum}-complete`),
      `Completed: ${new Date().toISOString()}\n`
    );
    console.log(`📍 Checkpoint saved: .scaffolding/.phase-${phaseNum}-complete`);
    
    // Update scaffold state
    updateScaffoldState(phaseNum, true);
    
    // Show next step
    const nextPhase = String(parseInt(phaseNum) + 1).padStart(2, '0');
    if (PHASES[nextPhase]) {
      console.log(`\n▶️  Next: Phase ${nextPhase} (${PHASES[nextPhase].name})`);
    } else {
      console.log(`\n🎉 All phases complete! Run smoke test:`);
      console.log(`   node Masterguide/scaffolding/scripts/smoke-test.js`);
    }
    
    process.exit(0);
  } else {
    console.log(`❌ Phase ${phaseNum} FAILED`);
    
    if (missing.length > 0) {
      console.log(`\n📁 Missing files (${missing.length}):`);
      missing.forEach(f => console.log(`   - ${f}`));
    }
    
    if (failed.length > 0) {
      console.log(`\n⚙️  Failed checks (${failed.length}):`);
      failed.forEach(f => console.log(`   - ${f.name}`));
    }
    
    console.log('\n💡 Options:');
    console.log(`   1. Re-run the phase to create missing files`);
    console.log(`   2. Run repair: node Masterguide/scaffolding/scripts/repair-phase.js ${phaseNum}`);
    console.log(`   3. Check: Masterguide/scaffolding/TROUBLESHOOTING.md`);
    
    process.exit(1);
  }
}

// Main
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--all' || args[0] === '-a') {
  checkAllPhases();
} else {
  const phaseNum = args[0].padStart(2, '0');
  verifyPhaseWithState(phaseNum);
}
