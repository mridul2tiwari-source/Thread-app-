package com.thread.model;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.Instant;

@Document("attachments")
public class Attachment {
  @Id
  public String id;
  public String messageId;
  public String conversationId;
  public String uploaderId;
  public String filename;
  public String mimeType;
  public long sizeBytes;
  public String url;
  public Instant uploadedAt = Instant.now();
}
