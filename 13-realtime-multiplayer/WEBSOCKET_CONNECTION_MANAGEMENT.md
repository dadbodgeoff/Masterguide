# WebSocket Connection Management

> **Implementation Time**: 4h  
> **Complexity**: Medium  
> **Dependencies**: asyncio, FastAPI (or any ASGI framework)

## Problem

WebSocket connections appear connected but can be stale (client crashed, network dropped). Broadcasting to "all connections" fails silently. At scale, you need connection limits, health verification, and reliable user-to-connection mapping.

## Solution

A connection manager that:
1. Tracks connections by lobby/room AND by user ID
2. Enforces connection limits (global + per-lobby)
3. Provides ping/pong health verification
4. Cleans up stale connections automatically

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CONNECTION MANAGER                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                    Connection Tracking                           │   │
│   │                                                                  │   │
│   │   active_connections: Dict[lobby_code, Set[WebSocket]]          │   │
│   │   connection_info: Dict[WebSocket, (lobby_code, user_id)]       │   │
│   │   user_connections: Dict[user_id, WebSocket]                    │   │
│   │                                                                  │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                    Health Monitoring                             │   │
│   │                                                                  │   │
│   │   pending_pings: Dict[user_id, asyncio.Event]                   │   │
│   │   connection_times: Dict[user_id, float]                        │   │
│   │   last_message_times: Dict[user_id, float]                      │   │
│   │                                                                  │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                    Capacity Management                           │   │
│   │                                                                  │   │
│   │   max_connections: 500 (global limit)                           │   │
│   │   max_per_lobby: 10 (per-room limit)                            │   │
│   │                                                                  │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Implementation

### Core Types

```python
# types.py
from dataclasses import dataclass
from typing import Optional


@dataclass
class ConnectionState:
    """Detailed state for a user's connection."""
    user_id: str
    connected: bool
    lobby_code: Optional[str]
    connected_at: Optional[float]
    last_message_at: Optional[float]


@dataclass
class ConnectionStats:
    """Server-wide connection statistics."""
    total_connections: int
    max_connections: int
    capacity_percent: float
    active_lobbies: int
    connections_by_lobby: dict
```

### Connection Manager

```python
# connection_manager.py
import asyncio
import json
import time
import logging
from typing import Dict, Optional, Set, Tuple

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """
    Production-grade WebSocket connection manager.
    
    Features:
    - Connection limits with graceful degradation
    - User-to-connection mapping for reliable routing
    - Ping/pong health verification
    - Automatic stale connection cleanup
    """

    def __init__(
        self,
        max_connections: int = 500,
        max_per_lobby: int = 10,
    ):
        """
        Initialize connection manager.
        
        Args:
            max_connections: Maximum total WebSocket connections
            max_per_lobby: Maximum connections per lobby/room
        """
        self.max_connections = max_connections
        self.max_per_lobby = max_per_lobby
        
        # lobby_code -> set of websockets
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        
        # websocket -> (lobby_code, user_id)
        self.connection_info: Dict[WebSocket, Tuple[str, str]] = {}
        
        # user_id -> websocket (for direct messaging)
        self.user_connections: Dict[str, WebSocket] = {}
        
        # Health monitoring
        self._pending_pings: Dict[str, asyncio.Event] = {}
        self._connection_times: Dict[str, float] = {}
        self._last_message_times: Dict[str, float] = {}
    
    # ═══════════════════════════════════════════════════════════════════
    # CAPACITY MANAGEMENT
    # ═══════════════════════════════════════════════════════════════════
    
    def can_accept_connection(self, lobby_code: str) -> Tuple[bool, str]:
        """
        Check if we can accept a new connection.
        
        Returns:
            Tuple of (can_accept, rejection_reason)
        """
        # Check global limit
        total = sum(len(conns) for conns in self.active_connections.values())
        if total >= self.max_connections:
            logger.warning(f"Server full: {total}/{self.max_connections}")
            return False, "server_full"
        
        # Check per-lobby limit
        lobby_count = len(self.active_connections.get(lobby_code, set()))
        if lobby_count >= self.max_per_lobby:
            logger.warning(f"Lobby {lobby_code} full: {lobby_count}/{self.max_per_lobby}")
            return False, "lobby_full"
        
        return True, ""
    
    def get_stats(self) -> dict:
        """Get connection statistics for monitoring."""
        total = sum(len(conns) for conns in self.active_connections.values())
        return {
            "total_connections": total,
            "max_connections": self.max_connections,
            "capacity_percent": round(total / self.max_connections * 100, 1),
            "active_lobbies": len(self.active_connections),
            "connections_by_lobby": {
                code: len(conns) 
                for code, conns in self.active_connections.items()
            }
        }
    
    # ═══════════════════════════════════════════════════════════════════
    # CONNECTION LIFECYCLE
    # ═══════════════════════════════════════════════════════════════════

    async def connect(
        self,
        websocket: WebSocket,
        lobby_code: str,
        user_id: str,
    ) -> None:
        """
        Accept and register a WebSocket connection.
        
        Call can_accept_connection() first to check capacity.
        """
        await websocket.accept()
        
        # Add to lobby connections
        if lobby_code not in self.active_connections:
            self.active_connections[lobby_code] = set()
        self.active_connections[lobby_code].add(websocket)
        
        # Track connection info
        self.connection_info[websocket] = (lobby_code, user_id)
        self.user_connections[user_id] = websocket
        
        # Track timestamps
        now = time.time()
        self._connection_times[user_id] = now
        self._last_message_times[user_id] = now
        
        logger.info(f"User {user_id} connected to lobby {lobby_code}")

    def disconnect(self, websocket: WebSocket) -> Optional[Tuple[str, str]]:
        """
        Remove a WebSocket connection.
        
        Returns:
            Tuple of (lobby_code, user_id) or None if not found
        """
        info = self.connection_info.get(websocket)
        if not info:
            return None
        
        lobby_code, user_id = info
        
        # Remove from lobby
        if lobby_code in self.active_connections:
            self.active_connections[lobby_code].discard(websocket)
            if not self.active_connections[lobby_code]:
                del self.active_connections[lobby_code]
        
        # Remove from tracking
        del self.connection_info[websocket]
        self.user_connections.pop(user_id, None)
        
        # Clean up health data
        self._connection_times.pop(user_id, None)
        self._last_message_times.pop(user_id, None)
        self._pending_pings.pop(user_id, None)
        
        logger.info(f"User {user_id} disconnected from lobby {lobby_code}")
        return info
    
    # ═══════════════════════════════════════════════════════════════════
    # MESSAGING
    # ═══════════════════════════════════════════════════════════════════

    async def broadcast_to_lobby(
        self,
        lobby_code: str,
        message: dict,
        exclude_user_id: Optional[str] = None,
    ) -> int:
        """
        Broadcast message to all connections in a lobby.
        
        Returns:
            Number of successful sends
        """
        if lobby_code not in self.active_connections:
            return 0
        
        data = json.dumps(message)
        disconnected = []
        sent_count = 0
        
        for websocket in self.active_connections[lobby_code]:
            # Skip excluded user
            if exclude_user_id:
                info = self.connection_info.get(websocket)
                if info and info[1] == exclude_user_id:
                    continue
            
            try:
                await websocket.send_text(data)
                sent_count += 1
            except Exception as e:
                logger.warning(f"Broadcast failed: {e}")
                disconnected.append(websocket)
        
        # Clean up failed connections
        for ws in disconnected:
            self.disconnect(ws)
        
        return sent_count

    async def send_to_user(self, user_id: str, message: dict) -> bool:
        """
        Send message to a specific user.
        
        Returns:
            True if sent successfully
        """
        websocket = self.user_connections.get(user_id)
        if not websocket:
            return False
        
        try:
            await websocket.send_text(json.dumps(message))
            return True
        except Exception as e:
            logger.warning(f"Send to {user_id} failed: {e}")
            self.disconnect(websocket)
            return False
    
    # ═══════════════════════════════════════════════════════════════════
    # HEALTH VERIFICATION
    # ═══════════════════════════════════════════════════════════════════

    async def ping_user(
        self, 
        user_id: str, 
        timeout: float = 2.0
    ) -> Tuple[bool, Optional[float]]:
        """
        Send health check ping and wait for pong.
        
        Uses asyncio.Event to coordinate with pong handler.
        
        Returns:
            Tuple of (success, latency_ms)
        """
        websocket = self.user_connections.get(user_id)
        if not websocket:
            return False, None
        
        # Create event for this ping
        ping_event = asyncio.Event()
        self._pending_pings[user_id] = ping_event
        
        start_time = time.time()
        
        try:
            # Send ping
            await websocket.send_text(json.dumps({
                "type": "health_ping",
                "timestamp": start_time
            }))
            
            # Wait for pong
            try:
                await asyncio.wait_for(ping_event.wait(), timeout=timeout)
                latency_ms = (time.time() - start_time) * 1000
                return True, latency_ms
            except asyncio.TimeoutError:
                logger.debug(f"Ping timeout for {user_id}")
                return False, None
                
        finally:
            self._pending_pings.pop(user_id, None)

    def record_pong(self, user_id: str) -> None:
        """
        Record pong response from user.
        
        Call this when you receive a health_pong message.
        """
        self._last_message_times[user_id] = time.time()
        
        # Signal waiting ping
        ping_event = self._pending_pings.get(user_id)
        if ping_event:
            ping_event.set()

    def update_last_message(self, user_id: str) -> None:
        """Update last message timestamp (call on any received message)."""
        self._last_message_times[user_id] = time.time()
    
    # ═══════════════════════════════════════════════════════════════════
    # QUERIES
    # ═══════════════════════════════════════════════════════════════════

    def is_user_connected(self, user_id: str) -> bool:
        """Check if user has active connection."""
        return user_id in self.user_connections

    def get_lobby_users(self, lobby_code: str) -> Set[str]:
        """Get all user IDs in a lobby."""
        users = set()
        for ws in self.active_connections.get(lobby_code, set()):
            info = self.connection_info.get(ws)
            if info:
                users.add(info[1])
        return users

    def get_connection_state(self, user_id: str) -> dict:
        """Get detailed connection state for debugging."""
        connected = user_id in self.user_connections
        websocket = self.user_connections.get(user_id)
        lobby_code = None
        
        if websocket:
            info = self.connection_info.get(websocket)
            if info:
                lobby_code = info[0]
        
        return {
            "user_id": user_id,
            "connected": connected,
            "lobby_code": lobby_code,
            "connected_at": self._connection_times.get(user_id),
            "last_message_at": self._last_message_times.get(user_id),
        }


# Global instance
manager = ConnectionManager()
```

### FastAPI Integration

```python
# websocket_endpoint.py
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException
from .connection_manager import manager

app = FastAPI()


@app.websocket("/ws/{lobby_code}")
async def websocket_endpoint(
    websocket: WebSocket,
    lobby_code: str,
    token: str = Query(...),
):
    """WebSocket endpoint with capacity checks and auth."""
    
    # Authenticate (implement your auth logic)
    user_id = await authenticate_token(token)
    if not user_id:
        await websocket.close(code=4001, reason="unauthorized")
        return
    
    # Check capacity
    can_accept, reason = manager.can_accept_connection(lobby_code)
    if not can_accept:
        await websocket.close(code=4002, reason=reason)
        return
    
    # Connect
    await manager.connect(websocket, lobby_code, user_id)
    
    try:
        while True:
            data = await websocket.receive_json()
            
            # Update activity timestamp
            manager.update_last_message(user_id)
            
            # Handle health pong
            if data.get("type") == "health_pong":
                manager.record_pong(user_id)
                continue
            
            # Route to handlers
            await handle_message(lobby_code, user_id, data)
            
    except WebSocketDisconnect:
        manager.disconnect(websocket)


async def authenticate_token(token: str) -> Optional[str]:
    """Validate JWT and return user_id."""
    # Implement your auth logic
    pass


async def handle_message(lobby_code: str, user_id: str, data: dict):
    """Route message to appropriate handler."""
    # Implement your message routing
    pass
```

### Client-Side Pong Handler

```typescript
// websocket-client.ts
class WebSocketClient {
  private ws: WebSocket | null = null;
  
  connect(url: string) {
    this.ws = new WebSocket(url);
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      // Respond to health pings immediately
      if (message.type === 'health_ping') {
        this.ws?.send(JSON.stringify({
          type: 'health_pong',
          timestamp: message.timestamp
        }));
        return;
      }
      
      // Handle other messages
      this.handleMessage(message);
    };
  }
  
  private handleMessage(message: any) {
    // Your message handling logic
  }
}
```

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `max_connections` | `500` | Global connection limit |
| `max_per_lobby` | `10` | Per-lobby connection limit |
| `ping_timeout` | `2.0s` | Health check timeout |

## Error Handling

| Scenario | Response |
|----------|----------|
| Server at capacity | Close with code 4002, reason "server_full" |
| Lobby at capacity | Close with code 4002, reason "lobby_full" |
| Auth failed | Close with code 4001, reason "unauthorized" |
| Send failed | Disconnect and clean up |

## Testing

```python
import pytest
from unittest.mock import AsyncMock, MagicMock

@pytest.mark.asyncio
async def test_connection_limits():
    """Verify connection limits are enforced."""
    manager = ConnectionManager(max_connections=2, max_per_lobby=2)
    
    # First connection should succeed
    can_accept, _ = manager.can_accept_connection("lobby1")
    assert can_accept is True
    
    # Simulate connections
    ws1, ws2 = MagicMock(), MagicMock()
    ws1.accept = AsyncMock()
    ws2.accept = AsyncMock()
    
    await manager.connect(ws1, "lobby1", "user1")
    await manager.connect(ws2, "lobby1", "user2")
    
    # Third should be rejected (at capacity)
    can_accept, reason = manager.can_accept_connection("lobby1")
    assert can_accept is False
    assert reason == "lobby_full"


@pytest.mark.asyncio
async def test_ping_pong_health_check():
    """Verify ping/pong health verification."""
    manager = ConnectionManager()
    
    ws = MagicMock()
    ws.accept = AsyncMock()
    ws.send_text = AsyncMock()
    
    await manager.connect(ws, "lobby1", "user1")
    
    # Start ping (will timeout without pong)
    import asyncio
    ping_task = asyncio.create_task(
        manager.ping_user("user1", timeout=0.1)
    )
    
    # Simulate pong response
    await asyncio.sleep(0.05)
    manager.record_pong("user1")
    
    success, latency = await ping_task
    assert success is True
    assert latency is not None
    assert latency < 100  # Should be ~50ms
```

## Production Checklist

- [ ] Connection limits tuned for your server capacity
- [ ] Health check interval configured (e.g., every 30s)
- [ ] Metrics exported (connection count, capacity %)
- [ ] Alerts for high capacity (>80%)
- [ ] Graceful shutdown drains connections
- [ ] Load tested with connection churn
- [ ] Client implements pong response

## Related Patterns

- [Atomic Matchmaking](./ATOMIC_MATCHMAKING.md)
- [Graceful Shutdown](../03-resilience/GRACEFUL_SHUTDOWN.md)
