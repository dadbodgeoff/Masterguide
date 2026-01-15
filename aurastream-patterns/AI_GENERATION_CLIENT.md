# AI Generation Client Pattern

> External AI API integration with retry logic, rate limiting, content safety, and multi-turn conversation support.

## Overview

This pattern covers integration with external AI generation APIs (like Google Gemini, OpenAI, etc.) including:
- Async HTTP client with connection pooling
- Exponential backoff retry logic
- Rate limit handling with Retry-After
- Content policy violation detection
- Multi-turn conversation for refinements
- Strict prompt constraints to prevent hallucination

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Backend   │────▶│  AI Client  │────▶│   AI API    │
│  (Service)  │     │  (Wrapper)  │     │  (Gemini)   │
└─────────────┘     └─────────────┘     └─────────────┘
                          │
                          ├── Retry Logic
                          ├── Rate Limiting
                          ├── Error Handling
                          └── Response Parsing
```

## Implementation

### Data Classes

```python
from dataclasses import dataclass, field
from typing import Optional, List


@dataclass
class ConversationTurn:
    """Single turn in a multi-turn conversation."""
    role: str  # "user" or "model"
    text: Optional[str] = None
    image_data: Optional[bytes] = None
    image_mime_type: str = "image/png"
    thought_signature: Optional[str] = None  # For model-generated images


@dataclass
class MediaAssetInput:
    """A media asset to include in generation."""
    image_data: bytes
    mime_type: str = "image/png"
    asset_id: str = ""
    display_name: str = ""
    asset_type: str = "image"  # logo, face, character, etc.


@dataclass
class GenerationRequest:
    """Request parameters for image generation."""
    prompt: str
    width: int
    height: int
    model: str = "gemini-2.0-flash-exp"
    seed: Optional[int] = None
    input_image: Optional[bytes] = None  # For image-to-image
    input_mime_type: str = "image/png"
    conversation_history: Optional[List[ConversationTurn]] = None
    media_assets: Optional[List[MediaAssetInput]] = None
    enable_grounding: bool = False  # Enable web search for real-time info


@dataclass
class GenerationResponse:
    """Response from image generation."""
    image_data: bytes
    generation_id: str
    seed: int
    inference_time_ms: int
    thought_signature: Optional[bytes] = None  # For multi-turn refinements
```

### Custom Exceptions

```python
from dataclasses import dataclass
from typing import Optional, Dict, Any


@dataclass
class RateLimitError(Exception):
    """Raised when rate limit is exceeded."""
    retry_after: int = 60
    
    def __str__(self):
        return f"Rate limit exceeded. Retry after {self.retry_after} seconds."


@dataclass
class ContentPolicyError(Exception):
    """Raised when content violates AI safety policies."""
    reason: str = "Content violates usage policies"
    
    def __str__(self):
        return f"Content policy violation: {self.reason}"


@dataclass
class GenerationTimeoutError(Exception):
    """Raised when generation times out."""
    timeout_seconds: int = 120
    
    def __str__(self):
        return f"Generation timed out after {self.timeout_seconds} seconds"


@dataclass
class GenerationError(Exception):
    """General generation failure."""
    message: str = "Generation failed"
    details: Optional[Dict[str, Any]] = None
    
    def __str__(self):
        return self.message
```

### AI Generation Client

```python
import asyncio
import base64
import logging
import os
import time
import uuid
from typing import Optional, List

import aiohttp

logger = logging.getLogger(__name__)


class AIGenerationClient:
    """
    Async client for AI image generation APIs.
    
    Features:
    - Exponential backoff retry (1s, 2s, 4s delays)
    - Rate limit handling with Retry-After header
    - Content policy violation detection
    - Multi-turn conversation support
    - Configurable timeout and retry settings
    """
    
    # Exponential backoff delays in seconds
    RETRY_DELAYS = [1, 2, 4]
    
    # API configuration
    BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
    
    # Strict content constraint to prevent hallucination
    STRICT_CONTENT_CONSTRAINT = """STRICT RULES:

1. CREATE ORIGINAL ART - Do NOT use screenshots or existing images.
   - Generate NEW artwork in a stylized, professional style
   - NO game HUD elements (health bars, minimaps, inventory)
   - NO watermarks or UI from other sources

2. REFERENCE IMAGE: If provided, COPY the exact layout and positions.

3. TEXT RENDERING - CRITICAL:
   - Render ALL text EXACTLY as written - no corrections
   - Text must be FULLY VISIBLE and NEVER covered by objects
   - Characters must be BEHIND or BESIDE text, never overlapping

4. QUANTITIES: If prompt says "3 items" - render EXACTLY 3.

5. NO ADDITIONS: Do NOT add text, labels, or elements not mentioned.

6. CHARACTERS: Render character details EXACTLY as described.

7. STYLE: You MAY be creative with colors and artistic style.

8. CONTENT: You may NOT be creative with text or quantities.

"""
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        timeout: int = 120,
        max_retries: int = 3,
    ):
        """
        Initialize the AI generation client.
        
        Args:
            api_key: API key (defaults to env var)
            model: Model to use (defaults to env var)
            timeout: Request timeout in seconds
            max_retries: Maximum retry attempts
        """
        self.api_key = api_key or os.environ.get("AI_API_KEY")
        if not self.api_key:
            raise ValueError("API key is required")
        
        self.model = model or os.environ.get("AI_MODEL", "gemini-2.0-flash-exp")
        self.timeout = timeout
        self.max_retries = min(max_retries, len(self.RETRY_DELAYS))
        self._session: Optional[aiohttp.ClientSession] = None
    
    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create the aiohttp session."""
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=self.timeout)
            )
        return self._session
    
    async def close(self):
        """Close the aiohttp session."""
        if self._session and not self._session.closed:
            await self._session.close()
    
    async def generate(self, request: GenerationRequest) -> GenerationResponse:
        """
        Generate an image using the AI API.
        
        Args:
            request: Generation request parameters
            
        Returns:
            GenerationResponse with image data and metadata
            
        Raises:
            RateLimitError: If rate limit exceeded
            ContentPolicyError: If content violates policy
            GenerationTimeoutError: If request times out
            GenerationError: For other failures
        """
        model_name = request.model or self.model
        
        return await self._request_with_retry(
            prompt=request.prompt,
            model_name=model_name,
            seed=request.seed,
            width=request.width,
            height=request.height,
            input_image=request.input_image,
            input_mime_type=request.input_mime_type,
            conversation_history=request.conversation_history,
            media_assets=request.media_assets,
            enable_grounding=request.enable_grounding,
        )
    
    async def _request_with_retry(
        self,
        prompt: str,
        model_name: str,
        seed: Optional[int],
        width: int,
        height: int,
        input_image: Optional[bytes] = None,
        input_mime_type: str = "image/png",
        conversation_history: Optional[List] = None,
        media_assets: Optional[List[MediaAssetInput]] = None,
        enable_grounding: bool = False,
    ) -> GenerationResponse:
        """Execute generation with exponential backoff retry."""
        last_exception: Optional[Exception] = None
        
        for attempt in range(self.max_retries):
            try:
                return await self._execute_generation(
                    prompt=prompt,
                    model_name=model_name,
                    seed=seed,
                    width=width,
                    height=height,
                    input_image=input_image,
                    input_mime_type=input_mime_type,
                    conversation_history=conversation_history,
                    media_assets=media_assets,
                    enable_grounding=enable_grounding,
                )
            
            except ContentPolicyError:
                # Don't retry content policy violations
                raise
            
            except RateLimitError as e:
                last_exception = e
                delay = e.retry_after if e.retry_after else self.RETRY_DELAYS[attempt]
                
                if attempt < self.max_retries - 1:
                    logger.warning(f"Rate limited, retrying in {delay}s")
                    await asyncio.sleep(delay)
                    continue
                raise
            
            except (GenerationTimeoutError, GenerationError) as e:
                last_exception = e
                if attempt < self.max_retries - 1:
                    delay = self.RETRY_DELAYS[attempt]
                    logger.warning(f"Generation failed, retrying in {delay}s: {e}")
                    await asyncio.sleep(delay)
                    continue
                raise
            
            except Exception as e:
                last_exception = e
                if attempt < self.max_retries - 1:
                    delay = self.RETRY_DELAYS[attempt]
                    logger.warning(f"Unexpected error, retrying in {delay}s: {e}")
                    await asyncio.sleep(delay)
                    continue
                
                raise GenerationError(
                    message=f"Generation failed: {str(e)}",
                    details={"original_error": str(e)},
                )
        
        if last_exception:
            raise last_exception
        raise GenerationError(message="Generation failed after all retries")
    
    def _build_multi_turn_contents(
        self,
        conversation_history: List,
        refinement_prompt: str,
        width: int,
        height: int,
    ) -> List:
        """
        Build multi-turn contents from conversation history.
        
        Enables cheaper refinements by maintaining context.
        """
        contents = []
        
        for turn in conversation_history:
            if isinstance(turn, dict):
                role = turn.get("role", "user")
                parts = []
                
                if turn.get("text"):
                    parts.append({"text": turn["text"]})
                
                if turn.get("image_data"):
                    image_data = turn["image_data"]
                    if isinstance(image_data, bytes):
                        image_b64 = base64.b64encode(image_data).decode()
                    else:
                        image_b64 = image_data
                    
                    image_part = {
                        "inlineData": {
                            "mimeType": turn.get("image_mime_type", "image/png"),
                            "data": image_b64,
                        }
                    }
                    
                    # Include thought_signature for model-generated images
                    if turn.get("thought_signature"):
                        sig = turn["thought_signature"]
                        if isinstance(sig, bytes):
                            sig_b64 = base64.b64encode(sig).decode()
                        else:
                            sig_b64 = sig
                        image_part["thoughtSignature"] = sig_b64
                    
                    parts.append(image_part)
                
                if parts:
                    contents.append({"role": role, "parts": parts})
        
        # Add refinement request
        refinement_constraint = """Apply this refinement while maintaining:
- The same overall composition and layout
- The same style and artistic approach
- Any text exactly as it was (unless specifically changed)

Refinement: """
        
        contents.append({
            "role": "user",
            "parts": [{
                "text": f"{refinement_constraint}{refinement_prompt}\n\nKeep at {width}x{height} pixels."
            }]
        })
        
        return contents
    
    async def _execute_generation(
        self,
        prompt: str,
        model_name: str,
        seed: Optional[int],
        width: int,
        height: int,
        input_image: Optional[bytes] = None,
        input_mime_type: str = "image/png",
        conversation_history: Optional[List] = None,
        media_assets: Optional[List[MediaAssetInput]] = None,
        enable_grounding: bool = False,
    ) -> GenerationResponse:
        """Execute a single generation request."""
        generation_id = str(uuid.uuid4())
        used_seed = seed if seed is not None else int(time.time() * 1000) % (2**31)
        start_time = time.time()
        
        # Build contents based on mode
        if conversation_history and len(conversation_history) > 0:
            # Multi-turn refinement mode
            contents = self._build_multi_turn_contents(
                conversation_history=conversation_history,
                refinement_prompt=prompt,
                width=width,
                height=height,
            )
        else:
            # Single-turn generation mode
            constrained_prompt = f"{self.STRICT_CONTENT_CONSTRAINT}{prompt}\n\nGenerate as {width}x{height} pixels."
            
            parts = []
            
            # Add input image first if provided
            if input_image is not None:
                parts.append({
                    "inlineData": {
                        "mimeType": input_mime_type,
                        "data": base64.b64encode(input_image).decode()
                    }
                })
            
            # Add prompt
            parts.append({"text": constrained_prompt})
            
            # Add media assets
            if media_assets:
                for asset in media_assets:
                    parts.append({
                        "inlineData": {
                            "mimeType": asset.mime_type,
                            "data": base64.b64encode(asset.image_data).decode()
                        }
                    })
            
            contents = [{"parts": parts}]
        
        # Build request body
        request_body = {
            "contents": contents,
            "generationConfig": {
                "responseModalities": ["IMAGE", "TEXT"],
                "responseMimeType": "text/plain",
            },
            "safetySettings": [
                {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"},
                {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_MEDIUM_AND_ABOVE"},
                {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"},
                {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"},
            ]
        }
        
        # Add grounding tool if enabled
        if enable_grounding:
            request_body["tools"] = [{"google_search": {}}]
            logger.info("Google Search grounding enabled")
        
        url = f"{self.BASE_URL}/models/{model_name}:generateContent"
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": self.api_key,
        }
        
        try:
            session = await self._get_session()
            async with session.post(url, json=request_body, headers=headers) as response:
                inference_time_ms = int((time.time() - start_time) * 1000)
                
                if response.status == 200:
                    data = await response.json()
                    image_data, thought_signature = self._extract_image_data(data)
                    
                    return GenerationResponse(
                        image_data=image_data,
                        generation_id=generation_id,
                        seed=used_seed,
                        inference_time_ms=inference_time_ms,
                        thought_signature=thought_signature,
                    )
                
                elif response.status == 429:
                    retry_after = int(response.headers.get("Retry-After", 60))
                    raise RateLimitError(retry_after=retry_after)
                
                elif response.status == 400:
                    error_data = await response.json()
                    error_str = str(error_data)
                    
                    if any(term in error_str.lower() for term in ["safety", "blocked", "policy"]):
                        raise ContentPolicyError(reason=error_str)
                    
                    raise GenerationError(
                        message=f"Bad request: {error_str}",
                        details=error_data,
                    )
                
                else:
                    error_text = await response.text()
                    raise GenerationError(
                        message=f"API error {response.status}: {error_text}",
                        details={"status": response.status},
                    )
        
        except asyncio.TimeoutError:
            raise GenerationTimeoutError(timeout_seconds=self.timeout)
        
        except (RateLimitError, ContentPolicyError, GenerationTimeoutError, GenerationError):
            raise
        
        except Exception as e:
            raise GenerationError(
                message=f"Generation failed: {str(e)}",
                details={"original_error": str(e)},
            )
    
    def _extract_image_data(self, data: dict) -> tuple[bytes, Optional[bytes]]:
        """Extract image bytes and thought_signature from response."""
        candidates = data.get("candidates", [])
        if not candidates:
            raise GenerationError(
                message="No image generated",
                details={"reason": "Empty response"},
            )
        
        content = candidates[0].get("content", {})
        parts = content.get("parts", [])
        
        image_data = None
        thought_signature = None
        
        for part in parts:
            if "inlineData" in part:
                inline_data = part["inlineData"]
                if "data" in inline_data:
                    image_data = base64.b64decode(inline_data["data"])
                if "thoughtSignature" in part:
                    thought_signature = base64.b64decode(part["thoughtSignature"])
        
        if image_data:
            return image_data, thought_signature
        
        # Check for text response explaining failure
        for part in parts:
            if "text" in part:
                raise GenerationError(
                    message=f"No image generated: {part['text'][:200]}",
                    details={"model_response": part["text"]},
                )
        
        raise GenerationError(
            message="No image data in response",
            details={"response": data},
        )


# Factory function
def create_ai_client(
    timeout: int = 120,
    max_retries: int = 3,
) -> AIGenerationClient:
    """Create an AI generation client from environment."""
    return AIGenerationClient(timeout=timeout, max_retries=max_retries)


# Singleton
_ai_client: Optional[AIGenerationClient] = None


def get_ai_client() -> AIGenerationClient:
    """Get or create the AI client singleton."""
    global _ai_client
    if _ai_client is None:
        _ai_client = create_ai_client()
    return _ai_client
```

## Usage Examples

### Basic Generation

```python
client = get_ai_client()

request = GenerationRequest(
    prompt="A cute cartoon banana mascot waving",
    width=512,
    height=512,
)

response = await client.generate(request)
# response.image_data contains PNG bytes
```

### With Reference Image

```python
request = GenerationRequest(
    prompt="Transform this sketch into a polished illustration",
    width=1024,
    height=1024,
    input_image=sketch_bytes,
    input_mime_type="image/png",
)

response = await client.generate(request)
```

### Multi-Turn Refinement

```python
# First generation
request1 = GenerationRequest(
    prompt="A gaming thumbnail with bold text 'EPIC WIN'",
    width=1280,
    height=720,
)
response1 = await client.generate(request1)

# Refinement (cheaper, uses conversation context)
request2 = GenerationRequest(
    prompt="Make the text bigger and add more glow",
    width=1280,
    height=720,
    conversation_history=[
        {"role": "user", "text": request1.prompt},
        {
            "role": "model",
            "image_data": response1.image_data,
            "thought_signature": response1.thought_signature,
        },
    ],
)
response2 = await client.generate(request2)
```

### With Media Assets

```python
request = GenerationRequest(
    prompt="Gaming thumbnail with the user's logo in bottom-right",
    width=1280,
    height=720,
    media_assets=[
        MediaAssetInput(
            image_data=logo_bytes,
            mime_type="image/png",
            asset_type="logo",
            display_name="User Logo",
        ),
    ],
)

response = await client.generate(request)
```

## Best Practices

1. **Always use retry logic** - AI APIs can be flaky
2. **Handle rate limits gracefully** - Respect Retry-After headers
3. **Don't retry content policy errors** - These won't succeed on retry
4. **Use strict prompts** - Prevent hallucination with explicit constraints
5. **Track thought signatures** - Required for multi-turn refinements
6. **Set appropriate timeouts** - Image generation can take 30-120s
7. **Log generation IDs** - Essential for debugging and support
