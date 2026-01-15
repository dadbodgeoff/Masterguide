# Error Sanitization

Production-safe error handling: log everything server-side, expose nothing to users.

## Problem

Error messages leak sensitive information:
- Database connection strings
- Internal file paths
- Stack traces with code structure
- API keys in error context
- Business logic details

## Solution: Sanitize Before Returning

```
Exception occurs
    ↓
[1] Log FULL error server-side (with context)
    ↓
[2] Classify error type
    ↓
[3] Return GENERIC message to user
    ↓
[4] Only expose safe, actionable errors
```

---

## Implementation

```python
import os
import logging
from typing import Optional
from fastapi import HTTPException
from pydantic import ValidationError

logger = logging.getLogger(__name__)


class ErrorSanitizer:
    """
    Sanitizes error messages to prevent information leakage.
    
    Security Best Practices:
    - Never expose internal errors in production
    - Log full details server-side
    - Return generic messages to users
    - Only expose safe, user-actionable errors
    """
    
    # Patterns that indicate sensitive information
    SENSITIVE_PATTERNS = [
        "password", "secret", "key", "token", "credential",
        "postgresql://", "mysql://", "mongodb://", "redis://",
        "localhost", "127.0.0.1", "internal", "0.0.0.0",
        "traceback", "exception", "error at", "line ",
        "/home/", "/var/", "/etc/", "C:\\",
        "SUPABASE", "AWS", "STRIPE", "SENDGRID",
    ]
    
    @staticmethod
    def is_production() -> bool:
        return os.getenv("ENVIRONMENT", "development").lower() == "production"
    
    @staticmethod
    def sanitize_error(
        e: Exception,
        user_message: str = "Operation failed",
        log_context: Optional[dict] = None
    ) -> str:
        """
        Sanitize error message for user display.
        
        Args:
            e: The exception that occurred
            user_message: Generic message to show users
            log_context: Additional context for server-side logging
            
        Returns:
            Safe error message for users
        """
        # ALWAYS log full error server-side
        log_extra = log_context or {}
        logger.error(
            f"Error occurred: {type(e).__name__}: {str(e)}",
            exc_info=True,
            extra=log_extra
        )
        
        # In development, show more details for debugging
        if not ErrorSanitizer.is_production():
            return f"{user_message}: {str(e)}"
        
        # In production, only expose safe errors
        
        # Validation errors are safe (user input issues)
        if isinstance(e, ValidationError):
            return f"Validation error: {str(e)}"
        
        # HTTPException with client error (4xx) is safe
        if isinstance(e, HTTPException):
            if 400 <= e.status_code < 500:
                return e.detail
            # Server errors (5xx) get generic message
            return user_message
        
        # Check if error message contains sensitive patterns
        error_str = str(e).lower()
        for pattern in ErrorSanitizer.SENSITIVE_PATTERNS:
            if pattern in error_str:
                return user_message
        
        # For short, simple errors without sensitive patterns, might be safe
        if len(str(e)) < 100 and not any(c in str(e) for c in ['/', '\\', '@', ':']):
            return str(e)
        
        # Default: return generic message
        return user_message
    
    @staticmethod
    def create_http_exception(
        e: Exception,
        status_code: int = 500,
        user_message: str = "Operation failed",
        log_context: Optional[dict] = None
    ) -> HTTPException:
        """Create HTTPException with sanitized error message."""
        safe_message = ErrorSanitizer.sanitize_error(e, user_message, log_context)
        return HTTPException(status_code=status_code, detail=safe_message)
```

---

## Domain-Specific Sanitizers

```python
def sanitize_database_error(e: Exception) -> str:
    """Sanitize database-related errors"""
    return ErrorSanitizer.sanitize_error(
        e,
        user_message="Database operation failed. Please try again.",
        log_context={"error_type": "database"}
    )


def sanitize_api_error(e: Exception, service_name: str = "external service") -> str:
    """Sanitize external API errors"""
    return ErrorSanitizer.sanitize_error(
        e,
        user_message=f"Failed to communicate with {service_name}. Please try again.",
        log_context={"error_type": "external_api", "service": service_name}
    )


def sanitize_file_error(e: Exception) -> str:
    """Sanitize file operation errors"""
    return ErrorSanitizer.sanitize_error(
        e,
        user_message="File operation failed. Please check the file and try again.",
        log_context={"error_type": "file_operation"}
    )


def sanitize_parsing_error(e: Exception) -> str:
    """Sanitize parsing/processing errors"""
    return ErrorSanitizer.sanitize_error(
        e,
        user_message="Failed to process the document. Please verify the format and try again.",
        log_context={"error_type": "parsing"}
    )


def sanitize_auth_error(e: Exception) -> str:
    """Sanitize authentication errors"""
    return ErrorSanitizer.sanitize_error(
        e,
        user_message="Authentication failed. Please check your credentials.",
        log_context={"error_type": "authentication"}
    )
```

---

## Error Classification

Centralized error typing for consistent UX:

```python
def classify_invoice_error(error: Exception) -> str:
    """
    Classify error type for user-friendly messaging
    
    Returns:
        Error type: 'zero_quantity', 'pack_size_conversion', 
        'data_validation', 'rate_limited', 'timeout', etc.
    """
    error_str = str(error).lower()
    
    # Business logic errors (safe to expose type)
    if 'check_quantity_nonzero' in error_str:
        return "zero_quantity"
    elif 'unit conversion' in error_str or 'pack_size' in error_str:
        return "pack_size_conversion"
    elif 'constraint' in error_str:
        return "data_validation"
    
    # Infrastructure errors (generic type)
    elif "rate" in error_str or "429" in error_str:
        return "rate_limited"
    elif "timeout" in error_str:
        return "timeout"
    elif "invalid" in error_str or "corrupt" in error_str:
        return "invalid_file"
    elif "not found" in error_str or "404" in error_str:
        return "file_not_found"
    
    return "unknown"


def get_user_friendly_message(error_type: str) -> str:
    """Get user-friendly message based on error type"""
    messages = {
        "zero_quantity": "Item quantity was zero. Please check the invoice.",
        "pack_size_conversion": "Could not convert pack size. Please verify the format.",
        "data_validation": "Data validation failed. Please check the item details.",
        "rate_limited": "System is busy. Please try again in a moment.",
        "timeout": "Processing took too long. Please try again.",
        "invalid_file": "This file doesn't appear to be valid. Please check and try again.",
        "file_not_found": "File not found. Please upload again.",
        "unknown": "Something went wrong. Our team has been notified."
    }
    return messages.get(error_type, messages["unknown"])
```

---

## Usage in Routes

```python
@router.post("/process")
async def process_invoice(invoice_id: str):
    try:
        result = await processor.process(invoice_id)
        return result
        
    except ValidationError as e:
        # Validation errors are safe to expose
        raise HTTPException(status_code=400, detail=str(e))
        
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
        
    except Exception as e:
        # All other errors get sanitized
        raise ErrorSanitizer.create_http_exception(
            e,
            status_code=500,
            user_message="Failed to process invoice",
            log_context={"invoice_id": invoice_id}
        )
```

---

## Partial Failure Handling

For batch operations, classify each failure:

```python
def process_invoice_items(items: List[Dict]) -> Dict:
    failed_items = []
    
    for idx, item in enumerate(items):
        try:
            process_item(item)
        except Exception as e:
            # Classify error for user
            error_type = classify_invoice_error(e)
            
            failed_items.append({
                "line": idx,
                "description": item['description'][:50],  # Truncate
                "error_type": error_type,
                "message": get_user_friendly_message(error_type)
                # NOTE: Don't include str(e) - might be sensitive
            })
            continue
    
    return {
        "status": "partial_success" if failed_items else "success",
        "failed_items": failed_items
    }
```

---

## Logging Best Practices

```python
# DO: Log full context server-side
logger.error(
    f"Invoice processing failed",
    exc_info=True,  # Include stack trace
    extra={
        "invoice_id": invoice_id,
        "user_id": user_id,
        "error_type": type(e).__name__,
        "error_message": str(e),
        "item_count": len(items),
    }
)

# DON'T: Log sensitive data
logger.error(f"Auth failed for password: {password}")  # NEVER
logger.error(f"DB error: {connection_string}")  # NEVER

# DO: Sanitize before logging if needed
logger.error(f"Auth failed for user: {user_id}")  # OK
logger.error(f"DB error occurred", extra={"table": "invoices"})  # OK
```

---

## Response Format

```python
# Development (ENVIRONMENT != "production")
{
    "error": "Database operation failed: connection refused to postgresql://user:pass@localhost:5432/db",
    "status_code": 500
}

# Production
{
    "error": "Database operation failed. Please try again.",
    "status_code": 500
}
```

---

## Gotchas

1. **Don't trust error messages**: Even "safe" errors might contain injected content
2. **Truncate user input in errors**: `item['description'][:50]` prevents log injection
3. **Validation errors need review**: Pydantic errors might expose field names you want hidden
4. **Log correlation IDs**: Include request_id/session_id for tracing
5. **Test in production mode**: Errors look different in dev vs prod
6. **Monitor "unknown" errors**: High rate of unknown = missing classification
