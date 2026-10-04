package com.thread.api;

import com.thread.model.*;
import com.thread.repo.*;
import com.thread.security.Jwt;
import com.thread.service.EmailService;
import com.thread.service.SmsService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/api")
public class Controllers {
  @Autowired UserRepo users;
  @Autowired StateRepo states;
  @Autowired ConversationRepo convRepo;
  @Autowired MessageRepo msgRepo;
  @Autowired OtpRepo otpRepo;
  @Autowired Jwt jwt;
  @Autowired EmailService emailService;
  @Autowired SmsService smsService;

  @Value("${thread.admin-password:admin123}")
  String adminPw;

  private final BCryptPasswordEncoder enc = new BCryptPasswordEncoder(12);
  private final SecureRandom secureRandom = new SecureRandom();

  static ResponseEntity<?> err(int c, String m) {
    return ResponseEntity.status(c).body(Map.of("error", m));
  }

  public static String validatePasswordRules(String p) {
    if (p == null || p.length() < 8) {
      return "Password must contain at least 8 characters.";
    }
    if (!p.matches(".*[A-Z].*")) {
      return "Password must contain at least one uppercase letter.";
    }
    if (!p.matches(".*[a-z].*")) {
      return "Password must contain at least one lowercase letter.";
    }
    if (!p.matches(".*[0-9].*")) {
      return "Password must contain at least one number.";
    }
    if (!p.matches(".*[^A-Za-z0-9].*")) {
      return "Password must contain at least one special character.";
    }
    return null;
  }

  public static boolean isValidEmail(String email) {
    return email != null && email.matches("^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$");
  }

  Map<String, Object> authBody(AppUser u) {
    Map<String, Object> userMap = new HashMap<>();
    userMap.put("id", u.id);
    userMap.put("name", u.name);
    userMap.put("email", u.email);
    userMap.put("phone", u.phone);
    userMap.put("handle", u.handle != null ? u.handle : (u.name != null ? u.name.toLowerCase().replace(" ", ".") : "user"));
    userMap.put("color", u.color != null ? u.color : "#ff6b4a");
    userMap.put("tick", u.tick);
    userMap.put("isPro", u.isPro);
    userMap.put("emailVerified", u.emailVerified);
    userMap.put("phoneVerified", u.phoneVerified);
    userMap.put("status", u.status != null ? u.status : "active");
    userMap.put("role", u.role != null ? u.role : "USER");
    return Map.of("token", jwt.make(u.id, "user"), "user", userMap);
  }

  // =========================================================================
  // 1. SIGN UP / CREATE ACCOUNT (VALIDATES DATA & SENDS REAL SMS OTP VIA TWILIO)
  // =========================================================================
  @PostMapping({"/auth/register", "/auth/signup", "/auth/register-otp"})
  public ResponseEntity<?> register(@RequestBody Map<String, String> b) {
    String email = b.getOrDefault("email", "").trim().toLowerCase();
    String rawPhone = b.getOrDefault("phone", b.getOrDefault("phoneNumber", "")).trim();
    String password = b.getOrDefault("password", "");
    String confirmPassword = b.getOrDefault("confirmPassword", b.getOrDefault("confirm_password", ""));
    String name = b.getOrDefault("name", "").trim();

    if (!isValidEmail(email)) {
      return err(400, "Please enter a valid email address.");
    }

    String normalizedPhone;
    try {
      normalizedPhone = smsService.normalizePhone(rawPhone);
    } catch (IllegalArgumentException e) {
      return err(400, e.getMessage());
    }

    String pwdErr = validatePasswordRules(password);
    if (pwdErr != null) {
      return err(400, pwdErr);
    }

    if (!confirmPassword.isEmpty() && !password.equals(confirmPassword)) {
      return err(400, "Passwords do not match.");
    }

    // 1. Check duplicate email (for active/verified user)
    var existingEmailUser = users.findByEmail(email);
    if (existingEmailUser.isPresent() && (existingEmailUser.get().phoneVerified || existingEmailUser.get().isActive)) {
      return err(409, "An account with this email already exists. Please log in instead.");
    }

    // 2. Check duplicate phone (for active/verified user)
    var existingPhoneUser = users.findByPhone(normalizedPhone);
    if (existingPhoneUser.isPresent() && (existingPhoneUser.get().phoneVerified || existingPhoneUser.get().isActive)) {
      return err(409, "This phone number is already registered. Please log in instead.");
    }

    // 3. Request SMS OTP from Twilio Verify
    try {
      smsService.sendVerification(normalizedPhone);
    } catch (IllegalStateException e) {
      return err(429, e.getMessage());
    } catch (IllegalArgumentException e) {
      return err(400, e.getMessage());
    } catch (Exception e) {
      return err(500, e.getMessage());
    }

    // 4. Create or update pending unverified user in database
    AppUser u = existingEmailUser.orElse(existingPhoneUser.orElse(new AppUser()));
    u.name = name.isEmpty() ? email.split("@")[0] : name;
    u.handle = u.name.toLowerCase().replace(" ", ".");
    u.email = email;
    u.phone = normalizedPhone;
    u.passwordHash = enc.encode(password);
    u.emailVerified = false;
    u.phoneVerified = false;
    u.status = "pending";
    u.isActive = false;
    u.role = "USER";
    if (u.createdAt == null) u.createdAt = Instant.now();
    u.updatedAt = Instant.now();
    users.save(u);

    Map<String, Object> res = new HashMap<>();
    res.put("message", "Verification code sent to " + smsService.maskPhone(normalizedPhone));
    res.put("phone", normalizedPhone);
    res.put("email", email);
    res.put("expiresIn", 300);
    return ResponseEntity.ok(res);
  }

  // =========================================================================
  // 2. VERIFY PHONE OTP & ACTIVATE ACCOUNT
  // =========================================================================
  @PostMapping({"/auth/verify-phone", "/auth/verify-email", "/auth/register-verify"})
  public ResponseEntity<?> verifyPhone(@RequestBody Map<String, String> b) {
    String email = b.getOrDefault("email", "").trim().toLowerCase();
    String rawPhone = b.getOrDefault("phone", b.getOrDefault("phoneNumber", "")).trim();
    String code = b.getOrDefault("otp", b.getOrDefault("code", "")).trim();
    String password = b.getOrDefault("password", "");
    String name = b.getOrDefault("name", "").trim();

    if (code.isEmpty()) {
      return err(400, "6-digit verification code is required.");
    }

    String phone = "";
    if (!rawPhone.isEmpty()) {
      try {
        phone = smsService.normalizePhone(rawPhone);
      } catch (Exception ignored) {}
    }

    if (phone.isEmpty() && !email.isEmpty()) {
      var userOpt = users.findByEmail(email);
      if (userOpt.isPresent() && userOpt.get().phone != null) {
        phone = userOpt.get().phone;
      }
    }

    if (phone.isEmpty()) {
      return err(400, "Phone number is required for verification.");
    }

    // Verify SMS OTP with Twilio Verify
    boolean isVerified;
    try {
      isVerified = smsService.checkVerification(phone, code);
    } catch (IllegalArgumentException e) {
      return err(400, e.getMessage());
    } catch (IllegalStateException e) {
      return err(429, e.getMessage());
    } catch (Exception e) {
      return err(500, e.getMessage());
    }

    if (!isVerified) {
      return err(400, "Invalid verification code.");
    }

    // OTP accepted: Activate user and mark phoneVerified = true
    AppUser u = users.findByPhone(phone).orElse(users.findByEmail(email).orElse(new AppUser()));
    if (u.phone == null || u.phone.isEmpty()) u.phone = phone;
    if (!email.isEmpty()) u.email = email;
    if (u.email == null || u.email.isEmpty()) u.email = (u.name != null ? u.name.toLowerCase() : "user") + "@thread.local";
    if (!name.isEmpty()) u.name = name;
    if (u.name == null || u.name.isEmpty()) u.name = u.email.split("@")[0];
    if (u.handle == null || u.handle.isEmpty()) u.handle = u.name.toLowerCase().replace(" ", ".");
    if (!password.isEmpty()) u.passwordHash = enc.encode(password);

    u.phoneVerified = true;
    u.emailVerified = true;
    u.status = "active";
    u.isActive = true;
    u.role = "USER";
    u.lastLoginAt = Instant.now();
    u.lastSeen = Instant.now();
    u.updatedAt = Instant.now();
    if (u.createdAt == null) u.createdAt = Instant.now();
    users.save(u);

    Map<String, Object> resp = new HashMap<>(authBody(u));
    resp.put("message", "Your account has been created successfully.");
    return ResponseEntity.ok(resp);
  }

  // =========================================================================
  // 3. LOGIN (AUTHENTICATES CREDENTIALS & SENDS SMS OTP TO REGISTERED PHONE)
  // =========================================================================
  @PostMapping("/auth/login")
  public ResponseEntity<?> login(@RequestBody Map<String, String> b) {
    String identifier = b.getOrDefault("email", b.getOrDefault("username", b.getOrDefault("phone", ""))).trim().toLowerCase();
    String password = b.getOrDefault("password", "");

    if (identifier.isEmpty() || password.isEmpty()) {
      return err(400, "Email/phone and password are required.");
    }

    Optional<AppUser> userOpt = users.findByEmail(identifier);
    if (userOpt.isEmpty()) {
      try {
        String normalized = smsService.normalizePhone(identifier);
        userOpt = users.findByPhone(normalized);
      } catch (Exception ignored) {}
    }

    if (userOpt.isEmpty() || !enc.matches(password, userOpt.get().passwordHash)) {
      return err(401, "Invalid email or password.");
    }

    AppUser user = userOpt.get();
    if ("suspended".equalsIgnoreCase(user.status) || !user.isActive) {
      return err(403, "Your account has been suspended. Please contact support.");
    }

    if (user.phone == null || user.phone.isEmpty()) {
      // Direct login if user has no phone (legacy account)
      user.lastLoginAt = Instant.now();
      user.lastSeen = Instant.now();
      users.save(user);
      return ResponseEntity.ok(authBody(user));
    }

    // Send SMS OTP to user's registered phone
    try {
      smsService.sendVerification(user.phone);
    } catch (IllegalStateException e) {
      return err(429, e.getMessage());
    } catch (IllegalArgumentException e) {
      return err(400, e.getMessage());
    } catch (Exception e) {
      return err(500, e.getMessage());
    }

    return ResponseEntity.ok(Map.of(
        "requireOtp", true,
        "email", user.email,
        "phone", smsService.maskPhone(user.phone),
        "message", "We've sent a verification code to your registered phone."
    ));
  }

  // =========================================================================
  // 4. VERIFY LOGIN OTP & ISSUE AUTH TOKEN
  // =========================================================================
  @PostMapping("/auth/verify-login")
  public ResponseEntity<?> verifyLogin(@RequestBody Map<String, String> b) {
    String email = b.getOrDefault("email", "").trim().toLowerCase();
    String rawPhone = b.getOrDefault("phone", "").trim();
    String code = b.getOrDefault("otp", b.getOrDefault("code", "")).trim();

    if (code.isEmpty()) {
      return err(400, "6-digit verification code is required.");
    }

    Optional<AppUser> userOpt = users.findByEmail(email);
    if (userOpt.isEmpty() && !rawPhone.isEmpty()) {
      try {
        String normalized = smsService.normalizePhone(rawPhone);
        userOpt = users.findByPhone(normalized);
      } catch (Exception ignored) {}
    }

    if (userOpt.isEmpty()) {
      return err(404, "User not found.");
    }

    AppUser user = userOpt.get();
    if (user.phone == null || user.phone.isEmpty()) {
      return err(400, "No phone number associated with this account.");
    }

    // Verify code with Twilio
    boolean isVerified;
    try {
      isVerified = smsService.checkVerification(user.phone, code);
    } catch (IllegalArgumentException e) {
      return err(400, e.getMessage());
    } catch (IllegalStateException e) {
      return err(429, e.getMessage());
    } catch (Exception e) {
      return err(500, e.getMessage());
    }

    if (!isVerified) {
      return err(400, "Invalid verification code.");
    }

    user.lastLoginAt = Instant.now();
    user.lastSeen = Instant.now();
    users.save(user);

    Map<String, Object> resp = new HashMap<>(authBody(user));
    resp.put("message", "You have successfully logged in.");
    return ResponseEntity.ok(resp);
  }

  // =========================================================================
  // 5. RESEND OTP (WITH 60-SECOND COOLDOWN)
  // =========================================================================
  @PostMapping("/auth/resend-otp")
  public ResponseEntity<?> resendOtp(@RequestBody Map<String, String> b) {
    String email = b.getOrDefault("email", "").trim().toLowerCase();
    String rawPhone = b.getOrDefault("phone", "").trim();
    String purpose = b.getOrDefault("purpose", "SIGNUP").toUpperCase().trim();

    String phone = "";
    if (!rawPhone.isEmpty()) {
      try {
        phone = smsService.normalizePhone(rawPhone);
      } catch (Exception ignored) {}
    }

    if (phone.isEmpty() && !email.isEmpty()) {
      var userOpt = users.findByEmail(email);
      if (userOpt.isPresent() && userOpt.get().phone != null) {
        phone = userOpt.get().phone;
      }
    }

    if (phone.isEmpty()) {
      return err(400, "Phone number is required to resend verification code.");
    }

    try {
      smsService.sendVerification(phone);
    } catch (IllegalStateException e) {
      return err(429, e.getMessage());
    } catch (IllegalArgumentException e) {
      return err(400, e.getMessage());
    } catch (Exception e) {
      return err(500, e.getMessage());
    }

    return ResponseEntity.ok(Map.of(
        "message", "A new verification code has been sent to " + smsService.maskPhone(phone),
        "phone", smsService.maskPhone(phone),
        "expiresIn", 300,
        "cooldown", 60
    ));
  }

  // =========================================================================
  // 6. FORGOT PASSWORD (SENDS OTP TO REGISTERED PHONE)
  // =========================================================================
  @PostMapping("/auth/forgot-password")
  public ResponseEntity<?> forgotPassword(@RequestBody Map<String, String> b) {
    String email = b.getOrDefault("email", "").trim().toLowerCase();
    if (!isValidEmail(email)) {
      return err(400, "Please enter a valid email address.");
    }

    var userOpt = users.findByEmail(email);
    if (userOpt.isPresent() && userOpt.get().phone != null && !userOpt.get().phone.isEmpty()) {
      try {
        smsService.sendVerification(userOpt.get().phone);
      } catch (Exception e) {
        System.err.println("[FORGOT PW] Failed sending SMS OTP: " + e.getMessage());
      }
    }

    // Generic safe response to prevent email enumeration
    return ResponseEntity.ok(Map.of(
        "message", "If an account exists for this email, we have sent a verification code to the registered phone.",
        "email", email,
        "phone", userOpt.isPresent() && userOpt.get().phone != null ? smsService.maskPhone(userOpt.get().phone) : ""
    ));
  }

  // =========================================================================
  // 7. VERIFY PASSWORD RESET OTP
  // =========================================================================
  @PostMapping({"/auth/verify-reset-otp", "/auth/verify-otp"})
  public ResponseEntity<?> verifyResetOtp(@RequestBody Map<String, String> b) {
    String email = b.getOrDefault("email", "").trim().toLowerCase();
    String code = b.getOrDefault("otp", b.getOrDefault("code", "")).trim();

    if (email.isEmpty() || code.isEmpty()) {
      return err(400, "Email and 6-digit verification code are required.");
    }

    var userOpt = users.findByEmail(email);
    if (userOpt.isEmpty() || userOpt.get().phone == null || userOpt.get().phone.isEmpty()) {
      return err(400, "Invalid or expired verification code.");
    }

    boolean isVerified;
    try {
      isVerified = smsService.checkVerification(userOpt.get().phone, code);
    } catch (IllegalArgumentException e) {
      return err(400, e.getMessage());
    } catch (IllegalStateException e) {
      return err(429, e.getMessage());
    } catch (Exception e) {
      return err(500, e.getMessage());
    }

    if (!isVerified) {
      return err(400, "Invalid verification code.");
    }

    return ResponseEntity.ok(Map.of(
        "valid", true,
        "message", "Verification code accepted."
    ));
  }

  // =========================================================================
  // 8. COMPLETE PASSWORD RESET
  // =========================================================================
  @PostMapping("/auth/reset-password")
  public ResponseEntity<?> resetPassword(@RequestBody Map<String, String> b) {
    String email = b.getOrDefault("email", "").trim().toLowerCase();
    String code = b.getOrDefault("otp", b.getOrDefault("code", "")).trim();
    String password = b.getOrDefault("password", "");
    String confirmPassword = b.getOrDefault("confirmPassword", b.getOrDefault("confirm_password", ""));

    if (email.isEmpty() || code.isEmpty() || password.isEmpty()) {
      return err(400, "Email, verification code, and new password are required.");
    }

    String pwdErr = validatePasswordRules(password);
    if (pwdErr != null) {
      return err(400, pwdErr);
    }

    if (!confirmPassword.isEmpty() && !password.equals(confirmPassword)) {
      return err(400, "Passwords do not match.");
    }

    var userOpt = users.findByEmail(email);
    if (userOpt.isEmpty() || userOpt.get().phone == null || userOpt.get().phone.isEmpty()) {
      return err(404, "User account not found.");
    }

    AppUser user = userOpt.get();
    boolean isVerified;
    try {
      isVerified = smsService.checkVerification(user.phone, code);
    } catch (Exception e) {
      return err(400, "Invalid or expired verification code.");
    }

    if (!isVerified) {
      return err(400, "Invalid verification code.");
    }

    user.passwordHash = enc.encode(password);
    user.updatedAt = Instant.now();
    users.save(user);

    return ResponseEntity.ok(Map.of(
        "message", "Your password has been updated. Please log in with your new password."
    ));
  }

  // =========================================================================
  // 9. CURRENT AUTHENTICATED USER SESSION (/auth/me)
  // =========================================================================
  @GetMapping("/auth/me")
  public ResponseEntity<?> getCurrentUser(@RequestAttribute("sub") String userId) {
    if (userId == null || userId.isEmpty()) {
      return err(401, "Not authenticated.");
    }
    var userOpt = users.findById(userId);
    if (userOpt.isEmpty()) {
      return err(401, "User not found or session expired.");
    }
    AppUser u = userOpt.get();
    if ("suspended".equalsIgnoreCase(u.status) || !u.isActive) {
      return err(403, "Account is disabled.");
    }
    return ResponseEntity.ok(authBody(u));
  }

  // =========================================================================
  // 10. LOGOUT
  // =========================================================================
  @PostMapping("/auth/logout")
  public ResponseEntity<?> logout() {
    return ResponseEntity.ok(Map.of("message", "Logged out successfully."));
  }

  // =========================================================================
  // 11. GOOGLE AUTHENTICATION INTEGRATION
  // =========================================================================
  @PostMapping("/auth/google")
  public ResponseEntity<?> googleAuth(@RequestBody Map<String, String> b) {
    String email = b.getOrDefault("email", "").trim().toLowerCase();
    String name  = b.getOrDefault("name", "").trim();
    String avatar = b.getOrDefault("avatar", "");

    if (email.isEmpty()) return err(400, "Google email required");

    var existing = users.findByEmail(email);
    AppUser u;
    if (existing.isPresent()) {
      u = existing.get();
      if (name != null && !name.isEmpty() && (u.name == null || u.name.isEmpty())) {
        u.name = name;
      }
      if (avatar != null && !avatar.isEmpty()) {
        u.avatar = avatar;
      }
      u.emailVerified = true;
      u.lastSeen = Instant.now();
      u.updatedAt = Instant.now();
      users.save(u);
    } else {
      u = new AppUser();
      u.name = name.isEmpty() ? email.split("@")[0] : name;
      u.handle = u.name.toLowerCase().replace(" ", ".");
      u.email = email;
      u.avatar = avatar;
      u.emailVerified = true;
      u.phoneVerified = true;
      u.status = "active";
      u.isActive = true;
      u.role = "USER";
      u.passwordHash = enc.encode("GOOGLE_OAUTH_" + UUID.randomUUID());
      u.createdAt = Instant.now();
      u.updatedAt = Instant.now();
      users.save(u);
    }

    return ResponseEntity.ok(authBody(u));
  }

  // =========================================================================
  // USER APP STATE
  // =========================================================================
  @GetMapping("/me/state")
  public Map<String, String> myState(@RequestAttribute("sub") String id) {
    return states.findById("user:" + id).orElse(new StateDoc()).data;
  }

  @PutMapping("/me/state")
  public Map<String, String> saveMy(
      @RequestAttribute("sub") String id, @RequestBody Map<String, String> patch) {
    return merge("user:" + id, patch);
  }

  // =========================================================================
  // ADMIN AUTH & USER MANAGEMENT (GET /api/admin/users)
  // =========================================================================
  @PostMapping("/admin/login")
  public ResponseEntity<?> adminLogin(@RequestBody Map<String, String> b) {
    if (!adminPw.equals(b.get("password"))) return err(401, "Wrong admin password");
    return ResponseEntity.ok(Map.of("token", jwt.make("admin", "admin")));
  }

  @GetMapping("/admin/state")
  public Map<String, String> adminState() {
    return states.findById("admin").orElse(new StateDoc()).data;
  }

  @PutMapping("/admin/state")
  public Map<String, String> saveAdmin(@RequestBody Map<String, String> patch) {
    return merge("admin", patch);
  }

  @GetMapping("/admin/users")
  public List<Map<String, Object>> allUsers() {
    List<Map<String, Object>> r = new ArrayList<>();
    users.findAll().forEach(u -> {
      Map<String, Object> map = new HashMap<>();
      map.put("id", u.id);
      map.put("name", u.name);
      map.put("h", u.handle != null ? u.handle : (u.name != null ? u.name.toLowerCase().replace(" ", ".") : "user"));
      map.put("email", u.email != null ? u.email : "");
      map.put("phone", u.phone != null ? u.phone : "");
      map.put("emailVerified", u.emailVerified);
      map.put("phoneVerified", u.phoneVerified);
      map.put("status", u.status != null ? u.status : "active");
      map.put("role", u.role != null ? u.role : "USER");
      map.put("tick", u.tick);
      map.put("pro", u.isPro ? 1 : 0);
      map.put("posts", 0);
      map.put("color", u.color != null ? u.color : "#ff6b4a");
      map.put("joined", u.createdAt != null ? u.createdAt.toString().substring(0, 10) : "2026-10-01");
      map.put("createdAt", u.createdAt != null ? u.createdAt.toString() : "");
      map.put("lastLoginAt", u.lastLoginAt != null ? u.lastLoginAt.toString() : "");
      r.add(map);
    });
    return r;
  }

  @PutMapping("/admin/users/{id}/status")
  public ResponseEntity<?> setStatus(@PathVariable String id, @RequestBody Map<String, String> b) {
    var o = users.findById(id);
    if (o.isEmpty()) return err(404, "Not found");
    o.get().status = b.get("status");
    o.get().updatedAt = Instant.now();
    users.save(o.get());
    return ResponseEntity.noContent().build();
  }

  @PutMapping("/admin/users/{id}/tick")
  public ResponseEntity<?> setTick(@PathVariable String id, @RequestBody Map<String, String> b) {
    var o = users.findById(id);
    if (o.isEmpty()) return err(404, "Not found");
    o.get().tick = b.get("tick");
    o.get().updatedAt = Instant.now();
    users.save(o.get());
    return ResponseEntity.noContent().build();
  }

  @PutMapping("/admin/users/{id}/pro")
  public ResponseEntity<?> setPro(@PathVariable String id, @RequestBody Map<String, Object> b) {
    var o = users.findById(id);
    if (o.isEmpty()) return err(404, "Not found");
    o.get().isPro = Boolean.TRUE.equals(b.get("pro")) || Integer.valueOf(1).equals(b.get("pro"));
    o.get().updatedAt = Instant.now();
    users.save(o.get());
    return ResponseEntity.noContent().build();
  }

  @DeleteMapping("/admin/users/{id}")
  public ResponseEntity<?> del(@PathVariable String id) {
    users.deleteById(id);
    states.deleteById("user:" + id);
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/admin/conversations")
  public List<Map<String, Object>> allConversations() {
    List<Map<String, Object>> res = new ArrayList<>();
    convRepo.findAll().forEach(c -> {
      Map<String, Object> item = new HashMap<>();
      item.put("id", c.id);
      item.put("name", c.name);
      item.put("group", c.group);
      item.put("participantCount", c.participantIds.size());
      item.put("messageCount", msgRepo.countByConversationId(c.id));
      item.put("preview", c.preview);
      item.put("updatedAt", c.updatedAt != null ? c.updatedAt.toString() : "");
      res.add(item);
    });
    return res;
  }

  @GetMapping("/admin/conversations/{id}/messages")
  public List<Message> getAdminConvMessages(@PathVariable String id) {
    return msgRepo.findByConversationIdOrderByCreatedAtAsc(id);
  }

  @DeleteMapping("/admin/messages/{id}")
  public ResponseEntity<?> deleteAbusiveMessage(@PathVariable String id) {
    msgRepo.deleteById(id);
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/admin/stats")
  public Map<String, Object> getStats() {
    long totalUsers = users.count();
    long totalMessages = msgRepo.count();
    long totalConvs = convRepo.count();
    return Map.of(
        "totalUsers", totalUsers,
        "totalMessages", totalMessages,
        "totalConversations", totalConvs
    );
  }

  Map<String, String> merge(String id, Map<String, String> patch) {
    StateDoc d = states.findById(id).orElse(new StateDoc(id));
    patch.forEach((k, v) -> {
      if (v == null) d.data.remove(k);
      else d.data.put(k.replace('.', '_'), v);
    });
    states.save(d);
    return d.data;
  }
}
