package com.thread.api;

import com.thread.model.*;
import com.thread.repo.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.web.bind.annotation.*;

import java.security.Principal;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;

@RestController
@RequestMapping("/api")
public class ChatController {

  @Autowired private UserRepo userRepo;
  @Autowired private ConversationRepo convRepo;
  @Autowired private MessageRepo msgRepo;
  @Autowired private ConversationMemberRepo memberRepo;
  @Autowired private SimpMessagingTemplate messagingTemplate;

  private static final DateTimeFormatter TIME_FMT =
      DateTimeFormatter.ofPattern("h:mm a").withZone(ZoneId.systemDefault());

  private String formatTime(Instant instant) {
    if (instant == null) return "now";
    return TIME_FMT.format(instant);
  }

  // List all conversations for the authenticated user
  @GetMapping("/conversations")
  public List<Conversation> getMyConversations(@RequestAttribute("sub") String userId) {
    List<Conversation> list = convRepo.findByParticipantIdsContainingOrderByUpdatedAtDesc(userId);

    AppUser me = userRepo.findById(userId).orElse(null);

    // Enrich conversation metadata
    for (Conversation c : list) {
      // Find unread count for current user
      memberRepo.findByConversationIdAndUserId(c.id, userId).ifPresent(m -> {
        c.unread = m.unreadCount;
        c.muted = m.muted;
      });

      // Load recent messages
      List<Message> msgs = msgRepo.findByConversationIdOrderByCreatedAtAsc(c.id);
      for (Message m : msgs) {
        m.sent = userId.equals(m.senderId);
      }
      c.messages = msgs;

      // For direct chats, adjust name/color/avatar to match recipient
      if (!c.group && c.participantIds.size() >= 2) {
        String otherId = c.participantIds.stream().filter(p -> !p.equals(userId)).findFirst().orElse(null);
        if (otherId != null) {
          userRepo.findById(otherId).ifPresent(other -> {
            c.name = other.name != null ? other.name : c.name;
            c.color = other.color != null ? other.color : c.color;
            c.online = other.online;
          });
        }
      }
    }
    return list;
  }

  // Create a new direct or group conversation
  @PostMapping("/conversations")
  public ResponseEntity<?> createConversation(
      @RequestAttribute("sub") String userId,
      @RequestBody Map<String, Object> body) {

    String name = (String) body.get("name");
    Boolean isGroup = (Boolean) body.getOrDefault("group", Boolean.FALSE);
    String color = (String) body.getOrDefault("color", "#ff6b4a");
    @SuppressWarnings("unchecked")
    List<String> participants = (List<String>) body.getOrDefault("participantIds", new ArrayList<>());

    if (!participants.contains(userId)) {
      participants.add(userId);
    }

    // If direct chat and already exists between these 2 users, return existing
    if (!isGroup && participants.size() == 2) {
      String p1 = participants.get(0), p2 = participants.get(1);
      List<Conversation> existing = convRepo.findByParticipantIdsContainingOrderByUpdatedAtDesc(p1);
      for (Conversation c : existing) {
        if (!c.group && c.participantIds.contains(p1) && c.participantIds.contains(p2)) {
          return ResponseEntity.ok(c);
        }
      }
    }

    Conversation c = new Conversation();
    c.name = name != null && !name.trim().isEmpty() ? name.trim() : "Chat";
    c.group = Boolean.TRUE.equals(isGroup);
    c.color = color;
    c.creatorId = userId;
    c.participantIds = participants;
    c.preview = "Started conversation";
    c.time = "now";
    c.updatedAt = Instant.now();
    convRepo.save(c);

    for (String pId : participants) {
      ConversationMember member = new ConversationMember(c.id, pId);
      if (pId.equals(userId)) {
        member.role = "owner";
      }
      memberRepo.save(member);
    }

    return ResponseEntity.ok(c);
  }

  // Get messages for a specific conversation
  @GetMapping("/conversations/{id}/messages")
  public ResponseEntity<?> getMessages(
      @RequestAttribute("sub") String userId,
      @PathVariable String id) {

    Optional<Conversation> convOpt = convRepo.findById(id);
    if (convOpt.isEmpty()) {
      return ResponseEntity.status(404).body(Map.of("error", "Conversation not found"));
    }

    List<Message> msgs = msgRepo.findByConversationIdOrderByCreatedAtAsc(id);
    for (Message m : msgs) {
      m.sent = userId.equals(m.senderId);
    }
    return ResponseEntity.ok(msgs);
  }

  // Send a message via REST
  @PostMapping("/conversations/{id}/messages")
  public ResponseEntity<?> sendMessage(
      @RequestAttribute("sub") String userId,
      @PathVariable String id,
      @RequestBody Message req) {

    Optional<Conversation> convOpt = convRepo.findById(id);
    if (convOpt.isEmpty()) {
      return ResponseEntity.status(404).body(Map.of("error", "Conversation not found"));
    }
    Conversation conv = convOpt.get();

    AppUser sender = userRepo.findById(userId).orElse(null);
    String senderName = sender != null && sender.name != null ? sender.name : "User";

    Message msg = new Message();
    msg.conversationId = id;
    msg.senderId = userId;
    msg.senderName = senderName;
    msg.text = req.text;
    msg.type = req.type;
    msg.src = req.src;
    msg.name = req.name;
    msg.mime = req.mime;
    msg.size = req.size;
    msg.dur = req.dur;
    msg.peaks = req.peaks;
    msg.caption = req.caption;
    msg.question = req.question;
    msg.options = req.options;
    msg.votes = req.votes;
    msg.total = req.total;
    msg.call = req.call;
    msg.reply = req.reply;
    msg.forwarded = req.forwarded;
    msg.opened = req.opened;
    msg.createdAt = Instant.now();
    msg.time = formatTime(msg.createdAt);
    msgRepo.save(msg);

    // Update conversation metadata
    conv.lastMessageText = msg.text;
    conv.lastMessageSenderId = userId;
    conv.preview = msg.text != null && !msg.text.isEmpty() ? msg.text : (msg.type != null ? msg.type.toUpperCase() : "New message");
    conv.previewType = msg.type;
    conv.previewName = msg.name;
    conv.time = "now";
    conv.updatedAt = Instant.now();
    convRepo.save(conv);

    // Increment unread count for other members
    List<ConversationMember> members = memberRepo.findByConversationId(id);
    for (ConversationMember member : members) {
      if (!member.userId.equals(userId)) {
        member.unreadCount++;
        memberRepo.save(member);
      }
    }

    // Broadcast message to WebSocket subscribers
    broadcastMessage(conv, msg);

    msg.sent = true;
    return ResponseEntity.ok(msg);
  }

  // Mark conversation as read
  @PostMapping("/conversations/{id}/read")
  public ResponseEntity<?> markAsRead(
      @RequestAttribute("sub") String userId,
      @PathVariable String id) {

    memberRepo.findByConversationIdAndUserId(id, userId).ifPresent(m -> {
      m.unreadCount = 0;
      memberRepo.save(m);
    });
    return ResponseEntity.noContent().build();
  }

  // STOMP Message Handler: /app/chat.send
  @MessageMapping("/chat.send")
  public void handleWsSend(@Payload Message req, Principal principal) {
    if (principal == null || req.conversationId == null) return;
    String userId = principal.getName();

    Optional<Conversation> convOpt = convRepo.findById(req.conversationId);
    if (convOpt.isEmpty()) return;
    Conversation conv = convOpt.get();

    AppUser sender = userRepo.findById(userId).orElse(null);
    String senderName = sender != null && sender.name != null ? sender.name : "User";

    req.senderId = userId;
    req.senderName = senderName;
    req.createdAt = Instant.now();
    req.time = formatTime(req.createdAt);
    msgRepo.save(req);

    conv.lastMessageText = req.text;
    conv.lastMessageSenderId = userId;
    conv.preview = req.text != null && !req.text.isEmpty() ? req.text : (req.type != null ? req.type.toUpperCase() : "New message");
    conv.previewType = req.type;
    conv.previewName = req.name;
    conv.time = "now";
    conv.updatedAt = Instant.now();
    convRepo.save(conv);

    broadcastMessage(conv, req);
  }

  // STOMP Typing Handler: /app/chat.typing
  @MessageMapping("/chat.typing")
  public void handleWsTyping(@Payload Map<String, Object> payload, Principal principal) {
    if (principal == null) return;
    String conversationId = (String) payload.get("conversationId");
    if (conversationId != null) {
      payload.put("userId", principal.getName());
      messagingTemplate.convertAndSend("/topic/conversation." + conversationId + ".typing", payload);
    }
  }

  private void broadcastMessage(Conversation conv, Message msg) {
    // 1. Broadcast to everyone viewing this conversation room
    messagingTemplate.convertAndSend("/topic/conversation." + conv.id, msg);

    // 2. Broadcast conversation update event to each participant
    for (String pId : conv.participantIds) {
      messagingTemplate.convertAndSend("/topic/user." + pId + ".conversations", conv);
    }
  }

  // Discover registered users
  @GetMapping("/users")
  public List<Map<String, Object>> searchUsers(@RequestAttribute("sub") String currentUserId) {
    List<Map<String, Object>> res = new ArrayList<>();
    userRepo.findAll().forEach(u -> {
      if (!u.id.equals(currentUserId) && "active".equals(u.status)) {
        res.add(Map.of(
            "id", u.id,
            "name", u.name != null ? u.name : "User",
            "email", u.email != null ? u.email : "",
            "color", u.color != null ? u.color : "#6c8cff",
            "online", u.online
        ));
      }
    });
    return res;
  }

  // Seed default sample contacts in MongoDB so new users have a lively initial experience
  private void seedInitialConversations(String myUserId) {
    AppUser me = userRepo.findById(myUserId).orElse(null);
    if (me == null) return;

    // Contact 1: Maya Chen
    AppUser c1 = getOrCreateSeedUser("maya.chen@mail.com", "Maya Chen", "#ff6b4a");
    Conversation conv1 = new Conversation();
    conv1.name = "Maya Chen";
    conv1.color = "#ff6b4a";
    conv1.creatorId = myUserId;
    conv1.participantIds = List.of(myUserId, c1.id);
    conv1.preview = "hey, are you free later?";
    conv1.time = "10:42 AM";
    conv1.updatedAt = Instant.now().minusSeconds(3600);
    convRepo.save(conv1);
    memberRepo.save(new ConversationMember(conv1.id, myUserId));
    memberRepo.save(new ConversationMember(conv1.id, c1.id));

    Message m1 = new Message();
    m1.conversationId = conv1.id;
    m1.senderId = c1.id;
    m1.senderName = c1.name;
    m1.text = "Hey! Did you check out the new Thread features?";
    m1.time = "10:40 AM";
    m1.createdAt = Instant.now().minusSeconds(3800);
    msgRepo.save(m1);

    Message m2 = new Message();
    m2.conversationId = conv1.id;
    m2.senderId = myUserId;
    m2.senderName = me.name;
    m2.text = "Yes, real-time messaging with MongoDB looks awesome!";
    m2.time = "10:41 AM";
    m2.createdAt = Instant.now().minusSeconds(3700);
    msgRepo.save(m2);

    Message m3 = new Message();
    m3.conversationId = conv1.id;
    m3.senderId = c1.id;
    m3.senderName = c1.name;
    m3.text = "hey, are you free later?";
    m3.time = "10:42 AM";
    m3.createdAt = Instant.now().minusSeconds(3600);
    msgRepo.save(m3);

    // Contact 2: Design Team (Group)
    AppUser c2 = getOrCreateSeedUser("priya.patel@mail.com", "Priya Patel", "#6c8cff");
    AppUser c3 = getOrCreateSeedUser("sam.wright@mail.com", "Sam Wright", "#35d0a0");
    Conversation conv2 = new Conversation();
    conv2.name = "Design Team";
    conv2.group = true;
    conv2.color = "#a87ff2";
    conv2.creatorId = myUserId;
    conv2.participantIds = List.of(myUserId, c1.id, c2.id, c3.id);
    conv2.preview = "Check the latest mockups attached";
    conv2.time = "9:15 AM";
    conv2.updatedAt = Instant.now().minusSeconds(7200);
    convRepo.save(conv2);
    memberRepo.save(new ConversationMember(conv2.id, myUserId));
    memberRepo.save(new ConversationMember(conv2.id, c1.id));
    memberRepo.save(new ConversationMember(conv2.id, c2.id));
    memberRepo.save(new ConversationMember(conv2.id, c3.id));

    Message mg1 = new Message();
    mg1.conversationId = conv2.id;
    mg1.senderId = c2.id;
    mg1.senderName = c2.name;
    mg1.text = "Morning everyone! New chat components are deployed.";
    mg1.time = "9:10 AM";
    mg1.createdAt = Instant.now().minusSeconds(7500);
    msgRepo.save(mg1);

    Message mg2 = new Message();
    mg2.conversationId = conv2.id;
    mg2.senderId = c3.id;
    mg2.senderName = c3.name;
    mg2.text = "Check the latest mockups attached";
    mg2.time = "9:15 AM";
    mg2.createdAt = Instant.now().minusSeconds(7200);
    msgRepo.save(mg2);
  }

  private AppUser getOrCreateSeedUser(String email, String name, String color) {
    return userRepo.findByEmail(email).orElseGet(() -> {
      AppUser u = new AppUser();
      u.email = email;
      u.name = name;
      u.handle = name.toLowerCase().replace(" ", ".");
      u.color = color;
      u.passwordHash = "$2a$10$e8Zz2g0MhP.WqIu2h7C2teJ5fP6y9y3aPq5uG8d4hJ8uL0e3tqZve"; // default pass
      u.status = "active";
      u.online = true;
      userRepo.save(u);
      return u;
    });
  }
}
