/**
 * routes/telegram.js — Telegram webhook endpoint (verified by secret token header).
 */

const express = require('express');
const { getWebhookSecret, handleWebhookUpdate } = require('../services/telegramBot');

module.exports = function telegramRoutes(io) {
  const router = express.Router();

  router.post('/webhook', async (req, res) => {
    const expectedSecret = getWebhookSecret();
    const gotSecret = req.headers['x-telegram-bot-api-secret-token'];
    if (expectedSecret && gotSecret !== expectedSecret) {
      return res.status(401).json({ error: 'INVALID_WEBHOOK_SECRET' });
    }
    // Respond immediately so Telegram never times out, then process asynchronously.
    res.json({ ok: true });
    handleWebhookUpdate(req.body, io).catch((err) => {
      console.error('Telegram update error:', err);
    });
  });

  return router;
};
