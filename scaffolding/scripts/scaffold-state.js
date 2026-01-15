/**
 * Scaffold State Manager
 * 
 * Tracks scaffolding progress, enables resume, and provides state queries.
 * This is the brain of the scaffolding system.
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = 'scaffold-state.json';
const CONFIG_FILE = 'scaffold-config.json';

// Default state structure
const DEFAULT_STATE = {
  version: '1.0.0',
  projectName: null,
  startedAt: null,
  lastUpdated: null,
  completedAt: null,
  status: 'not_started', // not_started, in_progress, completed, failed
  currentPhase: 0,
  phases: {
    1: { status: 'pending', name: 'WORKSPACE', startedAt: null, completedAt: null, error: null, attempts: 0 },
    2: { status: 'pending', name: 'ENVIRONMENT', startedAt: null, completedAt: null, error: null, attempts: 0 },
    3: { status: 'pending', name: 'TYPES', startedAt: null, completedAt: null, error: null, attempts: 0 },
    4: { status: 'pending', name: 'DATABASE', startedAt: null, completedAt: null, error: null, attempts: 0 },
    5: { status: 'pending', name: 'AUTH', startedAt: null, completedAt: null, error: null, attempts: 0 },
    6: { status: 'pending', name: 'RESILIENCE', startedAt: null, completedAt: null, error: null, attempts: 0 },
    7: { status: 'pending', name: 'WORKERS', startedAt: null, completedAt: null, error: null, attempts: 0 },
    8: { status: 'pending', name: 'API', startedAt: null, completedAt: null, error: null, attempts: 0 },
    9: { status: 'pending', name: 'OBSERVABILITY', startedAt: null, completedAt: null, error: null, attempts: 0 },
    10: { status: 'pending', name: 'INTEGRATIONS', startedAt: null, completedAt: null, error: null, attempts: 0 },
    11: { status: 'pending', name: 'FRONTEND', startedAt: null, completedAt: null, error: null, attempts: 0 },
  },
  config: null,
  errors: [],
  metrics: {
    totalDuration: null,
    phaseDurations: {},
    retryCount: 0,
  }
};

class ScaffoldState {
  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = workspaceRoot;
    this.statePath = path.join(workspaceRoot, STATE_FILE);
    this.configPath = path.join(workspaceRoot, CONFIG_FILE);
    this.state = null;
  }

  /**
   * Initialize or load existing state
   */
  init() {
    if (fs.existsSync(this.statePath)) {
      this.state = JSON.parse(fs.readFileSync(this.statePath, 'utf-8'));
      console.log(`📂 Loaded existing scaffold state (Phase ${this.state.currentPhase}, Status: ${this.state.status})`);
    } else {
      this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
      this.state.startedAt = new Date().toISOString();
      
      // Load config if exists
      if (fs.existsSync(this.configPath)) {
        this.state.config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        this.state.projectName = this.state.config.projectName;
      }
      
      this.save();
      console.log('📂 Created new scaffold state');
    }
    return this;
  }

  /**
   * Save state to disk
   */
  save() {
    this.state.lastUpdated = new Date().toISOString();
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
  }

  /**
   * Start a phase
   */
  startPhase(phaseNum) {
    const phase = this.state.phases[phaseNum];
    if (!phase) throw new Error(`Invalid phase: ${phaseNum}`);
    
    phase.status = 'in_progress';
    phase.startedAt = new Date().toISOString();
    phase.attempts += 1;
    this.state.currentPhase = phaseNum;
    this.state.status = 'in_progress';
    
    this.save();
    console.log(`▶️  Started Phase ${String(phaseNum).padStart(2, '0')}: ${phase.name} (Attempt ${phase.attempts})`);
  }

  /**
   * Complete a phase
   */
  completePhase(phaseNum) {
    const phase = this.state.phases[phaseNum];
    if (!phase) throw new Error(`Invalid phase: ${phaseNum}`);
    
    phase.status = 'completed';
    phase.completedAt = new Date().toISOString();
    phase.error = null;
    
    // Calculate duration
    if (phase.startedAt) {
      const duration = new Date(phase.completedAt) - new Date(phase.startedAt);
      this.state.metrics.phaseDurations[phaseNum] = duration;
    }
    
    // Check if all phases complete
    const allComplete = Object.values(this.state.phases).every(p => p.status === 'completed');
    if (allComplete) {
      this.state.status = 'completed';
      this.state.completedAt = new Date().toISOString();
      this.state.metrics.totalDuration = new Date(this.state.completedAt) - new Date(this.state.startedAt);
    }
    
    this.save();
    console.log(`✅ Completed Phase ${String(phaseNum).padStart(2, '0')}: ${phase.name}`);
  }

  /**
   * Fail a phase
   */
  failPhase(phaseNum, error) {
    const phase = this.state.phases[phaseNum];
    if (!phase) throw new Error(`Invalid phase: ${phaseNum}`);
    
    phase.status = 'failed';
    phase.error = error;
    this.state.status = 'failed';
    this.state.metrics.retryCount += 1;
    
    this.state.errors.push({
      phase: phaseNum,
      error: error,
      timestamp: new Date().toISOString(),
      attempt: phase.attempts,
    });
    
    this.save();
    console.log(`❌ Failed Phase ${String(phaseNum).padStart(2, '0')}: ${phase.name}`);
    console.log(`   Error: ${error}`);
  }

  /**
   * Skip a phase
   */
  skipPhase(phaseNum, reason = 'Skipped by configuration') {
    const phase = this.state.phases[phaseNum];
    if (!phase) throw new Error(`Invalid phase: ${phaseNum}`);
    
    phase.status = 'skipped';
    phase.error = reason;
    
    this.save();
    console.log(`⏭️  Skipped Phase ${String(phaseNum).padStart(2, '0')}: ${phase.name} (${reason})`);
  }

  /**
   * Get next phase to execute
   */
  getNextPhase() {
    const skipPhases = this.state.config?.scaffoldOptions?.skipPhases || [];
    
    for (let i = 1; i <= 11; i++) {
      const phase = this.state.phases[i];
      if (skipPhases.includes(i)) {
        if (phase.status === 'pending') {
          this.skipPhase(i, 'Skipped by configuration');
        }
        continue;
      }
      if (phase.status === 'pending' || phase.status === 'failed') {
        return i;
      }
    }
    return null; // All done
  }

  /**
   * Get resume instructions for an agent
   */
  getResumeInstructions() {
    const next = this.getNextPhase();
    
    if (!next) {
      return {
        action: 'complete',
        message: '🎉 All phases complete! Run smoke-test.js to validate.',
        command: 'node Masterguide/scaffolding/scripts/smoke-test.js',
      };
    }
    
    const phase = this.state.phases[next];
    const phaseFile = `${String(next).padStart(2, '0')}-${phase.name}.md`;
    
    let message = '';
    if (phase.status === 'failed') {
      message = `⚠️  Phase ${next} (${phase.name}) previously failed. Retrying...\n`;
      message += `   Previous error: ${phase.error}\n`;
      message += `   Attempt: ${phase.attempts + 1}`;
    } else {
      message = `▶️  Ready to execute Phase ${next}: ${phase.name}`;
    }
    
    return {
      action: 'execute',
      phase: next,
      phaseName: phase.name,
      phaseFile: phaseFile,
      message: message,
      command: `Execute the instructions in Masterguide/scaffolding/${phaseFile}`,
      previouslyFailed: phase.status === 'failed',
      attempt: phase.attempts + 1,
    };
  }

  /**
   * Get status summary
   */
  getSummary() {
    const completed = Object.values(this.state.phases).filter(p => p.status === 'completed').length;
    const failed = Object.values(this.state.phases).filter(p => p.status === 'failed').length;
    const skipped = Object.values(this.state.phases).filter(p => p.status === 'skipped').length;
    const pending = Object.values(this.state.phases).filter(p => p.status === 'pending').length;
    const inProgress = Object.values(this.state.phases).filter(p => p.status === 'in_progress').length;
    
    return {
      status: this.state.status,
      progress: `${completed}/${11 - skipped}`,
      progressPercent: Math.round((completed / (11 - skipped)) * 100),
      completed,
      failed,
      skipped,
      pending,
      inProgress,
      currentPhase: this.state.currentPhase,
      totalRetries: this.state.metrics.retryCount,
      startedAt: this.state.startedAt,
      lastUpdated: this.state.lastUpdated,
    };
  }

  /**
   * Reset state (for fresh start)
   */
  reset() {
    if (fs.existsSync(this.statePath)) {
      fs.unlinkSync(this.statePath);
    }
    this.state = null;
    console.log('🔄 Scaffold state reset');
  }

  /**
   * Export state for dashboard
   */
  toJSON() {
    return this.state;
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  
  const state = new ScaffoldState().init();
  
  switch (command) {
    case 'status':
      const summary = state.getSummary();
      console.log('\n📊 SCAFFOLD STATUS');
      console.log('═'.repeat(40));
      console.log(`Status:      ${summary.status}`);
      console.log(`Progress:    ${summary.progress} phases (${summary.progressPercent}%)`);
      console.log(`Current:     Phase ${summary.currentPhase || 'N/A'}`);
      console.log(`Retries:     ${summary.totalRetries}`);
      console.log(`Started:     ${summary.startedAt || 'N/A'}`);
      console.log(`Updated:     ${summary.lastUpdated || 'N/A'}`);
      console.log('');
      
      console.log('PHASES:');
      for (let i = 1; i <= 11; i++) {
        const p = state.state.phases[i];
        const icon = {
          'completed': '✅',
          'failed': '❌',
          'skipped': '⏭️',
          'in_progress': '🔄',
          'pending': '⬜',
        }[p.status];
        console.log(`  ${icon} ${String(i).padStart(2, '0')}. ${p.name.padEnd(15)} ${p.status}`);
      }
      break;
      
    case 'resume':
      const instructions = state.getResumeInstructions();
      console.log('\n🔄 RESUME INSTRUCTIONS');
      console.log('═'.repeat(40));
      console.log(instructions.message);
      if (instructions.command) {
        console.log(`\nCommand: ${instructions.command}`);
      }
      break;
      
    case 'reset':
      state.reset();
      break;
      
    case 'start':
      const phaseNum = parseInt(args[1]);
      if (phaseNum >= 1 && phaseNum <= 11) {
        state.startPhase(phaseNum);
      } else {
        console.error('Usage: scaffold-state.js start <phase_number>');
      }
      break;
      
    case 'complete':
      const completeNum = parseInt(args[1]);
      if (completeNum >= 1 && completeNum <= 11) {
        state.completePhase(completeNum);
      } else {
        console.error('Usage: scaffold-state.js complete <phase_number>');
      }
      break;
      
    case 'fail':
      const failNum = parseInt(args[1]);
      const error = args.slice(2).join(' ') || 'Unknown error';
      if (failNum >= 1 && failNum <= 11) {
        state.failPhase(failNum, error);
      } else {
        console.error('Usage: scaffold-state.js fail <phase_number> <error_message>');
      }
      break;
      
    default:
      console.log(`
Scaffold State Manager

Usage:
  node scaffold-state.js <command> [args]

Commands:
  status              Show current scaffold status
  resume              Get instructions for next phase
  reset               Reset all state (fresh start)
  start <phase>       Mark phase as started
  complete <phase>    Mark phase as completed
  fail <phase> <msg>  Mark phase as failed with error

Examples:
  node scaffold-state.js status
  node scaffold-state.js resume
  node scaffold-state.js start 3
  node scaffold-state.js complete 3
  node scaffold-state.js fail 3 "Import error in types.ts"
`);
  }
}

module.exports = { ScaffoldState, DEFAULT_STATE };
