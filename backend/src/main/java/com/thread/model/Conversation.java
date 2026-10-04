package com.thread.model;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.index.Indexed;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Document("conversations")
public class Conversation {
  @Id
  public String id;
  public String name;
  public boolean group = false;
  public String color = "#6c8cff";
  public String avatar;
  public String ring;
  public String creatorId;
  @Indexed
  public List<String> participantIds = new ArrayList<>();

  // Cached last message details for quick chat list rendering
  public String preview = "";
  public String previewType;
  public String previewName;
  public String previewExt;
  public String time = "now";
  public String lastMessageText;
  public String lastMessageSenderId;

  public Instant updatedAt = Instant.now();
  public Instant createdAt = Instant.now();

  // Client-populated / transient fields per user
  public int unread = 0;
  public boolean online = false;
  public boolean muted = false;
  public List<Message> messages = new ArrayList<>();
}
