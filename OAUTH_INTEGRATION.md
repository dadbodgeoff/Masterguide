# OAuth Integration Pattern

> Multi-provider OAuth 2.0 implementation with CSRF protection, account linking, and comprehensive audit logging.

## Overview

OAuth integration enables users to authenticate via third-party providers (Google, Twitch, Discord) while maintaining security through:
- State parameter with CSRF protection
- Secure token exchange
- Account linking vs new account creation
- Comprehensive audit logging

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│   Backend   │────▶│  Provider   │
│  (Browser)  │     │   (API)     │     │  (Google)   │
└─────────────┘     └─────────────┘     └─────────────┘
      │                    │                    │
      │ 1. Initiate OAuth  │                    │
      │───────────────────▶│                    │
      │                    │                    │
      │ 2. Return auth URL │                    │
      │◀───────────────────│                    │
      │                    │                    │
      │ 3. Redirect to provider                 │
      │────────────────────────────────────────▶│
      │                    │                    │
      │ 4. User authorizes │                    │
      │◀────────────────────────────────────────│
      │                    │                    │
      │ 5. Callback with code                   │
      │───────────────────▶│                    │
      │                    │ 6. Exchange code   │
      │                    │───────────────────▶│
      │                    │                    │
      │                    │ 7. Return tokens   │
      │                    │◀───────────────────│
      │                    │                    │
      │ 8. Return JWT      │                    │
      │◀───────────────────│                    │
```

## Implementation

### Configuration

```python
from dataclasses import dataclass
from typing import Optional
import os


@dataclass
class OAuthProviderConfig:
    """Configuration for an OAuth provider."""
    client_id: str
    client_secret: str
    authorize_url: str
    token_url: str
    userinfo_url: str
    scopes: list[str]
    redirect_uri: str


class OAuthConfig:
    """OAuth configuration for all providers."""
    
    def __init__(self):
        self.base_redirect_uri = os.environ.get(
            "OAUTH_REDIRECT_BASE", 
            "https://app.example.com"
        )
    
    @property
    def google(self) -> OAuthProviderConfig:
        return OAuthProviderConfig(
            client_id=os.environ["GOOGLE_CLIENT_ID"],
            client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
            authorize_url="https://accounts.google.com/o/oauth2/v2/auth",
            token_url="https://oauth2.googleapis.com/token",
            userinfo_url="https://www.googleapis.com/oauth2/v2/userinfo",
            scopes=["openid", "email", "profile"],
            redirect_uri=f"{self.base_redirect_uri}/auth/callback/google",
        )
    
    @property
    def twitch(self) -> OAuthProviderConfig:
        return OAuthProviderConfig(
            client_id=os.environ["TWITCH_CLIENT_ID"],
            client_secret=os.environ["TWITCH_CLIENT_SECRET"],
            authorize_url="https://id.twitch.tv/oauth2/authorize",
            token_url="https://id.twitch.tv/oauth2/token",
            userinfo_url="https://api.twitch.tv/helix/users",
            scopes=["user:read:email"],
            redirect_uri=f"{self.base_redirect_uri}/auth/callback/twitch",
        )
    
    @property
    def discord(self) -> OAuthProviderConfig:
        return OAuthProviderConfig(
            client_id=os.environ["DISCORD_CLIENT_ID"],
            client_secret=os.environ["DISCORD_CLIENT_SECRET"],
            authorize_url="https://discord.com/api/oauth2/authorize",
            token_url="https://discord.com/api/oauth2/token",
            userinfo_url="https://discord.com/api/users/@me",
            scopes=["identify", "email"],
            redirect_uri=f"{self.base_redirect_uri}/auth/callback/discord",
        )
    
    def get_provider(self, name: str) -> OAuthProviderConfig:
        """Get provider config by name."""
        providers = {
            "google": self.google,
            "twitch": self.twitch,
            "discord": self.discord,
        }
        if name not in providers:
            raise ValueError(f"Unknown OAuth provider: {name}")
        return providers[name]
```

### State Management with CSRF Protection

```python
import secrets
import hashlib
import time
from dataclasses import dataclass
from typing import Optional
import redis.asyncio as redis


@dataclass
class OAuthState:
    """OAuth state for CSRF protection."""
    state_token: str
    provider: str
    redirect_uri: str
    created_at: float
    user_id: Optional[str] = None  # For account linking
    
    def to_dict(self) -> dict:
        return {
            "state_token": self.state_token,
            "provider": self.provider,
            "redirect_uri": self.redirect_uri,
            "created_at": self.created_at,
            "user_id": self.user_id,
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> "OAuthState":
        return cls(**data)


class OAuthStateManager:
    """
    Manages OAuth state tokens with Redis storage.
    
    State tokens:
    - Are cryptographically random
    - Expire after 10 minutes
    - Are single-use (deleted after validation)
    """
    
    STATE_TTL = 600  # 10 minutes
    STATE_PREFIX = "oauth:state:"
    
    def __init__(self, redis_client: redis.Redis):
        self.redis = redis_client
    
    async def create_state(
        self,
        provider: str,
        redirect_uri: str,
        user_id: Optional[str] = None,
    ) -> OAuthState:
        """Create a new OAuth state token."""
        # Generate cryptographically secure token
        state_token = secrets.token_urlsafe(32)
        
        state = OAuthState(
            state_token=state_token,
            provider=provider,
            redirect_uri=redirect_uri,
            created_at=time.time(),
            user_id=user_id,
        )
        
        # Store in Redis with TTL
        key = f"{self.STATE_PREFIX}{state_token}"
        await self.redis.setex(
            key,
            self.STATE_TTL,
            json.dumps(state.to_dict()),
        )
        
        return state
    
    async def validate_state(self, state_token: str) -> Optional[OAuthState]:
        """
        Validate and consume a state token.
        
        Returns the state if valid, None if invalid or expired.
        Token is deleted after validation (single-use).
        """
        key = f"{self.STATE_PREFIX}{state_token}"
        
        # Get and delete atomically
        pipe = self.redis.pipeline()
        pipe.get(key)
        pipe.delete(key)
        results = await pipe.execute()
        
        state_data = results[0]
        if not state_data:
            return None
        
        try:
            return OAuthState.from_dict(json.loads(state_data))
        except (json.JSONDecodeError, KeyError):
            return None
```

### OAuth Service

```python
import httpx
from dataclasses import dataclass
from typing import Optional, Tuple
import logging

logger = logging.getLogger(__name__)


@dataclass
class OAuthUserInfo:
    """Normalized user info from OAuth provider."""
    provider: str
    provider_user_id: str
    email: str
    email_verified: bool
    display_name: Optional[str]
    avatar_url: Optional[str]
    raw_data: dict


class OAuthService:
    """
    Handles OAuth authentication flow for multiple providers.
    
    Responsibilities:
    - Generate authorization URLs
    - Exchange authorization codes for tokens
    - Fetch and normalize user info
    - Handle account creation/linking
    """
    
    def __init__(
        self,
        config: OAuthConfig,
        state_manager: OAuthStateManager,
        user_service: "UserService",
        audit_service: "AuditService",
    ):
        self.config = config
        self.state_manager = state_manager
        self.user_service = user_service
        self.audit_service = audit_service
    
    async def initiate_oauth(
        self,
        provider: str,
        redirect_uri: str,
        user_id: Optional[str] = None,
    ) -> str:
        """
        Initiate OAuth flow by generating authorization URL.
        
        Args:
            provider: OAuth provider name (google, twitch, discord)
            redirect_uri: Where to redirect after OAuth completes
            user_id: If provided, this is an account linking flow
            
        Returns:
            Authorization URL to redirect user to
        """
        provider_config = self.config.get_provider(provider)
        
        # Create state token
        state = await self.state_manager.create_state(
            provider=provider,
            redirect_uri=redirect_uri,
            user_id=user_id,
        )
        
        # Build authorization URL
        params = {
            "client_id": provider_config.client_id,
            "redirect_uri": provider_config.redirect_uri,
            "response_type": "code",
            "scope": " ".join(provider_config.scopes),
            "state": state.state_token,
        }
        
        # Provider-specific parameters
        if provider == "google":
            params["access_type"] = "offline"
            params["prompt"] = "consent"
        elif provider == "discord":
            params["prompt"] = "consent"
        
        query_string = "&".join(f"{k}={v}" for k, v in params.items())
        return f"{provider_config.authorize_url}?{query_string}"
    
    async def handle_callback(
        self,
        provider: str,
        code: str,
        state_token: str,
        ip_address: str,
        user_agent: str,
    ) -> Tuple["User", "TokenPair"]:
        """
        Handle OAuth callback after user authorization.
        
        Args:
            provider: OAuth provider name
            code: Authorization code from provider
            state_token: State token for CSRF validation
            ip_address: Client IP for audit logging
            user_agent: Client user agent for audit logging
            
        Returns:
            Tuple of (User, TokenPair) for the authenticated user
            
        Raises:
            OAuthError: If state validation fails or token exchange fails
        """
        # Validate state token (CSRF protection)
        state = await self.state_manager.validate_state(state_token)
        if not state:
            self.audit_service.log_oauth_failed(
                provider=provider,
                ip_address=ip_address,
                user_agent=user_agent,
                reason="Invalid or expired state token",
            )
            raise OAuthError("Invalid or expired state token")
        
        if state.provider != provider:
            raise OAuthError("Provider mismatch in state token")
        
        # Exchange code for tokens
        provider_config = self.config.get_provider(provider)
        tokens = await self._exchange_code(provider_config, code)
        
        # Fetch user info from provider
        user_info = await self._fetch_user_info(provider, provider_config, tokens)
        
        # Check if this is account linking or new auth
        if state.user_id:
            # Account linking flow
            user = await self._link_account(state.user_id, user_info)
            self.audit_service.log_oauth_link(
                user_id=user.id,
                provider=provider,
                provider_user_id=user_info.provider_user_id,
                ip_address=ip_address,
                user_agent=user_agent,
            )
        else:
            # Login or registration flow
            user = await self._find_or_create_user(user_info)
            self.audit_service.log_oauth_success(
                user_id=user.id,
                provider=provider,
                ip_address=ip_address,
                user_agent=user_agent,
                is_new_user=user.created_at == user.updated_at,
            )
        
        # Generate JWT tokens
        token_pair = await self.user_service.create_tokens(user)
        
        return user, token_pair
    
    async def _exchange_code(
        self,
        config: OAuthProviderConfig,
        code: str,
    ) -> dict:
        """Exchange authorization code for access token."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                config.token_url,
                data={
                    "client_id": config.client_id,
                    "client_secret": config.client_secret,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": config.redirect_uri,
                },
                headers={"Accept": "application/json"},
            )
            
            if response.status_code != 200:
                logger.error(f"Token exchange failed: {response.text}")
                raise OAuthError("Failed to exchange authorization code")
            
            return response.json()
    
    async def _fetch_user_info(
        self,
        provider: str,
        config: OAuthProviderConfig,
        tokens: dict,
    ) -> OAuthUserInfo:
        """Fetch and normalize user info from provider."""
        access_token = tokens["access_token"]
        
        async with httpx.AsyncClient() as client:
            headers = {"Authorization": f"Bearer {access_token}"}
            
            # Twitch requires Client-ID header
            if provider == "twitch":
                headers["Client-ID"] = config.client_id
            
            response = await client.get(
                config.userinfo_url,
                headers=headers,
            )
            
            if response.status_code != 200:
                logger.error(f"User info fetch failed: {response.text}")
                raise OAuthError("Failed to fetch user info")
            
            data = response.json()
        
        # Normalize based on provider
        return self._normalize_user_info(provider, data)
    
    def _normalize_user_info(self, provider: str, data: dict) -> OAuthUserInfo:
        """Normalize user info from different providers."""
        if provider == "google":
            return OAuthUserInfo(
                provider=provider,
                provider_user_id=data["id"],
                email=data["email"],
                email_verified=data.get("verified_email", False),
                display_name=data.get("name"),
                avatar_url=data.get("picture"),
                raw_data=data,
            )
        
        elif provider == "twitch":
            user_data = data["data"][0] if data.get("data") else data
            return OAuthUserInfo(
                provider=provider,
                provider_user_id=user_data["id"],
                email=user_data.get("email", ""),
                email_verified=True,  # Twitch verifies emails
                display_name=user_data.get("display_name"),
                avatar_url=user_data.get("profile_image_url"),
                raw_data=data,
            )
        
        elif provider == "discord":
            return OAuthUserInfo(
                provider=provider,
                provider_user_id=data["id"],
                email=data.get("email", ""),
                email_verified=data.get("verified", False),
                display_name=data.get("username"),
                avatar_url=self._get_discord_avatar(data),
                raw_data=data,
            )
        
        raise ValueError(f"Unknown provider: {provider}")
    
    def _get_discord_avatar(self, data: dict) -> Optional[str]:
        """Build Discord avatar URL."""
        if data.get("avatar"):
            return f"https://cdn.discordapp.com/avatars/{data['id']}/{data['avatar']}.png"
        return None
    
    async def _find_or_create_user(self, user_info: OAuthUserInfo) -> "User":
        """Find existing user or create new one."""
        # First, check if OAuth connection exists
        existing = await self.user_service.find_by_oauth(
            provider=user_info.provider,
            provider_user_id=user_info.provider_user_id,
        )
        if existing:
            return existing
        
        # Check if email exists (for account merging)
        if user_info.email:
            existing = await self.user_service.find_by_email(user_info.email)
            if existing:
                # Link OAuth to existing account
                await self._link_account(existing.id, user_info)
                return existing
        
        # Create new user
        return await self.user_service.create_from_oauth(user_info)
    
    async def _link_account(
        self,
        user_id: str,
        user_info: OAuthUserInfo,
    ) -> "User":
        """Link OAuth provider to existing user account."""
        await self.user_service.add_oauth_connection(
            user_id=user_id,
            provider=user_info.provider,
            provider_user_id=user_info.provider_user_id,
            email=user_info.email,
        )
        return await self.user_service.get(user_id)
```

### API Routes

```python
from fastapi import APIRouter, Request, HTTPException, Query
from fastapi.responses import RedirectResponse

router = APIRouter(prefix="/auth/oauth")


@router.post("/{provider}")
async def initiate_oauth(
    provider: str,
    request: Request,
    redirect_uri: str = Query(default="/dashboard"),
    oauth_service: OAuthService = Depends(get_oauth_service),
) -> dict:
    """
    Initiate OAuth flow for a provider.
    
    Returns the authorization URL to redirect the user to.
    """
    if provider not in ["google", "twitch", "discord"]:
        raise HTTPException(status_code=400, detail="Invalid provider")
    
    # Get user_id if authenticated (for account linking)
    user_id = None
    try:
        token = get_token_from_request(request)
        if token:
            payload = verify_token(token)
            user_id = payload.sub
    except:
        pass
    
    auth_url = await oauth_service.initiate_oauth(
        provider=provider,
        redirect_uri=redirect_uri,
        user_id=user_id,
    )
    
    return {"authorization_url": auth_url}


@router.get("/{provider}/callback")
async def oauth_callback(
    provider: str,
    request: Request,
    code: str = Query(...),
    state: str = Query(...),
    oauth_service: OAuthService = Depends(get_oauth_service),
) -> RedirectResponse:
    """
    Handle OAuth callback from provider.
    
    Exchanges code for tokens, creates/links user, and redirects.
    """
    ip_address = get_client_ip(request)
    user_agent = request.headers.get("User-Agent", "unknown")
    
    try:
        user, tokens = await oauth_service.handle_callback(
            provider=provider,
            code=code,
            state_token=state,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        
        # Redirect to frontend with tokens
        # In production, use secure cookie or fragment
        redirect_url = f"/auth/success?token={tokens.access_token}"
        return RedirectResponse(url=redirect_url)
        
    except OAuthError as e:
        return RedirectResponse(url=f"/auth/error?message={e.message}")
```

## Security Considerations

1. **State Token** - Always validate state to prevent CSRF attacks
2. **Single-Use Tokens** - Delete state tokens after use
3. **Short TTL** - State tokens expire after 10 minutes
4. **HTTPS Only** - All OAuth redirects must use HTTPS
5. **Secure Storage** - Never log access tokens or secrets
6. **Email Verification** - Don't trust unverified emails for account linking

## Testing

```python
import pytest
from unittest.mock import AsyncMock, patch


@pytest.fixture
def oauth_service(redis_client, user_service, audit_service):
    config = OAuthConfig()
    state_manager = OAuthStateManager(redis_client)
    return OAuthService(config, state_manager, user_service, audit_service)


async def test_initiate_oauth_creates_state(oauth_service, redis_client):
    auth_url = await oauth_service.initiate_oauth(
        provider="google",
        redirect_uri="/dashboard",
    )
    
    assert "accounts.google.com" in auth_url
    assert "state=" in auth_url
    
    # Verify state was stored
    state_token = auth_url.split("state=")[1].split("&")[0]
    stored = await redis_client.get(f"oauth:state:{state_token}")
    assert stored is not None


async def test_callback_validates_state(oauth_service):
    with pytest.raises(OAuthError, match="Invalid or expired state"):
        await oauth_service.handle_callback(
            provider="google",
            code="test-code",
            state_token="invalid-state",
            ip_address="127.0.0.1",
            user_agent="test",
        )


async def test_callback_creates_new_user(oauth_service, mock_google_api):
    # Create valid state
    state = await oauth_service.state_manager.create_state(
        provider="google",
        redirect_uri="/dashboard",
    )
    
    user, tokens = await oauth_service.handle_callback(
        provider="google",
        code="valid-code",
        state_token=state.state_token,
        ip_address="127.0.0.1",
        user_agent="test",
    )
    
    assert user.email == "test@example.com"
    assert tokens.access_token is not None
```
