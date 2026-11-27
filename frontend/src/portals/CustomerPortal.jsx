import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { LogIn, CalendarPlus, X } from 'lucide-react';
import CustomerBookingForm from '../components/CustomerBookingForm';
import { fetchArray, fetchObject } from '../lib/api';

/**
 * CustomerPortal
 *
 * Clean, modern public landing page with animated abstract ambient orbs,
 * luminous Jaipur Mandir line-art hero, a subtle Staff Login button, and a
 * centered "Request a Stay" CTA that opens the booking form in a modal.
 */
export default function CustomerPortal({ apiBaseUrl }) {
  const [roomTypes, setRoomTypes] = useState([]);
  const [termsText, setTermsText] = useState('');
  const [formConfig, setFormConfig] = useState(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    fetchArray(`${apiBaseUrl}/inventory/room-types?publicOnly=1`).then((rows) =>
      setRoomTypes(rows.map((rt) => ({ id: rt.id, name: rt.name, basePrice: rt.base_price })))
    );
    fetchObject(`${apiBaseUrl}/settings`).then((s) => {
      setTermsText(s.terms_and_conditions ?? '');
      setFormConfig(s.booking_form_config?.online ?? null);
    });
  }, [apiBaseUrl]);

  const handleSubmit = async (payload) => {
    const res = await fetch(`${apiBaseUrl}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        body.error === 'ROOM_TYPE_FULL'
          ? 'That room type just filled up — please pick another.'
          : (body.message || 'Submission failed.')
      );
    }
    return res.json();
  };

  return (
    <div className="relative min-h-screen flex flex-col overflow-hidden bg-gradient-to-b from-[#170B08] via-[#2B1610] to-[#1A0D09] text-[#F8F4EC]">
      {/* Animated abstract ambient orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className="animate-orb-slow absolute -top-28 -left-24 h-96 w-96 rounded-full opacity-25 blur-3xl"
          style={{ background: 'radial-gradient(circle, #E3B368 0%, rgba(199,122,52,0) 70%)' }}
        />
        <div
          className="animate-orb-reverse absolute top-1/3 -right-28 h-[28rem] w-[28rem] rounded-full opacity-20 blur-3xl"
          style={{ background: 'radial-gradient(circle, #C77A34 0%, rgba(140,59,59,0) 70%)' }}
        />
        <div
          className="animate-orb-slow absolute -bottom-32 left-1/3 h-96 w-96 rounded-full opacity-20 blur-3xl"
          style={{ background: 'radial-gradient(circle, #B8792F 0%, rgba(43,22,16,0) 70%)' }}
        />
      </div>

      {/* Minimalist top bar with small Staff Login */}
      <header className="relative z-10 w-full max-w-6xl mx-auto px-4 sm:px-6 pt-5 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="inline-block w-2 h-2 rounded-full bg-[#E3B368] shadow-[0_0_10px_#E3B368]" />
          <span className="text-[11px] uppercase tracking-[0.22em] text-[#F8F4EC]/70">
            BAPS Shri Swaminarayan Mandir · Jaipur
          </span>
        </div>
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 rounded-full border border-[#F8F4EC]/15 bg-white/5 backdrop-blur-md px-3.5 py-1.5 text-xs text-[#F8F4EC]/80 hover:bg-white/15 hover:text-white transition-all"
        >
          <LogIn className="w-3 h-3 text-[#E3B368]" /> Staff Login
        </Link>
      </header>

      {/* Centered Hero with Mandir Line Art + Request Stay Button */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 py-8 text-center animate-fade-up">
        <div className="relative mx-auto w-full max-w-2xl aspect-[1280/676] animate-mandir-float mb-4">
          <div
            className="absolute inset-x-10 inset-y-6 rounded-full blur-3xl opacity-35"
            style={{ background: 'radial-gradient(ellipse at center, #E3B368 0%, transparent 72%)' }}
          />
          <img
            src={`${process.env.PUBLIC_URL}/lineart-jaipur.svg`}
            alt="BAPS Jaipur Mandir"
            className="relative w-full h-full object-contain select-none"
            style={{
              filter: 'brightness(0) saturate(100%) invert(82%) sepia(32%) saturate(620%) hue-rotate(346deg) drop-shadow(0 0 22px rgba(227,179,104,0.45))',
            }}
          />
        </div>

        <h1 className="font-serif text-2xl sm:text-4xl text-[#F8F4EC] tracking-wide mb-2">
          BAPS Jaipur Utara
        </h1>
        <p className="text-sm sm:text-base text-[#F8F4EC]/65 max-w-md mb-7">
          Guest Accommodation &amp; Stay Request Portal
        </p>

        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2.5 rounded-full bg-gradient-to-r from-[#E3B368] via-[#C77A34] to-[#B8792F] text-[#1A0D09] font-medium px-8 py-3.5 text-sm sm:text-base shadow-[0_12px_36px_rgba(227,179,104,0.35)] hover:scale-[1.03] hover:shadow-[0_16px_44px_rgba(227,179,104,0.5)] active:scale-[0.99] transition-all"
        >
          <CalendarPlus className="w-4 h-4" />
          Request a Stay
        </button>
      </main>

      {/* Request Stay Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="relative w-full max-w-2xl my-auto max-h-[92vh] overflow-y-auto rounded-2xl animate-fade-up">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              aria-label="Close"
              className="absolute top-4 right-4 z-10 rounded-full bg-[#2B1610]/10 p-1.5 text-[#2B1610]/60 hover:bg-[#2B1610]/20 hover:text-[#2B1610] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <CustomerBookingForm
              roomTypes={roomTypes}
              apiBaseUrl={apiBaseUrl}
              onSubmit={handleSubmit}
              termsText={termsText}
              formConfig={formConfig}
            />
          </div>
        </div>
      )}
    </div>
  );
}
