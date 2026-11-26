// Transactional email through Cloudflare Email Sending, as HTML with a
// plain-text part (email-templates.ts). Locally the runtime's send_email
// binding is the sink: it writes each message to a file and logs its path,
// so nothing leaves the machine.

import { invitationEmail, magicLinkEmail } from "./email-templates.ts";
import type { RenderedEmail } from "./email-templates.ts";
import type { Env } from "./env.ts";

export const sendEmail = (env: Env, to: string, email: RenderedEmail) =>
  env.EMAIL.send({ from: env.EMAIL_FROM, to, ...email });

export const sendInvitationEmail = async (
  env: Env,
  invitation: {
    id: string;
    email: string;
    organizationName: string;
    inviterName: string;
  },
) => {
  await sendEmail(
    env,
    invitation.email,
    invitationEmail(
      { appUrl: env.APP_URL },
      {
        url: new URL(`/invitations/${invitation.id}`, env.APP_URL).href,
        email: invitation.email,
        orgName: invitation.organizationName,
        inviterName: invitation.inviterName,
      },
    ),
  );
};

export const sendMagicLinkEmail = async (
  env: Env,
  message: { email: string; url: string },
) => {
  await sendEmail(
    env,
    message.email,
    magicLinkEmail({ appUrl: env.APP_URL }, { url: message.url }),
  );
};
