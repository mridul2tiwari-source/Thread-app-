package com.thread.repo;

import com.thread.model.ConversationMember;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;
import java.util.Optional;

public interface ConversationMemberRepo extends MongoRepository<ConversationMember, String> {
  List<ConversationMember> findByUserId(String userId);
  List<ConversationMember> findByConversationId(String conversationId);
  Optional<ConversationMember> findByConversationIdAndUserId(String conversationId, String userId);
  void deleteByConversationId(String conversationId);
}
