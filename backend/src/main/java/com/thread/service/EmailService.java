package com.thread.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;

@Service
public class EmailService {

  @Autowired(required = false)
  private JavaMailSender mailSender;

  @Value("${thread.mail-from:${spring.mail.username:k42621508@gmail.com}}")
  private String fromAddress;

  public boolean sendSignupOtp(String to, String otp) {
    String subject = "Verify your Thread account";
    String body = "Welcome to Thread!\n\n"
        + "Your verification code is:\n\n"
        + "    " + otp + "\n\n"
        + "This code expires in 5 minutes.\n"
        + "Please enter this code on the verification screen to complete your account registration.\n\n"
        + "If you did not request this code, you can safely ignore this email.\n\n"
        + "Best regards,\nThe Thread Team";
    return sendEmail(to, subject, body);
  }

  public boolean sendLoginOtp(String to, String otp) {
    String subject = "Thread Login Verification Code";
    String body = "Hello,\n\n"
        + "Your Thread login verification code is:\n\n"
        + "    " + otp + "\n\n"
        + "This code expires in 5 minutes.\n"
        + "Please enter this code on the login verification screen to access your account.\n\n"
        + "If you did not attempt to log in, please secure your account immediately.\n\n"
        + "Best regards,\nThe Thread Team";
    return sendEmail(to, subject, body);
  }

  public boolean sendPasswordResetOtp(String to, String otp) {
    String subject = "Thread Password Reset Code";
    String body = "Hello,\n\n"
        + "You requested a password reset for your Thread account.\n\n"
        + "Your verification code is:\n\n"
        + "    " + otp + "\n\n"
        + "This code expires in 5 minutes.\n"
        + "Please enter this code on the reset password screen to create a new password.\n\n"
        + "If you did not request a password reset, please ignore this email.\n\n"
        + "Best regards,\nThe Thread Team";
    return sendEmail(to, subject, body);
  }

  private boolean sendEmail(String to, String subject, String text) {
    if (mailSender == null) {
      System.err.println("[EMAIL WARNING] JavaMailSender not configured. Email to " + to + " skipped.");
      return false;
    }
    try {
      SimpleMailMessage msg = new SimpleMailMessage();
      msg.setFrom(fromAddress);
      msg.setTo(to);
      msg.setSubject(subject);
      msg.setText(text);
      mailSender.send(msg);
      System.out.println("[EMAIL SUCCESS] Sent '" + subject + "' to " + to);
      return true;
    } catch (Exception e) {
      System.err.println("[EMAIL ERROR] Failed sending to " + to + ": " + e.getMessage());
      return false;
    }
  }
}
