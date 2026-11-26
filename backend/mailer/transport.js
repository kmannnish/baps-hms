/**
 * mailer/transport.js — builds a nodemailer transport from the Reception PC's
 * .env. SMTP credentials live ONLY here (process.env) — never in the database,
 * never synced to the cloud. See CLAUDE.md.
 *
 * Zero-budget + opt-in: when SMTP_* is blank/missing, isMailConfigured() is
 * false and the whole daily-email feature simply stays dormant (the scheduler
 * logs once and does nothing). No account, no cost, no network calls.
 *
 * Gmail (free): a Google account with 2-Step Verification, then an App Password.
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=465
 *   SMTP_USER=yourname@gmail.com
 *   SMTP_PASS=<16-char App Password, no spaces>
 *   SMTP_FROM=BAPS Jaipur Utara <yourname@gmail.com>   (optional; defaults to SMTP_USER)
 */

const nodemailer = require('nodemailer');

function mailConfig() {
  const host = (process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 465) || 465;
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();
  const from = (process.env.SMTP_FROM || '').trim() || user;
  return { host, port, user, pass, from };
}

function brevoKey() {
  return (process.env.BREVO_API_KEY || '').trim();
}

function parseAddress(raw, fallbackEmail) {
  const s = String(raw || '').trim();
  const m = /^(.*?)\s*<([^>]+)>$/.exec(s);
  if (m) return { name: m[1].trim() || 'BAPS Jaipur Utara', email: m[2].trim() };
  return { name: 'BAPS Jaipur Utara', email: s || fallbackEmail };
}

// The feature is "configured" when we have either BREVO_API_KEY (HTTPS, works on
// Render Free Tier where SMTP ports 465/587 are blocked) or SMTP credentials.
function isMailConfigured() {
  if (brevoKey()) return true;
  const { host, user, pass } = mailConfig();
  return Boolean(host && user && pass);
}

// Returns a nodemailer transport (or a Brevo HTTPS transport with the same
// .sendMail() interface), or null when mail isn't configured.
function createTransport() {
  const apiKey = brevoKey();
  if (apiKey) {
    const { user, from } = mailConfig();
    return {
      async sendMail({ from: msgFrom, to, subject, text, html, attachments }) {
        const sender = parseAddress(msgFrom || from, user || 'utarabapsjaipur@gmail.com');
        const recipients = String(to || '')
          .split(',')
          .map((e) => e.trim())
          .filter(Boolean)
          .map((email) => ({ email }));
        const payload = {
          sender,
          to: recipients,
          subject: subject || 'BAPS Jaipur Utara Report',
          ...(html ? { htmlContent: html } : {}),
          ...(text ? { textContent: text } : {}),
        };
        if (Array.isArray(attachments) && attachments.length > 0) {
          payload.attachment = attachments
            .filter((a) => a && a.content)
            .map((a) => ({
              name: a.filename || 'attachment.pdf',
              content: Buffer.isBuffer(a.content)
                ? a.content.toString('base64')
                : Buffer.from(a.content).toString('base64'),
            }));
        }
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`Brevo API ${res.status}: ${errText}`);
        }
        return res.json();
      },
    };
  }
  const { host, port, user, pass } = mailConfig();
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

module.exports = { createTransport, isMailConfigured, mailConfig };
