package com.thread.model;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.index.Indexed;
import java.time.Instant;

@Document("otp_tokens")
public class OtpToken {
  @Id
  public String id;

  @Indexed
  public String email;

  public String purpose; // "SIGNUP", "LOGIN", "PASSWORD_RESET"

  public String otpHash; // BCrypt hash of 6-digit OTP
  public String code;    // Plain code reference (if needed in development or fallback)

  public int attempts = 0; // Max 5 verification attempts

  public Instant lastResendAt = Instant.now(); // For 60-second cooldown calculation

  @Indexed(expireAfterSeconds = 600) // auto-expire in Mongo TTL index
  public Instant expiresAt = Instant.now().plusSeconds(300); // 5 minutes validity

  public boolean used = false;
  public Instant createdAt = Instant.now();
}
