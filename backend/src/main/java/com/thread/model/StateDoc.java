package com.thread.model;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.util.*;
@Document("app_state")
public class StateDoc{
  @Id public String id; // "admin" or "user:<userId>"
  public Map<String,String> data=new HashMap<>();
  public StateDoc(){} public StateDoc(String id){this.id=id;}
}
