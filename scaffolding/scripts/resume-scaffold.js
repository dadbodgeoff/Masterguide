/**
 * Resume Scaffold
 * 
 * Intelligent resume system that tells an agent exactly where to pick up.
 * Generates context-aware instructions for continuing scaffolding.
 */

const fs = require('fs');
const path = require('path');
const { ScaffoldState } = require('./scaffold-state');

class ResumeScaffold {
  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = workspaceRoot;
    this.state = new ScaffoldState(workspaceRoot).init();
    this.scaffoldingDir = path.join(workspaceRoot, 'Masterguide', 'scaffolding');
  }

  /**
   * Generate comprehensive resume context for an agent
   */
  generateResumeContext() {
    const summary = this.state.getSummary();
    const instructions = this.state.getResumeInstructions();
    
    let output = [];
    
    output.push('═'.repeat(60));
    output.push('🔄 SCAFFOLD RESUME CONTEXT');
    output.push('═'.repeat(60));
    output.push('');
    
    // Status overview
    output.push('## Current Status');
    output.push(`- Overall: ${summary.status.toUpperCase()}`);
    output.push(`- Progress: ${summary.progress} phases complete (${summary.progressPercent}%)`);
    output.push(`- Total retries: ${summary.totalRetries}`);
    output.push('');
    
    // Phase breakdown
    output.push('## Phase Status');
    for (let i = 1; i <= 11; i++) {
      const p = this.state.state.phases[i];
      const icon = {
        'completed': '✅',
        'failed': '❌',
        'skipped': '⏭️',
        'in_progress': '🔄',
        'pending': '⬜',
      }[p.status];
      
      let line = `${icon} Phase ${String(i).padStart(2, '0')}: ${p.name}`;
      if (p.status === 'failed' && p.error) {
        line += ` — ERROR: ${p.error}`;
      }
      if (p.status === 'completed' && this.state.state.metrics.phaseDurations[i]) {
        const duration = Math.round(this.state.state.metrics.phaseDurations[i] / 1000);
        line += ` (${duration}s)`;
      }
      output.push(line);
    }
    output.push('');
    
    // Next action
    output.push('## Next Action');
    if (instructions.action === 'complete') {
      output.push('🎉 ALL PHASES COMPLETE!');
      output.push('');
      output.push('Run the smoke test to validate everything works:');
      output.push('```');
      output.push('node Masterguide/scaffolding/scripts/smoke-test.js');
      output.push('```');
    } else {
      output.push(instructions.message);
      output.push('');
      
      if (instructions.previouslyFailed) {
        output.push('⚠️  This phase previously failed. Review the error above and:');
        output.push('1. Check TROUBLESHOOTING.md for common fixes');
        output.push('2. Verify prerequisites are met');
        output.push('3. Try the repair script: `node scripts/repair-phase.js ' + instructions.phase + '`');
        output.push('');
      }
      
      output.push('### Instructions');
      output.push(`1. Read: Masterguide/scaffolding/${instructions.phaseFile}`);
      output.push(`2. Execute all artifacts in the document`);
      output.push(`3. Run verification: \`node Masterguide/scaffolding/scripts/verify-phase.js ${String(instructions.phase).padStart(2, '0')}\``);
      output.push(`4. If passed, update state: \`node Masterguide/scaffolding/scripts/scaffold-state.js complete ${instructions.phase}\``);
      output.push('');
      
      // Show what files should exist after this phase
      output.push('### Expected Artifacts');
      const artifacts = this.getPhaseArtifacts(instructions.phase);
      if (artifacts.length > 0) {
        artifacts.forEach(a => output.push(`- ${a}`));
      } else {
        output.push('(See phase document for full list)');
      }
    }
    
    output.push('');
    output.push('═'.repeat(60));
    
    return output.join('\n');
  }

  /**
   * Get key artifacts for a phase (simplified list)
   */
  getPhaseArtifacts(phaseNum) {
    const artifacts = {
      1: ['apps/web/', 'packages/backend/', 'packages/types/', 'turbo.json', 'pnpm-workspace.yaml'],
      2: ['apps/web/lib/env.ts', 'packages/backend/src/config.py'],
      3: ['packages/types/src/', 'packages/backend/src/exceptions.py'],
      4: ['supabase/migrations/', 'apps/web/lib/supabase/'],
      5: ['apps/web/lib/auth/', 'packages/backend/src/auth/'],
      6: ['packages/backend/src/resilience/', 'apps/web/lib/resilience/'],
      7: ['packages/backend/src/jobs/'],
      8: ['packages/backend/src/api/', 'apps/web/app/api/jobs/'],
      9: ['packages/backend/src/observability/', 'apps/web/lib/observability/'],
      10: ['packages/backend/src/integrations/', 'apps/web/app/api/webhooks/'],
      11: ['apps/web/components/ui/', 'apps/web/lib/design-tokens/'],
    };
    return artifacts[phaseNum] || [];
  }

  /**
   * Generate agent-friendly prompt
   */
  generateAgentPrompt() {
    const instructions = this.state.getResumeInstructions();
    
    if (instructions.action === 'complete') {
      return `
The scaffolding is complete. All 11 phases have been executed successfully.

Your next task is to run the smoke test to validate the entire system works together:

\`\`\`bash
node Masterguide/scaffolding/scripts/smoke-test.js
\`\`\`

If the smoke test passes, the enterprise infrastructure is ready for feature development.
`;
    }
    
    let prompt = `
## SCAFFOLD RESUME — Phase ${instructions.phase}: ${instructions.phaseName}

${instructions.previouslyFailed ? `⚠️ WARNING: This phase previously failed with error: "${this.state.state.phases[instructions.phase].error}"

Before retrying, check Masterguide/scaffolding/TROUBLESHOOTING.md for common fixes.

` : ''}You are resuming an enterprise SaaS scaffolding process.

### Your Task
Execute Phase ${instructions.phase} (${instructions.phaseName}) by following the instructions in:
\`Masterguide/scaffolding/${instructions.phaseFile}\`

### Process
1. Read the phase document completely
2. Check the "Skip Conditions" — if already done, skip to verification
3. Create all artifacts listed in the document
4. Run verification: \`node Masterguide/scaffolding/scripts/verify-phase.js ${String(instructions.phase).padStart(2, '0')}\`
5. If verification passes, mark complete: \`node Masterguide/scaffolding/scripts/scaffold-state.js complete ${instructions.phase}\`
6. If verification fails, check TROUBLESHOOTING.md and retry

### Important
- Do NOT skip verification
- Do NOT proceed to the next phase until verification passes
- If stuck, report the error and wait for guidance

Begin by reading the phase document.
`;
    
    return prompt;
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const format = args[0] || 'full';
  
  const resume = new ResumeScaffold();
  
  switch (format) {
    case 'prompt':
      // Agent-friendly prompt
      console.log(resume.generateAgentPrompt());
      break;
      
    case 'json':
      // JSON for programmatic use
      const state = resume.state;
      console.log(JSON.stringify({
        summary: state.getSummary(),
        instructions: state.getResumeInstructions(),
        state: state.toJSON(),
      }, null, 2));
      break;
      
    case 'full':
    default:
      // Full context
      console.log(resume.generateResumeContext());
      break;
  }
}

module.exports = { ResumeScaffold };
