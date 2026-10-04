package com.thread;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.data.mongodb.repository.config.EnableMongoRepositories;

@SpringBootApplication
@EnableMongoRepositories(basePackages = "com.thread.repo")
public class ThreadApplication {
  public static void main(String[] a) {
    SpringApplication.run(ThreadApplication.class, a);
  }
}
