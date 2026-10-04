package com.thread.security;
import io.jsonwebtoken.*; import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value; import org.springframework.stereotype.Component;
import javax.crypto.SecretKey; import java.util.Date;
@Component
public class Jwt{
  private final SecretKey key;
  public Jwt(@Value("${thread.jwt-secret}") String s){key=Keys.hmacShaKeyFor(s.getBytes());}
  public String make(String sub,String role){return Jwts.builder().subject(sub).claim("role",role).expiration(new Date(System.currentTimeMillis()+7L*86400000L)).signWith(key).compact();}
  public Claims parse(String t){return Jwts.parser().verifyWith(key).build().parseSignedClaims(t).getPayload();}
}
