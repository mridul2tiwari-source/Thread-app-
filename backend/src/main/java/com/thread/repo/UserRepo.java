package com.thread.repo;

import com.thread.model.AppUser;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.Optional;

public interface UserRepo extends MongoRepository<AppUser, String> {
  Optional<AppUser> findByEmail(String email);
  boolean existsByEmail(String email);
  Optional<AppUser> findByPhone(String phone);
  boolean existsByPhone(String phone);
  Optional<AppUser> findByHandle(String handle);
}

