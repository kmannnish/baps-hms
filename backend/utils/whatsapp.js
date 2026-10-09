/**
 * utils/whatsapp.js
 *
 * Reads the Admin-configured template for a given status from `settings.whatsapp_templates`,
 * interpolates {{name}} / {{status}} / {{room}}, and builds a wa.me deep link that
 * opens the device's WhatsApp app with the message pre-filled (per spec: "Manual button ...
 * opening the device's WhatsApp with the Admin-configured template pre-filled").
 */

const pool = require('../db');

async function getTemplates() {
  const { rows } = await pool.query(
    `SELECT value FROM settings WHERE key = 'whatsapp_templates'`
  );
  return rows[0]?.value ?? {};
}

function interpolate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

/**
 * @param {'approved'|'rejected'|'modified'} statusKey
 * @param {{ name: string, status: string, room: string, mobile: string }} vars
 * @returns {Promise<string>} wa.me URL
 */
async function buildWhatsAppLink(statusKey, vars) {
  const templates = await getTemplates();
  const template = templates[statusKey] ?? '{{name}}, your booking status is now {{status}}.';
  const message = interpolate(template, vars);

  // Strip non-digits, expects mobile stored with country code (e.g. 919876543210)
  const phone = (vars.mobile || '').replace(/\D/g, '');

  const base = phone ? `https://wa.me/${phone}` : `https://wa.me/`;
  return `${base}?text=${encodeURIComponent(message)}`;
}

module.exports = { buildWhatsAppLink, interpolate, getTemplates };
