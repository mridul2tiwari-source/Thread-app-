package com.thread.repo;

import com.thread.model.OtpToken;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.Optional;
import java.util.List;

public interface OtpRepo extends MongoRepository<OtpToken, String> {
  Optional<OtpToken> findTopByEmailAndPurposeAndUsedFalseOrderByCreatedAtDesc(String email, String purpose);
  Optional<OtpToken> findTopByEmailAndPurposeOrderByCreatedAtDesc(String email, String purpose);
  List<OtpToken> findByEmailAndPurpose(String email, String purpose);
  void deleteByEmail(String email);
  void deleteByEmailAndPurpose(String email, String purpose);
}
