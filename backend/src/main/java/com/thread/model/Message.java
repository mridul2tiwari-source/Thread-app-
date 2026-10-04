package com.thread.model;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.index.Indexed;
import java.time.Instant;
import java.util.List;
import java.util.Map;

@Document("messages")
public class Message {
  @Id
  public String id;

  @Indexed
  public String conversationId;

  @Indexed
  public String senderId;
  public String senderName;

  public String text;
  public String type; // null/"text", "snap", "img", "gif", "video", "voice", "poll", "file"
  public String src;
  public String name;
  public String mime;
  public Long size;
  public Double dur;
  public List<Double> peaks;
  public String caption;

  // Poll fields
  public String question;
  public List<String> options;
  public List<Integer> votes;
  public Integer total;

  // Call fields
  public Map<String, Object> call;

  // Reply / quote info
  public Object reply;

  public boolean forwarded = false;
  public boolean opened = false;
  public boolean edited = false;
  public boolean deleted = false;

  public String time = "now";
  public Instant createdAt = Instant.now();

  // Transient flag populated for client rendering relative to the viewer
  public Boolean sent;
}
