# Design Document: Fast Chat History Loading

## Overview

This design addresses performance optimization for chat history loading in the DocuMind chat application. The current implementation experiences slow loading times when users log in after chatting as guests and claim their chat history. The primary bottleneck is inefficient database queries and lack of optimization in the message retrieval path.

The solution implements a multi-layered optimization strategy:

1. **Database Layer**: Composite indexes on the messages table to accelerate queries
2. **Query Optimization**: Selective column retrieval and efficient ordering
3. **Caching Layer**: Short-lived response caching with intelligent invalidation
4. **Async Processing**: Non-blocking database operations for concurrent requests
5. **Pagination**: Optional chunked loading for very large chat histories

The design maintains backward compatibility with existing API contracts while delivering sub-200ms response times for typical chat histories (up to 100 messages).

## Architecture

### System Components

```mermaid
graph TB
    Client[Frontend Client]
    API[FastAPI Endpoint]
    Cache[Response Cache]
    DB[Supabase PostgreSQL]
    
    Client -->|GET /messages/{email}/{chat}| API
    API -->|Check cache| Cache
    Cache -->|Cache miss| API
    API -->|Optimized query| DB
    DB -->|Indexed results| API
    API -->|Store result| Cache
    API -->|JSON response| Client
    
    style Cache fill:#f9f,stroke:#333
    style DB fill:#bbf,stroke:#333
```

### Data Flow

1. **Request Phase**: Client requests chat history via `/messages/{email}/{chat_name}`
2. **Cache Check**: API checks in-memory cache using `(user_id, chat_id)` as key
3. **Cache Hit**: Return cached response immediately (< 10ms)
4. **Cache Miss**: Execute optimized database query
5. **Query Execution**: PostgreSQL uses composite index `(chat_id, id)` for fast retrieval
6. **Response Assembly**: Serialize only required fields (role, content, display_id)
7. **Cache Update**: Store response with 60-second TTL
8. **Response Delivery**: Return JSON to client

### Performance Targets

| Scenario | Target | Strategy |
|----------|--------|----------|
| 1-100 messages | < 200ms | Composite index + selective columns |
| 101-1000 messages | < 500ms | Same + async processing |
| Cache hit | < 10ms | In-memory lookup |
| Chat claim | < 300ms | Batch update + transaction |

## Components and Interfaces

### 1. Message Retrieval Endpoint

**New Endpoint**: `GET /messages/{email}/{chat_name}`

```python
@app.get("/messages/{email}/{chat_name}")
async def get_messages(
    email: str,
    chat_name: str,
    limit: Optional[int] = None,
    offset: Optional[int] = 0
) -> dict:
    """
    Retrieve chat history with optimized performance.
    
    Args:
        email: User email address
        chat_name: Name of the chat
        limit: Optional max messages to return (default: all)
        offset: Optional offset for pagination (default: 0)
    
    Returns:
        {
            "messages": [{"role": str, "content": str, "display_id": str}],
            "total_count": int,
            "has_more": bool,
            "query_time_ms": float
        }
    """
```

### 2. Optimized Database Operations

**New Function**: `db_ops.get_messages_for_chat_optimized()`

```python
def get_messages_for_chat_optimized(
    chat_id: int,
    limit: Optional[int] = None,
    offset: int = 0
) -> tuple[list[dict], int]:
    """
    Retrieve messages with performance optimizations.
    
    - Uses composite index (chat_id, id)
    - Selects only required columns
    - Orders by id in database
    - Supports pagination
    
    Returns:
        (messages, total_count)
    """
```

**Modified Function**: `update_messages_display_id()` - Batch Update

```python
def update_messages_display_id_batch(chat_id: int, display_id: str) -> None:
    """
    Update all message display_ids for a chat in a single batch operation.
    Uses Supabase batch update for efficiency.
    """
```

### 3. Response Cache

**Cache Implementation**: In-memory dictionary with TTL

```python
class MessageCache:
    """
    Simple in-memory cache for message responses.
    Thread-safe with asyncio locks.
    """
    
    def __init__(self, ttl_seconds: int = 60):
        self._cache: dict[tuple[int, int], CacheEntry] = {}
        self._lock = asyncio.Lock()
        self._ttl = ttl_seconds
    
    async def get(self, user_id: int, chat_id: int) -> Optional[dict]:
        """Retrieve cached response if not expired."""
    
    async def set(self, user_id: int, chat_id: int, data: dict) -> None:
        """Store response with current timestamp."""
    
    async def invalidate(self, user_id: int, chat_id: int) -> None:
        """Remove cache entry (called when new message added)."""
    
    async def cleanup_expired(self) -> None:
        """Remove expired entries (background task)."""
```

### 4. Database Indexes

**Required Indexes** (to be added via migration):

```sql
-- Composite index for message retrieval (most important)
CREATE INDEX IF NOT EXISTS idx_messages_chat_id_id 
ON messages(chat_id, id);

-- Already exists but verify
CREATE INDEX IF NOT EXISTS idx_messages_chat_id 
ON messages(chat_id);
```

### 5. Chat Claim Optimization

**Modified Endpoint**: `/chats/claim`

```python
@app.post("/chats/claim")
async def claim_guest_chat(body: ClaimChatRequest):
    """
    Optimized chat claim with batch updates and async processing.
    
    - Updates chat ownership
    - Batch updates message display_ids
    - Invalidates cache
    - Returns within 300ms
    """
```

## Data Models

### Message Response Model

```python
class MessageResponse(BaseModel):
    """Optimized message response (excludes unnecessary fields)."""
    role: str
    content: str
    display_id: Optional[str] = None

class MessagesResponse(BaseModel):
    """Response for message retrieval endpoint."""
    messages: list[MessageResponse]
    total_count: int
    has_more: bool
    query_time_ms: float
```

### Cache Entry Model

```python
@dataclass
class CacheEntry:
    """Internal cache entry with TTL."""
    data: dict
    timestamp: float
    
    def is_expired(self, ttl_seconds: int) -> bool:
        return time.time() - self.timestamp > ttl_seconds
```

### Database Schema Changes

No schema changes required. The existing schema supports all operations:

- `messages` table has `chat_id` and `id` columns for indexing
- `messages` table has `role`, `content`, `display_id` for retrieval
- `chats` table has `user_id` and `name` for lookup

**Index Additions** (performance only, no data changes):

```sql
-- Add composite index for optimal query performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_chat_id_id 
ON messages(chat_id, id);
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Response Field Restriction

*For any* message retrieval request, the response messages SHALL contain only the required fields (role, content, display_id) and SHALL NOT include large fields such as embedding data or internal database fields.

**Validates: Requirements 1.5, 7.1, 7.3, 10.2**

### Property 2: Message Ordering Consistency

*For any* chat with multiple messages, when messages are retrieved, they SHALL be ordered by id in ascending order (oldest first).

**Validates: Requirements 3.4**

### Property 3: Limit Parameter Enforcement

*For any* message retrieval request with a limit parameter, the number of messages returned SHALL NOT exceed the specified limit value.

**Validates: Requirements 3.3, 5.1**

### Property 4: Chat Claim Atomicity

*For any* guest chat being claimed by an authenticated user, after the claim operation completes, both the chat ownership AND all associated message display_ids SHALL be updated to reflect the authenticated user's identity.

**Validates: Requirements 2.2**

### Property 5: Cache Invalidation on New Message

*For any* chat, if messages are retrieved (potentially cached), then a new message is added, then messages are retrieved again, the second retrieval SHALL include the newly added message.

**Validates: Requirements 4.2**

### Property 6: Cache Invalidation on Chat Claim

*For any* guest chat, if messages are retrieved (potentially cached), then the chat is claimed by an authenticated user, then messages are retrieved again, the second retrieval SHALL reflect the updated display_id values from the claim operation.

**Validates: Requirements 4.4**

### Property 7: Pagination Offset Non-Overlap

*For any* chat with N messages where N > limit, retrieving messages with offset=0 and offset=limit SHALL return non-overlapping message sets, and the union of both sets SHALL contain 2×limit distinct messages (or fewer if N < 2×limit).

**Validates: Requirements 5.2**

### Property 8: Pagination Metadata Presence

*For any* message retrieval request, the response SHALL include pagination metadata fields: total_count (integer) and has_more (boolean).

**Validates: Requirements 5.4**

### Property 9: Performance Metrics Presence

*For any* message retrieval request, the response SHALL include performance metrics: query_time_ms (float) representing the database query duration.

**Validates: Requirements 6.3**

### Property 10: Database Error Handling

*For any* message retrieval request where the database operation fails, the system SHALL return an error response with a descriptive error message rather than crashing or returning invalid data.

**Validates: Requirements 9.1**

### Property 11: User Type Agnostic Retrieval

*For any* valid user (guest or authenticated), message retrieval SHALL succeed and return the correct messages for chats owned by that user, regardless of user authentication status.

**Validates: Requirements 10.4**

## Error Handling

### Database Errors

**Connection Failures**:
- Catch Supabase connection exceptions
- Return HTTP 503 with message: "Database temporarily unavailable"
- Log error details with chat_id and user_id for debugging

**Query Timeouts**:
- Set query timeout to 5 seconds
- Return HTTP 504 with message: "Request timed out. Please try again."
- Log slow query details for performance analysis

**Invalid Chat/User**:
- Return HTTP 404 with message: "Chat not found" if chat doesn't exist
- Return HTTP 404 with message: "User not found" if user doesn't exist
- Do not expose internal database errors to clients

### Cache Errors

**Cache Corruption**:
- If cached data fails to deserialize, invalidate cache entry
- Fall back to database query
- Log cache error for investigation

**Cache Lock Timeout**:
- If cache lock cannot be acquired within 100ms, skip cache
- Proceed directly to database query
- Log lock contention for monitoring

### Pagination Errors

**Invalid Parameters**:
- If limit < 0, return HTTP 400: "Limit must be non-negative"
- If offset < 0, return HTTP 400: "Offset must be non-negative"
- If limit > 1000, clamp to 1000 and log warning

### Chat Claim Errors

**Concurrent Claims**:
- Use database transaction isolation to prevent race conditions
- If chat already claimed, return success (idempotent operation)
- Log concurrent claim attempts for monitoring

**Partial Update Failure**:
- Wrap chat ownership and message updates in transaction
- On failure, rollback all changes
- Return HTTP 500 with message: "Failed to claim chat. Please try again."

## Testing Strategy

### Dual Testing Approach

This feature requires both unit tests and property-based tests for comprehensive coverage:

**Unit Tests** focus on:
- Specific examples of message retrieval (e.g., chat with 5 messages)
- Edge cases (empty chats, single message, exactly at limit boundary)
- Error conditions (database down, invalid parameters, timeout scenarios)
- Integration points (cache invalidation triggers, transaction rollback)

**Property-Based Tests** focus on:
- Universal properties that hold for all inputs (message ordering, field restrictions)
- Comprehensive input coverage through randomization (various chat sizes, user types)
- Invariants that must hold across operations (cache consistency, atomicity)

### Property-Based Testing Configuration

**Library**: Use `hypothesis` for Python property-based testing

**Configuration**:
- Minimum 100 iterations per property test (due to randomization)
- Each property test must reference its design document property
- Tag format: `# Feature: fast-chat-history-loading, Property {number}: {property_text}`

**Example Property Test Structure**:

```python
from hypothesis import given, strategies as st
import pytest

@given(
    message_count=st.integers(min_value=1, max_value=1000),
    limit=st.integers(min_value=1, max_value=100)
)
@pytest.mark.property_test
def test_property_3_limit_enforcement(message_count, limit):
    """
    Feature: fast-chat-history-loading
    Property 3: Limit Parameter Enforcement
    
    For any message retrieval request with a limit parameter,
    the number of messages returned SHALL NOT exceed the specified limit.
    """
    # Setup: Create chat with message_count messages
    # Execute: Retrieve messages with limit parameter
    # Assert: len(response.messages) <= limit
```

### Unit Test Coverage

**Message Retrieval Tests**:
- Test retrieving messages from chat with 0, 1, 50, 100, 1000 messages
- Test with and without limit/offset parameters
- Test cache hit and cache miss scenarios
- Test response structure and field presence

**Chat Claim Tests**:
- Test claiming guest chat with 0, 1, 50, 100+ messages
- Test concurrent claim attempts (race condition)
- Test claim with invalid guest chat name
- Test claim with non-existent user

**Pagination Tests**:
- Test default limit (50 messages)
- Test offset at boundaries (0, middle, end)
- Test has_more flag accuracy
- Test total_count accuracy

**Error Handling Tests**:
- Mock database connection failure
- Mock query timeout (> 5 seconds)
- Test invalid parameters (negative limit/offset)
- Test non-existent chat/user

**Performance Tests** (separate from unit/property tests):
- Benchmark message retrieval for 100, 500, 1000 messages
- Verify < 200ms for 100 messages, < 500ms for 1000 messages
- Test cache performance (< 10ms for cache hits)
- Test chat claim performance (< 300ms)

### Integration Tests

**End-to-End Scenarios**:
1. Guest user chats → logs in → claims chat → retrieves history
2. User adds message → retrieves history → verifies new message present
3. User retrieves history → another user adds message → first user retrieves again
4. User retrieves with pagination → navigates through pages → verifies all messages

**Database Integration**:
- Verify composite index exists and is used (EXPLAIN ANALYZE)
- Test with real Supabase instance
- Verify transaction isolation for chat claim

**Cache Integration**:
- Verify cache invalidation on message add
- Verify cache invalidation on chat claim
- Verify cache expiration after TTL
- Test cache cleanup background task

### Test Data Generation

**Hypothesis Strategies**:

```python
# Generate realistic chat scenarios
@st.composite
def chat_with_messages(draw):
    message_count = draw(st.integers(min_value=0, max_value=1000))
    messages = [
        {
            "role": draw(st.sampled_from(["user", "model"])),
            "content": draw(st.text(min_size=1, max_size=500)),
            "display_id": draw(st.text(min_size=2, max_size=10))
        }
        for _ in range(message_count)
    ]
    return messages

# Generate pagination parameters
pagination_params = st.fixed_dictionaries({
    "limit": st.integers(min_value=1, max_value=1000),
    "offset": st.integers(min_value=0, max_value=10000)
})
```

### Continuous Performance Monitoring

**Metrics to Track**:
- P50, P95, P99 response times for message retrieval
- Cache hit rate percentage
- Database query execution time
- Chat claim operation duration

**Alerting Thresholds**:
- Alert if P95 response time > 500ms for 5 minutes
- Alert if cache hit rate < 50% for 10 minutes
- Alert if database query time > 1 second
- Alert if chat claim duration > 500ms

