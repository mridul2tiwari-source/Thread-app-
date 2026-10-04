package com.thread.repo;

import com.thread.model.Conversation;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;
import java.util.Optional;

public interface ConversationRepo extends MongoRepository<Conversation, String> {
  List<Conversation> findByParticipantIdsContainingOrderByUpdatedAtDesc(String userId);
  Optional<Conversation> findByIdAndParticipantIdsContaining(String id, String userId);
}
