package com.thread.repo;

import com.thread.model.Attachment;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;

public interface AttachmentRepo extends MongoRepository<Attachment, String> {
  List<Attachment> findByConversationId(String conversationId);
}
