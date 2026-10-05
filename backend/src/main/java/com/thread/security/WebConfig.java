package com.thread.security;

import jakarta.servlet.http.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.*;
import org.springframework.web.servlet.HandlerInterceptor;

@Configuration
public class WebConfig implements WebMvcConfigurer {
  private final Jwt jwt;

  @Value("${thread.cors-origins:http://localhost:5173,http://localhost:5174}")
  String[] origins;

  public WebConfig(Jwt j) {
    jwt = j;
  }

  @Override
  public void addCorsMappings(CorsRegistry r) {
    r.addMapping("/**")
        .allowedOrigins(origins)
        .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
        .allowedHeaders("*")
        .allowCredentials(true);
  }

  @Override
  public void addInterceptors(InterceptorRegistry r) {
    r.addInterceptor(new HandlerInterceptor() {
      @Override
      public boolean preHandle(HttpServletRequest q, HttpServletResponse s, Object h) throws Exception {
        if ("OPTIONS".equalsIgnoreCase(q.getMethod())) return true;
        String p = q.getRequestURI();

        boolean admin = p.startsWith("/api/admin/") && !p.equals("/api/admin/login") && !p.equals("/api/admin/register") && !p.equals("/api/admin/google");
        boolean userProtected = p.startsWith("/api/me/")
            || p.startsWith("/api/conversations")
            || p.startsWith("/api/users")
            || p.equals("/api/auth/me");

        if (!admin && !userProtected) return true;

        try {
          String a = q.getHeader("Authorization");
          if (a == null || !a.startsWith("Bearer ")) {
            throw new RuntimeException("Missing Authorization header");
          }
          var c = jwt.parse(a.substring(7).trim());
          String role = c.get("role", String.class);
          if (admin && !"admin".equals(role)) {
            throw new RuntimeException("Admin role required");
          }
          if (userProtected && !"user".equals(role) && !"admin".equals(role)) {
            throw new RuntimeException("Valid user role required");
          }
          q.setAttribute("sub", c.getSubject());
          return true;
        } catch (Exception e) {
          s.setStatus(401);
          s.setContentType("application/json");
          s.getWriter().write("{\"error\":\"Unauthorized\"}");
          return false;
        }
      }
    }).addPathPatterns("/api/**");
  }
}
