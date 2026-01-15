# AI Coaching System Pattern

> Multi-turn conversational AI for intent extraction, clarification, and generation readiness detection.

## Overview

This pattern implements an AI coaching system that:
- Guides users through articulating creative intent
- Extracts structured parameters from conversation
- Detects when intent is ready for generation
- Handles clarification questions for ambiguous input
- Manages session state across turns

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│   Coach     │────▶│    LLM      │
│  (Chat UI)  │     │  Service    │     │  (Gemini)   │
└─────────────┘     └─────────────┘     └─────────────┘
                          │
                          ├── Session Manager
                          ├── Intent Parser
                          ├── Prompt Builder
                          └── Grounding Service
```

## Implementation

### Session Model

```python
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List, Dict, Any
from enum import Enum


class SessionStatus(str, Enum):
    ACTIVE = "active"
    COMPLETED = "completed"
    EXPIRED = "expired"


@dataclass
class CoachMessage:
    """A message in the coaching conversation."""
    role: str  # "user" or "assistant"
    content: str
    timestamp: float
    tokens_in: int = 0
    tokens_out: int = 0


@dataclass
class CoachSession:
    """
    Represents a coaching session.
    
    Tracks conversation history, extracted intent,
    and session metadata.
    """
    session_id: str
    user_id: str
    status: SessionStatus
    asset_type: str
    mood: Optional[str]
    brand_context: Dict[str, Any]
    game_context: Optional[str]
    messages: List[CoachMessage] = field(default_factory=list)
    intent_schema: Optional[Dict[str, Any]] = None
    current_prompt_draft: Optional[str] = None
    prompt_history: List[str] = field(default_factory=list)
    turns_used: int = 0
    tokens_in_total: int = 0
    tokens_out_total: int = 0
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)


### Intent Schema

```python
from dataclasses import dataclass, field
from typing import Optional, List
from enum import Enum


class ReadinessState(str, Enum):
    """States for generation readiness."""
    NOT_READY = "not_ready"
    NEEDS_CLARIFICATION = "needs_clarification"
    AWAITING_CONFIRMATION = "awaiting_confirmation"
    READY = "ready"


@dataclass
class AmbiguousAnnotation:
    """An annotation that needs clarification."""
    text: str
    possible_intents: List[str]  # ["render", "display_text"]
    resolved: bool = False
    resolution: Optional[str] = None


@dataclass
class SceneElement:
    """An element to render in the scene."""
    description: str
    position: Optional[str] = None  # "center", "left", "background"
    style: Optional[str] = None


@dataclass
class DisplayText:
    """Text to display in the output."""
    text: str
    style: Optional[str] = None  # "bold", "neon", "handwritten"
    position: Optional[str] = None


@dataclass
class CreativeIntentSchema:
    """
    Structured representation of user's creative intent.
    
    Extracted from conversation and used to determine
    generation readiness.
    """
    asset_type: str
    mood: Optional[str] = None
    game_context: Optional[str] = None
    brand_context: Optional[Dict[str, Any]] = None
    
    # Extracted elements
    scene_elements: List[SceneElement] = field(default_factory=list)
    display_texts: List[DisplayText] = field(default_factory=list)
    ambiguous_annotations: List[AmbiguousAnnotation] = field(default_factory=list)
    
    # Readiness tracking
    turn_count: int = 0
    user_confirmed_vision: bool = False
    last_coach_summary: Optional[str] = None
    
    def get_readiness(self) -> ReadinessState:
        """Determine current readiness state."""
        # First turn can never be ready
        if self.turn_count == 0:
            return ReadinessState.NOT_READY
        
        # Check for unresolved ambiguities
        unresolved = [a for a in self.ambiguous_annotations if not a.resolved]
        if unresolved:
            return ReadinessState.NEEDS_CLARIFICATION
        
        # Need user confirmation
        if not self.user_confirmed_vision:
            return ReadinessState.AWAITING_CONFIRMATION
        
        return ReadinessState.READY
    
    def is_ready(self) -> bool:
        """Check if ready for generation."""
        return self.get_readiness() == ReadinessState.READY
    
    def get_clarification_questions(self) -> List[str]:
        """Get questions for unresolved ambiguities."""
        questions = []
        for amb in self.ambiguous_annotations:
            if not amb.resolved:
                questions.append(
                    f'Should "{amb.text}" be rendered as an image element '
                    f'or displayed as text?'
                )
        return questions
    
    def get_missing_info(self) -> List[str]:
        """Get list of missing required information."""
        missing = []
        if not self.scene_elements and not self.display_texts:
            missing.append("No visual elements or text specified")
        return missing
    
    def to_generation_description(self) -> str:
        """Convert to generation prompt."""
        parts = []
        
        if self.mood:
            parts.append(f"Mood: {self.mood}")
        
        if self.game_context:
            parts.append(f"Game: {self.game_context}")
        
        if self.scene_elements:
            elements = [e.description for e in self.scene_elements]
            parts.append(f"Scene: {', '.join(elements)}")
        
        if self.display_texts:
            texts = [f'"{t.text}"' for t in self.display_texts]
            parts.append(f"Text: {', '.join(texts)}")
        
        if self.last_coach_summary:
            parts.append(f"\n{self.last_coach_summary}")
        
        return "\n".join(parts)
    
    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dict for storage."""
        return {
            "asset_type": self.asset_type,
            "mood": self.mood,
            "game_context": self.game_context,
            "scene_elements": [
                {"description": e.description, "position": e.position, "style": e.style}
                for e in self.scene_elements
            ],
            "display_texts": [
                {"text": t.text, "style": t.style, "position": t.position}
                for t in self.display_texts
            ],
            "ambiguous_annotations": [
                {"text": a.text, "possible_intents": a.possible_intents, 
                 "resolved": a.resolved, "resolution": a.resolution}
                for a in self.ambiguous_annotations
            ],
            "turn_count": self.turn_count,
            "user_confirmed_vision": self.user_confirmed_vision,
            "last_coach_summary": self.last_coach_summary,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CreativeIntentSchema":
        """Deserialize from dict."""
        schema = cls(
            asset_type=data.get("asset_type", ""),
            mood=data.get("mood"),
            game_context=data.get("game_context"),
        )
        
        for e in data.get("scene_elements", []):
            schema.scene_elements.append(SceneElement(**e))
        
        for t in data.get("display_texts", []):
            schema.display_texts.append(DisplayText(**t))
        
        for a in data.get("ambiguous_annotations", []):
            schema.ambiguous_annotations.append(AmbiguousAnnotation(**a))
        
        schema.turn_count = data.get("turn_count", 0)
        schema.user_confirmed_vision = data.get("user_confirmed_vision", False)
        schema.last_coach_summary = data.get("last_coach_summary")
        
        return schema
```


### Intent Parser

```python
import re
from typing import Tuple


class IntentParser:
    """
    Parses user messages and coach responses to extract intent.
    
    Responsibilities:
    - Parse initial request for base intent
    - Update schema from user messages
    - Extract structured data from coach responses
    - Detect confirmation signals
    """
    
    # Patterns for detecting user confirmation
    CONFIRMATION_PATTERNS = [
        r"\b(yes|yeah|yep|sure|ok|okay|perfect|great|looks good|that's it|exactly)\b",
        r"\b(let's go|do it|generate|create it|make it)\b",
    ]
    
    def parse_initial_request(
        self,
        description: str,
        asset_type: str,
        mood: Optional[str] = None,
        game_context: Optional[str] = None,
        canvas_description: Optional[str] = None,
        brand_context: Optional[Dict] = None,
    ) -> CreativeIntentSchema:
        """
        Parse initial request into intent schema.
        
        Args:
            description: User's initial description
            asset_type: Type of asset to create
            mood: Optional mood/vibe
            game_context: Optional game name
            canvas_description: Optional canvas layout description
            brand_context: Optional brand kit data
            
        Returns:
            Initial CreativeIntentSchema
        """
        schema = CreativeIntentSchema(
            asset_type=asset_type,
            mood=mood,
            game_context=game_context,
            brand_context=brand_context,
            turn_count=0,
        )
        
        # Extract quoted text as potential display text
        quoted = re.findall(r'"([^"]+)"', description)
        for text in quoted:
            schema.display_texts.append(DisplayText(text=text))
        
        # Extract scene elements from description
        # (simplified - real implementation would use NLP)
        if description and not quoted:
            schema.scene_elements.append(SceneElement(description=description))
        
        return schema
    
    def parse_user_message(
        self,
        message: str,
        schema: CreativeIntentSchema,
        last_coach_message: Optional[str] = None,
    ) -> Tuple[CreativeIntentSchema, bool]:
        """
        Parse user message to update intent schema.
        
        Args:
            message: User's message
            schema: Current intent schema
            last_coach_message: Previous coach response
            
        Returns:
            Tuple of (updated schema, is_confirmation)
        """
        schema.turn_count += 1
        
        # Check for confirmation
        is_confirmation = self._is_confirmation(message)
        if is_confirmation:
            schema.user_confirmed_vision = True
        
        # Check for clarification responses
        message_lower = message.lower()
        for amb in schema.ambiguous_annotations:
            if not amb.resolved:
                if "text" in message_lower or "display" in message_lower:
                    amb.resolved = True
                    amb.resolution = "display_text"
                elif "render" in message_lower or "image" in message_lower:
                    amb.resolved = True
                    amb.resolution = "render"
        
        # Extract new quoted text
        quoted = re.findall(r'"([^"]+)"', message)
        for text in quoted:
            if not any(t.text == text for t in schema.display_texts):
                schema.display_texts.append(DisplayText(text=text))
        
        return schema, is_confirmation
    
    def parse_coach_response(
        self,
        response: str,
        schema: CreativeIntentSchema,
    ) -> CreativeIntentSchema:
        """
        Parse coach response to update intent schema.
        
        Extracts:
        - Summary of understood intent
        - Clarification questions
        - Ready signal
        """
        # Extract summary (text after "I understand" or similar)
        summary_match = re.search(
            r"(?:I understand|So you want|Let me summarize)[:\s]+(.+?)(?:\n\n|$)",
            response,
            re.IGNORECASE | re.DOTALL,
        )
        if summary_match:
            schema.last_coach_summary = summary_match.group(1).strip()
        
        # Check for [INTENT_READY] marker
        if "[INTENT_READY]" in response:
            # Coach believes intent is clear
            # But we still require user confirmation
            pass
        
        return schema
    
    def _is_confirmation(self, message: str) -> bool:
        """Check if message is a confirmation."""
        message_lower = message.lower().strip()
        
        for pattern in self.CONFIRMATION_PATTERNS:
            if re.search(pattern, message_lower):
                return True
        
        return False


# Singleton
_intent_parser: Optional[IntentParser] = None


def get_intent_parser() -> IntentParser:
    global _intent_parser
    if _intent_parser is None:
        _intent_parser = IntentParser()
    return _intent_parser
```

### Prompt Builder

```python
from dataclasses import dataclass
from typing import Optional, Dict, Any, List


@dataclass
class PromptContext:
    """Context for building coach prompts."""
    asset_type: str
    mood: Optional[str] = None
    custom_mood: Optional[str] = None
    brand_context: Optional[Dict[str, Any]] = None
    game_name: Optional[str] = None
    game_context: Optional[str] = None
    description: str = ""
    preferences: Optional[Dict[str, Any]] = None
    community_assets: Optional[List[Dict]] = None
    media_asset_placements: Optional[List[Dict]] = None
    canvas_snapshot_url: Optional[str] = None
    canvas_snapshot_description: Optional[str] = None


class PromptBuilder:
    """
    Builds system prompts and first messages for coach sessions.
    
    The coach helps users articulate WHAT they want,
    not HOW to prompt the AI.
    """
    
    SYSTEM_PROMPT_TEMPLATE = """You are a creative coach helping users design {asset_type} assets.

Your role is to help the user articulate their creative vision clearly. You do NOT generate images - you help clarify what they want.

RULES:
1. Ask clarifying questions to understand their vision
2. Summarize what you understand after each exchange
3. When the vision is clear and complete, say [INTENT_READY]
4. Never say [INTENT_READY] on the first turn - always ask at least one question
5. Focus on WHAT they want, not HOW to achieve it technically

ASSET TYPE: {asset_type}
{mood_section}
{brand_section}
{game_section}

When summarizing, be specific about:
- Visual elements to include
- Text to display (exact wording)
- Overall mood/style
- Layout preferences
"""
    
    FIRST_MESSAGE_TEMPLATE = """The user wants to create a {asset_type}.

Their initial description: "{description}"

{context_section}

Help them refine this vision. Ask about:
- Specific visual elements they want
- Any text to include (exact wording)
- Style/mood preferences
- Layout preferences

Remember: Ask at least one clarifying question before saying the intent is ready."""
    
    def build_system_prompt(self, context: PromptContext) -> str:
        """Build system prompt for coach session."""
        mood_section = ""
        if context.mood:
            mood_section = f"MOOD: {context.custom_mood or context.mood}"
        
        brand_section = ""
        if context.brand_context:
            brand_name = context.brand_context.get("name", "User's brand")
            brand_section = f"BRAND: {brand_name}"
        
        game_section = ""
        if context.game_name:
            game_section = f"GAME CONTEXT: {context.game_name}"
            if context.game_context:
                game_section += f"\n{context.game_context}"
        
        return self.SYSTEM_PROMPT_TEMPLATE.format(
            asset_type=context.asset_type,
            mood_section=mood_section,
            brand_section=brand_section,
            game_section=game_section,
        )
    
    def build_first_message(self, context: PromptContext) -> str:
        """Build first user message for coach."""
        context_section = ""
        
        if context.canvas_snapshot_description:
            context_section += f"\nCanvas layout: {context.canvas_snapshot_description}"
        
        if context.community_assets:
            asset_names = [a.get("display_name", "asset") for a in context.community_assets]
            context_section += f"\nUsing community assets: {', '.join(asset_names)}"
        
        return self.FIRST_MESSAGE_TEMPLATE.format(
            asset_type=context.asset_type,
            description=context.description,
            context_section=context_section,
        )
    
    def build_system_prompt_from_session(self, session: CoachSession) -> str:
        """Build system prompt from existing session."""
        context = PromptContext(
            asset_type=session.asset_type,
            mood=session.mood,
            brand_context=session.brand_context,
            game_context=session.game_context,
        )
        return self.build_system_prompt(context)


# Singleton
_prompt_builder: Optional[PromptBuilder] = None


def get_prompt_builder() -> PromptBuilder:
    global _prompt_builder
    if _prompt_builder is None:
        _prompt_builder = PromptBuilder()
    return _prompt_builder
```


### Coach Service

```python
import logging
import time
from typing import Optional, Dict, Any, AsyncGenerator, List

logger = logging.getLogger(__name__)

MAX_TURNS = 10  # Maximum turns per session


@dataclass
class StreamChunk:
    """A chunk of streamed response."""
    type: str  # "token", "grounding", "intent_ready", "done", "error"
    content: str = ""
    metadata: Optional[Dict[str, Any]] = None


class CoachService:
    """
    Unified Coach Service - orchestrates coaching flows.
    
    Responsibilities:
    - Start sessions with pre-loaded context
    - Continue conversations with refinement
    - End sessions and extract final intent
    - Track intent parameters for generation readiness
    """
    
    def __init__(
        self,
        session_manager: SessionManager,
        llm_client: LLMClient,
        intent_parser: IntentParser,
        prompt_builder: PromptBuilder,
    ):
        self.sessions = session_manager
        self.llm = llm_client
        self.parser = intent_parser
        self.prompts = prompt_builder
    
    async def start_with_context(
        self,
        user_id: str,
        brand_context: Dict[str, Any],
        asset_type: str,
        mood: str,
        description: str,
        game_name: Optional[str] = None,
        tier: str = "studio",
    ) -> AsyncGenerator[StreamChunk, None]:
        """Start a coaching session with pre-loaded context."""
        
        # Build prompts
        context = PromptContext(
            asset_type=asset_type,
            mood=mood,
            brand_context=brand_context,
            game_name=game_name,
            description=description,
        )
        system_prompt = self.prompts.build_system_prompt(context)
        first_message = self.prompts.build_first_message(context)
        
        # Create session
        session = await self.sessions.create(
            user_id=user_id,
            asset_type=asset_type,
            mood=mood,
            brand_context=brand_context,
            game_context=game_name,
        )
        
        # Initialize intent schema
        intent_schema = self.parser.parse_initial_request(
            description=description,
            asset_type=asset_type,
            mood=mood,
            game_context=game_name,
            brand_context=brand_context,
        )
        intent_schema.turn_count = 0
        
        # Store schema in session
        session.intent_schema = intent_schema.to_dict()
        await self.sessions.update(session)
        
        # Stream LLM response
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": first_message},
        ]
        
        full_response = ""
        tokens_in, tokens_out = 0, 0
        
        async for token in self.llm.stream_chat(messages):
            full_response += token
            yield StreamChunk(type="token", content=token)
        
        # Parse coach response
        intent_schema = self.parser.parse_coach_response(full_response, intent_schema)
        
        # Get readiness (first turn is NEVER ready)
        readiness = intent_schema.get_readiness()
        is_ready = intent_schema.is_ready()
        
        # Update session
        session.intent_schema = intent_schema.to_dict()
        await self.sessions.update(session)
        
        # Save messages
        await self.sessions.add_message(
            session.session_id,
            CoachMessage(role="user", content=first_message, timestamp=time.time()),
        )
        await self.sessions.add_message(
            session.session_id,
            CoachMessage(role="assistant", content=full_response, timestamp=time.time()),
        )
        
        # Emit readiness status
        yield StreamChunk(
            type="intent_ready",
            metadata={
                "is_ready": is_ready,
                "readiness_state": readiness.value,
                "refined_description": intent_schema.to_generation_description(),
                "clarification_questions": intent_schema.get_clarification_questions(),
                "missing_info": intent_schema.get_missing_info(),
            },
        )
        
        yield StreamChunk(
            type="done",
            metadata={
                "session_id": session.session_id,
                "turns_used": 1,
                "turns_remaining": MAX_TURNS - 1,
            },
        )
    
    async def continue_chat(
        self,
        session_id: str,
        user_id: str,
        message: str,
    ) -> AsyncGenerator[StreamChunk, None]:
        """Continue the coaching conversation."""
        
        # Get session
        session = await self.sessions.get(session_id, user_id)
        if not session:
            yield StreamChunk(type="error", content="Session not found")
            return
        
        # Check turn limit
        if session.turns_used >= MAX_TURNS:
            yield StreamChunk(type="error", content="Turn limit reached")
            return
        
        # Load intent schema
        if session.intent_schema:
            intent_schema = CreativeIntentSchema.from_dict(session.intent_schema)
        else:
            intent_schema = CreativeIntentSchema(asset_type=session.asset_type)
        
        # Get last coach message
        last_coach_message = None
        for msg in reversed(session.messages):
            if msg.role == "assistant":
                last_coach_message = msg.content
                break
        
        # Parse user message
        intent_schema, is_confirmation = self.parser.parse_user_message(
            message=message,
            schema=intent_schema,
            last_coach_message=last_coach_message,
        )
        
        # Build messages
        system_prompt = self.prompts.build_system_prompt_from_session(session)
        messages = [{"role": "system", "content": system_prompt}]
        for msg in session.messages:
            messages.append({"role": msg.role, "content": msg.content})
        messages.append({"role": "user", "content": message})
        
        # Stream response
        full_response = ""
        async for token in self.llm.stream_chat(messages):
            full_response += token
            yield StreamChunk(type="token", content=token)
        
        # Parse coach response
        intent_schema = self.parser.parse_coach_response(full_response, intent_schema)
        
        # Get readiness
        readiness = intent_schema.get_readiness()
        is_ready = intent_schema.is_ready()
        
        # Update session
        session.intent_schema = intent_schema.to_dict()
        session.turns_used += 1
        await self.sessions.update(session)
        
        # Save messages
        await self.sessions.add_message(
            session_id,
            CoachMessage(role="user", content=message, timestamp=time.time()),
        )
        await self.sessions.add_message(
            session_id,
            CoachMessage(role="assistant", content=full_response, timestamp=time.time()),
        )
        
        yield StreamChunk(
            type="intent_ready",
            metadata={
                "is_ready": is_ready,
                "readiness_state": readiness.value,
                "refined_description": intent_schema.to_generation_description(),
                "is_confirmation": is_confirmation,
                "user_confirmed_vision": intent_schema.user_confirmed_vision,
                "clarification_questions": intent_schema.get_clarification_questions(),
            },
        )
        
        yield StreamChunk(
            type="done",
            metadata={
                "turns_used": intent_schema.turn_count,
                "turns_remaining": MAX_TURNS - intent_schema.turn_count,
            },
        )
    
    async def end_session(self, session_id: str, user_id: str) -> Dict[str, Any]:
        """End a session and return the final intent."""
        session = await self.sessions.end(session_id, user_id)
        
        return {
            "session_id": session_id,
            "final_prompt": session.current_prompt_draft or "",
            "turns_used": session.turns_used,
        }
```

## API Routes

```python
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/coach")


@router.post("/sessions/start")
async def start_session(
    request: StartSessionRequest,
    current_user: User = Depends(get_current_user),
    coach_service: CoachService = Depends(get_coach_service),
):
    """Start a new coaching session."""
    
    async def generate():
        async for chunk in coach_service.start_with_context(
            user_id=current_user.id,
            brand_context=request.brand_context,
            asset_type=request.asset_type,
            mood=request.mood,
            description=request.description,
            game_name=request.game_name,
        ):
            yield f"data: {json.dumps(chunk.__dict__)}\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
    )


@router.post("/sessions/{session_id}/chat")
async def continue_session(
    session_id: str,
    request: ChatRequest,
    current_user: User = Depends(get_current_user),
    coach_service: CoachService = Depends(get_coach_service),
):
    """Continue a coaching conversation."""
    
    async def generate():
        async for chunk in coach_service.continue_chat(
            session_id=session_id,
            user_id=current_user.id,
            message=request.message,
        ):
            yield f"data: {json.dumps(chunk.__dict__)}\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
    )
```

## Best Practices

1. **Never ready on first turn** - Always ask clarifying questions
2. **Require user confirmation** - Don't assume intent is clear
3. **Track ambiguities** - Explicitly handle unclear input
4. **Summarize understanding** - Show users what you understood
5. **Limit turns** - Prevent infinite conversations
6. **Stream responses** - Better UX for long responses
7. **Persist session state** - Handle reconnections gracefully
