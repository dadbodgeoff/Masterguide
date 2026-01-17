# Phase 12: Security Hardening

> **Time**: 20 minutes  
> **Prerequisites**: [05-AUTH](./05-AUTH.md), [08-API](./08-API.md)  
> **Produces**: CSP headers, CORS config, audit logging, input sanitization, security middleware

---

## 🤖 Agent Execution Context

**What you're doing**: Adding security hardening layers — Content Security Policy, CORS configuration, audit logging, input sanitization, and security headers. This phase hardens the application against common web vulnerabilities.

**Expected state BEFORE execution**:
- Phase 05 complete (auth middleware exists)
- Phase 08 complete (API routes exist)
- `apps/web/middleware.ts` exists
- `packages/backend/src/main.py` exists

**What you'll create**:
- `apps/web/lib/security/csp.ts` — Content Security Policy configuration
- `apps/web/lib/security/headers.ts` — Security headers middleware
- `packages/backend/src/security/__init__.py` — Security module
- `packages/backend/src/security/audit.py` — Audit logging service
- `packages/backend/src/security/sanitize.py` — Input sanitization utilities
- `packages/backend/src/security/cors.py` — CORS configuration
- `packages/backend/src/security/middleware.py` — Security middleware
- `packages/backend/tests/security/test_audit.py` — Audit logging tests
- `packages/backend/tests/security/test_sanitize.py` — Sanitization tests
- UPDATE `apps/web/middleware.ts` — Add security headers
- UPDATE `packages/backend/src/main.py` — Add security middleware

**Execution approach**:
1. Create frontend security utilities
2. Create backend security module
3. Create audit logging service
4. Create input sanitization
5. Create security middleware
6. Update existing middleware files
7. Create tests

**IMPORTANT**:
- CSP must allow Supabase and your API domains
- Audit logs should NOT contain sensitive data (passwords, tokens)
- Sanitization should prevent XSS and SQL injection
- CORS should be restrictive in production

**After completion, tell the user**:
- "Phase 12 complete. Security hardening applied."
- "CSP, CORS, audit logging, and input sanitization configured."
- "Review CSP policy for your specific third-party integrations."

---

## Skip Conditions

Skip this phase if ANY of these exist:
- `apps/web/lib/security/` directory exists
- `packages/backend/src/security/` directory exists

## Purpose

Harden the application against common security vulnerabilities:
- XSS attacks (Content Security Policy)
- CSRF attacks (SameSite cookies, CORS)
- Clickjacking (X-Frame-Options)
- Information leakage (security headers)
- Audit trail for compliance
- Input sanitization for injection attacks

---

## Artifacts to Create

### 1. apps/web/lib/security/csp.ts

```typescript
/**
 * Content Security Policy configuration.
 * 
 * Defines allowed sources for scripts, styles, images, etc.
 * Adjust based on your third-party integrations.
 */

export interface CSPDirectives {
  'default-src': string[];
  'script-src': string[];
  'style-src': string[];
  'img-src': string[];
  'font-src': string[];
  'connect-src': string[];
  'frame-src': string[];
  'frame-ancestors': string[];
  'form-action': string[];
  'base-uri': string[];
  'object-src': string[];
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export const cspDirectives: CSPDirectives = {
  'default-src': ["'self'"],
  'script-src': [
    "'self'",
    "'unsafe-inline'", // Required for Next.js - consider nonce-based in production
    "'unsafe-eval'", // Required for development - remove in production
    'https://js.stripe.com',
  ],
  'style-src': [
    "'self'",
    "'unsafe-inline'", // Required for Tailwind
  ],
  'img-src': [
    "'self'",
    'data:',
    'blob:',
    SUPABASE_URL,
    '*.supabase.co',
  ],
  'font-src': ["'self'", 'data:'],
  'connect-src': [
    "'self'",
    SUPABASE_URL,
    '*.supabase.co',
    BACKEND_URL,
    'https://api.stripe.com',
  ],
  'frame-src': [
    "'self'",
    'https://js.stripe.com',
    'https://hooks.stripe.com',
  ],
  'frame-ancestors': ["'none'"],
  'form-action': ["'self'"],
  'base-uri': ["'self'"],
  'object-src': ["'none'"],
};

/**
 * Build CSP header string from directives.
 */
export function buildCSP(directives: CSPDirectives): string {
  return Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(' ')}`)
    .join('; ');
}

/**
 * Get CSP header value.
 */
export function getCSPHeader(): string {
  return buildCSP(cspDirectives);
}

/**
 * Production CSP (stricter).
 */
export function getProductionCSP(): CSPDirectives {
  return {
    ...cspDirectives,
    'script-src': [
      "'self'",
      'https://js.stripe.com',
      // Add nonce support for inline scripts
    ],
  };
}
```

### 2. apps/web/lib/security/headers.ts

```typescript
/**
 * Security headers configuration.
 */

import { getCSPHeader } from './csp';

export interface SecurityHeaders {
  [key: string]: string;
}

/**
 * Get all security headers.
 */
export function getSecurityHeaders(): SecurityHeaders {
  const isDev = process.env.NODE_ENV === 'development';

  return {
    // Content Security Policy
    'Content-Security-Policy': isDev ? '' : getCSPHeader(),
    
    // Prevent clickjacking
    'X-Frame-Options': 'DENY',
    
    // Prevent MIME type sniffing
    'X-Content-Type-Options': 'nosniff',
    
    // Enable XSS filter (legacy browsers)
    'X-XSS-Protection': '1; mode=block',
    
    // Control referrer information
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    
    // Permissions Policy (formerly Feature-Policy)
    'Permissions-Policy': [
      'camera=()',
      'microphone=()',
      'geolocation=()',
      'interest-cohort=()',
    ].join(', '),
    
    // HSTS (only in production with HTTPS)
    ...(isDev ? {} : {
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    }),
  };
}

/**
 * Apply security headers to a Response.
 */
export function applySecurityHeaders(response: Response): Response {
  const headers = getSecurityHeaders();
  
  Object.entries(headers).forEach(([key, value]) => {
    if (value) {
      response.headers.set(key, value);
    }
  });
  
  return response;
}
```

### 3. apps/web/lib/security/index.ts

```typescript
export * from './csp';
export * from './headers';
```


### 4. packages/backend/src/security/__init__.py

```python
"""
Security module.

Provides audit logging, input sanitization, and security middleware.
"""

from .audit import AuditLogger, AuditEvent, AuditAction
from .sanitize import sanitize_input, sanitize_html, validate_email, validate_uuid
from .middleware import SecurityMiddleware

__all__ = [
    "AuditLogger",
    "AuditEvent", 
    "AuditAction",
    "sanitize_input",
    "sanitize_html",
    "validate_email",
    "validate_uuid",
    "SecurityMiddleware",
]
```

### 5. packages/backend/src/security/audit.py

```python
"""
Audit logging service.

Provides structured audit logging for security-relevant events.
Audit logs are essential for compliance (SOC2, GDPR, HIPAA).
"""

import json
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4

import structlog

logger = structlog.get_logger(__name__)


class AuditAction(str, Enum):
    """Audit action types."""
    
    # Authentication
    LOGIN_SUCCESS = "auth.login.success"
    LOGIN_FAILURE = "auth.login.failure"
    LOGOUT = "auth.logout"
    PASSWORD_CHANGE = "auth.password.change"
    PASSWORD_RESET_REQUEST = "auth.password.reset_request"
    MFA_ENABLED = "auth.mfa.enabled"
    MFA_DISABLED = "auth.mfa.disabled"
    
    # Authorization
    ACCESS_DENIED = "authz.access_denied"
    PERMISSION_GRANTED = "authz.permission.granted"
    PERMISSION_REVOKED = "authz.permission.revoked"
    
    # Data access
    DATA_READ = "data.read"
    DATA_CREATE = "data.create"
    DATA_UPDATE = "data.update"
    DATA_DELETE = "data.delete"
    DATA_EXPORT = "data.export"
    
    # Admin actions
    USER_CREATED = "admin.user.created"
    USER_UPDATED = "admin.user.updated"
    USER_DELETED = "admin.user.deleted"
    SETTINGS_CHANGED = "admin.settings.changed"
    
    # Security events
    RATE_LIMIT_EXCEEDED = "security.rate_limit"
    SUSPICIOUS_ACTIVITY = "security.suspicious"
    API_KEY_CREATED = "security.api_key.created"
    API_KEY_REVOKED = "security.api_key.revoked"


class AuditEvent:
    """Represents an audit event."""
    
    def __init__(
        self,
        action: AuditAction,
        actor_id: str | None = None,
        actor_email: str | None = None,
        resource_type: str | None = None,
        resource_id: str | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
        details: dict[str, Any] | None = None,
        success: bool = True,
    ):
        self.id = str(uuid4())
        self.timestamp = datetime.now(timezone.utc)
        self.action = action
        self.actor_id = actor_id
        self.actor_email = self._mask_email(actor_email)
        self.resource_type = resource_type
        self.resource_id = resource_id
        self.ip_address = self._mask_ip(ip_address)
        self.user_agent = user_agent
        self.details = self._sanitize_details(details or {})
        self.success = success
    
    def _mask_email(self, email: str | None) -> str | None:
        """Partially mask email for privacy."""
        if not email or "@" not in email:
            return email
        local, domain = email.split("@", 1)
        if len(local) <= 2:
            return f"**@{domain}"
        return f"{local[0]}{'*' * (len(local) - 2)}{local[-1]}@{domain}"
    
    def _mask_ip(self, ip: str | None) -> str | None:
        """Partially mask IP address."""
        if not ip:
            return ip
        parts = ip.split(".")
        if len(parts) == 4:
            return f"{parts[0]}.{parts[1]}.xxx.xxx"
        return ip  # IPv6 or other format
    
    def _sanitize_details(self, details: dict[str, Any]) -> dict[str, Any]:
        """Remove sensitive fields from details."""
        sensitive_keys = {
            "password", "token", "secret", "api_key", "credit_card",
            "ssn", "authorization", "cookie", "session",
        }
        return {
            k: "[REDACTED]" if k.lower() in sensitive_keys else v
            for k, v in details.items()
        }
    
    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for logging/storage."""
        return {
            "id": self.id,
            "timestamp": self.timestamp.isoformat(),
            "action": self.action.value,
            "actor_id": self.actor_id,
            "actor_email": self.actor_email,
            "resource_type": self.resource_type,
            "resource_id": self.resource_id,
            "ip_address": self.ip_address,
            "user_agent": self.user_agent,
            "details": self.details,
            "success": self.success,
        }


class AuditLogger:
    """
    Audit logger service.
    
    Logs security-relevant events for compliance and forensics.
    In production, these should be sent to a dedicated audit log store.
    """
    
    def __init__(self, service_name: str = "backend"):
        self.service_name = service_name
        self.logger = structlog.get_logger("audit")
    
    async def log(self, event: AuditEvent) -> None:
        """Log an audit event."""
        log_data = {
            "audit": True,
            "service": self.service_name,
            **event.to_dict(),
        }
        
        if event.success:
            self.logger.info("audit_event", **log_data)
        else:
            self.logger.warning("audit_event", **log_data)
    
    async def log_auth(
        self,
        action: AuditAction,
        actor_id: str | None,
        actor_email: str | None,
        ip_address: str | None,
        user_agent: str | None,
        success: bool = True,
        details: dict[str, Any] | None = None,
    ) -> None:
        """Log an authentication event."""
        event = AuditEvent(
            action=action,
            actor_id=actor_id,
            actor_email=actor_email,
            ip_address=ip_address,
            user_agent=user_agent,
            success=success,
            details=details,
        )
        await self.log(event)
    
    async def log_data_access(
        self,
        action: AuditAction,
        actor_id: str,
        resource_type: str,
        resource_id: str,
        ip_address: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        """Log a data access event."""
        event = AuditEvent(
            action=action,
            actor_id=actor_id,
            resource_type=resource_type,
            resource_id=resource_id,
            ip_address=ip_address,
            details=details,
        )
        await self.log(event)
    
    async def log_security_event(
        self,
        action: AuditAction,
        ip_address: str | None,
        details: dict[str, Any],
        actor_id: str | None = None,
    ) -> None:
        """Log a security event."""
        event = AuditEvent(
            action=action,
            actor_id=actor_id,
            ip_address=ip_address,
            details=details,
            success=False,
        )
        await self.log(event)


# Global audit logger instance
audit_logger = AuditLogger()
```

### 6. packages/backend/src/security/sanitize.py

```python
"""
Input sanitization utilities.

Provides functions to sanitize user input and prevent injection attacks.
"""

import html
import re
from typing import Any
from uuid import UUID


# Patterns for validation
EMAIL_PATTERN = re.compile(
    r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
)
UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

# Characters that could be used in SQL injection
SQL_DANGEROUS_CHARS = {"'", '"', ";", "--", "/*", "*/", "xp_", "sp_"}

# HTML tags that are never allowed
DANGEROUS_TAGS = {
    "script", "iframe", "object", "embed", "form", "input",
    "button", "link", "meta", "style", "base",
}


def sanitize_input(value: str, max_length: int = 10000) -> str:
    """
    Sanitize a string input.
    
    - Strips leading/trailing whitespace
    - Removes null bytes
    - Limits length
    - Escapes HTML entities
    
    Args:
        value: The input string
        max_length: Maximum allowed length
        
    Returns:
        Sanitized string
    """
    if not isinstance(value, str):
        return ""
    
    # Remove null bytes
    value = value.replace("\x00", "")
    
    # Strip whitespace
    value = value.strip()
    
    # Limit length
    value = value[:max_length]
    
    # Escape HTML entities
    value = html.escape(value)
    
    return value


def sanitize_html(value: str, allowed_tags: set[str] | None = None) -> str:
    """
    Sanitize HTML content, removing dangerous tags.
    
    Args:
        value: HTML string
        allowed_tags: Set of allowed tag names (default: basic formatting)
        
    Returns:
        Sanitized HTML string
    """
    if allowed_tags is None:
        allowed_tags = {"p", "br", "b", "i", "u", "strong", "em", "a", "ul", "ol", "li"}
    
    # Remove dangerous tags completely
    for tag in DANGEROUS_TAGS:
        # Remove opening tags
        value = re.sub(
            rf"<{tag}[^>]*>",
            "",
            value,
            flags=re.IGNORECASE,
        )
        # Remove closing tags
        value = re.sub(
            rf"</{tag}>",
            "",
            value,
            flags=re.IGNORECASE,
        )
    
    # Remove event handlers (onclick, onerror, etc.)
    value = re.sub(
        r'\s+on\w+\s*=\s*["\'][^"\']*["\']',
        "",
        value,
        flags=re.IGNORECASE,
    )
    
    # Remove javascript: URLs
    value = re.sub(
        r'href\s*=\s*["\']javascript:[^"\']*["\']',
        'href="#"',
        value,
        flags=re.IGNORECASE,
    )
    
    return value


def validate_email(email: str) -> bool:
    """
    Validate email format.
    
    Args:
        email: Email address to validate
        
    Returns:
        True if valid email format
    """
    if not email or len(email) > 254:
        return False
    return bool(EMAIL_PATTERN.match(email))


def validate_uuid(value: str) -> bool:
    """
    Validate UUID format.
    
    Args:
        value: String to validate
        
    Returns:
        True if valid UUID format
    """
    if not value:
        return False
    try:
        UUID(value)
        return True
    except (ValueError, AttributeError):
        return False


def validate_slug(value: str, max_length: int = 100) -> bool:
    """
    Validate URL slug format.
    
    Args:
        value: String to validate
        max_length: Maximum allowed length
        
    Returns:
        True if valid slug format
    """
    if not value or len(value) > max_length:
        return False
    return bool(SLUG_PATTERN.match(value))


def check_sql_injection(value: str) -> bool:
    """
    Check if a string contains potential SQL injection patterns.
    
    Note: This is a basic check. Always use parameterized queries!
    
    Args:
        value: String to check
        
    Returns:
        True if suspicious patterns found
    """
    value_lower = value.lower()
    
    # Check for dangerous characters/patterns
    for pattern in SQL_DANGEROUS_CHARS:
        if pattern in value_lower:
            return True
    
    # Check for common SQL keywords in suspicious contexts
    sql_keywords = ["select", "insert", "update", "delete", "drop", "union", "exec"]
    for keyword in sql_keywords:
        if re.search(rf"\b{keyword}\b", value_lower):
            return True
    
    return False


def sanitize_filename(filename: str) -> str:
    """
    Sanitize a filename for safe storage.
    
    Args:
        filename: Original filename
        
    Returns:
        Sanitized filename
    """
    # Remove path separators
    filename = filename.replace("/", "_").replace("\\", "_")
    
    # Remove null bytes
    filename = filename.replace("\x00", "")
    
    # Remove leading dots (hidden files)
    filename = filename.lstrip(".")
    
    # Keep only safe characters
    filename = re.sub(r"[^a-zA-Z0-9._-]", "_", filename)
    
    # Limit length
    if len(filename) > 255:
        name, ext = filename.rsplit(".", 1) if "." in filename else (filename, "")
        max_name_len = 255 - len(ext) - 1 if ext else 255
        filename = f"{name[:max_name_len]}.{ext}" if ext else name[:255]
    
    return filename or "unnamed"


def sanitize_dict(data: dict[str, Any], max_depth: int = 10) -> dict[str, Any]:
    """
    Recursively sanitize all string values in a dictionary.
    
    Args:
        data: Dictionary to sanitize
        max_depth: Maximum recursion depth
        
    Returns:
        Sanitized dictionary
    """
    if max_depth <= 0:
        return {}
    
    result = {}
    for key, value in data.items():
        # Sanitize key
        safe_key = sanitize_input(str(key), max_length=100)
        
        # Sanitize value based on type
        if isinstance(value, str):
            result[safe_key] = sanitize_input(value)
        elif isinstance(value, dict):
            result[safe_key] = sanitize_dict(value, max_depth - 1)
        elif isinstance(value, list):
            result[safe_key] = [
                sanitize_input(v) if isinstance(v, str)
                else sanitize_dict(v, max_depth - 1) if isinstance(v, dict)
                else v
                for v in value
            ]
        else:
            result[safe_key] = value
    
    return result
```

### 7. packages/backend/src/security/cors.py

```python
"""
CORS configuration.

Provides secure CORS settings for the API.
"""

from typing import Sequence


def get_cors_origins(env: str = "development") -> list[str]:
    """
    Get allowed CORS origins based on environment.
    
    Args:
        env: Environment name (development, staging, production)
        
    Returns:
        List of allowed origins
    """
    if env == "development":
        return [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]
    elif env == "staging":
        return [
            "https://staging.yourdomain.com",
        ]
    elif env == "production":
        return [
            "https://yourdomain.com",
            "https://www.yourdomain.com",
        ]
    return []


def get_cors_config(env: str = "development") -> dict:
    """
    Get full CORS configuration.
    
    Args:
        env: Environment name
        
    Returns:
        CORS configuration dictionary
    """
    return {
        "allow_origins": get_cors_origins(env),
        "allow_credentials": True,
        "allow_methods": ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        "allow_headers": [
            "Authorization",
            "Content-Type",
            "X-Request-ID",
            "X-Idempotency-Key",
        ],
        "expose_headers": [
            "X-Request-ID",
            "X-RateLimit-Limit",
            "X-RateLimit-Remaining",
            "X-RateLimit-Reset",
        ],
        "max_age": 600,  # Cache preflight for 10 minutes
    }
```

### 8. packages/backend/src/security/middleware.py

```python
"""
Security middleware for FastAPI.
"""

import time
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from .audit import AuditAction, audit_logger


class SecurityMiddleware(BaseHTTPMiddleware):
    """
    Security middleware that adds headers and logging.
    """
    
    async def dispatch(
        self,
        request: Request,
        call_next: Callable,
    ) -> Response:
        start_time = time.time()
        
        # Get client info
        client_ip = self._get_client_ip(request)
        user_agent = request.headers.get("user-agent", "")
        
        # Process request
        response = await call_next(request)
        
        # Add security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        
        # Add request timing
        process_time = time.time() - start_time
        response.headers["X-Process-Time"] = str(process_time)
        
        # Log suspicious activity
        if response.status_code == 401:
            await audit_logger.log_security_event(
                action=AuditAction.ACCESS_DENIED,
                ip_address=client_ip,
                details={
                    "path": str(request.url.path),
                    "method": request.method,
                    "user_agent": user_agent[:200],
                },
            )
        
        return response
    
    def _get_client_ip(self, request: Request) -> str:
        """Extract client IP from request, handling proxies."""
        # Check X-Forwarded-For header (set by proxies/load balancers)
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            # Take the first IP (original client)
            return forwarded.split(",")[0].strip()
        
        # Check X-Real-IP header
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip
        
        # Fall back to direct client
        if request.client:
            return request.client.host
        
        return "unknown"
```


### 9. Update apps/web/middleware.ts

Add security headers to the existing middleware:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSecurityHeaders } from '@/lib/security/headers';

export async function middleware(request: NextRequest) {
  // Get response (from existing auth middleware logic)
  const response = NextResponse.next();
  
  // Apply security headers
  const securityHeaders = getSecurityHeaders();
  Object.entries(securityHeaders).forEach(([key, value]) => {
    if (value) {
      response.headers.set(key, value);
    }
  });
  
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};
```

### 10. Update packages/backend/src/main.py

Add security middleware to FastAPI app:

```python
# Add to imports
from src.security.middleware import SecurityMiddleware
from src.security.cors import get_cors_config

# Replace CORS middleware configuration
cors_config = get_cors_config(env="development")  # Use env variable in production
app.add_middleware(
    CORSMiddleware,
    **cors_config,
)

# Add security middleware
app.add_middleware(SecurityMiddleware)
```

---

## Security Testing

### 11. packages/backend/tests/security/__init__.py

```python
"""Security tests package."""
```

### 12. packages/backend/tests/security/test_audit.py

```python
"""
Audit logging tests.
"""

import pytest
from unittest.mock import AsyncMock, patch

from src.security.audit import (
    AuditAction,
    AuditEvent,
    AuditLogger,
)


class TestAuditEvent:
    """Tests for AuditEvent."""
    
    def test_creates_event_with_id_and_timestamp(self):
        """Event should have auto-generated ID and timestamp."""
        event = AuditEvent(action=AuditAction.LOGIN_SUCCESS)
        
        assert event.id is not None
        assert len(event.id) == 36  # UUID format
        assert event.timestamp is not None
    
    def test_masks_email(self):
        """Email should be partially masked."""
        event = AuditEvent(
            action=AuditAction.LOGIN_SUCCESS,
            actor_email="john.doe@example.com",
        )
        
        assert event.actor_email == "j******e@example.com"
    
    def test_masks_short_email(self):
        """Short email local part should be fully masked."""
        event = AuditEvent(
            action=AuditAction.LOGIN_SUCCESS,
            actor_email="ab@example.com",
        )
        
        assert event.actor_email == "**@example.com"
    
    def test_masks_ip_address(self):
        """IP address should be partially masked."""
        event = AuditEvent(
            action=AuditAction.LOGIN_SUCCESS,
            ip_address="192.168.1.100",
        )
        
        assert event.ip_address == "192.168.xxx.xxx"
    
    def test_sanitizes_sensitive_details(self):
        """Sensitive fields should be redacted."""
        event = AuditEvent(
            action=AuditAction.LOGIN_SUCCESS,
            details={
                "username": "john",
                "password": "secret123",
                "token": "abc123",
                "api_key": "key123",
            },
        )
        
        assert event.details["username"] == "john"
        assert event.details["password"] == "[REDACTED]"
        assert event.details["token"] == "[REDACTED]"
        assert event.details["api_key"] == "[REDACTED]"
    
    def test_to_dict(self):
        """Should convert to dictionary."""
        event = AuditEvent(
            action=AuditAction.DATA_CREATE,
            actor_id="user-123",
            resource_type="document",
            resource_id="doc-456",
        )
        
        data = event.to_dict()
        
        assert data["action"] == "data.create"
        assert data["actor_id"] == "user-123"
        assert data["resource_type"] == "document"
        assert data["resource_id"] == "doc-456"
        assert "timestamp" in data
        assert "id" in data


class TestAuditLogger:
    """Tests for AuditLogger."""
    
    @pytest.fixture
    def logger(self):
        return AuditLogger(service_name="test-service")
    
    @pytest.mark.asyncio
    async def test_log_event(self, logger):
        """Should log audit event."""
        with patch.object(logger.logger, "info") as mock_info:
            event = AuditEvent(
                action=AuditAction.LOGIN_SUCCESS,
                actor_id="user-123",
            )
            
            await logger.log(event)
            
            mock_info.assert_called_once()
            call_kwargs = mock_info.call_args[1]
            assert call_kwargs["audit"] is True
            assert call_kwargs["service"] == "test-service"
    
    @pytest.mark.asyncio
    async def test_log_failed_event_as_warning(self, logger):
        """Failed events should be logged as warnings."""
        with patch.object(logger.logger, "warning") as mock_warning:
            event = AuditEvent(
                action=AuditAction.LOGIN_FAILURE,
                success=False,
            )
            
            await logger.log(event)
            
            mock_warning.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_log_auth(self, logger):
        """Should log authentication events."""
        with patch.object(logger, "log", new_callable=AsyncMock) as mock_log:
            await logger.log_auth(
                action=AuditAction.LOGIN_SUCCESS,
                actor_id="user-123",
                actor_email="test@example.com",
                ip_address="192.168.1.1",
                user_agent="Mozilla/5.0",
            )
            
            mock_log.assert_called_once()
            event = mock_log.call_args[0][0]
            assert event.action == AuditAction.LOGIN_SUCCESS
            assert event.actor_id == "user-123"
    
    @pytest.mark.asyncio
    async def test_log_data_access(self, logger):
        """Should log data access events."""
        with patch.object(logger, "log", new_callable=AsyncMock) as mock_log:
            await logger.log_data_access(
                action=AuditAction.DATA_READ,
                actor_id="user-123",
                resource_type="document",
                resource_id="doc-456",
            )
            
            mock_log.assert_called_once()
            event = mock_log.call_args[0][0]
            assert event.action == AuditAction.DATA_READ
            assert event.resource_type == "document"
    
    @pytest.mark.asyncio
    async def test_log_security_event(self, logger):
        """Should log security events as failures."""
        with patch.object(logger, "log", new_callable=AsyncMock) as mock_log:
            await logger.log_security_event(
                action=AuditAction.RATE_LIMIT_EXCEEDED,
                ip_address="192.168.1.1",
                details={"path": "/api/users"},
            )
            
            mock_log.assert_called_once()
            event = mock_log.call_args[0][0]
            assert event.success is False
```

### 13. packages/backend/tests/security/test_sanitize.py

```python
"""
Input sanitization tests.
"""

import pytest

from src.security.sanitize import (
    sanitize_input,
    sanitize_html,
    validate_email,
    validate_uuid,
    validate_slug,
    check_sql_injection,
    sanitize_filename,
    sanitize_dict,
)


class TestSanitizeInput:
    """Tests for sanitize_input."""
    
    def test_strips_whitespace(self):
        assert sanitize_input("  hello  ") == "hello"
    
    def test_removes_null_bytes(self):
        assert sanitize_input("hello\x00world") == "helloworld"
    
    def test_limits_length(self):
        result = sanitize_input("a" * 100, max_length=10)
        assert len(result) == 10
    
    def test_escapes_html(self):
        result = sanitize_input("<script>alert('xss')</script>")
        assert "<script>" not in result
        assert "&lt;script&gt;" in result
    
    def test_handles_non_string(self):
        assert sanitize_input(123) == ""  # type: ignore
        assert sanitize_input(None) == ""  # type: ignore


class TestSanitizeHtml:
    """Tests for sanitize_html."""
    
    def test_removes_script_tags(self):
        result = sanitize_html("<p>Hello</p><script>alert('xss')</script>")
        assert "<script>" not in result
        assert "<p>Hello</p>" in result
    
    def test_removes_event_handlers(self):
        result = sanitize_html('<img src="x" onerror="alert(1)">')
        assert "onerror" not in result
    
    def test_removes_javascript_urls(self):
        result = sanitize_html('<a href="javascript:alert(1)">Click</a>')
        assert "javascript:" not in result
    
    def test_preserves_allowed_tags(self):
        result = sanitize_html("<p><strong>Bold</strong> and <em>italic</em></p>")
        assert "<strong>" in result
        assert "<em>" in result


class TestValidateEmail:
    """Tests for validate_email."""
    
    def test_valid_emails(self):
        assert validate_email("user@example.com") is True
        assert validate_email("user.name@example.co.uk") is True
        assert validate_email("user+tag@example.com") is True
    
    def test_invalid_emails(self):
        assert validate_email("") is False
        assert validate_email("not-an-email") is False
        assert validate_email("@example.com") is False
        assert validate_email("user@") is False
        assert validate_email("user@.com") is False
    
    def test_too_long_email(self):
        long_email = "a" * 250 + "@example.com"
        assert validate_email(long_email) is False


class TestValidateUuid:
    """Tests for validate_uuid."""
    
    def test_valid_uuids(self):
        assert validate_uuid("550e8400-e29b-41d4-a716-446655440000") is True
        assert validate_uuid("550E8400-E29B-41D4-A716-446655440000") is True
    
    def test_invalid_uuids(self):
        assert validate_uuid("") is False
        assert validate_uuid("not-a-uuid") is False
        assert validate_uuid("550e8400-e29b-41d4-a716") is False


class TestValidateSlug:
    """Tests for validate_slug."""
    
    def test_valid_slugs(self):
        assert validate_slug("hello-world") is True
        assert validate_slug("post123") is True
        assert validate_slug("a") is True
    
    def test_invalid_slugs(self):
        assert validate_slug("") is False
        assert validate_slug("Hello-World") is False  # Uppercase
        assert validate_slug("hello_world") is False  # Underscore
        assert validate_slug("-hello") is False  # Leading dash
        assert validate_slug("hello-") is False  # Trailing dash


class TestCheckSqlInjection:
    """Tests for check_sql_injection."""
    
    def test_detects_sql_keywords(self):
        assert check_sql_injection("SELECT * FROM users") is True
        assert check_sql_injection("1; DROP TABLE users") is True
        assert check_sql_injection("' OR '1'='1") is True
    
    def test_allows_normal_input(self):
        assert check_sql_injection("Hello World") is False
        assert check_sql_injection("john.doe@example.com") is False
        assert check_sql_injection("My favorite color is blue") is False


class TestSanitizeFilename:
    """Tests for sanitize_filename."""
    
    def test_removes_path_separators(self):
        assert "/" not in sanitize_filename("../../../etc/passwd")
        assert "\\" not in sanitize_filename("..\\..\\windows\\system32")
    
    def test_removes_leading_dots(self):
        result = sanitize_filename(".hidden")
        assert not result.startswith(".")
    
    def test_limits_length(self):
        long_name = "a" * 300 + ".txt"
        result = sanitize_filename(long_name)
        assert len(result) <= 255
    
    def test_handles_empty_result(self):
        assert sanitize_filename("...") == "unnamed"


class TestSanitizeDict:
    """Tests for sanitize_dict."""
    
    def test_sanitizes_string_values(self):
        result = sanitize_dict({"name": "  <script>alert(1)</script>  "})
        assert "<script>" not in result["name"]
    
    def test_sanitizes_nested_dicts(self):
        result = sanitize_dict({
            "user": {
                "name": "<b>John</b>",
            }
        })
        assert "&lt;b&gt;" in result["user"]["name"]
    
    def test_sanitizes_lists(self):
        result = sanitize_dict({
            "tags": ["<script>", "normal"],
        })
        assert "<script>" not in result["tags"][0]
    
    def test_respects_max_depth(self):
        deep = {"a": {"b": {"c": {"d": "value"}}}}
        result = sanitize_dict(deep, max_depth=2)
        assert result["a"]["b"] == {}
```

---

## Verification

After creating all files, run:

```bash
node Masterguide/scaffolding/scripts/verify-phase.js 12
```

**Manual checks:**

```bash
# 1. Run security tests
cd packages/backend
pytest tests/security/ -v

# 2. Check security headers in browser
# Start dev server and inspect response headers in DevTools

# 3. Test CSP
# Check browser console for CSP violations
```

**Success Criteria**:
- [ ] Security headers present in responses
- [ ] Audit logging captures auth events
- [ ] Input sanitization prevents XSS
- [ ] CORS configured correctly
- [ ] All security tests pass

---

## Next Phase

Proceed to [13-FILE-STORAGE.md](./13-FILE-STORAGE.md) for file upload and storage patterns.
