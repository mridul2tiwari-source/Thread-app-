package com.thread.model;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.index.Indexed;
import java.time.Instant;

@Document("users")
public class AppUser {
  @Id
  public String id;

  public String name;
  public String handle;

  @Indexed(unique = true)
  public String email;

  @Indexed(unique = true)
  public String phone;

  public String passwordHash;

  public boolean emailVerified = false;
  public boolean phoneVerified = false;
  public String status = "active"; // active, pending, suspended
  public boolean isActive = true;
  public String role = "USER"; // USER, ADMIN

  public String tick; // blue, red, orange, or null
  public boolean isPro = false;
  public String avatar;
  public String color = "#ff6b4a";
  public boolean online = false;

  public Instant lastLoginAt;
  public Instant lastSeen = Instant.now();
  public Instant createdAt = Instant.now();
  public Instant updatedAt = Instant.now();
  public boolean systemKeyboard = false;
}

