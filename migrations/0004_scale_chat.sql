-- Inbox / group lookups as the conversation list grows.
create index if not exists conv_members_user_arch_idx
  on conversation_members (user_id, archived, conversation_id);
create index if not exists messages_convo_created_desc_idx
  on messages (conversation_id, created_at desc);
create index if not exists conversations_last_idx
  on conversations (last_message_at desc);
