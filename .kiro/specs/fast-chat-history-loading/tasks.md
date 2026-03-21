# Implementation Plan: Fast Chat History Loading

## Overview

This implementation optimizes chat history loading performance through database indexing, query optimization, response caching, and batch operations. The approach focuses on minimizing database query time and data transfer while maintaining backward compatibility with existing API contracts.

## Tasks

- [x] 1. Add database composite index for message retrieval
  - Create SQL migration to add composite index (chat_id, id) on messages table
  - Verify index creation with EXPLAIN ANALYZE on sample queries
  - _Requirements: 1.3, 1.4, 3.1_

- [x] 2. Implement optimized message retrieval function
  - [x] 2.1 Create get_messages_for_chat_optimized() in db_ops.py
    - Add function with selective column retrieval (id, role, content, display_id only)
    - Implement pagination support with limit and offset parameters
    - Use composite index with ORDER BY id ASC in database query
    - Return tuple of (messages, total_count)
    - _Requirements: 1.5, 3.2, 3.3, 3.4, 5.1, 5.2, 7.1, 7.3_
  
  - [ ]* 2.2 Write property test for message retrieval optimization
    - **Property 1: Response Field Restriction**
    - **Validates: Requirements 1.5, 7.1, 7.3, 10.2**
  
  - [ ]* 2.3 Write property test for message ordering
    - **Property 2: Message Ordering Consistency**
    - **Validates: Requirements 3.4**
  
  - [ ]* 2.4 Write property test for limit parameter
    - **Property 3: Limit Parameter Enforcement**
    - **Validates: Requirements 3.3, 5.1**

- [x] 3. Implement response cache with TTL
  - [x] 3.1 Create MessageCache class in main.py
    - Implement in-memory cache with 60-second TTL
    - Add async get(), set(), invalidate(), and cleanup_expired() methods
    - Use asyncio.Lock for thread-safe cache access
    - Use (user_id, chat_id) tuple as cache key
    - _Requirements: 4.1, 4.3_
  
  - [ ]* 3.2 Write property test for cache invalidation on new message
    - **Property 5: Cache Invalidation on New Message**
    - **Validates: Requirements 4.2**
  
  - [ ]* 3.3 Write property test for cache invalidation on chat claim
    - **Property 6: Cache Invalidation on Chat Claim**
    - **Validates: Requirements 4.4**

- [x] 4. Create new GET /messages endpoint
  - [x] 4.1 Implement GET /messages/{email}/{chat_name} endpoint
    - Add async endpoint handler with email, chat_name, limit, offset parameters
    - Look up user by email, then chat by user_id and chat_name
    - Check cache first using MessageCache.get()
    - On cache miss, call get_messages_for_chat_optimized()
    - Store result in cache with MessageCache.set()
    - Return JSON with messages, total_count, has_more, query_time_ms
    - _Requirements: 1.1, 1.2, 5.3, 5.4, 6.3, 7.4, 8.1, 10.1, 10.2_
  
  - [ ]* 4.2 Write property test for pagination metadata
    - **Property 8: Pagination Metadata Presence**
    - **Validates: Requirements 5.4**
  
  - [ ]* 4.3 Write property test for performance metrics
    - **Property 9: Performance Metrics Presence**
    - **Validates: Requirements 6.3**
  
  - [ ]* 4.4 Write property test for user type agnostic retrieval
    - **Property 11: User Type Agnostic Retrieval**
    - **Validates: Requirements 10.4**

- [ ] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Optimize chat claim process with batch updates
  - [x] 6.1 Create update_messages_display_id_batch() in db_ops.py
    - Replace individual message updates with single batch update query
    - Use Supabase .update().eq(chat_id) to update all messages at once
    - _Requirements: 2.2, 2.3_
  
  - [x] 6.2 Update /chats/claim endpoint to use batch function
    - Replace call to update_messages_display_id() with update_messages_display_id_batch()
    - Wrap chat ownership and message updates in try-except for transaction-like behavior
    - Add cache invalidation call after successful claim
    - Measure and log claim operation duration
    - _Requirements: 2.1, 2.4, 4.4, 6.1, 6.2_
  
  - [ ]* 6.3 Write property test for chat claim atomicity
    - **Property 4: Chat Claim Atomicity**
    - **Validates: Requirements 2.2**

- [x] 7. Add error handling and logging
  - [x] 7.1 Add error handling to message retrieval endpoint
    - Catch database connection failures and return HTTP 503
    - Implement 5-second query timeout with HTTP 504 response
    - Return HTTP 404 for non-existent chat or user
    - Return empty array for chats with no messages
    - _Requirements: 9.1, 9.2, 9.4_
  
  - [x] 7.2 Add performance logging
    - Log response time for all message retrieval requests
    - Log warning when response time exceeds 500ms
    - Include chat_id and message count in slow query logs
    - _Requirements: 6.1, 6.2, 9.3_
  
  - [ ]* 7.3 Write property test for database error handling
    - **Property 10: Database Error Handling**
    - **Validates: Requirements 9.1**

- [x] 8. Add pagination parameter validation
  - [x] 8.1 Implement parameter validation in GET /messages endpoint
    - Validate limit >= 0, return HTTP 400 if negative
    - Validate offset >= 0, return HTTP 400 if negative
    - Clamp limit to maximum of 1000 if exceeded
    - Set default limit to 50 if not provided
    - _Requirements: 5.3_
  
  - [ ]* 8.2 Write property test for pagination offset non-overlap
    - **Property 7: Pagination Offset Non-Overlap**
    - **Validates: Requirements 5.2**

- [x] 9. Integrate cache invalidation into existing endpoints
  - [x] 9.1 Add cache invalidation to /chat endpoint
    - After adding new message, call MessageCache.invalidate() with user_id and chat_id
    - _Requirements: 4.2_
  
  - [x] 9.2 Implement background cache cleanup task
    - Create async background task that runs cleanup_expired() every 60 seconds
    - Register task in FastAPI startup event
    - _Requirements: 4.1_

- [ ] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The composite index (chat_id, id) is critical for query performance
- Cache TTL of 60 seconds balances freshness with performance
- Batch updates significantly improve chat claim performance for large message histories
