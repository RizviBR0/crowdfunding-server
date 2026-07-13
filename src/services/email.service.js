import nodemailer from "nodemailer";

import { env } from "../config/env.js";

let sharedTransporter;

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const isConfigured = (config) => Boolean(config.smtpHost && config.smtpUser && config.smtpPass && config.emailFrom);

export const getEmailConfiguration = (config = env) => ({
  enabled: isConfigured(config),
  host: config.smtpHost || "",
  port: config.smtpPort || 587,
  secure: Boolean(config.smtpSecure),
  user: config.smtpUser || "",
  from: config.emailFrom || "",
  maxAttempts: config.emailMaxAttempts || 2,
});

const getTransporter = ({ config = env, createTransport = nodemailer.createTransport } = {}) => {
  if (!isConfigured(config)) return null;
  const configKey = `${config.smtpHost}:${config.smtpPort}:${config.smtpUser}`;
  if (!sharedTransporter || sharedTransporter.configKey !== configKey) {
    sharedTransporter = {
      configKey,
      transporter: createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpSecure,
        auth: { user: config.smtpUser, pass: config.smtpPass },
      }),
    };
  }
  return sharedTransporter.transporter;
};

const templates = {
  campaign_decision: ({ recipientName, message, metadata }) => ({
    subject: `Campaign ${metadata?.decision === "approved" ? "approved" : "decision updated"} · FundBloom`,
    intro: `Hi ${recipientName || "there"},`,
    message,
    action: "Review your campaigns",
    actionRoute: "/dashboard/creator/campaigns",
  }),
  contribution_created: ({ recipientName, message }) => ({
    subject: "New contribution to your FundBloom campaign",
    intro: `Hi ${recipientName || "there"},`,
    message,
    action: "Review contributions",
    actionRoute: "/dashboard/creator",
  }),
  contribution_decision: ({ recipientName, message }) => ({
    subject: "Your FundBloom contribution was updated",
    intro: `Hi ${recipientName || "there"},`,
    message,
    action: "View contribution history",
    actionRoute: "/dashboard/supporter/contributions",
  }),
  withdrawal_requested: ({ recipientName, message }) => ({
    subject: "Withdrawal request received · FundBloom",
    intro: `Hi ${recipientName || "there"},`,
    message,
    action: "View withdrawals",
    actionRoute: "/dashboard/creator/withdrawals",
  }),
  withdrawal_decision: ({ recipientName, message }) => ({
    subject: "Withdrawal request updated · FundBloom",
    intro: `Hi ${recipientName || "there"},`,
    message,
    action: "View withdrawals",
    actionRoute: "/dashboard/creator/withdrawals",
  }),
};

export const buildNotificationEmail = ({ type, recipientName, message, metadata } = {}) => {
  const template = templates[type] || ((input) => ({
    subject: "FundBloom notification",
    intro: `Hi ${input.recipientName || "there"},`,
    message: input.message,
    action: "Open FundBloom",
    actionRoute: "/dashboard",
  }));
  const content = template({ type, recipientName, message, metadata });
  const safeIntro = escapeHtml(content.intro);
  const safeMessage = escapeHtml(content.message);
  const safeAction = escapeHtml(content.action);
  const safeRoute = escapeHtml(content.actionRoute);
  return {
    subject: content.subject,
    text: `${content.intro}\n\n${content.message}\n\n${content.action}: ${content.actionRoute}`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#312344"><p>${safeIntro}</p><p>${safeMessage}</p><p><a href="${safeRoute}">${safeAction}</a></p><p>FundBloom</p></div>`,
  };
};

export const sendNotificationEmail = async ({
  type,
  toEmail,
  recipientName,
  message,
  metadata,
  config = env,
  createTransport,
  maxAttempts = config.emailMaxAttempts || 2,
} = {}) => {
  if (!toEmail || !isConfigured(config)) {
    return { sent: false, skipped: true, reason: "SMTP_NOT_CONFIGURED" };
  }

  const transporter = getTransporter({ config, createTransport });
  const email = {
    from: config.emailFrom,
    to: toEmail,
    ...buildNotificationEmail({ type, recipientName, message, metadata }),
  };
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await transporter.sendMail(email);
      return { sent: true, skipped: false, attempts: attempt };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};

export const resetEmailTransporter = () => {
  sharedTransporter = undefined;
};
