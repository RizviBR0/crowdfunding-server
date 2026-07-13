import nodemailer from "nodemailer";

import { env } from "../config/env.js";

let sharedTransporter;

const isConfigured = (config) => Boolean(config.smtpHost && config.smtpUser && config.smtpPass && config.emailFrom);

export const getEmailConfiguration = (config = env) => ({
  enabled: isConfigured(config),
  host: config.smtpHost || "",
  port: config.smtpPort || 587,
  secure: Boolean(config.smtpSecure),
  user: config.smtpUser || "",
  from: config.emailFrom || "",
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
  return {
    subject: content.subject,
    text: `${content.intro}\n\n${content.message}\n\n${content.action}: ${content.actionRoute}`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#312344"><p>${content.intro}</p><p>${content.message}</p><p><a href="${content.actionRoute}">${content.action}</a></p><p>FundBloom</p></div>`,
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
} = {}) => {
  if (!toEmail || !isConfigured(config)) {
    return { sent: false, skipped: true, reason: "SMTP_NOT_CONFIGURED" };
  }

  const transporter = getTransporter({ config, createTransport });
  await transporter.sendMail({
    from: config.emailFrom,
    to: toEmail,
    ...buildNotificationEmail({ type, recipientName, message, metadata }),
  });
  return { sent: true, skipped: false };
};

export const resetEmailTransporter = () => {
  sharedTransporter = undefined;
};
