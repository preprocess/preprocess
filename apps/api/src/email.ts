// Transactional email through Cloudflare Email Sending. Locally the runtime's
// send_email binding is the sink: it writes each message to a file and logs
// its path, so nothing leaves the machine.

import type { Env } from "./env.ts";

export const sendInvitationEmail = async (
  env: Env,
  invitation: {
    id: string;
    email: string;
    organizationName: string;
    inviterName: string;
  },
) => {
  const url = new URL(`/invitations/${invitation.id}`, env.APP_URL).href;
  await env.EMAIL.send({
    from: env.EMAIL_FROM,
    to: invitation.email,
    subject: `Join ${invitation.organizationName} on Preprocess`,
    text: [
      `${invitation.inviterName} invited you to join ${invitation.organizationName} on Preprocess.`,
      "",
      `Join ${invitation.organizationName}: ${url}`,
      "",
      "If you did not expect this, you can ignore this email.",
    ].join("\n"),
  });
};

export const sendMagicLinkEmail = async (
  env: Env,
  message: { email: string; url: string },
) => {
  await env.EMAIL.send({
    from: env.EMAIL_FROM,
    to: message.email,
    subject: "Your sign-in link for Preprocess",
    text: [
      "Use this link to sign in to Preprocess. It works once and expires in 15 minutes:",
      "",
      message.url,
      "",
      "If you did not ask for it, you can ignore this email.",
    ].join("\n"),
  });
};
