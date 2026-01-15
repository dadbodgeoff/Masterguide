# Fixed Timestep Game Loop with Interpolation

> **Implementation Time**: 4h  
> **Complexity**: Medium  
> **Dependencies**: None (vanilla TypeScript)

## Problem

Frame-rate-dependent game loops cause physics to behave differently on 30fps vs 144fps monitors. Players on faster machines move faster, jump higher, or have gameplay advantages. Variable delta time helps but introduces non-determinism and floating-point drift.

## Solution

Separate physics updates (fixed timestep) from rendering (variable). Use an accumulator to run physics at consistent rate regardless of frame rate, then interpolate between physics states for smooth rendering.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    FIXED TIMESTEP GAME LOOP                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   requestAnimationFrame                                                  │
│           │                                                              │
│           ▼                                                              │
│   ┌───────────────────────────────────────────────────────────────┐     │
│   │                    FRAME START                                 │     │
│   │                                                                │     │
│   │   • Calculate frame delta (capped at MAX_FRAME_TIME)          │     │
│   │   • Add delta to accumulator                                  │     │
│   │   • Apply time scale (slow-mo, hitstop)                       │     │
│   │                                                                │     │
│   └───────────────────────────────────────────────────────────────┘     │
│           │                                                              │
│           ▼                                                              │
│   ┌───────────────────────────────────────────────────────────────┐     │
│   │                    PHYSICS LOOP                                │     │
│   │                                                                │     │
│   │   while (accumulator >= fixedTimestep) {                      │     │
│   │       onFixedUpdate(fixedTimestep)  // Physics, collision     │     │
│   │       accumulator -= fixedTimestep                            │     │
│   │   }                                                            │     │
│   │                                                                │     │
│   └───────────────────────────────────────────────────────────────┘     │
│           │                                                              │
│           ▼                                                              │
│   ┌───────────────────────────────────────────────────────────────┐     │
│   │                    RENDER                                      │     │
│   │                                                                │     │
│   │   interpolation = accumulator / fixedTimestep                 │     │
│   │   onRenderUpdate(delta, interpolation)  // Smooth visuals     │     │
│   │                                                                │     │
│   └───────────────────────────────────────────────────────────────┘     │
│           │                                                              │
│           ▼                                                              │
│   ┌───────────────────────────────────────────────────────────────┐     │
│   │                    STATS UPDATE                                │     │
│   │                                                                │     │
│   │   • FPS calculation (1-second rolling average)                │     │
│   │   • Lag spike detection                                       │     │
│   │   • Performance metrics                                       │     │
│   │                                                                │     │
│   └───────────────────────────────────────────────────────────────┘     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Implementation

### Core Types

```typescript
// types.ts

export interface GameLoopStats {
  fps: number
  frameTime: number
  physicsTime: number
  renderTime: number
  lagSpikes: number
  interpolation: number
  timeScale: number
  isInHitstop: boolean
}

export interface GameLoopCallbacks {
  /**
   * Fixed timestep update for physics/game logic.
   * Called 0-N times per frame depending on accumulator.
   * 
   * @param fixedDelta - Always the same value (e.g., 1/60)
   * @param now - Current timestamp
   */
  onFixedUpdate: (fixedDelta: number, now: number) => void
  
  /**
   * Variable timestep update for rendering.
   * Called exactly once per frame.
   * 
   * @param delta - Time since last frame (variable)
   * @param interpolation - 0-1 value for smoothing between physics states
   * @param now - Current timestamp
   */
  onRenderUpdate: (delta: number, interpolation: number, now: number) => void
  
  /**
   * Optional callback when lag spike detected.
   * 
   * @param missedFrames - Number of physics frames that were skipped
   */
  onLagSpike?: (missedFrames: number) => void
}
```

### Game Loop Implementation

```typescript
// GameLoop.ts

import type { GameLoopStats, GameLoopCallbacks } from './types'

export class GameLoop {
  // Configuration
  private fixedTimestep: number
  private readonly MAX_FRAME_TIME = 0.25  // Cap to prevent spiral of death
  private readonly LAG_SPIKE_THRESHOLD = 0.1  // 100ms = lag spike
  
  // Accumulator for fixed timestep
  private accumulator = 0
  private lastTime = 0
  private interpolation = 0
  
  // Stats tracking
  private frameCount = 0
  private fpsTimer = 0
  private currentFps = 60
  private lagSpikes = 0
  private physicsTime = 0
  private renderTime = 0
  
  // State
  private running = false
  private animationId: number | null = null
  private callbacks: GameLoopCallbacks

  // Hitstop - freeze frames on impact for game feel
  private hitstopTimer = 0
  private hitstopDuration = 0
  private hitstopIntensity = 0
  
  // External time scale (slow-mo death, power-ups, etc.)
  private externalTimeScale = 1.0
  
  constructor(callbacks: GameLoopCallbacks, fixedTimestep = 1 / 60) {
    this.callbacks = callbacks
    this.fixedTimestep = fixedTimestep
  }

  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Start the game loop.
   */
  start(): void {
    if (this.running) return
    
    this.running = true
    this.lastTime = performance.now() / 1000
    this.accumulator = 0
    this.frameCount = 0
    this.fpsTimer = 0
    this.lagSpikes = 0
    
    this.loop()
  }

  /**
   * Stop the game loop.
   */
  stop(): void {
    this.running = false
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
  }

  /**
   * Set the fixed timestep (for quality adjustment).
   * Lower values = more physics updates = smoother but more CPU.
   */
  setFixedTimestep(timestep: number): void {
    this.fixedTimestep = timestep
  }

  /**
   * Trigger hitstop (screen freeze on impact).
   * Creates satisfying "weight" to hits.
   * 
   * @param frames - Number of frames to freeze (at 60fps, 3 frames = 50ms)
   * @param intensity - 0-1, how much to slow time (0 = full freeze, 1 = normal)
   */
  triggerHitstop(frames = 3, intensity = 0.1): void {
    this.hitstopDuration = frames * this.fixedTimestep
    this.hitstopTimer = this.hitstopDuration
    this.hitstopIntensity = intensity
  }

  /**
   * Set external time scale for slow-mo effects.
   * 
   * @param scale - 0-1 for slow-mo, 1 for normal, >1 for fast-forward
   */
  setTimeScale(scale: number): void {
    this.externalTimeScale = Math.max(0, scale)
  }

  /**
   * Get current loop statistics.
   */
  getStats(): GameLoopStats {
    return {
      fps: this.currentFps,
      frameTime: this.physicsTime + this.renderTime,
      physicsTime: this.physicsTime,
      renderTime: this.renderTime,
      lagSpikes: this.lagSpikes,
      interpolation: this.interpolation,
      timeScale: this.getEffectiveTimeScale(),
      isInHitstop: this.hitstopTimer > 0,
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE IMPLEMENTATION
  // ═══════════════════════════════════════════════════════════════════

  private loop = (): void => {
    if (!this.running) return
    
    const now = performance.now() / 1000
    let frameTime = now - this.lastTime
    this.lastTime = now
    
    // Cap frame time to prevent spiral of death
    // (when physics can't keep up, don't try to catch up forever)
    if (frameTime > this.MAX_FRAME_TIME) {
      const missedFrames = Math.floor(frameTime / this.fixedTimestep)
      this.lagSpikes++
      
      if (this.callbacks.onLagSpike) {
        this.callbacks.onLagSpike(missedFrames)
      }
      
      frameTime = this.MAX_FRAME_TIME
    }
    
    // Apply time scale
    frameTime *= this.getEffectiveTimeScale()
    
    // Update hitstop
    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= frameTime / this.getEffectiveTimeScale()
    }
    
    // Add to accumulator
    this.accumulator += frameTime
    
    // Fixed timestep physics updates
    const physicsStart = performance.now()
    
    while (this.accumulator >= this.fixedTimestep) {
      this.callbacks.onFixedUpdate(this.fixedTimestep, now)
      this.accumulator -= this.fixedTimestep
    }
    
    this.physicsTime = performance.now() - physicsStart
    
    // Calculate interpolation for smooth rendering
    this.interpolation = this.accumulator / this.fixedTimestep
    
    // Render update (once per frame)
    const renderStart = performance.now()
    this.callbacks.onRenderUpdate(frameTime, this.interpolation, now)
    this.renderTime = performance.now() - renderStart
    
    // FPS calculation (1-second rolling average)
    this.frameCount++
    this.fpsTimer += frameTime / this.getEffectiveTimeScale()
    
    if (this.fpsTimer >= 1.0) {
      this.currentFps = Math.round(this.frameCount / this.fpsTimer)
      this.frameCount = 0
      this.fpsTimer = 0
    }
    
    // Schedule next frame
    this.animationId = requestAnimationFrame(this.loop)
  }

  private getEffectiveTimeScale(): number {
    // Hitstop overrides external time scale
    if (this.hitstopTimer > 0) {
      return this.hitstopIntensity
    }
    return this.externalTimeScale
  }
}
```

### Usage Example

```typescript
// example.ts

import { GameLoop } from './GameLoop'

// Game state
let playerX = 0
let playerY = 0
let playerVelX = 0
let playerVelY = 0

// Previous state for interpolation
let prevPlayerX = 0
let prevPlayerY = 0

const gameLoop = new GameLoop({
  onFixedUpdate: (fixedDelta, now) => {
    // Store previous position for interpolation
    prevPlayerX = playerX
    prevPlayerY = playerY
    
    // Physics update (deterministic, same every time)
    playerVelY += 980 * fixedDelta  // Gravity
    playerX += playerVelX * fixedDelta
    playerY += playerVelY * fixedDelta
    
    // Collision detection
    if (playerY > 500) {
      playerY = 500
      playerVelY = 0
    }
  },
  
  onRenderUpdate: (delta, interpolation, now) => {
    // Interpolate between physics states for smooth rendering
    const renderX = prevPlayerX + (playerX - prevPlayerX) * interpolation
    const renderY = prevPlayerY + (playerY - prevPlayerY) * interpolation
    
    // Draw at interpolated position
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillRect(renderX - 10, renderY - 10, 20, 20)
    
    // Draw FPS
    const stats = gameLoop.getStats()
    ctx.fillText(`FPS: ${stats.fps}`, 10, 20)
  },
  
  onLagSpike: (missedFrames) => {
    console.warn(`Lag spike: missed ${missedFrames} physics frames`)
  },
})

// Start the loop
gameLoop.start()

// Trigger hitstop on collision
function onPlayerHit() {
  gameLoop.triggerHitstop(4, 0.05)  // 4 frames, 5% speed
}

// Slow-mo death sequence
function onPlayerDeath() {
  gameLoop.setTimeScale(0.3)  // 30% speed
  setTimeout(() => gameLoop.setTimeScale(1.0), 2000)
}
```

### Interpolation Helper

```typescript
// interpolation.ts

/**
 * Interpolate between two values.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Interpolate between two positions.
 */
export function lerpPosition(
  prev: { x: number; y: number },
  curr: { x: number; y: number },
  t: number
): { x: number; y: number } {
  return {
    x: lerp(prev.x, curr.x, t),
    y: lerp(prev.y, curr.y, t),
  }
}

/**
 * Interpolate angle (handles wraparound).
 */
export function lerpAngle(a: number, b: number, t: number): number {
  // Normalize to [-PI, PI]
  let diff = b - a
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  return a + diff * t
}

/**
 * State container with automatic previous state tracking.
 */
export class InterpolatedState<T extends Record<string, number>> {
  private current: T
  private previous: T
  
  constructor(initial: T) {
    this.current = { ...initial }
    this.previous = { ...initial }
  }
  
  /**
   * Call at start of fixed update to save previous state.
   */
  savePrevious(): void {
    this.previous = { ...this.current }
  }
  
  /**
   * Update current state.
   */
  set<K extends keyof T>(key: K, value: T[K]): void {
    this.current[key] = value
  }
  
  /**
   * Get current state value.
   */
  get<K extends keyof T>(key: K): T[K] {
    return this.current[key]
  }
  
  /**
   * Get interpolated value for rendering.
   */
  getInterpolated<K extends keyof T>(key: K, t: number): number {
    const prev = this.previous[key] as number
    const curr = this.current[key] as number
    return lerp(prev, curr, t)
  }
}
```

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `fixedTimestep` | `1/60` | Physics update interval (60Hz) |
| `MAX_FRAME_TIME` | `0.25` | Cap to prevent spiral of death |
| `LAG_SPIKE_THRESHOLD` | `0.1` | Frame time that triggers lag spike callback |

## Error Handling

| Scenario | Handling |
|----------|----------|
| Frame takes too long | Cap at MAX_FRAME_TIME, log lag spike |
| Tab backgrounded | Browser throttles RAF, accumulator catches up on focus |
| Physics can't keep up | Spiral of death prevention via frame cap |

## Testing

```typescript
import { describe, it, expect, vi } from 'vitest'
import { GameLoop } from './GameLoop'

describe('GameLoop', () => {
  it('calls fixed update at consistent rate', () => {
    const fixedUpdates: number[] = []
    
    const loop = new GameLoop({
      onFixedUpdate: (delta) => {
        fixedUpdates.push(delta)
      },
      onRenderUpdate: () => {},
    }, 1/60)
    
    // Simulate 100ms of frames
    // ... (mock requestAnimationFrame)
    
    // All fixed updates should have same delta
    expect(fixedUpdates.every(d => d === 1/60)).toBe(true)
  })
  
  it('provides interpolation value between 0 and 1', () => {
    let lastInterpolation = 0
    
    const loop = new GameLoop({
      onFixedUpdate: () => {},
      onRenderUpdate: (_, interpolation) => {
        lastInterpolation = interpolation
      },
    })
    
    // ... simulate frames
    
    expect(lastInterpolation).toBeGreaterThanOrEqual(0)
    expect(lastInterpolation).toBeLessThan(1)
  })
  
  it('applies hitstop time scale', () => {
    const loop = new GameLoop({
      onFixedUpdate: () => {},
      onRenderUpdate: () => {},
    })
    
    loop.triggerHitstop(3, 0.1)
    
    const stats = loop.getStats()
    expect(stats.isInHitstop).toBe(true)
    expect(stats.timeScale).toBe(0.1)
  })
})
```

## Production Checklist

- [ ] Fixed timestep tuned for your game (30-60Hz typical)
- [ ] MAX_FRAME_TIME prevents spiral of death
- [ ] Interpolation used for all rendered positions
- [ ] Lag spike callback logs to analytics
- [ ] FPS counter visible in debug mode
- [ ] Hitstop values tuned for game feel
- [ ] Tested on low-end devices

## Related Patterns

- [Server-Authoritative Tick System](../13-realtime-multiplayer/SERVER_AUTHORITATIVE_TICK.md)
- [Object Pooling](./OBJECT_POOLING.md)
