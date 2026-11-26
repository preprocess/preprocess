// The system emails (Design's handoff, PRE-66): one HTML template per email,
// built from shared blocks, plus a plain-text part and a subject. Every
// value is escaped in the HTML; the text part is plain. Images are PNGs the
// app serves from its own origin (apps/app/public/brand/email), so every
// install hosts its own and nothing loads from a third party.

const light = {
  bg: "#fbf7f0",
  card: "#f3efe7",
  fg: "#26251e",
  muted: "#6b655c",
  border: "#e6e2db",
  quote: "#d5cfc2",
  tile: "#ddd7cb",
  onFg: "#fbf7f0",
};
const dark = {
  bg: "#15120f",
  card: "#211e1b",
  fg: "#fafafa",
  muted: "#a3a3a3",
  border: "#2c2926",
  quote: "#423f3c",
  tile: "#35312e",
  onFg: "#15120f",
};
const FONT =
  "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const font = (size: number, lineHeight: number, weight = 400) =>
  `font-family:${FONT};font-size:${size}px;line-height:${lineHeight}px;font-weight:${weight};mso-line-height-rule:exactly;`;

export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

// selfHosted drops "on Preprocess" from footers (Chip, 2026-11-26).
export type Brand = { appUrl: string; selfHosted: boolean };

const onPreprocess = (brand: Brand) =>
  brand.selfHosted ? "" : " on Preprocess";

export type RenderedEmail = { subject: string; html: string; text: string };

const assetUrl = (brand: Brand, file: string) =>
  escapeHtml(new URL(`/brand/email/${file}`, brand.appUrl).href);

const page = (brand: Brand, subject: string, preheader: string, body: string) =>
  `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style>table,td,p,a,span,h1{font-family:'Segoe UI',Arial,sans-serif !important;}</style><![endif]-->
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark;}
body{margin:0;padding:0;width:100%;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
a{text-decoration:none;}
@media only screen and (max-width:600px){
.pp-pad{padding:32px 20px 40px !important;}
.pp-h1{font-size:22px !important;line-height:28px !important;}
.pp-btn-wrap{width:100% !important;}
.pp-btn-a{display:block !important;}
}
@media (prefers-color-scheme:dark){
.pp-bg{background-color:${dark.bg} !important;}
.pp-card{background-color:${dark.card} !important;}
.pp-fg{color:${dark.fg} !important;}
.pp-muted{color:${dark.muted} !important;}
.pp-rule{border-top-color:${dark.border} !important;}
.pp-quote{border-left-color:${dark.quote} !important;}
.pp-tile{background-color:${dark.tile} !important;color:${dark.fg} !important;}
.pp-btn{background-color:${dark.fg} !important;}
.pp-btn-a{color:${dark.onFg} !important;}
.pp-img-light{display:none !important;}
.pp-img-dark{display:block !important;}
}
</style>
<style>
[data-ogsc] .pp-fg{color:${dark.fg} !important;}
[data-ogsc] .pp-muted{color:${dark.muted} !important;}
[data-ogsc] .pp-btn-a{color:${dark.onFg} !important;}
[data-ogsb] .pp-bg{background-color:${dark.bg} !important;}
[data-ogsb] .pp-card{background-color:${dark.card} !important;}
[data-ogsb] .pp-btn{background-color:${dark.fg} !important;}
[data-ogsb] .pp-tile{background-color:${dark.tile} !important;}
[data-ogsc] .pp-img-light{display:none !important;}
[data-ogsc] .pp-img-dark{display:block !important;}
</style>
</head>
<body class="pp-bg" style="margin:0;padding:0;background-color:${light.bg};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${light.bg};">${escapeHtml(preheader)}${"&#8199;&#65279;&#847; ".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="pp-bg" bgcolor="${light.bg}" style="background-color:${light.bg};">
<tr><td align="center" valign="top">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
<tr><td class="pp-pad" align="left" style="padding:48px 40px 56px;">
${header(brand)}${body}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
`;

const row = (padding: string, inner: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:${padding};">${inner}</td></tr></table>\n`;

// www.preprocess.com's header lockup: the 20px mark on a 22px canvas, a 10px
// gap, and the name in the system UI font at 18px / 450.
const header = (brand: Brand) => {
  const mark = (file: string, className: string, display: string) =>
    `<img class="${className}" src="${assetUrl(brand, file)}" width="22" height="22" alt="" style="display:${display};border:0;height:22px;width:22px;">`;
  return row(
    "0 0 40px",
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
      '<td valign="top" style="padding:3px 0 0;">' +
      mark("mark.png", "pp-img-light", "block") +
      "<!--[if !mso]><!-->" +
      mark("mark-dark.png", "pp-img-dark", "none") +
      "<!--<![endif]--></td>" +
      `<td valign="top" class="pp-fg" style="padding:0 0 0 9px;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:18px;line-height:28px;mso-line-height-rule:exactly;font-weight:450;font-variation-settings:'wght' 450,'opsz' 16;letter-spacing:-0.02em;color:${light.fg};-webkit-font-smoothing:antialiased;">Preprocess</td>` +
      "</tr></table>",
  );
};

const heading = (html: string, padding = "0 0 12px") =>
  row(
    padding,
    `<h1 class="pp-fg pp-h1" style="margin:0;${font(24, 30, 500)}letter-spacing:-0.02em;color:${light.fg};">${html}</h1>`,
  );

const paragraph = (html: string) =>
  row(
    "0",
    `<p class="pp-fg" style="margin:0;${font(16, 24)}color:${light.fg};">${html}</p>`,
  );

const ICONS = {
  tagged: "at-sign",
  assigned: "user-round-check",
  waiting: "hourglass",
} as const;

const caseCard = (
  brand: Brand,
  kind: keyof typeof ICONS,
  agent: string,
  caseTitle: string,
) => {
  const icon = (file: string, className: string, display: string) =>
    `<img class="${className}" src="${assetUrl(brand, file)}" width="16" height="16" alt="" style="display:${display};border:0;width:16px;height:16px;">`;
  return row(
    "24px 0 0",
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="pp-card" bgcolor="${light.card}" style="background-color:${light.card};border-radius:24px;"><tr><td style="padding:20px 24px;">` +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
      '<td width="16" valign="middle" style="padding:0 8px 0 0;width:16px;">' +
      icon(`icon-${ICONS[kind]}.png`, "pp-img-light", "block") +
      "<!--[if !mso]><!-->" +
      icon(`icon-${ICONS[kind]}-dark.png`, "pp-img-dark", "none") +
      "<!--<![endif]--></td>" +
      `<td valign="middle" class="pp-muted" style="${font(13, 20)}color:${light.muted};">${escapeHtml(agent)} agent</td>` +
      "</tr></table>" +
      `<p class="pp-fg" style="margin:6px 0 0;${font(16, 22, 500)}color:${light.fg};">${escapeHtml(caseTitle)}</p>` +
      "</td></tr></table>",
  );
};

const quote = (label: string | null, value: string) =>
  row(
    "24px 0 0",
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="pp-quote" style="border-left:2px solid ${light.quote};padding:0 0 0 16px;">` +
      (label
        ? `<p class="pp-muted" style="margin:0 0 4px;${font(13, 20)}color:${light.muted};">${label}</p>`
        : "") +
      `<p class="pp-fg" style="margin:0;${font(16, 24)}color:${light.fg};white-space:pre-line;">${escapeHtml(value)}</p>` +
      "</td></tr></table>",
  );

const button = (label: string, url: string) =>
  row(
    "32px 0 0",
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="pp-btn-wrap"><tr>' +
      `<td align="center" class="pp-btn" bgcolor="${light.fg}" style="background-color:${light.fg};border-radius:20px;mso-padding-alt:10px 20px;">` +
      `<a class="pp-btn-a" href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:10px 20px;${font(14, 20, 500)}color:${light.onFg};text-decoration:none;border-radius:20px;">${label}</a>` +
      "</td></tr></table>",
  );

const pasteLink = (url: string) =>
  row(
    "24px 0 0",
    `<p class="pp-muted" style="margin:0;${font(13, 20)}color:${light.muted};">Or paste this link into your browser:<br>` +
      `<a class="pp-muted" href="${escapeHtml(url)}" target="_blank" style="color:${light.muted};text-decoration:underline;word-break:break-all;">${escapeHtml(url)}</a></p>`,
  );

const footer = (html: string) =>
  row(
    "48px 0 0",
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="pp-rule" style="border-top:1px solid ${light.border};padding:24px 0 0;">` +
      `<p class="pp-muted" style="margin:0;${font(13, 20)}color:${light.muted};">${html}</p>` +
      "</td></tr></table>",
  );

const settingsFooter = (brand: Brand, orgName: string, settingsUrl: string) =>
  footer(
    `Sent for ${escapeHtml(orgName)}${onPreprocess(brand)}. You can turn these emails off in <a class="pp-muted" href="${escapeHtml(settingsUrl)}" target="_blank" style="color:${light.muted};text-decoration:underline;">notification settings</a>.`,
  );

const settingsText = (brand: Brand, orgName: string, settingsUrl: string) =>
  `--\nSent for ${orgName}${onPreprocess(brand)}. Turn these emails off in notification settings: ${settingsUrl}\n`;

// The initial on --muted. Images from user.image or organization.logo can be
// on any host, so emails show the initial and load nothing third-party.
const tile = (
  size: number,
  initial: string,
  fontSize: number,
  radius: number,
) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="pp-tile" width="${size}" height="${size}" align="center" valign="middle" bgcolor="${light.tile}" style="width:${size}px;height:${size}px;border-radius:${radius}px;background-color:${light.tile};${font(fontSize, size, 500)}color:${light.fg};text-align:center;">${escapeHtml(initial)}</td></tr></table>`;

const initialOf = (name: string) => (name.trim()[0] ?? "?").toLocaleUpperCase();

const PREHEADER_LIMIT = 100;
const clip = (value: string) => {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > PREHEADER_LIMIT
    ? `${line.slice(0, PREHEADER_LIMIT - 1).trimEnd()}…`
    : line;
};

export const magicLinkEmail = (
  brand: Brand,
  data: { url: string },
): RenderedEmail => {
  const subject = "Your sign-in link for Preprocess";
  return {
    subject,
    html: page(
      brand,
      subject,
      "The link works once and expires in 15 minutes.",
      heading("Sign in to Preprocess") +
        paragraph("This link works once and expires in 15 minutes.") +
        button("Sign in", data.url) +
        pasteLink(data.url) +
        footer("If you didn’t ask to sign in, you can ignore this email."),
    ),
    text: `Sign in to Preprocess\n\nUse this link to sign in. It works once and expires in 15 minutes:\n\n${data.url}\n\nIf you didn’t ask to sign in, you can ignore this email.\n`,
  };
};

export const invitationEmail = (
  brand: Brand,
  data: { url: string; email: string; orgName: string; inviterName: string },
): RenderedEmail => {
  const org = escapeHtml(data.orgName);
  const inviter = escapeHtml(data.inviterName);
  const subject = `Join ${data.orgName} on Preprocess`;
  return {
    subject,
    html: page(
      brand,
      subject,
      `${data.inviterName} invited you to join ${data.orgName}.`,
      row("0 0 20px", tile(48, initialOf(data.orgName), 20, 14)) +
        heading(`Join ${org} on Preprocess`) +
        row(
          "0",
          '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
            `<td valign="top" style="padding:0 10px 0 0;width:24px;">${tile(24, initialOf(data.inviterName), 11, 12)}</td>` +
            `<td valign="top" class="pp-fg" style="${font(16, 24)}color:${light.fg};">${inviter} invited you to join ${org}.</td>` +
            "</tr></table>",
        ) +
        button(`Join ${org}`, data.url) +
        pasteLink(data.url) +
        footer(
          `This invitation was sent to ${escapeHtml(data.email)}. If you didn’t expect it, you can ignore this email.`,
        ),
    ),
    text: `Join ${data.orgName} on Preprocess\n\n${data.inviterName} invited you to join ${data.orgName}.\n\nJoin ${data.orgName}: ${data.url}\n\nThis invitation was sent to ${data.email}. If you didn’t expect it, you can ignore this email.\n`,
  };
};

type CaseData = {
  url: string;
  settingsUrl: string;
  orgName: string;
  agent: string;
  caseTitle: string | null;
};

export const taggedEmail = (
  brand: Brand,
  data: CaseData & { tagger: string; groupName: string; message: string },
): RenderedEmail => {
  const title = data.caseTitle ?? "a case";
  const subject = `${data.groupName} was tagged on ${title} (${data.agent})`;
  return {
    subject,
    html: page(
      brand,
      subject,
      clip(data.message),
      heading(
        `${escapeHtml(data.tagger)} tagged ${escapeHtml(data.groupName)}`,
        "0",
      ) +
        caseCard(brand, "tagged", data.agent, title) +
        quote(null, data.message) +
        button("Open case", data.url) +
        settingsFooter(brand, data.orgName, data.settingsUrl),
    ),
    text: `${data.tagger} tagged ${data.groupName} on ${title}:\n\n${data.message}\n\nOpen the case: ${data.url}\n\n${settingsText(brand, data.orgName, data.settingsUrl)}`,
  };
};

export const assignedEmail = (brand: Brand, data: CaseData): RenderedEmail => {
  const title = data.caseTitle ?? "A case";
  const subject = `${title} (${data.agent}) was assigned to you`;
  return {
    subject,
    html: page(
      brand,
      subject,
      `${title} on the ${data.agent} agent.`,
      heading("A case was assigned to you", "0") +
        caseCard(brand, "assigned", data.agent, title) +
        button("Open case", data.url) +
        settingsFooter(brand, data.orgName, data.settingsUrl),
    ),
    text: `${title} on the ${data.agent} agent was assigned to you.\n\nOpen the case: ${data.url}\n\n${settingsText(brand, data.orgName, data.settingsUrl)}`,
  };
};

export const waitingEmail = (
  brand: Brand,
  data: CaseData & { groupName: string; reason: string | null },
): RenderedEmail => {
  const title = data.caseTitle ?? "A case";
  const subject = `${title} (${data.agent}) is waiting on ${data.groupName}`;
  return {
    subject,
    html: page(
      brand,
      subject,
      `${title} on the ${data.agent} agent.${data.reason ? ` ${clip(data.reason)}` : ""}`,
      heading(`A case is waiting on ${escapeHtml(data.groupName)}`, "0") +
        caseCard(brand, "waiting", data.agent, title) +
        (data.reason ? quote("Reason", data.reason) : "") +
        button("Open case", data.url) +
        settingsFooter(brand, data.orgName, data.settingsUrl),
    ),
    text: `${title} on the ${data.agent} agent is waiting on ${data.groupName}.\n\n${data.reason ? `Reason: ${data.reason}\n\n` : ""}Open the case: ${data.url}\n\n${settingsText(brand, data.orgName, data.settingsUrl)}`,
  };
};

// Composed from the handoff's blocks; Design approved the copy.
export const webhookDisabledEmail = (
  brand: Brand,
  data: { url: string; endpointUrl: string; orgName: string; days: number },
): RenderedEmail => {
  const period = data.days === 1 ? "1 day" : `${data.days} days`;
  const subject = "A Preprocess webhook endpoint was disabled";
  return {
    subject,
    html: page(
      brand,
      subject,
      `Every delivery to ${data.endpointUrl} failed for ${period}.`,
      heading("A webhook endpoint was disabled") +
        paragraph(
          `Every delivery to ${escapeHtml(data.endpointUrl)} failed for ${period}, so the endpoint was disabled. Fix the receiver, then enable it again.`,
        ) +
        button("Open webhooks", data.url) +
        footer(
          `Sent to the owners and admins of ${escapeHtml(data.orgName)}${onPreprocess(brand)}.`,
        ),
    ),
    text: `Every delivery to ${data.endpointUrl} failed for ${period}, so the endpoint was disabled.\n\nFix the receiver, then enable it again: ${data.url}\n\n--\nSent to the owners and admins of ${data.orgName}${onPreprocess(brand)}.\n`,
  };
};

export const longDate = (at: Date) =>
  at.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

// Three days before Team ends (PRE-96), to each person losing a seat.
export const seatEndingEmail = (
  brand: Brand,
  data: { url: string; orgName: string; at: Date; email: string },
): RenderedEmail => {
  const date = longDate(data.at);
  const subject = `Your access to ${data.orgName} changes on ${date}`;
  const line = `${data.orgName} moves from Team to Free on ${date}, which includes 3 developer and operator seats. Starting then, your access changes to viewer—you can still read cases and none of your work is deleted, but you won’t be able to deploy, run evals or work cases. If you still need access, ask an Owner.`;
  const sentTo = `Sent to ${data.email} as a member of ${data.orgName}${onPreprocess(brand)}.`;
  return {
    subject,
    html: page(
      brand,
      subject,
      clip(line),
      heading(escapeHtml(`Your access changes on ${date}`)) +
        paragraph(escapeHtml(line)) +
        button(escapeHtml(`Open ${data.orgName}`), data.url) +
        footer(escapeHtml(sentTo)),
    ),
    text: `${line}\n\nOpen ${data.orgName}: ${data.url}\n\n--\n${sentTo}\n`,
  };
};

// When Team has ended (PRE-96), to the Owners: what changed with it.
export const planSwitchedEmail = (
  brand: Brand,
  data: {
    url: string;
    orgName: string;
    demoted: string[];
    pausedAgents: string[];
  },
): RenderedEmail => {
  const subject = `${data.orgName} moved to Free`;
  const n = data.demoted.length;
  const lines = [
    ...(n
      ? [
          n === 1
            ? `1 person moved to viewer: ${data.demoted[0]}. Upgrade to Team any time to restore their previous role in one click.`
            : `${n} people moved to viewer: ${data.demoted.join(", ")}. Upgrade to Team any time to restore their previous roles in one click.`,
        ]
      : []),
    ...(data.pausedAgents.length
      ? [
          `Paused because they use a custom environment: ${data.pausedAgents.join(", ")}. They resume automatically if you return to Team.`,
        ]
      : []),
    "Free includes 1,000 cases a month, and storage over 5 GB bills at $0.10/GB-month at month end. Your credits and auto-reload carried over unchanged.",
  ];
  const sentTo = `Sent to the owners of ${data.orgName}${onPreprocess(brand)}.`;
  return {
    subject,
    html: page(
      brand,
      subject,
      clip(lines[0]!),
      heading(escapeHtml(`${data.orgName} is now on Free`)) +
        lines.map((l) => paragraph(escapeHtml(l))).join("") +
        button("Open Billing", data.url) +
        footer(escapeHtml(sentTo)),
    ),
    text: `${lines.join("\n\n")}\n\nOpen Billing: ${data.url}\n\n--\n${sentTo}\n`,
  };
};
