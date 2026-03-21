# Database Migrations

## Fast Chat History Loading - Index Migration

To enable fast chat history loading, you need to run the SQL migration to add a composite index.

### Steps to Apply Migration:

1. Open your Supabase Dashboard
2. Navigate to: **SQL Editor**
3. Open the file: `Backend/migrations/001_add_message_composite_index.sql`
4. Copy the SQL content
5. Paste it into the Supabase SQL Editor
6. Click **Run** to execute the migration

### What This Does:

Creates a composite index `idx_messages_chat_id_id` on the `messages` table with columns `(chat_id, id)`. This dramatically speeds up message retrieval queries by allowing the database to quickly find all messages for a specific chat and return them in order.

### Verification:

After running the migration, you can verify the index was created by running:

```sql
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'messages' 
AND indexname = 'idx_messages_chat_id_id';
```

You should see the index listed with its definition.

### Performance Impact:

- **Before**: Message queries scan the entire messages table
- **After**: Message queries use the index for instant lookups
- **Expected improvement**: 10-100x faster for typical chat histories
