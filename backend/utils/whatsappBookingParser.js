/**
 * Parses the BAPS Jaipur Utara WhatsApp booking template into structured fields.
 * Handles both full templates and partial/varied formatting.
 */

function normalizeDate(raw) {
  if (!raw) return '';
  const cleaned = raw.trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;
  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const m = cleaned.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (!m) return '';
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeTime(raw) {
  if (!raw) return '';
  const cleaned = raw.trim().toUpperCase();
  const m = cleaned.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!m) return '';
  let h = Number(m[1]);
  const min = m[2];
  const ampm = m[3]?.toUpperCase();
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  if (h > 23 || Number(min) > 59) return '';
  return `${String(h).padStart(2, '0')}:${min}`;
}

function extractNumber(raw) {
  if (!raw) return 0;
  const m = String(raw).match(/\d+/);
  return m ? Number(m[0]) : 0;
}

function parseWhatsAppBooking(text) {
  if (!text || typeof text !== 'string') return null;

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const getVal = (pattern) => {
    for (const line of lines) {
      const m = line.match(pattern);
      if (m) return (m[1] || '').trim();
    }
    return '';
  };

  const guestName = getVal(/^(?:\d+\s*[\.\)]\s*)?Full\s*Name\s*:?-+\s*(.+)$/i);
  const rawMobile = getVal(/^(?:\d+\s*[\.\)]\s*)?Mobile\s*(?:No|Number)?\s*:?-+\s*(.+)$/i);
  const mobileDigits = rawMobile.replace(/\D/g, '');
  const mobile = mobileDigits.length > 10 && mobileDigits.startsWith('91')
    ? mobileDigits.slice(-10)
    : mobileDigits;

  const guestCity = getVal(/^(?:\d+\s*[\.\)]\s*)?City(?:\s*\/\s*Address)?\s*:?-+\s*(.+)$/i);
  const checkinDate = normalizeDate(getVal(/^(?:\d+\s*[\.\)]\s*)?(?:Arrival|Check[\s-]*in)\s*Date\s*:?-+\s*(.+)$/i));
  const preferredArrivalTime = normalizeTime(getVal(/^(?:\d+\s*[\.\)]\s*)?(?:Arrival|Check[\s-]*in)\s*Time\s*:?-+\s*(.+)$/i));
  const checkoutDate = normalizeDate(getVal(/^(?:\d+\s*[\.\)]\s*)?(?:Departure|Check[\s-]*out)\s*Date\s*:?-+\s*(.+)$/i));
  const preferredDepartureTime = normalizeTime(getVal(/^(?:\d+\s*[\.\)]\s*)?(?:Departure|Check[\s-]*out)\s*Time\s*:?-+\s*(.+)$/i));

  const totalPerson = extractNumber(getVal(/^(?:\d+\s*[\.\)]\s*)?Total\s*Person\s*:?-+\s*(.+)$/i));
  let paxMen = extractNumber(getVal(/^Gents|Male|Men\s*:?-+\s*(.*)$/i));
  const gentsLine = getVal(/^(?:Gents|Male|Men)\s*:?-+\s*(.+)$/i);
  paxMen = extractNumber(gentsLine);
  const paxWomen = extractNumber(getVal(/^(?:Ladies|Female|Women)\s*:?-+\s*(.+)$/i));
  const paxChildren = extractNumber(getVal(/^(?:Children|Kids)\s*:?-+\s*(.+)$/i));

  if (paxMen === 0 && paxWomen === 0 && paxChildren === 0 && totalPerson > 0) {
    paxMen = totalPerson;
  }

  let roomRequire = getVal(/^(?:\d+\s*[\.\)]\s*)?Room\s*Require(?:d)?\s*:?-+\s*(.+)$/i);
  const dormLine = getVal(/^Dormitory\s*:?-+\s*(.+)$/i);
  const nonAcLine = getVal(/^Non\s*AC\s*Room\s*:?-+\s*(.+)$/i);
  const acLine = getVal(/^AC\s*Room\s*:?-+\s*(.+)$/i);
  if (!roomRequire) {
    if (acLine && !/^no|0|-$/i.test(acLine)) roomRequire = 'AC';
    else if (nonAcLine && !/^no|0|-$/i.test(nonAcLine)) roomRequire = 'Non AC';
    else if (dormLine && !/^no|0|-$/i.test(dormLine)) roomRequire = 'Dormitory';
  }

  const santReferenceName = getVal(/^(?:\d+\s*[\.\)]\s*)?Sant\s*Ref(?:erence)?\s*:?-+\s*(.+)$/i);

  if (!guestName && !mobile && !checkinDate) return null;

  return {
    guestName,
    mobile,
    guestCity,
    checkinDate,
    preferredArrivalTime,
    checkoutDate,
    preferredDepartureTime,
    paxMen,
    paxWomen,
    paxChildren,
    roomRequire,
    santReferenceName,
  };
}

module.exports = { parseWhatsAppBooking, normalizeDate, normalizeTime };
