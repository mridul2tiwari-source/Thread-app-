package com.thread.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class SmsService {

  @Value("${twilio.account-sid:${TWILIO_ACCOUNT_SID:}}")
  private String accountSid;

  @Value("${twilio.auth-token:${TWILIO_AUTH_TOKEN:}}")
  private String authToken;

  @Value("${twilio.verify-service-sid:${TWILIO_VERIFY_SERVICE_SID:}}")
  private String verifyServiceSid;

  private final HttpClient httpClient = HttpClient.newBuilder()
      .connectTimeout(Duration.ofSeconds(10))
      .build();

  private final ObjectMapper objectMapper = new ObjectMapper();

  // In-memory rate limiting / cooldown cache per phone (Phone -> Last Sent Epoch Millis)
  private final Map<String, Long> lastSentTimeMap = new ConcurrentHashMap<>();

  /**
   * Check if Twilio Verify credentials are fully configured.
   */
  public boolean isConfigured() {
    return accountSid != null && !accountSid.trim().isEmpty() && !accountSid.contains("your_")
        && authToken != null && !authToken.trim().isEmpty() && !authToken.contains("your_")
        && verifyServiceSid != null && !verifyServiceSid.trim().isEmpty() && !verifyServiceSid.contains("your_");
  }

  /**
   * Normalizes phone number into standard E.164 format.
   * Supports international format with country codes.
   * Defaults 10-digit Indian numbers (e.g. 9876543210) to +919876543210.
   */
  public String normalizePhone(String rawPhone) {
    if (rawPhone == null || rawPhone.trim().isEmpty()) {
      throw new IllegalArgumentException("Enter a valid phone number.");
    }

    // Remove all whitespace, dashes, dots, brackets
    String sanitized = rawPhone.trim().replaceAll("[\\s\\-\\(\\)\\.]", "");

    if (sanitized.startsWith("00")) {
      sanitized = "+" + sanitized.substring(2);
    }

    if (!sanitized.startsWith("+")) {
      // If starts with 0 and followed by 10 digits (e.g. 09876543210)
      if (sanitized.startsWith("0") && sanitized.length() == 11) {
        sanitized = "+91" + sanitized.substring(1);
      }
      // Standard 10-digit Indian mobile number
      else if (sanitized.length() == 10 && sanitized.matches("^[6-9]\\d{9}$")) {
        sanitized = "+91" + sanitized;
      }
      // If other digit string without '+', prefix with '+'
      else if (sanitized.matches("^\\d{10,15}$")) {
        sanitized = "+" + sanitized;
      }
    }

    // Strict E.164 verification: + followed by 7 to 15 digits (first digit 1-9)
    if (!sanitized.matches("^\\+[1-9]\\d{7,14}$")) {
      throw new IllegalArgumentException("Enter a valid phone number in international format (e.g. +919876543210).");
    }

    return sanitized;
  }

  /**
   * Sends real SMS OTP to the recipient via Twilio Verify API.
   */
  public void sendVerification(String rawPhone) {
    String phone = normalizePhone(rawPhone);

    // Enforce 60-second resend cooldown
    Long lastSent = lastSentTimeMap.get(phone);
    if (lastSent != null) {
      long elapsed = (System.currentTimeMillis() - lastSent) / 1000;
      if (elapsed < 60) {
        long wait = 60 - elapsed;
        throw new IllegalStateException("Please wait " + wait + " seconds before requesting another code.");
      }
    }

    if (!isConfigured()) {
      System.err.println("[SMS ERROR] Twilio SMS provider is not configured.");
      System.err.println("Required environment variables: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID");
      throw new IllegalStateException("SMS provider credentials are missing. Please configure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID in backend/.env.");
    }

    try {
      String url = String.format("https://verify.twilio.com/v2/Services/%s/Verifications", verifyServiceSid.trim());
      String formData = "To=" + URLEncoder.encode(phone, StandardCharsets.UTF_8) + "&Channel=sms";
      String basicAuth = Base64.getEncoder().encodeToString((accountSid.trim() + ":" + authToken.trim()).getBytes(StandardCharsets.UTF_8));

      HttpRequest request = HttpRequest.newBuilder()
          .uri(URI.create(url))
          .header("Content-Type", "application/x-www-form-urlencoded")
          .header("Authorization", "Basic " + basicAuth)
          .timeout(Duration.ofSeconds(15))
          .POST(HttpRequest.BodyPublishers.ofString(formData))
          .build();

      HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

      if (response.statusCode() >= 200 && response.statusCode() < 300) {
        lastSentTimeMap.put(phone, System.currentTimeMillis());
        System.out.println("[SMS SUCCESS] Twilio Verify OTP sent to " + maskPhone(phone));
      } else {
        String respBody = response.body();
        System.err.println("[SMS TWILIO ERROR] Response (" + response.statusCode() + "): " + respBody);
        handleTwilioError(respBody, response.statusCode());
      }
    } catch (IllegalStateException | IllegalArgumentException e) {
      throw e;
    } catch (Exception e) {
      System.err.println("[SMS EXCEPTION] Failed to connect to Twilio Verify: " + e.getMessage());
      throw new RuntimeException("Unable to send verification code. Please check your network and try again.");
    }
  }

  /**
   * Verifies the 6-digit OTP code against Twilio Verify API.
   */
  public boolean checkVerification(String rawPhone, String code) {
    if (code == null || code.trim().length() < 4) {
      throw new IllegalArgumentException("Enter a valid verification code.");
    }

    String phone = normalizePhone(rawPhone);

    if (!isConfigured()) {
      System.err.println("[SMS ERROR] Twilio SMS provider is not configured.");
      throw new IllegalStateException("SMS provider credentials are missing. Please configure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID.");
    }

    try {
      String url = String.format("https://verify.twilio.com/v2/Services/%s/VerificationChecks", verifyServiceSid.trim());
      String formData = "To=" + URLEncoder.encode(phone, StandardCharsets.UTF_8)
          + "&Code=" + URLEncoder.encode(code.trim(), StandardCharsets.UTF_8);
      String basicAuth = Base64.getEncoder().encodeToString((accountSid.trim() + ":" + authToken.trim()).getBytes(StandardCharsets.UTF_8));

      HttpRequest request = HttpRequest.newBuilder()
          .uri(URI.create(url))
          .header("Content-Type", "application/x-www-form-urlencoded")
          .header("Authorization", "Basic " + basicAuth)
          .timeout(Duration.ofSeconds(15))
          .POST(HttpRequest.BodyPublishers.ofString(formData))
          .build();

      HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

      if (response.statusCode() >= 200 && response.statusCode() < 300) {
        JsonNode node = objectMapper.readTree(response.body());
        String status = node.has("status") ? node.get("status").asText() : "";
        boolean valid = node.has("valid") && node.get("valid").asBoolean();

        if ("approved".equalsIgnoreCase(status) && valid) {
          // Clear cooldown on success
          lastSentTimeMap.remove(phone);
          return true;
        } else {
          return false;
        }
      } else {
        String respBody = response.body();
        System.err.println("[SMS CHECK TWILIO ERROR] Response (" + response.statusCode() + "): " + respBody);
        handleTwilioCheckError(respBody, response.statusCode());
        return false;
      }
    } catch (IllegalStateException | IllegalArgumentException e) {
      throw e;
    } catch (Exception e) {
      System.err.println("[SMS CHECK EXCEPTION] Failed to verify OTP with Twilio: " + e.getMessage());
      throw new RuntimeException("Verification service is currently unavailable. Please try again.");
    }
  }

  private void handleTwilioError(String respBody, int statusCode) {
    try {
      JsonNode json = objectMapper.readTree(respBody);
      int code = json.has("code") ? json.get("code").asInt() : 0;
      String message = json.has("message") ? json.get("message").asText() : "";

      if (code == 60200 || code == 21211) {
        throw new IllegalArgumentException("Enter a valid phone number.");
      } else if (code == 60203) {
        throw new IllegalStateException("Too many verification attempts. Please wait a few minutes before trying again.");
      } else if (code == 60033 || code == 21614) {
        throw new IllegalArgumentException("Unable to send SMS to this number. Please check the country code and number.");
      } else {
        throw new RuntimeException("Unable to send verification code. Please try again.");
      }
    } catch (IllegalArgumentException | IllegalStateException e) {
      throw e;
    } catch (Exception ignored) {
      throw new RuntimeException("Unable to send verification code. Please try again.");
    }
  }

  private void handleTwilioCheckError(String respBody, int statusCode) {
    try {
      JsonNode json = objectMapper.readTree(respBody);
      int code = json.has("code") ? json.get("code").asInt() : 0;

      if (code == 20404) {
        throw new IllegalArgumentException("Your verification code has expired. Please request a new code.");
      } else if (code == 60202) {
        throw new IllegalStateException("Too many attempts. Please request a new verification code.");
      } else {
        throw new IllegalArgumentException("Invalid verification code.");
      }
    } catch (IllegalArgumentException | IllegalStateException e) {
      throw e;
    } catch (Exception ignored) {
      throw new IllegalArgumentException("Invalid verification code.");
    }
  }

  public String maskPhone(String phone) {
    if (phone == null || phone.length() < 7) return phone;
    int len = phone.length();
    String prefix = phone.substring(0, Math.min(3, len - 4));
    String suffix = phone.substring(len - 3);
    return prefix + "******" + suffix;
  }
}
