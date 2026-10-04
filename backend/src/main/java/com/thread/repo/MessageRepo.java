package com.thread.repo;

import com.thread.model.Message;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;

public interface MessageRepo extends MongoRepository<Message, String> {
  List<Message> findByConversationIdOrderByCreatedAtAsc(String conversationId);
  List<Message> findByConversationIdOrderByCreatedAtDesc(String conversationId, Pageable pageable);
  long countByConversationId(String conversationId);
  void deleteByConversationId(String conversationId);
}
