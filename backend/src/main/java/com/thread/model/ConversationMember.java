package com.thread.model;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.Indexed;
import java.time.Instant;

@Document("conversation_members")
@CompoundIndex(name = "conv_user_idx", def = "{'conversationId': 1, 'userId': 1}", unique = true)
public class ConversationMember {
  @Id
  public String id;

  @Indexed
  public String conversationId;

  @Indexed
  public String userId;

  public String role = "member"; // "owner", "admin", "member"
  public int unreadCount = 0;
  public String lastReadMessageId;
  public boolean muted = false;
  public Instant joinedAt = Instant.now();

  public ConversationMember() {}
  public ConversationMember(String conversationId, String userId) {
    this.conversationId = conversationId;
    this.userId = userId;
  }
}
