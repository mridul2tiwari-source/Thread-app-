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
  @Autowired org.springframework.messaging.simp.SimpMessagingTemplate messagingTemplate;

  @Value("${thread.admin-password:admin123}")
  String adminPw;
  @Value("${thread.admin-google-email:k42621508@gmail.com}")
  String adminGoogleEmail;

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
    userMap.put("systemKeyboard", u.systemKeyboard);
    return Map.of("token", jwt.make(u.id, "user"), "user", userMap);
  }

    // =========================================================================
  // 1. SIGN UP / CREATE ACCOUNT (EMAIL ONLY)
  // =========================================================================
  @PostMapping({"/auth/register", "/auth/signup", "/auth/register-otp"})
  public ResponseEntity<?> register(@RequestBody Map<String, String> b) {
    String email = b.getOrDefault("email", "").trim().toLowerCase();
    String password = b.getOrDefault("password", "");
    String confirmPassword = b.getOrDefault("confirmPassword", b.getOrDefault("confirm_password", ""));
    String name = b.getOrDefault("name", "").trim();

    if (!isValidEmail(email)) {
      return err(400, "Please enter a valid email address.");
    }

    String pwdErr = validatePasswordRules(password);
    if (pwdErr != null) {
      return err(400, pwdErr);
    }

    if (!confirmPassword.isEmpty() && !password.equals(confirmPassword)) {
      return err(400, "Passwords do not match.");
    }

    var existingUser = users.findByEmail(email);
    if (existingUser.isPresent() && (existingUser.get().emailVerified || existingUser.get().isActive)) {
      return err(409, "An account with this email already exists. Please log in instead.");
    }

    AppUser u = existingUser.orElse(new AppUser());
    u.name = name.isEmpty() ? email.split("@")[0] : name;
    u.handle = u.name.toLowerCase().replace(" ", ".");
    u.email = email;
    u.passwordHash = enc.encode(password);
    u.emailVerified = false;
    u.status = "pending";
    u.isActive = false;
    u.role = "USER";
    if (u.createdAt == null) u.createdAt = Instant.now();
    u.updatedAt = Instant.now();
    users.save(u);

    // Generate and send Email OTP
    String code = String.format("%06d", secureRandom.nextInt(1000000));
    OtpToken otpToken = otpRepo.findTopByEmailAndPurposeOrderByCreatedAtDesc(email, "SIGNUP").orElse(new OtpToken());
    otpToken.email = email;
    otpToken.purpose = "SIGNUP";
    otpToken.otpHash = enc.encode(code);
    otpToken.code = code;
    otpToken.attempts = 0;
    otpToken.used = false;
    otpToken.createdAt = Instant.now();
    otpToken.lastResendAt = Instant.now();
    otpToken.expiresAt = Instant.now().plusSeconds(300);
    otpRepo.save(otpToken);

    emailService.sendSignupOtp(email, code);

    return ResponseEntity.ok(Map.of(
        "message", "Verification code sent to " + email,
        "email", email,
        "expiresIn", 300
    ));
  }

  // =========================================================================
  // 2. VERIFY EMAIL OTP & ACTIVATE ACCOUNT
  // =========================================================================
  @PostMapping({"/auth/verify-phone", "/auth/verify-email", "/auth/register-verify"})
  public ResponseEntity<?> verifyEmail(@RequestBody Map<String, String> b) {
    String email = b.getOrDefault("email", "").trim().toLowerCase();
    String code = b.getOrDefault("otp", b.getOrDefault("code", "")).trim();

    if (code.isEmpty() || email.isEmpty()) {
      return err(400, "Email and 6-digit verification code are required.");
    }

    var otpOpt = otpRepo.findTopByEmailAndPurposeAndUsedFalseOrderByCreatedAtDesc(email, "SIGNUP");
    if (otpOpt.isEmpty() || otpOpt.get().expiresAt.isBefore(Instant.now())) {
      return err(400, "Verification code is expired or invalid.");
    }

    OtpToken otpToken = otpOpt.get();
    if (otpToken.attempts >= 5) {
      return err(429, "Too many failed attempts. Please request a new code.");
    }

    if (!enc.matches(code, otpToken.otpHash)) {
      otpToken.attempts++;
      otpRepo.save(otpToken);
      return err(400, "Invalid verification code.");
    }

    otpToken.used = true;
    otpRepo.save(otpToken);

    AppUser u = users.findByEmail(email).orElse(null);
    if (u == null) return err(404, "User not found.");

    u.emailVerified = true;
    u.status = "active";
    u.isActive = true;
    u.lastLoginAt = Instant.now();
    u.lastSeen = Instant.now();
    u.updatedAt = Instant.now();
    users.save(u);

    Map<String, Object> resp = new HashMap<>(authBody(u));
    resp.put("message", "Your account has been created successfully.");
    return ResponseEntity.ok(resp);
  }

  // =========================================================================
  // 3. LOGIN (EMAIL + PASSWORD) - NO OTP REQUIRED
  // =========================================================================
  @PostMapping("/auth/login")
  public ResponseEntity<?> login(@RequestBody Map<String, String> b) {
    String email = b.getOrDefault("email", b.getOrDefault("username", "")).trim().toLowerCase();
    String password = b.getOrDefault("password", "");

    if (email.isEmpty() || password.isEmpty()) {
      return err(400, "Email and password are required.");
    }

    Optional<AppUser> userOpt = users.findByEmail(email);

    if (userOpt.isEmpty() || !enc.matches(password, userOpt.get().passwordHash)) {
      return err(401, "Invalid email or password.");
    }

    AppUser user = userOpt.get();
    if ("suspended".equalsIgnoreCase(user.status) || !user.isActive) {
      return err(403, "Your account is not active or has been suspended.");
    }

    user.lastLoginAt = Instant.now();
    user.lastSeen = Instant.now();
    users.save(user);
    
    Map<String, Object> resp = new HashMap<>(authBody(user));
    resp.put("message", "You have successfully logged in.");
    return ResponseEntity.ok(resp);
  }

  // =========================================================================
  // 4. VERIFY LOGIN OTP (DUMMY ENDPOINT TO PREVENT BREAKING OLD CLIENTS)
  // =========================================================================
  @PostMapping("/auth/verify-login")
  public ResponseEntity<?> verifyLogin(@RequestBody Map<String, String> b) {
     return err(400, "Login OTP is no longer used.");
  }

  // =========================================================================
  // 5. RESEND OTP (WITH 60-SECOND COOLDOWN)
  // =========================================================================
  @PostMapping("/auth/resend-otp")
  public ResponseEntity<?> resendOtp(@RequestBody Map<String, String> b) {
    String email = b.getOrDefault("email", "").trim().toLowerCase();
    String purpose = b.getOrDefault("purpose", "SIGNUP").toUpperCase().trim();

    if (email.isEmpty()) {
      return err(400, "Email is required to resend verification code.");
    }

    var otpOpt = otpRepo.findTopByEmailAndPurposeOrderByCreatedAtDesc(email, purpose);
    if (otpOpt.isPresent()) {
      OtpToken oldToken = otpOpt.get();
      if (oldToken.lastResendAt != null && oldToken.lastResendAt.plusSeconds(60).isAfter(Instant.now())) {
        return err(429, "Please wait 60 seconds before requesting a new code.");
      }
    }

    String code = String.format("%06d", secureRandom.nextInt(1000000));
    OtpToken otpToken = otpOpt.orElse(new OtpToken());
    otpToken.email = email;
    otpToken.purpose = purpose;
    otpToken.otpHash = enc.encode(code);
    otpToken.code = code;
    otpToken.attempts = 0;
    otpToken.used = false;
    otpToken.createdAt = Instant.now();
    otpToken.lastResendAt = Instant.now();
    otpToken.expiresAt = Instant.now().plusSeconds(300);
    otpRepo.save(otpToken);

    if ("PASSWORD_RESET".equals(purpose)) {
      emailService.sendPasswordResetOtp(email, code);
    } else {
      emailService.sendSignupOtp(email, code);
    }

    return ResponseEntity.ok(Map.of(
        "message", "A new verification code has been sent to " + email,
        "email", email,
        "expiresIn", 300,
        "cooldown", 60
    ));
  }

  // =========================================================================
  // 6. FORGOT PASSWORD (EMAIL ONLY)
  // =========================================================================
  @PostMapping("/auth/forgot-password")
  public ResponseEntity<?> forgotPassword(@RequestBody Map<String, String> b) {
    String email = b.getOrDefault("email", "").trim().toLowerCase();
    if (!isValidEmail(email)) {
      return err(400, "Please enter a valid email address.");
    }

    var userOpt = users.findByEmail(email);
    if (userOpt.isPresent() && userOpt.get().isActive) {
      // Check cooldown
      var otpOpt = otpRepo.findTopByEmailAndPurposeOrderByCreatedAtDesc(email, "PASSWORD_RESET");
      if (otpOpt.isPresent() && otpOpt.get().lastResendAt != null && otpOpt.get().lastResendAt.plusSeconds(60).isAfter(Instant.now())) {
        // Just return success to not reveal timing attacks, or let it pass silently
      } else {
        String code = String.format("%06d", secureRandom.nextInt(1000000));
        OtpToken otpToken = otpOpt.orElse(new OtpToken());
        otpToken.email = email;
        otpToken.purpose = "PASSWORD_RESET";
        otpToken.otpHash = enc.encode(code);
        otpToken.code = code;
        otpToken.attempts = 0;
        otpToken.used = false;
        otpToken.createdAt = Instant.now();
        otpToken.lastResendAt = Instant.now();
        otpToken.expiresAt = Instant.now().plusSeconds(300);
        otpRepo.save(otpToken);
        emailService.sendPasswordResetOtp(email, code);
      }
    }

    // Generic safe response to prevent email enumeration
    return ResponseEntity.ok(Map.of(
        "message", "If an account exists for this email, we have sent a verification code to it.",
        "email", email
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

    var otpOpt = otpRepo.findTopByEmailAndPurposeAndUsedFalseOrderByCreatedAtDesc(email, "PASSWORD_RESET");
    if (otpOpt.isEmpty() || otpOpt.get().expiresAt.isBefore(Instant.now())) {
      return err(400, "Verification code is expired or invalid.");
    }

    OtpToken otpToken = otpOpt.get();
    if (otpToken.attempts >= 5) {
      return err(429, "Too many failed attempts. Please request a new code.");
    }

    if (!enc.matches(code, otpToken.otpHash)) {
      otpToken.attempts++;
      otpRepo.save(otpToken);
      return err(400, "Invalid verification code.");
    }

    // Mark as used, but maybe keep a short lived token for the actual reset?
    // The requirement says: "After successful OTP verification, allow the user to reset their password"
    // Usually we generate a resetToken, but for simplicity, we'll mark this token as verified 
    // and they must submit it again along with the new password, or we just trust the client for the next step.
    // The original logic just relies on them sending the code again in `/reset-password`.
    // Let's NOT mark it used yet! Let the reset password endpoint mark it used.
    
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
    if (userOpt.isEmpty()) {
      return err(404, "User account not found.");
    }
    
    var otpOpt = otpRepo.findTopByEmailAndPurposeAndUsedFalseOrderByCreatedAtDesc(email, "PASSWORD_RESET");
    if (otpOpt.isEmpty() || otpOpt.get().expiresAt.isBefore(Instant.now())) {
      return err(400, "Verification code is expired or invalid.");
    }
    
    OtpToken otpToken = otpOpt.get();
    if (otpToken.attempts >= 5) {
      return err(429, "Too many failed attempts. Please request a new code.");
    }
    
    if (!enc.matches(code, otpToken.otpHash)) {
      otpToken.attempts++;
      otpRepo.save(otpToken);
      return err(400, "Invalid verification code.");
    }

    // Success! Update password and invalidate OTP
    otpToken.used = true;
    otpRepo.save(otpToken);

    AppUser user = userOpt.get();
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


  @PostMapping("/admin/google")
  public ResponseEntity<?> adminGoogle(@RequestBody Map<String, String> b) {
    String email = b.get("email");

    if (email == null || !adminGoogleEmail.equalsIgnoreCase(email)) {
      return err(401, "Google account is not an admin");
    }

    return ResponseEntity.ok(Map.of(
      "token", jwt.make("admin", "admin")
    ));
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
    messagingTemplate.convertAndSendToUser(id, "/queue/badge", Map.of(
        "verified", o.get().tick != null,
        "badgeType", o.get().tick != null ? o.get().tick : ""
    ));
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
  @PutMapping("/users/me/settings")
  public ResponseEntity<?> updateSettings(@RequestHeader("Authorization") String auth, @RequestBody Map<String, Object> body) {
    if (auth == null || !auth.startsWith("Bearer ")) return ResponseEntity.status(401).build();
    String token = auth.substring(7);
    String userId = jwt.parse(token).getSubject();
    AppUser user = users.findById(userId).orElse(null);
    if (user == null) return ResponseEntity.status(404).build();

    if (body.containsKey("systemKeyboard")) {
      user.systemKeyboard = (Boolean) body.get("systemKeyboard");
    }
    users.save(user);
    return ResponseEntity.ok(user);
  }

  @GetMapping("/users/{username}")
  public ResponseEntity<?> getUserByUsername(@PathVariable String username) {
    AppUser user = users.findByHandle(username).orElse(null);
    if (user == null) {
      user = users.findAll().stream().filter(u -> username.equalsIgnoreCase(u.name)).findFirst().orElse(null);
    }
    if (user == null) return ResponseEntity.status(404).build();
    Map<String, Object> res = new HashMap<>();
    res.put("id", user.id);
    res.put("name", user.name);
    res.put("handle", user.handle);
    res.put("avatar", user.avatar);
    return ResponseEntity.ok(res);
  }
}
