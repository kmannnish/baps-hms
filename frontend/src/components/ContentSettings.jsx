import React, { useState, useEffect, useRef } from 'react';
import { Save, Loader2, MessageCircleMore, FileText, Percent, Clock, Music, Play, Upload, Building2, Mail, Send, Image as ImageIcon, Soup, ShieldCheck } from 'lucide-react';
import { fetchObject, fetchArray } from '../lib/api';

/**
 * ContentSettings
 *
 * Admin screen to edit guest-facing text (T&C popup, WhatsApp templates),
 * billing configuration (tax on/off + percentage), the bill/invoice branding
 * printed on the PDF, and the daily email report to Swami Ji.
 *
 * Reads through the AUTHENTICATED GET /settings/manage (not the public
 * GET /settings) so private keys like the daily-report recipient come back.
 * SMTP credentials are NOT settings — they live in the PC's .env only.
 *
 * props.apiBaseUrl, props.token
 */
export default function ContentSettings({ apiBaseUrl, token }) {
  const [terms, setTerms] = useState('');
  const [templates, setTemplates] = useState({ approved: '', rejected: '', modified: '' });
  const [taxEnabled, setTaxEnabled] = useState(true);
  const [gstPercent, setGstPercent] = useState(5);
  const [checkinTime, setCheckinTime] = useState('14:00');
  const [checkoutTime, setCheckoutTime] = useState('11:00');
  const [sounds, setSounds] = useState([]);
  const [activeSoundId, setActiveSoundId] = useState(null);
  const [uploadingSound, setUploadingSound] = useState(false);
  const soundFileRef = useRef(null);

  // Bill / invoice branding (printed on the PDF — see backend/pdf/receipt.js).
  const [branding, setBranding] = useState({
    org_name: '', org_address: '', org_gstin: '', org_phone: '', org_email: '',
    invoice_prefix: '', org_logo_url: '',
  });
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoFileRef = useRef(null);

  // Daily email report (see backend/mailer/dailyReport.js).
  const [dailyReport, setDailyReport] = useState({ enabled: false, time: '20:00', recipient: '' });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // Bhojanshala (dining hall) — meal timings drive the "current meal" cut-offs,
  // and the daily head-count report goes to this email / falls back to WhatsApp
  // on this mobile. SMTP creds still live in .env, same as the daily report.
  const [bhojan, setBhojan] = useState({
    breakfast_time: '07:30', lunch_time: '11:30', dinner_time: '19:30',
    email: '', mobile: '', report_enabled: false, report_time: '06:30',
  });

  // Feature toggle: let Reception approve/reject a pending booking on Swami Ji's
  // behalf (recording his phone/WhatsApp decision) with a mandatory note.
  const [receptionApproveOnBehalf, setReceptionApproveOnBehalf] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => {
    const bearer = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetchObject(`${apiBaseUrl}/settings/manage`, { headers: bearer }, {}),
      fetchArray(`${apiBaseUrl}/settings/notification-sounds`, { headers: bearer }),
    ]).then(([s, snds]) => {
      setTerms(s.terms_and_conditions ?? '');
      setTemplates(s.whatsapp_templates ?? { approved: '', rejected: '', modified: '' });
      setTaxEnabled(s.tax_enabled !== false);
      setGstPercent(Number(s.gst_percent ?? 5));
      setCheckinTime(s.default_checkin_time ?? '14:00');
      setCheckoutTime(s.default_checkout_time ?? '11:00');
      setActiveSoundId(s.notification_sound_id ?? null);
      setBranding({
        org_name: s.org_name ?? '',
        org_address: s.org_address ?? '',
        org_gstin: s.org_gstin ?? '',
        org_phone: s.org_phone ?? '',
        org_email: s.org_email ?? '',
        invoice_prefix: s.invoice_prefix ?? '',
        org_logo_url: s.org_logo_url ?? '',
      });
      setDailyReport({
        enabled: s.daily_report_enabled === true,
        time: s.daily_report_time ?? '20:00',
        recipient: s.daily_report_recipient ?? '',
      });
      setBhojan({
        breakfast_time: s.bhojan_breakfast_time ?? '07:30',
        lunch_time: s.bhojan_lunch_time ?? '11:30',
        dinner_time: s.bhojan_dinner_time ?? '19:30',
        email: s.bhojanshala_email ?? '',
        mobile: s.bhojanshala_mobile ?? '',
        report_enabled: s.bhojan_report_enabled === true,
        report_time: s.bhojan_report_time ?? '06:30',
      });
      setReceptionApproveOnBehalf(s.reception_approve_on_behalf === true);
      setSounds(snds);
      setLoading(false);
    });
  }, [apiBaseUrl, token]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await fetch(`${apiBaseUrl}/settings`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({
          terms_and_conditions: terms,
          whatsapp_templates: templates,
          tax_enabled: taxEnabled,
          gst_percent: gstPercent,
          default_checkin_time: checkinTime,
          default_checkout_time: checkoutTime,
          notification_sound_id: activeSoundId,
          org_name: branding.org_name,
          org_address: branding.org_address,
          org_gstin: branding.org_gstin,
          org_phone: branding.org_phone,
          org_email: branding.org_email,
          invoice_prefix: branding.invoice_prefix,
          org_logo_url: branding.org_logo_url,
          daily_report_enabled: dailyReport.enabled,
          daily_report_time: dailyReport.time,
          daily_report_recipient: dailyReport.recipient,
          bhojan_breakfast_time: bhojan.breakfast_time,
          bhojan_lunch_time: bhojan.lunch_time,
          bhojan_dinner_time: bhojan.dinner_time,
          bhojanshala_email: bhojan.email,
          bhojanshala_mobile: bhojan.mobile,
          bhojan_report_enabled: bhojan.report_enabled,
          bhojan_report_time: bhojan.report_time,
          reception_approve_on_behalf: receptionApproveOnBehalf,
        }),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const uploadSound = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingSound(true);
    const fd = new FormData();
    fd.append('sound', file);
    fd.append('label', file.name.replace(/\.[^.]+$/, ''));
    const res = await fetch(`${apiBaseUrl}/settings/notification-sound`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    if (res.ok) {
      const newSound = await res.json();
      setSounds((prev) => [newSound, ...prev]);
      setActiveSoundId(newSound.id);
    }
    setUploadingSound(false);
    e.target.value = '';
  };

  const previewSound = (filename) => {
    const audio = new Audio(`${apiBaseUrl.replace('/api', '')}/uploads/sounds/${filename}`);
    audio.play().catch(() => {});
  };

  const uploadLogo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    const fd = new FormData();
    fd.append('logo', file);
    const res = await fetch(`${apiBaseUrl}/settings/branding-logo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    if (res.ok) {
      const { org_logo_url } = await res.json();
      setBranding((prev) => ({ ...prev, org_logo_url }));
    }
    setUploadingLogo(false);
    e.target.value = '';
  };

  const sendTestEmail = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${apiBaseUrl}/reports/daily-email/test`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(dailyReport.recipient ? { to: dailyReport.recipient } : {}),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.sent) {
        setTestResult({ ok: true, message: `Sent to ${body.to}.` });
      } else {
        setTestResult({ ok: false, message: body.message || body.error || 'Could not send the test email.' });
      }
    } catch {
      setTestResult({ ok: false, message: 'Could not reach the server to send the test email.' });
    } finally {
      setTesting(false);
    }
  };

  const logoSrc = branding.org_logo_url
    ? (/^https?:\/\//i.test(branding.org_logo_url)
        ? branding.org_logo_url
        : `${apiBaseUrl.replace('/api', '')}${branding.org_logo_url}`)
    : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-[#2B1610]/40">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h3 className="font-serif text-lg text-[#2B1610] mb-1 flex items-center gap-2">
          <Percent className="w-4 h-4 text-[#B8792F]" /> Tax (GST)
        </h3>
        <p className="text-xs text-[#2B1610]/50 mb-3">
          Applies to every booking's final amount at approval, check-in billing edits, and
          payment calculations across the whole system.
        </p>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={taxEnabled}
              onChange={(e) => setTaxEnabled(e.target.checked)}
              className="accent-[#B8792F]"
            />
            <span className="text-sm text-[#2B1610]/80">Charge tax on bookings</span>
          </label>
          {taxEnabled && (
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={gstPercent}
                onChange={(e) => setGstPercent(Number(e.target.value))}
                className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm w-20"
              />
              <span className="text-sm text-[#2B1610]/60">% GST</span>
            </div>
          )}
        </div>
      </div>

      {/* Bill / invoice branding — printed on the PDF bill and the daily report */}
      <div>
        <h3 className="font-serif text-lg text-[#2B1610] mb-1 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-[#B8792F]" /> Bill / invoice details
        </h3>
        <p className="text-xs text-[#2B1610]/50 mb-3">
          Shown in the header of the printed and emailed PDF bill. Leave a field blank to omit it.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1">Organisation name</label>
            <input
              value={branding.org_name}
              onChange={(e) => setBranding({ ...branding, org_name: e.target.value })}
              placeholder="BAPS Jaipur Utara"
              className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1">Address</label>
            <textarea
              value={branding.org_address}
              onChange={(e) => setBranding({ ...branding, org_address: e.target.value })}
              className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full h-16 resize-none"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1">GSTIN</label>
            <input
              value={branding.org_gstin}
              onChange={(e) => setBranding({ ...branding, org_gstin: e.target.value })}
              className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1">Invoice prefix</label>
            <input
              value={branding.invoice_prefix}
              onChange={(e) => setBranding({ ...branding, invoice_prefix: e.target.value })}
              placeholder="e.g. BAPS/"
              className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1">Phone</label>
            <input
              value={branding.org_phone}
              onChange={(e) => setBranding({ ...branding, org_phone: e.target.value })}
              className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1">Email</label>
            <input
              value={branding.org_email}
              onChange={(e) => setBranding({ ...branding, org_email: e.target.value })}
              className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full"
            />
          </div>
        </div>
        <div className="mt-3">
          <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1.5">Logo</label>
          <div className="flex items-center gap-4">
            {logoSrc ? (
              <img src={logoSrc} alt="Organisation logo" className="h-16 w-16 object-contain border border-[#2B1610]/15 bg-white" />
            ) : (
              <div className="h-16 w-16 flex items-center justify-center border border-dashed border-[#2B1610]/20 text-[#2B1610]/30">
                <ImageIcon className="w-5 h-5" />
              </div>
            )}
            <input ref={logoFileRef} type="file" accept="image/*" className="hidden" onChange={uploadLogo} />
            <button
              type="button"
              onClick={() => logoFileRef.current?.click()}
              disabled={uploadingLogo}
              className="flex items-center gap-1.5 text-sm text-[#B8792F] hover:underline disabled:opacity-50"
            >
              {uploadingLogo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {branding.org_logo_url ? 'Replace logo' : 'Upload logo'}
            </button>
          </div>
        </div>
      </div>

      <div>
        <h3 className="font-serif text-lg text-[#2B1610] mb-1 flex items-center gap-2">
          <Clock className="w-4 h-4 text-[#B8792F]" /> Check-in &amp; checkout times
        </h3>
        <p className="text-xs text-[#2B1610]/50 mb-3">
          Default times used for checkout reminders and overdue calculations.
        </p>
        <div className="flex items-center gap-6">
          <div>
            <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1">Check-in time</label>
            <input
              type="time"
              value={checkinTime}
              onChange={(e) => setCheckinTime(e.target.value)}
              className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1">Checkout time</label>
            <input
              type="time"
              value={checkoutTime}
              onChange={(e) => setCheckoutTime(e.target.value)}
              className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm"
            />
          </div>
        </div>
      </div>

      <div>
        <h3 className="font-serif text-lg text-[#2B1610] mb-1 flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#B8792F]" /> Terms &amp; conditions popup
        </h3>
        <p className="text-xs text-[#2B1610]/50 mb-2">
          Shown to guests before they submit the Customer Portal booking form.
        </p>
        <textarea
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          className="w-full border border-[#2B1610]/20 bg-white px-3 py-2 text-sm h-24 resize-none"
        />
      </div>

      <div>
        <h3 className="font-serif text-lg text-[#2B1610] mb-1 flex items-center gap-2">
          <MessageCircleMore className="w-4 h-4 text-[#B8792F]" /> WhatsApp message templates
        </h3>
        <p className="text-xs text-[#2B1610]/50 mb-3">
          Use <code className="bg-[#2B1610]/5 px-1">{'{{name}}'}</code>,{' '}
          <code className="bg-[#2B1610]/5 px-1">{'{{status}}'}</code>, and{' '}
          <code className="bg-[#2B1610]/5 px-1">{'{{room}}'}</code> — they'll be filled in automatically.
        </p>
        <div className="space-y-4">
          {['approved', 'rejected', 'modified'].map((key) => (
            <div key={key}>
              <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1">{key}</label>
              <textarea
                value={templates[key] ?? ''}
                onChange={(e) => setTemplates({ ...templates, [key]: e.target.value })}
                className="w-full border border-[#2B1610]/20 bg-white px-3 py-2 text-sm h-16 resize-none"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Daily email report to Swami Ji */}
      <div>
        <h3 className="font-serif text-lg text-[#2B1610] mb-1 flex items-center gap-2">
          <Mail className="w-4 h-4 text-[#B8792F]" /> Daily email report
        </h3>
        <p className="text-xs text-[#2B1610]/50 mb-3">
          At the time below, the Reception PC emails a PDF with the day's income, bookings,
          current occupancy, and the next 7 days. SMTP credentials (a free Gmail App Password)
          are set in the PC's <code className="bg-[#2B1610]/5 px-1">.env</code> file — not here —
          and the report stays off until they're configured.
        </p>
        <div className="flex items-center gap-4 mb-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={dailyReport.enabled}
              onChange={(e) => setDailyReport({ ...dailyReport, enabled: e.target.checked })}
              className="accent-[#B8792F]"
            />
            <span className="text-sm text-[#2B1610]/80">Send a daily report</span>
          </label>
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-[#2B1610]/60">at</span>
            <input
              type="time"
              value={dailyReport.time}
              onChange={(e) => setDailyReport({ ...dailyReport, time: e.target.value })}
              className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm"
            />
          </div>
        </div>
        <div className="mb-3">
          <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1">Recipient email</label>
          <input
            type="email"
            value={dailyReport.recipient}
            onChange={(e) => setDailyReport({ ...dailyReport, recipient: e.target.value })}
            placeholder="Defaults to Swami Ji's account email"
            className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full sm:w-96"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={sendTestEmail}
            disabled={testing}
            className="flex items-center gap-1.5 border border-[#B8792F] text-[#B8792F] px-4 py-2 text-sm hover:bg-[#B8792F]/10 disabled:opacity-50"
          >
            {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Send test now
          </button>
          {testResult && (
            <span className={`text-sm ${testResult.ok ? 'text-[#4A6D5C]' : 'text-[#8C3B3B]'}`}>
              {testResult.message}
            </span>
          )}
        </div>
      </div>

      {/* Bhojanshala (dining hall) */}
      <div>
        <h3 className="font-serif text-lg text-[#2B1610] mb-1 flex items-center gap-2">
          <Soup className="w-4 h-4 text-[#B8792F]" /> Bhojanshala (dining)
        </h3>
        <p className="text-xs text-[#2B1610]/50 mb-3">
          The dining-hall head-count view highlights the <em>current</em> meal by the time of
          day using the cut-offs below (Breakfast until the lunch time, Lunch until the dinner
          time, then Dinner). The daily count is emailed to the Bhojanshala; if email isn't set
          up it falls back to a WhatsApp link to the mobile number below.
        </p>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1">Breakfast from</label>
            <input
              type="time"
              value={bhojan.breakfast_time}
              onChange={(e) => setBhojan({ ...bhojan, breakfast_time: e.target.value })}
              className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm w-full"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1">Lunch from</label>
            <input
              type="time"
              value={bhojan.lunch_time}
              onChange={(e) => setBhojan({ ...bhojan, lunch_time: e.target.value })}
              className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm w-full"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1">Dinner from</label>
            <input
              type="time"
              value={bhojan.dinner_time}
              onChange={(e) => setBhojan({ ...bhojan, dinner_time: e.target.value })}
              className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm w-full"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1">Bhojanshala email</label>
            <input
              type="email"
              value={bhojan.email}
              onChange={(e) => setBhojan({ ...bhojan, email: e.target.value })}
              placeholder="kitchen@example.org"
              className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1">WhatsApp fallback mobile</label>
            <input
              type="tel"
              value={bhojan.mobile}
              onChange={(e) => setBhojan({ ...bhojan, mobile: e.target.value })}
              placeholder="10-digit number"
              className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full"
            />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={bhojan.report_enabled}
              onChange={(e) => setBhojan({ ...bhojan, report_enabled: e.target.checked })}
              className="accent-[#B8792F]"
            />
            <span className="text-sm text-[#2B1610]/80">Email the day's count automatically</span>
          </label>
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-[#2B1610]/60">at</span>
            <input
              type="time"
              value={bhojan.report_time}
              onChange={(e) => setBhojan({ ...bhojan, report_time: e.target.value })}
              className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm"
            />
          </div>
        </div>
        <p className="text-xs text-[#2B1610]/40 mt-2">
          Uses the same SMTP settings as the daily report (the PC's{' '}
          <code className="bg-[#2B1610]/5 px-1">.env</code>). Reception can also send it on
          demand from the Bhojanshala tab.
        </p>
      </div>

      {/* Reception approve-on-behalf toggle */}
      <div>
        <h3 className="font-serif text-lg text-[#2B1610] mb-1 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#B8792F]" /> Reception approvals
        </h3>
        <p className="text-xs text-[#2B1610]/50 mb-3">
          When on, Reception can approve or reject a pending online booking on Swami Ji's
          behalf — recording his phone/WhatsApp decision — with a mandatory note of who
          approved it. Leave off to require Swami Ji to decide every online booking himself.
        </p>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={receptionApproveOnBehalf}
            onChange={(e) => setReceptionApproveOnBehalf(e.target.checked)}
            className="accent-[#B8792F]"
          />
          <span className="text-sm text-[#2B1610]/80">Let Reception approve bookings on behalf of Swami Ji</span>
        </label>
      </div>

      <div>
        <h3 className="font-serif text-lg text-[#2B1610] mb-1 flex items-center gap-2">
          <Music className="w-4 h-4 text-[#B8792F]" /> Notification sound
        </h3>
        <p className="text-xs text-[#2B1610]/50 mb-3">
          Played at Reception when a checkout reminder fires. Upload an MP3 (max 5 MB).
        </p>
        <div className="space-y-2 mb-3">
          {sounds.length === 0 && <p className="text-xs text-[#2B1610]/40">No sounds uploaded yet.</p>}
          {sounds.map((s) => (
            <div key={s.id} className="flex items-center gap-3">
              <input
                type="radio"
                name="activeSound"
                value={s.id}
                checked={activeSoundId === s.id}
                onChange={() => setActiveSoundId(s.id)}
                className="accent-[#B8792F]"
              />
              <span className="text-sm text-[#2B1610]/80 flex-1">{s.label}</span>
              <button
                type="button"
                onClick={() => previewSound(s.filename)}
                className="text-[#B8792F] hover:text-[#2B1610] flex items-center gap-1 text-xs"
              >
                <Play className="w-3 h-3" /> Play
              </button>
            </div>
          ))}
        </div>
        <input ref={soundFileRef} type="file" accept=".mp3,audio/*" className="hidden" onChange={uploadSound} />
        <button
          type="button"
          onClick={() => soundFileRef.current?.click()}
          disabled={uploadingSound}
          className="flex items-center gap-1.5 text-sm text-[#B8792F] hover:underline disabled:opacity-50"
        >
          {uploadingSound ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          Upload MP3
        </button>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="flex items-center gap-2 bg-[#2B1610] text-[#F8F4EC] px-5 py-2.5 text-sm hover:bg-[#3d2118] disabled:opacity-60"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {saving ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
      </button>
    </div>
  );
}
