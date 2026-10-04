package com.thread.repo;

import com.thread.model.StateDoc;
import org.springframework.data.mongodb.repository.MongoRepository;

public interface StateRepo extends MongoRepository<StateDoc, String> {}
