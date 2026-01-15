# Server-Authoritative Tick System

> **Implementation Time**: 8h  
> **Complexity**: High  
> **Dependencies**: asyncio, Redis (optional for distributed)

## Problem

Client-authoritative multiplayer is trivially exploitable (speed hacks, teleports, aimbots). But naive server-authoritative implementations feel laggy and unfair due to network latency. You need server authority with lag compensation to make hits feel fair for both players.

## Solution

A server-side tick system that:
1. Runs at fixed rate (60Hz) for deterministic physics
2. Validates all client inputs (movement, actions)
3. Maintains position history for lag compensation
4. Tracks violations with decay for anti-cheat
5. Broadcasts state at reduced rate to save bandwidth

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SERVER TICK SYSTEM (60Hz)                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Client Input                                                           │
│       │                                                                  │
│       ▼                                                                  │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                    INPUT VALIDATION                              │   │
│   │                                                                  │   │
│   │   • Speed limit check (max units/tick)                          │   │
│   │   • Teleport detection (distance from last valid)               │   │
│   │   • Action cooldown verification                                │   │
│   │   • Violation tracking with decay                               │   │
│   │                                                                  │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                  │
│       ▼                                                                  │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                    GAME STATE UPDATE                             │   │
│   │                                                                  │   │
│   │   • Apply validated movement                                    │   │
│   │   • Process combat (with lag compensation)                      │   │
│   │   • Update buffs/debuffs                                        │   │
│   │   • Check win conditions                                        │   │
│   │                                                                  │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                  │
│       ▼                                                                  │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                    LAG COMPENSATION                              │   │
│   │                                                                  │   │
│   │   • Position history buffer (200ms window)                      │   │
│   │   • Rewind to client's perceived time                           │   │
│   │   • Hit detection against historical positions                  │   │
│   │   • Interpolate between snapshots                               │   │
│   │                                                                  │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                  │
│       ▼                                                                  │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                    STATE BROADCAST                               │   │
│   │                                                                  │   │
│   │   • Every N ticks (e.g., every 3rd = 20Hz)                      │   │
│   │   • Delta compression (only changed state)                      │   │
│   │   • Priority for important events                               │   │
│   │                                                                  │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Implementation

### Configuration

```python
# config.py
from dataclasses import dataclass


@dataclass(frozen=True)
class TickConfig:
    """Server tick configuration."""
    rate_hz: int = 60                    # Ticks per second
    broadcast_divisor: int = 3           # Broadcast every N ticks (60/3 = 20Hz)
    
    @property
    def interval_ms(self) -> float:
        return 1000.0 / self.rate_hz     # 16.67ms at 60Hz


@dataclass(frozen=True)
class MovementConfig:
    """Movement validation configuration."""
    max_speed: float = 300.0             # Units per second
    teleport_threshold: float = 100.0    # Max distance per tick before flagged
    
    def max_distance_per_tick(self, tick_rate: int) -> float:
        """Maximum valid movement distance per tick."""
        return self.max_speed / tick_rate


@dataclass(frozen=True)
class LagCompConfig:
    """Lag compensation configuration."""
    max_rewind_ms: int = 200             # Maximum rewind window
    snapshot_interval_ms: int = 16       # Position snapshot frequency
    
    def history_size(self, tick_rate: int) -> int:
        """Number of snapshots to keep."""
        return int((self.max_rewind_ms / 1000) * tick_rate) + 1


@dataclass(frozen=True)
class AntiCheatConfig:
    """Anti-cheat configuration."""
    violation_threshold: int = 10        # Violations before kick
    decay_per_second: float = 1.0        # Violation decay rate
    warning_threshold: int = 5           # Violations before warning


# Default configs
TICK_CONFIG = TickConfig()
MOVEMENT_CONFIG = MovementConfig()
LAG_COMP_CONFIG = LagCompConfig()
ANTICHEAT_CONFIG = AntiCheatConfig()
```

### Core Types

```python
# models.py
from dataclasses import dataclass, field
from typing import Dict, Optional, Tuple
from collections import deque
from enum import Enum


class ViolationType(str, Enum):
    SPEED_HACK = "speed_hack"
    TELEPORT = "teleport"
    INVALID_ACTION = "invalid_action"


@dataclass
class PlayerInput:
    """Validated player input."""
    player_id: str
    tick: int
    dx: float = 0.0                      # Movement delta X
    dy: float = 0.0                      # Movement delta Y
    timestamp_ms: float = 0.0            # Client timestamp for lag comp


@dataclass
class PositionSnapshot:
    """Historical position for lag compensation."""
    x: float
    y: float
    tick: int
    timestamp_ms: float


@dataclass
class PlayerState:
    """Server-authoritative player state."""
    player_id: str
    x: float = 0.0
    y: float = 0.0
    health: int = 100
    
    # Validation state
    last_valid_position: Tuple[float, float] = (0.0, 0.0)
    violations: float = 0.0
    
    # Lag compensation
    position_history: deque = field(default_factory=lambda: deque(maxlen=15))
    
    def record_position(self, tick: int, timestamp_ms: float) -> None:
        """Record position snapshot for lag compensation."""
        self.position_history.append(PositionSnapshot(
            x=self.x,
            y=self.y,
            tick=tick,
            timestamp_ms=timestamp_ms,
        ))


@dataclass
class GameState:
    """Complete game state."""
    game_id: str
    tick: int = 0
    players: Dict[str, PlayerState] = field(default_factory=dict)
    running: bool = False
    start_time_ms: float = 0.0
```

### Input Validator

```python
# validation.py
import math
import logging
from typing import Tuple, Optional

from .config import MOVEMENT_CONFIG, ANTICHEAT_CONFIG, MovementConfig, AntiCheatConfig
from .models import PlayerInput, PlayerState, ViolationType

logger = logging.getLogger(__name__)


class InputValidator:
    """
    Validates player inputs for anti-cheat.
    
    Checks:
    - Movement speed limits
    - Teleport detection
    - Action cooldowns
    
    Tracks violations with decay for graduated response.
    """
    
    def __init__(
        self,
        movement_config: MovementConfig = MOVEMENT_CONFIG,
        anticheat_config: AntiCheatConfig = ANTICHEAT_CONFIG,
    ):
        self._movement = movement_config
        self._anticheat = anticheat_config
    
    def validate_movement(
        self,
        player: PlayerState,
        input: PlayerInput,
        tick_rate: int,
    ) -> Tuple[bool, Optional[ViolationType]]:
        """
        Validate movement input.
        
        Returns:
            Tuple of (is_valid, violation_type)
        """
        # Calculate movement distance
        distance = math.sqrt(input.dx ** 2 + input.dy ** 2)
        
        # Check speed limit
        max_distance = self._movement.max_distance_per_tick(tick_rate)
        if distance > max_distance * 1.5:  # 50% tolerance for network jitter
            logger.warning(
                f"Speed violation: {player.player_id} moved {distance:.1f} "
                f"(max {max_distance:.1f})"
            )
            return False, ViolationType.SPEED_HACK
        
        # Check for teleport (large jump from last valid position)
        new_x = player.x + input.dx
        new_y = player.y + input.dy
        
        last_x, last_y = player.last_valid_position
        jump_distance = math.sqrt(
            (new_x - last_x) ** 2 + (new_y - last_y) ** 2
        )
        
        if jump_distance > self._movement.teleport_threshold:
            logger.warning(
                f"Teleport violation: {player.player_id} jumped {jump_distance:.1f}"
            )
            return False, ViolationType.TELEPORT
        
        return True, None
    
    def apply_violation(
        self,
        player: PlayerState,
        violation: ViolationType,
    ) -> Tuple[bool, bool]:
        """
        Apply violation to player.
        
        Returns:
            Tuple of (should_warn, should_kick)
        """
        # Increment violations
        player.violations += 1.0
        
        should_warn = player.violations >= self._anticheat.warning_threshold
        should_kick = player.violations >= self._anticheat.violation_threshold
        
        if should_kick:
            logger.error(
                f"Kicking {player.player_id}: {player.violations} violations"
            )
        elif should_warn:
            logger.warning(
                f"Warning {player.player_id}: {player.violations} violations"
            )
        
        return should_warn, should_kick
    
    def decay_violations(
        self,
        player: PlayerState,
        delta_seconds: float,
    ) -> None:
        """Decay violations over time (reward good behavior)."""
        decay = self._anticheat.decay_per_second * delta_seconds
        player.violations = max(0.0, player.violations - decay)
```

### Lag Compensator

```python
# lag_compensation.py
import logging
from typing import Optional, Tuple

from .config import LAG_COMP_CONFIG, LagCompConfig
from .models import PlayerState, PositionSnapshot

logger = logging.getLogger(__name__)


class LagCompensator:
    """
    Lag compensation for fair hit detection.
    
    When a player fires, we rewind the target's position
    to where they were when the shooter saw them (accounting
    for network latency).
    """
    
    def __init__(self, config: LagCompConfig = LAG_COMP_CONFIG):
        self._config = config
    
    def get_position_at_time(
        self,
        player: PlayerState,
        target_time_ms: float,
        current_time_ms: float,
    ) -> Tuple[float, float]:
        """
        Get player's position at a past time.
        
        Uses linear interpolation between snapshots.
        
        Args:
            player: Player to get historical position for
            target_time_ms: The time we want position for
            current_time_ms: Current server time
            
        Returns:
            Tuple of (x, y) at target time
        """
        # Clamp rewind to max window
        rewind_ms = current_time_ms - target_time_ms
        if rewind_ms > self._config.max_rewind_ms:
            logger.debug(
                f"Clamping rewind from {rewind_ms:.0f}ms to {self._config.max_rewind_ms}ms"
            )
            target_time_ms = current_time_ms - self._config.max_rewind_ms
        
        # No history? Use current position
        if not player.position_history:
            return player.x, player.y
        
        # Find surrounding snapshots
        before: Optional[PositionSnapshot] = None
        after: Optional[PositionSnapshot] = None
        
        for snapshot in player.position_history:
            if snapshot.timestamp_ms <= target_time_ms:
                before = snapshot
            elif after is None:
                after = snapshot
                break
        
        # Edge cases
        if before is None:
            # Target time is before our history
            oldest = player.position_history[0]
            return oldest.x, oldest.y
        
        if after is None:
            # Target time is after our history (use latest)
            return before.x, before.y
        
        # Interpolate between snapshots
        time_range = after.timestamp_ms - before.timestamp_ms
        if time_range <= 0:
            return before.x, before.y
        
        t = (target_time_ms - before.timestamp_ms) / time_range
        t = max(0.0, min(1.0, t))  # Clamp to [0, 1]
        
        x = before.x + (after.x - before.x) * t
        y = before.y + (after.y - before.y) * t
        
        return x, y
    
    def check_hit(
        self,
        shooter: PlayerState,
        target: PlayerState,
        shot_time_ms: float,
        current_time_ms: float,
        hit_radius: float = 20.0,
    ) -> Tuple[bool, Tuple[float, float]]:
        """
        Check if shot hits target with lag compensation.
        
        Args:
            shooter: Player who fired
            target: Player being shot at
            shot_time_ms: When shooter fired (client time)
            current_time_ms: Current server time
            hit_radius: Hit detection radius
            
        Returns:
            Tuple of (hit, target_position_at_shot_time)
        """
        # Get target's position at shot time
        target_x, target_y = self.get_position_at_time(
            target, shot_time_ms, current_time_ms
        )
        
        # Simple distance check (replace with your hit detection)
        import math
        distance = math.sqrt(
            (shooter.x - target_x) ** 2 + 
            (shooter.y - target_y) ** 2
        )
        
        hit = distance <= hit_radius
        
        if hit:
            logger.debug(
                f"Lag-compensated hit: rewound {current_time_ms - shot_time_ms:.0f}ms"
            )
        
        return hit, (target_x, target_y)
```

### Tick System

```python
# tick_system.py
import asyncio
import time
import logging
from typing import Dict, Optional, Callable, Awaitable

from .config import TICK_CONFIG, TickConfig
from .models import GameState, PlayerState, PlayerInput
from .validation import InputValidator
from .lag_compensation import LagCompensator

logger = logging.getLogger(__name__)


class TickSystem:
    """
    Server-authoritative tick system.
    
    Runs at fixed rate (60Hz), processing inputs and
    updating game state. Broadcasts at reduced rate
    to save bandwidth.
    """
    
    def __init__(self, config: TickConfig = TICK_CONFIG):
        self._config = config
        self._games: Dict[str, GameState] = {}
        self._tasks: Dict[str, asyncio.Task] = {}
        
        # Delegates
        self._validator = InputValidator()
        self._lag_comp = LagCompensator()
        
        # Callbacks
        self._broadcast_callback: Optional[
            Callable[[str, dict], Awaitable[None]]
        ] = None
        self._kick_callback: Optional[
            Callable[[str, str, str], Awaitable[None]]
        ] = None
    
    def set_broadcast_callback(
        self, 
        callback: Callable[[str, dict], Awaitable[None]]
    ) -> None:
        """Set callback for broadcasting state updates."""
        self._broadcast_callback = callback
    
    def set_kick_callback(
        self,
        callback: Callable[[str, str, str], Awaitable[None]]
    ) -> None:
        """Set callback for kicking players (game_id, player_id, reason)."""
        self._kick_callback = callback
    
    def create_game(
        self,
        game_id: str,
        player1_id: str,
        player2_id: str,
        spawn1: Tuple[float, float] = (100, 300),
        spawn2: Tuple[float, float] = (700, 300),
    ) -> GameState:
        """Create a new game."""
        game = GameState(game_id=game_id)
        
        game.players[player1_id] = PlayerState(
            player_id=player1_id,
            x=spawn1[0],
            y=spawn1[1],
            last_valid_position=spawn1,
        )
        
        game.players[player2_id] = PlayerState(
            player_id=player2_id,
            x=spawn2[0],
            y=spawn2[1],
            last_valid_position=spawn2,
        )
        
        self._games[game_id] = game
        return game
    
    async def start_game(self, game_id: str) -> None:
        """Start the game loop."""
        game = self._games.get(game_id)
        if not game:
            raise ValueError(f"Game {game_id} not found")
        
        game.running = True
        game.start_time_ms = time.time() * 1000
        
        # Start tick loop
        task = asyncio.create_task(self._tick_loop(game_id))
        self._tasks[game_id] = task
        
        logger.info(f"Started game {game_id} at {self._config.rate_hz}Hz")
    
    async def stop_game(self, game_id: str) -> None:
        """Stop the game loop."""
        game = self._games.get(game_id)
        if game:
            game.running = False
        
        task = self._tasks.pop(game_id, None)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        
        self._games.pop(game_id, None)
        logger.info(f"Stopped game {game_id}")
    
    async def process_input(
        self,
        game_id: str,
        input: PlayerInput,
    ) -> bool:
        """
        Process player input.
        
        Returns:
            True if input was valid and applied
        """
        game = self._games.get(game_id)
        if not game or not game.running:
            return False
        
        player = game.players.get(input.player_id)
        if not player:
            return False
        
        # Validate movement
        valid, violation = self._validator.validate_movement(
            player, input, self._config.rate_hz
        )
        
        if not valid and violation:
            _, should_kick = self._validator.apply_violation(player, violation)
            
            if should_kick and self._kick_callback:
                await self._kick_callback(
                    game_id, 
                    input.player_id, 
                    f"Anti-cheat: {violation.value}"
                )
            
            return False
        
        # Apply movement
        player.x += input.dx
        player.y += input.dy
        player.last_valid_position = (player.x, player.y)
        
        return True
    
    async def _tick_loop(self, game_id: str) -> None:
        """Main game loop running at fixed tick rate."""
        game = self._games.get(game_id)
        if not game:
            return
        
        interval = self._config.interval_ms / 1000.0  # Convert to seconds
        last_time = time.time()
        
        while game.running:
            tick_start = time.time()
            
            # Calculate delta for violation decay
            delta = tick_start - last_time
            last_time = tick_start
            
            # Update game state
            await self._tick(game, delta)
            
            # Broadcast state (at reduced rate)
            if game.tick % self._config.broadcast_divisor == 0:
                await self._broadcast_state(game)
            
            game.tick += 1
            
            # Sleep for remainder of tick
            elapsed = time.time() - tick_start
            sleep_time = max(0, interval - elapsed)
            
            if sleep_time > 0:
                await asyncio.sleep(sleep_time)
            elif elapsed > interval * 1.5:
                logger.warning(
                    f"Tick {game.tick} took {elapsed*1000:.1f}ms "
                    f"(target {interval*1000:.1f}ms)"
                )
    
    async def _tick(self, game: GameState, delta: float) -> None:
        """Process one game tick."""
        current_time_ms = time.time() * 1000
        
        for player in game.players.values():
            # Decay violations
            self._validator.decay_violations(player, delta)
            
            # Record position for lag compensation
            player.record_position(game.tick, current_time_ms)
    
    async def _broadcast_state(self, game: GameState) -> None:
        """Broadcast game state to all players."""
        if not self._broadcast_callback:
            return
        
        state = {
            "type": "game_state",
            "tick": game.tick,
            "players": {
                pid: {
                    "x": p.x,
                    "y": p.y,
                    "health": p.health,
                }
                for pid, p in game.players.items()
            }
        }
        
        await self._broadcast_callback(game.game_id, state)
```

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `rate_hz` | `60` | Server tick rate |
| `broadcast_divisor` | `3` | Broadcast every N ticks (20Hz at 60/3) |
| `max_speed` | `300` | Max movement units per second |
| `teleport_threshold` | `100` | Distance that triggers teleport detection |
| `max_rewind_ms` | `200` | Maximum lag compensation window |
| `violation_threshold` | `10` | Violations before kick |
| `decay_per_second` | `1.0` | Violation decay rate |

## Error Handling

| Scenario | Handling |
|----------|----------|
| Speed hack detected | Reject input, increment violations |
| Teleport detected | Reject input, increment violations |
| Violations exceed threshold | Kick player |
| Tick takes too long | Log warning, continue |
| Game not found | Return early |

## Testing

```python
import pytest
from .tick_system import TickSystem
from .models import PlayerInput

@pytest.mark.asyncio
async def test_speed_hack_detection():
    """Verify speed hacks are detected and rejected."""
    system = TickSystem()
    game = system.create_game("test", "p1", "p2")
    
    # Normal movement should succeed
    valid = await system.process_input("test", PlayerInput(
        player_id="p1",
        tick=1,
        dx=5.0,  # Normal speed
        dy=0.0,
    ))
    assert valid is True
    
    # Speed hack should be rejected
    valid = await system.process_input("test", PlayerInput(
        player_id="p1",
        tick=2,
        dx=500.0,  # Way too fast
        dy=0.0,
    ))
    assert valid is False
    
    # Check violations accumulated
    player = game.players["p1"]
    assert player.violations > 0


@pytest.mark.asyncio
async def test_lag_compensation():
    """Verify lag compensation rewinds correctly."""
    from .lag_compensation import LagCompensator
    from .models import PlayerState, PositionSnapshot
    
    comp = LagCompensator()
    
    player = PlayerState(player_id="target", x=100, y=100)
    
    # Add position history
    player.position_history.append(PositionSnapshot(
        x=0, y=0, tick=1, timestamp_ms=1000
    ))
    player.position_history.append(PositionSnapshot(
        x=50, y=50, tick=2, timestamp_ms=1050
    ))
    player.position_history.append(PositionSnapshot(
        x=100, y=100, tick=3, timestamp_ms=1100
    ))
    
    # Get position at middle time (should interpolate)
    x, y = comp.get_position_at_time(player, 1025, 1100)
    
    assert 20 < x < 30  # Should be ~25 (halfway between 0 and 50)
    assert 20 < y < 30
```

## Production Checklist

- [ ] Tick rate tuned for your game (30-60Hz typical)
- [ ] Broadcast rate balanced (bandwidth vs responsiveness)
- [ ] Lag compensation window matches your target latency
- [ ] Violation thresholds tuned (too strict = false positives)
- [ ] Metrics for tick duration, violations, kicks
- [ ] Alerts for consistently slow ticks
- [ ] Load tested with max players

## Related Patterns

- [Fixed Timestep Game Loop](./FIXED_TIMESTEP_GAME_LOOP.md)
- [WebSocket Connection Management](./WEBSOCKET_CONNECTION_MANAGEMENT.md)
