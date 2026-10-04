package com.thread.api;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.servlet.view.RedirectView;

@Controller
public class RootController {

  @GetMapping("/")
  public RedirectView root() {
    // Automatically redirect root visits on :8080 to the user React app on :5173
    return new RedirectView("http://localhost:5173");
  }
}
