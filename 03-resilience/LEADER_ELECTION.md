# Leader Election

> **Implementation Time**: 4h  
> **Complexity**: Medium  
> **Dependencies**: PostgreSQL or Redis

## Problem

Multiple instances of your app. Only one should run the cron job. Only one should process the queue. You need a single leader, with automatic failover.

## Solution

Leader election with heartbeat. One instance becomes leader. Others wait. If leader dies, another takes over automatically.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Leader Election                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Instance A          Instance B          Instance C             │
│  (Leader)            (Follower)          (Follower)             │
│      │                   │                   │                  │
│      │  heartbeat        │                   │                  │
│      │───────────────────┼───────────────────┼──────────┐       │
│      │                   │                   │          │       │
│      │                   │                   │          ▼       │
│      │                   │                   │   ┌────────────┐ │
│      │                   │                   │   │   Leader   │ │
│      │                   │                   │   │   Store    │ │
│      │                   │                   │   │            │ │
│      │                   │  check leader     │   │ leader: A  │ │
│      │                   │───────────────────┼──▶│ term: 5    │ │
│      │                   │                   │   │ heartbeat: │ │
│      │                   │◀──────────────────┼───│  10s ago   │ │
│      │                   │  "A is leader"    │   └────────────┘ │
│      │                   │                   │                  │
│      │                   │                   │                  │
│  [Leader dies]           │                   │                  │
│      ✗                   │                   │                  │
│                          │  heartbeat timeout│                  │
│                          │  try to become    │                  │
│                          │  leader           │                  │
│                          │───────────────────┼──────────┐       │
│                          │                   │          ▼       │
│                          │                   │   ┌────────────┐ │
│                          │                   │   │ leader: B  │ │
│                          │◀──────────────────┼───│ term: 6    │ │
│                          │  "You are leader" │   └────────────┘ │
│                          │                   │                  │
│                     (New Leader)             │                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation

### Types

```typescript
// types.ts
export interface LeaderInfo {
  leaderId: string;
  term: number;
  lastHeartbeat: Date;
  metadata?: Record<string, unknown>;
}

export interface LeaderElectionConfig {
  serviceName: string;
  candidateId: string;
  heartbeatIntervalMs: number;
  heartbeatTimeoutSeconds: number;
  onBecomeLeader?: () => void | Promise<void>;
  onLoseLeadership?: () => void | Promise<void>;
  onLeaderChange?: (newLeaderId: string) => void | Promise<void>;
}
```

### Database Schema

```sql
-- migrations/leader_election.sql

CREATE TABLE leader_election (
    service_name VARCHAR(255) PRIMARY KEY,
    leader_id VARCHAR(255) NOT NULL,
    term INTEGER NOT NULL DEFAULT 1,
    last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',
    
    CONSTRAINT positive_term CHECK (term > 0)
);

CREATE INDEX idx_leader_heartbeat ON leader_election(last_heartbeat);

-- Try to become leader (atomic)
CREATE OR REPLACE FUNCTION try_become_leader(
    p_service_name VARCHAR(255),
    p_candidate_id VARCHAR(255),
    p_timeout_seconds INTEGER DEFAULT 30
) RETURNS BOOLEAN AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_timeout TIMESTAMPTZ := v_now - (p_timeout_seconds || ' seconds')::INTERVAL;
    v_current_leader RECORD;
BEGIN
    -- Check current leader
    SELECT * INTO v_current_leader
    FROM leader_election
    WHERE service_name = p_service_name
    FOR UPDATE;
    
    IF NOT FOUND THEN
        -- No leader exists, become leader
        INSERT INTO leader_election (service_name, leader_id, term, last_heartbeat)
        VALUES (p_service_name, p_candidate_id, 1, v_now);
        RETURN TRUE;
    END IF;
    
    -- Check if we're already leader
    IF v_current_leader.leader_id = p_candidate_id THEN
        -- Refresh heartbeat
        UPDATE leader_election
        SET last_heartbeat = v_now
        WHERE service_name = p_service_name;
        RETURN TRUE;
    END IF;
    
    -- Check if current leader has timed out
    IF v_current_leader.last_heartbeat < v_timeout THEN
        -- Take over leadership
        UPDATE leader_election
        SET 
            leader_id = p_candidate_id,
            term = term + 1,
            last_heartbeat = v_now
        WHERE service_name = p_service_name;
        RETURN TRUE;
    END IF;
    
    -- Someone else is leader
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- Send heartbeat
CREATE OR REPLACE FUNCTION leader_heartbeat(
    p_service_name VARCHAR(255),
    p_leader_id VARCHAR(255)
) RETURNS BOOLEAN AS $$
BEGIN
    UPDATE leader_election
    SET last_heartbeat = NOW()
    WHERE service_name = p_service_name
    AND leader_id = p_leader_id;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Step down as leader
CREATE OR REPLACE FUNCTION step_down(
    p_service_name VARCHAR(255),
    p_leader_id VARCHAR(255)
) RETURNS BOOLEAN AS $$
BEGIN
    DELETE FROM leader_election
    WHERE service_name = p_service_name
    AND leader_id = p_leader_id;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Get current leader
CREATE OR REPLACE FUNCTION get_leader(
    p_service_name VARCHAR(255)
) RETURNS TABLE (
    leader_id VARCHAR(255),
    term INTEGER,
    last_heartbeat TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT le.leader_id, le.term, le.last_heartbeat
    FROM leader_election le
    WHERE le.service_name = p_service_name;
END;
$$ LANGUAGE plpgsql;
```

### Leader Election Class

```typescript
// leader-election.ts
import { SupabaseClient } from '@supabase/supabase-js';
import { LeaderElectionConfig, LeaderInfo } from './types';

const DEFAULT_CONFIG = {
  heartbeatIntervalMs: 10000,
  heartbeatTimeoutSeconds: 30,
};

export class LeaderElection {
  private config: LeaderElectionConfig;
  private supabase: SupabaseClient;
  private isLeader = false;
  private currentTerm = 0;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private running = false;

  constructor(supabase: SupabaseClient, config: LeaderElectionConfig) {
    this.supabase = supabase;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start participating in leader election.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Initial election attempt
    await this.tryBecomeLeader();

    // Start heartbeat loop
    this.heartbeatInterval = setInterval(
      () => this.heartbeatLoop(),
      this.config.heartbeatIntervalMs
    );
  }

  /**
   * Stop participating in leader election.
   */
  async stop(): Promise<void> {
    this.running = false;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Step down if we're leader
    if (this.isLeader) {
      await this.stepDown();
    }
  }

  /**
   * Check if this instance is the leader.
   */
  isCurrentLeader(): boolean {
    return this.isLeader;
  }

  /**
   * Get current leader info.
   */
  async getLeader(): Promise<LeaderInfo | null> {
    const { data, error } = await this.supabase.rpc('get_leader', {
      p_service_name: this.config.serviceName,
    });

    if (error || !data || data.length === 0) {
      return null;
    }

    return {
      leaderId: data[0].leader_id,
      term: data[0].term,
      lastHeartbeat: new Date(data[0].last_heartbeat),
    };
  }

  /**
   * Try to become leader.
   */
  private async tryBecomeLeader(): Promise<boolean> {
    const { data, error } = await this.supabase.rpc('try_become_leader', {
      p_service_name: this.config.serviceName,
      p_candidate_id: this.config.candidateId,
      p_timeout_seconds: this.config.heartbeatTimeoutSeconds,
    });

    if (error) {
      console.error('[LeaderElection] Error:', error);
      return false;
    }

    const becameLeader = data === true;

    if (becameLeader && !this.isLeader) {
      // Just became leader
      this.isLeader = true;
      console.log(`[LeaderElection] ${this.config.candidateId} became leader for ${this.config.serviceName}`);
      
      if (this.config.onBecomeLeader) {
        await this.config.onBecomeLeader();
      }
    }

    return becameLeader;
  }

  /**
   * Send heartbeat to maintain leadership.
   */
  private async sendHeartbeat(): Promise<boolean> {
    const { data, error } = await this.supabase.rpc('leader_heartbeat', {
      p_service_name: this.config.serviceName,
      p_leader_id: this.config.candidateId,
    });

    if (error) {
      console.error('[LeaderElection] Heartbeat error:', error);
      return false;
    }

    return data === true;
  }

  /**
   * Step down from leadership.
   */
  private async stepDown(): Promise<void> {
    if (!this.isLeader) return;

    const { error } = await this.supabase.rpc('step_down', {
      p_service_name: this.config.serviceName,
      p_leader_id: this.config.candidateId,
    });

    if (!error) {
      this.isLeader = false;
      console.log(`[LeaderElection] ${this.config.candidateId} stepped down`);
      
      if (this.config.onLoseLeadership) {
        await this.config.onLoseLeadership();
      }
    }
  }

  /**
   * Heartbeat loop - maintain or acquire leadership.
   */
  private async heartbeatLoop(): Promise<void> {
    if (!this.running) return;

    if (this.isLeader) {
      // Try to maintain leadership
      const maintained = await this.sendHeartbeat();
      
      if (!maintained) {
        // Lost leadership
        this.isLeader = false;
        console.log(`[LeaderElection] ${this.config.candidateId} lost leadership`);
        
        if (this.config.onLoseLeadership) {
          await this.config.onLoseLeadership();
        }
      }
    } else {
      // Try to become leader
      await this.tryBecomeLeader();
    }

    // Check for leader changes
    const leader = await this.getLeader();
    if (leader && this.config.onLeaderChange) {
      await this.config.onLeaderChange(leader.leaderId);
    }
  }
}
```

## Usage Examples

### Singleton Cron Job

```typescript
import { LeaderElection } from './leader-election';
import { createServerSupabaseClient } from './supabase-server';

const supabase = await createServerSupabaseClient();

const election = new LeaderElection(supabase, {
  serviceName: 'daily-report-generator',
  candidateId: `worker-${process.env.HOSTNAME || 'local'}`,
  heartbeatIntervalMs: 10000,
  heartbeatTimeoutSeconds: 30,
  
  onBecomeLeader: async () => {
    console.log('I am now the leader, starting cron jobs');
    startCronJobs();
  },
  
  onLoseLeadership: async () => {
    console.log('Lost leadership, stopping cron jobs');
    stopCronJobs();
  },
});

// Start election
await election.start();

// Check before running leader-only tasks
if (election.isCurrentLeader()) {
  await runDailyReport();
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  await election.stop();
  process.exit(0);
});
```

### Queue Consumer

```typescript
const election = new LeaderElection(supabase, {
  serviceName: 'queue-consumer',
  candidateId: `consumer-${process.pid}`,
  
  onBecomeLeader: () => {
    // Start consuming from queue
    queueConsumer.start();
  },
  
  onLoseLeadership: () => {
    // Stop consuming, let new leader take over
    queueConsumer.stop();
  },
});

await election.start();
```

### Conditional Execution

```typescript
async function runIfLeader<T>(
  election: LeaderElection,
  fn: () => Promise<T>
): Promise<T | null> {
  if (!election.isCurrentLeader()) {
    console.log('Not leader, skipping');
    return null;
  }
  
  return fn();
}

// Usage
await runIfLeader(election, async () => {
  await sendDailyEmails();
});
```

## Configuration Guide

| Scenario | heartbeatIntervalMs | heartbeatTimeoutSeconds |
|----------|---------------------|-------------------------|
| Fast failover | 5000 | 15 |
| Normal | 10000 | 30 |
| Slow/unreliable network | 30000 | 90 |

## Production Checklist

- [ ] Unique candidate IDs per instance
- [ ] Heartbeat interval < timeout / 3
- [ ] Graceful shutdown calls stop()
- [ ] Leader-only tasks check isCurrentLeader()
- [ ] Monitoring for leadership changes
- [ ] Alerts on frequent leader changes

## Related Patterns

- [Distributed Locking](./DISTRIBUTED_LOCK.md)
- [Worker Orchestration](../04-workers/ORCHESTRATION.md)
