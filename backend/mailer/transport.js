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

// The feature is "configured" only when we have a host and credentials. Missing
// any one of them → the daily email stays off (no crash, no half-send).
function isMailConfigured() {
  const { host, user, pass } = mailConfig();
  return Boolean(host && user && pass);
}

// Returns a nodemailer transport, or null when SMTP isn't configured. Port 465
// uses implicit TLS; anything else (e.g. 587) uses STARTTLS via secure:false.
function createTransport() {
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
