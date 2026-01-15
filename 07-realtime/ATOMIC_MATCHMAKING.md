# Atomic Matchmaking with Two-Phase Commit

> **Implementation Time**: 6h  
> **Complexity**: High  
> **Dependencies**: asyncio, Redis (optional for distributed)

## Problem

Matching two players in real-time systems is deceptively hard. Either player can disconnect between being matched and joining the game. Naive implementations create orphaned lobbies, leave players stuck in limbo, or match players with disconnected opponents.

## Solution

Two-phase commit semantics for match creation:
1. **Phase 1**: Verify both connections are healthy via ping/pong
2. **Phase 2**: Create lobby, send notifications, confirm delivery
3. **Rollback**: On any failure, clean up lobby and re-queue the healthy player

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        ATOMIC MATCH FLOW                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Queue Manager              Atomic Match Creator         Connection Mgr │
│        │                            │                           │        │
│        │  ──── Match Found ────▶    │                           │        │
│        │                            │                           │        │
│        │                     ┌──────┴──────┐                    │        │
│        │                     │   PHASE 1   │                    │        │
│        │                     │ Health Check│                    │        │
│        │                     └──────┬──────┘                    │        │
│        │                            │                           │        │
│        │                            │ ──── Ping Player 1 ────▶  │        │
│        │                            │ ◀──── Pong ─────────────  │        │
│        │                            │ ──── Ping Player 2 ────▶  │        │
│        │                            │ ◀──── Pong ─────────────  │        │
│        │                            │                           │        │
│        │                     ┌──────┴──────┐                    │        │
│        │                     │   PHASE 2   │                    │        │
│        │                     │Create Lobby │                    │        │
│        │                     └──────┬──────┘                    │        │
│        │                            │                           │        │
│        │                            │ ──── Notify Both ──────▶  │        │
│        │                            │ ◀──── Confirm Delivery ─  │        │
│        │                            │                           │        │
│        │                     ┌──────┴──────┐                    │        │
│        │                     │  SUCCESS or │                    │        │
│        │                     │  ROLLBACK   │                    │        │
│        │                     └─────────────┘                    │        │
│        │                                                        │        │
│        │  ◀──── Re-queue Healthy Player (on failure) ────       │        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Implementation

### Core Types

```python
# models.py
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from enum import Enum


class MatchStatus(str, Enum):
    SUCCESS = "success"
    PLAYER1_DISCONNECTED = "player1_disconnected"
    PLAYER2_DISCONNECTED = "player2_disconnected"
    BOTH_DISCONNECTED = "both_disconnected"
    NOTIFICATION_FAILED = "notification_failed"
    LOBBY_CREATION_FAILED = "lobby_creation_failed"


@dataclass
class MatchTicket:
    """A player waiting in the matchmaking queue."""
    player_id: str
    category: str
    queued_at: datetime = field(default_factory=datetime.utcnow)
    skill_rating: int = 1000
    
    
@dataclass
class MatchResult:
    """Result of an atomic match attempt."""
    status: MatchStatus
    lobby_id: Optional[str] = None
    lobby_code: Optional[str] = None
    player1_healthy: bool = True
    player2_healthy: bool = True
    requeued_player: Optional[str] = None
    error_message: Optional[str] = None
```

### Health Checker

```python
# health_checker.py
import asyncio
import time
from typing import Tuple, Optional, Protocol


class ConnectionManager(Protocol):
    """Protocol for connection management."""
    async def ping_user(self, user_id: str, timeout: float) -> Tuple[bool, Optional[float]]:
        """Send ping and wait for pong. Returns (success, latency_ms)."""
        ...
    
    def is_user_connected(self, user_id: str) -> bool:
        """Check if user has active connection."""
        ...


class ConnectionHealthChecker:
    """
    Verifies player connections are healthy before matching.
    
    Uses ping/pong to detect stale connections that appear
    connected but can't actually receive messages.
    """
    
    PING_TIMEOUT = 2.0  # seconds
    MAX_ACCEPTABLE_LATENCY = 500  # ms
    
    def __init__(self, connection_manager: ConnectionManager):
        self._manager = connection_manager
    
    async def check_health(self, player_id: str) -> Tuple[bool, Optional[float]]:
        """
        Check if a player's connection is healthy.
        
        Returns:
            Tuple of (is_healthy, latency_ms)
        """
        # Quick check - is connection even registered?
        if not self._manager.is_user_connected(player_id):
            return False, None
        
        # Active health check via ping/pong
        success, latency = await self._manager.ping_user(
            player_id, 
            timeout=self.PING_TIMEOUT
        )
        
        if not success:
            return False, None
        
        # Check latency is acceptable
        if latency and latency > self.MAX_ACCEPTABLE_LATENCY:
            return False, latency
        
        return True, latency
    
    async def verify_both_healthy(
        self,
        player1_id: str,
        player2_id: str,
    ) -> Tuple[bool, bool, bool]:
        """
        Verify both players have healthy connections.
        
        Checks both in parallel for speed.
        
        Returns:
            Tuple of (both_healthy, player1_healthy, player2_healthy)
        """
        results = await asyncio.gather(
            self.check_health(player1_id),
            self.check_health(player2_id),
        )
        
        health1, _ = results[0]
        health2, _ = results[1]
        
        return (health1 and health2), health1, health2
```

### Atomic Match Creator

```python
# atomic_match.py
import asyncio
import logging
from typing import Optional, Protocol

from .models import MatchTicket, MatchResult, MatchStatus
from .health_checker import ConnectionHealthChecker

logger = logging.getLogger(__name__)


class LobbyService(Protocol):
    """Protocol for lobby creation."""
    async def create_lobby(self, host_id: str, category: str) -> dict:
        """Create a new lobby. Returns lobby dict with id and code."""
        ...
    
    async def add_player(self, lobby_id: str, player_id: str) -> bool:
        """Add player to lobby. Returns success."""
        ...
    
    async def delete_lobby(self, lobby_id: str) -> None:
        """Delete/cleanup a lobby."""
        ...


class QueueManager(Protocol):
    """Protocol for queue management."""
    async def requeue_player(self, ticket: MatchTicket, priority: bool = True) -> None:
        """Re-add player to queue, optionally with priority."""
        ...


class NotificationService(Protocol):
    """Protocol for player notifications."""
    async def notify_match_found(
        self, 
        player_id: str, 
        lobby_code: str,
        opponent_id: str,
    ) -> bool:
        """Notify player of match. Returns delivery confirmation."""
        ...


class AtomicMatchCreator:
    """
    Creates matches with two-phase commit semantics.
    
    Phase 1: Verify both connections are healthy
    Phase 2: Create lobby, send notifications, confirm delivery
    
    On failure: Rollback lobby, re-queue healthy player
    """
    
    NOTIFICATION_TIMEOUT = 2.0  # seconds
    NOTIFICATION_RETRIES = 3
    
    def __init__(
        self,
        health_checker: ConnectionHealthChecker,
        lobby_service: LobbyService,
        queue_manager: QueueManager,
        notification_service: NotificationService,
    ):
        self._health_checker = health_checker
        self._lobby_service = lobby_service
        self._queue_manager = queue_manager
        self._notifications = notification_service
    
    async def create_match(
        self,
        player1: MatchTicket,
        player2: MatchTicket,
    ) -> MatchResult:
        """
        Create a match atomically.
        
        Phase 1: Verify both connections healthy
        Phase 2: Create lobby, send notifications, confirm delivery
        
        On failure: Rollback lobby, re-queue healthy player
        """
        # ═══════════════════════════════════════════════════════════════
        # PHASE 1: Health Check
        # ═══════════════════════════════════════════════════════════════
        logger.info(f"Phase 1: Verifying connections for {player1.player_id} and {player2.player_id}")
        
        both_healthy, health1, health2 = await self._health_checker.verify_both_healthy(
            player1.player_id,
            player2.player_id,
        )
        
        if not both_healthy:
            return await self._handle_health_failure(
                player1, player2, health1, health2
            )
        
        logger.info("Phase 1 complete: Both players healthy")
        
        # ═══════════════════════════════════════════════════════════════
        # PHASE 2: Create Lobby & Notify
        # ═══════════════════════════════════════════════════════════════
        logger.info("Phase 2: Creating lobby and notifying players")
        
        lobby = None
        try:
            # Create lobby
            lobby = await self._lobby_service.create_lobby(
                host_id=player1.player_id,
                category=player1.category,
            )
            
            # Add second player
            added = await self._lobby_service.add_player(
                lobby["id"], 
                player2.player_id
            )
            if not added:
                raise Exception("Failed to add player2 to lobby")
            
            # Notify both players (parallel)
            notify_results = await asyncio.gather(
                self._notify_with_retry(
                    player1.player_id, 
                    lobby["code"], 
                    player2.player_id
                ),
                self._notify_with_retry(
                    player2.player_id, 
                    lobby["code"], 
                    player1.player_id
                ),
                return_exceptions=True,
            )
            
            # Check notification results
            p1_notified = notify_results[0] is True
            p2_notified = notify_results[1] is True
            
            if not p1_notified or not p2_notified:
                raise Exception(
                    f"Notification failed: p1={p1_notified}, p2={p2_notified}"
                )
            
            logger.info(f"Match created successfully: {lobby['code']}")
            
            return MatchResult(
                status=MatchStatus.SUCCESS,
                lobby_id=lobby["id"],
                lobby_code=lobby["code"],
            )
            
        except Exception as e:
            logger.error(f"Phase 2 failed: {e}")
            
            # Rollback: delete lobby if created
            if lobby:
                try:
                    await self._lobby_service.delete_lobby(lobby["id"])
                except Exception as rollback_error:
                    logger.error(f"Rollback failed: {rollback_error}")
            
            # Re-check health and requeue healthy player
            return await self._handle_phase2_failure(player1, player2, str(e))
    
    async def _handle_health_failure(
        self,
        player1: MatchTicket,
        player2: MatchTicket,
        health1: bool,
        health2: bool,
    ) -> MatchResult:
        """Handle Phase 1 health check failure."""
        
        if not health1 and not health2:
            logger.warning("Both players disconnected")
            return MatchResult(
                status=MatchStatus.BOTH_DISCONNECTED,
                player1_healthy=False,
                player2_healthy=False,
            )
        
        # Re-queue the healthy player with priority
        if health1 and not health2:
            await self._queue_manager.requeue_player(player1, priority=True)
            return MatchResult(
                status=MatchStatus.PLAYER2_DISCONNECTED,
                player1_healthy=True,
                player2_healthy=False,
                requeued_player=player1.player_id,
            )
        
        if health2 and not health1:
            await self._queue_manager.requeue_player(player2, priority=True)
            return MatchResult(
                status=MatchStatus.PLAYER1_DISCONNECTED,
                player1_healthy=False,
                player2_healthy=True,
                requeued_player=player2.player_id,
            )
        
        # Shouldn't reach here
        return MatchResult(status=MatchStatus.BOTH_DISCONNECTED)
    
    async def _handle_phase2_failure(
        self,
        player1: MatchTicket,
        player2: MatchTicket,
        error: str,
    ) -> MatchResult:
        """Handle Phase 2 failure with re-queue of healthy players."""
        
        # Re-check who's still connected
        _, health1, health2 = await self._health_checker.verify_both_healthy(
            player1.player_id,
            player2.player_id,
        )
        
        requeued = None
        
        # Re-queue healthy players with priority
        if health1:
            await self._queue_manager.requeue_player(player1, priority=True)
            requeued = player1.player_id
        
        if health2:
            await self._queue_manager.requeue_player(player2, priority=True)
            requeued = player2.player_id if not requeued else f"{requeued},{player2.player_id}"
        
        return MatchResult(
            status=MatchStatus.NOTIFICATION_FAILED,
            player1_healthy=health1,
            player2_healthy=health2,
            requeued_player=requeued,
            error_message=error,
        )
    
    async def _notify_with_retry(
        self,
        player_id: str,
        lobby_code: str,
        opponent_id: str,
    ) -> bool:
        """Notify player with retries."""
        for attempt in range(self.NOTIFICATION_RETRIES):
            try:
                success = await asyncio.wait_for(
                    self._notifications.notify_match_found(
                        player_id, 
                        lobby_code, 
                        opponent_id
                    ),
                    timeout=self.NOTIFICATION_TIMEOUT,
                )
                if success:
                    return True
            except asyncio.TimeoutError:
                logger.warning(f"Notification timeout for {player_id}, attempt {attempt + 1}")
            except Exception as e:
                logger.warning(f"Notification error for {player_id}: {e}")
            
            # Brief delay before retry
            if attempt < self.NOTIFICATION_RETRIES - 1:
                await asyncio.sleep(0.1)
        
        return False
```

### Queue Manager with Priority Re-queue

```python
# queue_manager.py
import asyncio
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, Optional, List
import logging

from .models import MatchTicket

logger = logging.getLogger(__name__)


@dataclass
class QueueEntry:
    """Internal queue entry with priority support."""
    ticket: MatchTicket
    priority: bool = False
    added_at: datetime = field(default_factory=datetime.utcnow)


class MatchmakingQueue:
    """
    FIFO queue with priority re-queue support.
    
    Players who were matched but had their match fail
    get re-queued with priority (front of queue).
    """
    
    STALE_THRESHOLD = timedelta(minutes=5)
    
    def __init__(self):
        # category -> deque of QueueEntry
        self._queues: Dict[str, deque] = {}
        self._player_tickets: Dict[str, QueueEntry] = {}
        self._lock = asyncio.Lock()
    
    async def enqueue(
        self, 
        ticket: MatchTicket, 
        priority: bool = False
    ) -> bool:
        """
        Add player to queue.
        
        Args:
            ticket: Player's match ticket
            priority: If True, add to front of queue (for re-queued players)
        """
        async with self._lock:
            # Check if already in queue
            if ticket.player_id in self._player_tickets:
                logger.warning(f"Player {ticket.player_id} already in queue")
                return False
            
            entry = QueueEntry(ticket=ticket, priority=priority)
            
            # Get or create category queue
            if ticket.category not in self._queues:
                self._queues[ticket.category] = deque()
            
            queue = self._queues[ticket.category]
            
            # Priority players go to front
            if priority:
                queue.appendleft(entry)
                logger.info(f"Priority re-queue: {ticket.player_id} to front of {ticket.category}")
            else:
                queue.append(entry)
            
            self._player_tickets[ticket.player_id] = entry
            return True
    
    async def dequeue_pair(self, category: str) -> Optional[tuple]:
        """
        Get two players from queue for matching.
        
        Returns:
            Tuple of (ticket1, ticket2) or None if not enough players
        """
        async with self._lock:
            queue = self._queues.get(category)
            if not queue or len(queue) < 2:
                return None
            
            # Get two entries
            entry1 = queue.popleft()
            entry2 = queue.popleft()
            
            # Remove from tracking
            self._player_tickets.pop(entry1.ticket.player_id, None)
            self._player_tickets.pop(entry2.ticket.player_id, None)
            
            return entry1.ticket, entry2.ticket
    
    async def remove_player(self, player_id: str) -> bool:
        """Remove player from queue (e.g., they cancelled)."""
        async with self._lock:
            entry = self._player_tickets.pop(player_id, None)
            if not entry:
                return False
            
            queue = self._queues.get(entry.ticket.category)
            if queue:
                try:
                    queue.remove(entry)
                except ValueError:
                    pass
            
            return True
    
    async def requeue_player(
        self, 
        ticket: MatchTicket, 
        priority: bool = True
    ) -> None:
        """
        Re-queue a player after failed match.
        
        By default uses priority to put them at front of queue.
        """
        # Remove if somehow still in queue
        await self.remove_player(ticket.player_id)
        # Re-add with priority
        await self.enqueue(ticket, priority=priority)
    
    async def cleanup_stale(self) -> List[str]:
        """Remove stale entries. Returns list of removed player IDs."""
        removed = []
        now = datetime.utcnow()
        
        async with self._lock:
            for category, queue in self._queues.items():
                stale = [
                    e for e in queue 
                    if now - e.added_at > self.STALE_THRESHOLD
                ]
                for entry in stale:
                    queue.remove(entry)
                    self._player_tickets.pop(entry.ticket.player_id, None)
                    removed.append(entry.ticket.player_id)
        
        if removed:
            logger.info(f"Cleaned up {len(removed)} stale queue entries")
        
        return removed
    
    def get_queue_size(self, category: str) -> int:
        """Get number of players waiting in category."""
        queue = self._queues.get(category)
        return len(queue) if queue else 0
```

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `PING_TIMEOUT` | `2.0s` | Max time to wait for pong response |
| `MAX_ACCEPTABLE_LATENCY` | `500ms` | Reject connections with higher latency |
| `NOTIFICATION_TIMEOUT` | `2.0s` | Max time to wait for notification delivery |
| `NOTIFICATION_RETRIES` | `3` | Retry count for failed notifications |
| `STALE_THRESHOLD` | `5min` | Remove queue entries older than this |

## Error Handling

| Scenario | Handling |
|----------|----------|
| Player 1 disconnected | Re-queue Player 2 with priority |
| Player 2 disconnected | Re-queue Player 1 with priority |
| Both disconnected | Log and discard match |
| Lobby creation fails | Re-queue both healthy players |
| Notification fails | Rollback lobby, re-queue healthy players |

## Testing

```python
import pytest
from unittest.mock import AsyncMock, MagicMock

@pytest.mark.asyncio
async def test_atomic_match_both_healthy():
    """Match succeeds when both players are healthy."""
    health_checker = MagicMock()
    health_checker.verify_both_healthy = AsyncMock(return_value=(True, True, True))
    
    lobby_service = MagicMock()
    lobby_service.create_lobby = AsyncMock(return_value={"id": "123", "code": "ABC123"})
    lobby_service.add_player = AsyncMock(return_value=True)
    
    notifications = MagicMock()
    notifications.notify_match_found = AsyncMock(return_value=True)
    
    queue_manager = MagicMock()
    
    creator = AtomicMatchCreator(
        health_checker, lobby_service, queue_manager, notifications
    )
    
    result = await creator.create_match(
        MatchTicket(player_id="p1", category="trivia"),
        MatchTicket(player_id="p2", category="trivia"),
    )
    
    assert result.status == MatchStatus.SUCCESS
    assert result.lobby_code == "ABC123"


@pytest.mark.asyncio
async def test_atomic_match_player2_disconnected():
    """Player 1 is re-queued when Player 2 disconnects."""
    health_checker = MagicMock()
    health_checker.verify_both_healthy = AsyncMock(return_value=(False, True, False))
    
    queue_manager = MagicMock()
    queue_manager.requeue_player = AsyncMock()
    
    creator = AtomicMatchCreator(
        health_checker, MagicMock(), queue_manager, MagicMock()
    )
    
    ticket1 = MatchTicket(player_id="p1", category="trivia")
    ticket2 = MatchTicket(player_id="p2", category="trivia")
    
    result = await creator.create_match(ticket1, ticket2)
    
    assert result.status == MatchStatus.PLAYER2_DISCONNECTED
    assert result.requeued_player == "p1"
    queue_manager.requeue_player.assert_called_once_with(ticket1, priority=True)
```

## Production Checklist

- [ ] Health check timeout tuned for your network conditions
- [ ] Notification retries configured appropriately
- [ ] Stale queue cleanup running on interval
- [ ] Metrics for match success/failure rates
- [ ] Alerts for high failure rates
- [ ] Logging includes correlation IDs for debugging
- [ ] Load tested with concurrent match attempts

## Related Patterns

- [WebSocket Connection Management](./WEBSOCKET_CONNECTION_MANAGEMENT.md)
- [Distributed Locking](../03-resilience/DISTRIBUTED_LOCK.md)
