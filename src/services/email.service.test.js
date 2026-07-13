import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildNotificationEmail,
  resetEmailTransporter,
  sendNotificationEmail,
} from "./email.service.js";

const smtpConfig = {
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "mailer@example.com",
  smtpPass: "smtp-password",
  emailFrom: "FundBloom <mailer@example.com>",
};

describe("email service", () => {
  afterEach(() => resetEmailTransporter());

  it("skips delivery safely when SMTP is not configured", async () => {
    await expect(sendNotificationEmail({ toEmail: "creator@example.com", type: "campaign_decision" })).resolves.toEqual({
      sent: false,
      skipped: true,
      reason: "SMTP_NOT_CONFIGURED",
    });
  });

  it("builds a readable campaign decision email", () => {
    const email = buildNotificationEmail({
      type: "campaign_decision",
      recipientName: "Mina Maker",
      message: "Your campaign was approved.",
      metadata: { decision: "approved" },
    });

    expect(email.subject).toContain("approved");
    expect(email.text).toContain("Mina Maker");
    expect(email.html).toContain("Your campaign was approved.");
  });

  it("escapes user-controlled content in HTML email bodies", () => {
    const email = buildNotificationEmail({
      type: "contribution_decision",
      recipientName: "<Mina>",
      message: "<script>alert('x')</script>",
    });

    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });

  it("uses Nodemailer transport and sends a decision email", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "mail_1" });
    const createTransport = vi.fn(() => ({ sendMail }));

    await expect(sendNotificationEmail({
      type: "withdrawal_decision",
      toEmail: "creator@example.com",
      recipientName: "Mina Maker",
      message: "Your withdrawal was approved.",
      config: smtpConfig,
      createTransport,
    })).resolves.toEqual({ sent: true, skipped: false, attempts: 1 });

    expect(createTransport).toHaveBeenCalledWith({
      host: smtpConfig.smtpHost,
      port: smtpConfig.smtpPort,
      secure: smtpConfig.smtpSecure,
      auth: { user: smtpConfig.smtpUser, pass: smtpConfig.smtpPass },
    });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: smtpConfig.emailFrom,
      to: "creator@example.com",
      subject: expect.stringContaining("Withdrawal"),
    }));
  });

  it("retries a transient SMTP failure once by default", async () => {
    const sendMail = vi.fn()
      .mockRejectedValueOnce(new Error("temporary SMTP failure"))
      .mockResolvedValueOnce({ messageId: "mail_2" });
    const createTransport = vi.fn(() => ({ sendMail }));

    await expect(sendNotificationEmail({
      type: "contribution_created",
      toEmail: "creator@example.com",
      message: "A contribution arrived.",
      config: smtpConfig,
      createTransport,
    })).resolves.toEqual({ sent: true, skipped: false, attempts: 2 });
    expect(sendMail).toHaveBeenCalledTimes(2);
  });
});
