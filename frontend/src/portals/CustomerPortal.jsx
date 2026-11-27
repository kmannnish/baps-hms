import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { LogIn, CalendarPlus, X } from 'lucide-react';
import CustomerBookingForm from '../components/CustomerBookingForm';
import { fetchArray, fetchObject } from '../lib/api';

/**
 * CustomerPortal
 *
 * Full-screen landing page with:
 *  - Subtle flowing Red-White-Red-White-Red BAPS Dhaja abstract line-art ribbons
 *  - Grand Jaipur Mandir line-art backdrop with soft edge-fade transparency
 *  - Centered "Request a Stay" CTA opening the booking form modal
 *  - Minimalist "Staff Login" pill in the top-right
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
    <div className="relative min-h-screen flex flex-col overflow-hidden bg-gradient-to-b from-[#140906] via-[#26130D] to-[#120805] text-[#F8F4EC]">
      {/* Animated abstract ambient orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className="animate-orb-slow absolute -top-32 -left-24 h-[28rem] w-[28rem] rounded-full opacity-25 blur-3xl"
          style={{ background: 'radial-gradient(circle, #E3B368 0%, rgba(199,122,52,0) 70%)' }}
        />
        <div
          className="animate-orb-reverse absolute top-1/4 -right-28 h-[30rem] w-[30rem] rounded-full opacity-20 blur-3xl"
          style={{ background: 'radial-gradient(circle, #C43E3E 0%, rgba(140,59,59,0) 70%)' }}
        />
        <div
          className="animate-orb-slow absolute -bottom-32 left-1/3 h-[26rem] w-[26rem] rounded-full opacity-20 blur-3xl"
          style={{ background: 'radial-gradient(circle, #B8792F 0%, rgba(43,22,16,0) 70%)' }}
        />
      </div>

      {/* BAPS Dhaja (Red-White-Red-White-Red) infinite seamless flowing ribbons */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden opacity-30">
        <svg
          aria-hidden="true"
          viewBox="0 0 2880 900"
          preserveAspectRatio="none"
          className="w-[200%] h-full animate-wave-infinite"
        >
          <g fill="none" strokeLinecap="round" className="animate-flag-flutter">
            {[
              { dy: 0, color: '#D14343', width: 2.2, op: 1 },
              { dy: 14, color: '#F8F4EC', width: 1.5, op: 0.8 },
              { dy: 28, color: '#D14343', width: 2.2, op: 1 },
              { dy: 42, color: '#F8F4EC', width: 1.5, op: 0.8 },
              { dy: 56, color: '#D14343', width: 2.2, op: 1 },
            ].map((b, i) => (
              <path
                key={`top-${i}`}
                d={`M0 ${190 + b.dy} C 360 ${80 + b.dy}, 720 ${300 + b.dy}, 1080 ${190 + b.dy} S 1440 ${190 + b.dy}, 1440 ${190 + b.dy} C 1800 ${80 + b.dy}, 2160 ${300 + b.dy}, 2520 ${190 + b.dy} S 2880 ${190 + b.dy}, 2880 ${190 + b.dy}`}
                stroke={b.color}
                strokeWidth={b.width}
                strokeOpacity={b.op}
              />
            ))}
          </g>
          <g fill="none" strokeLinecap="round" className="animate-flag-flutter-delayed">
            {[
              { dy: 0, color: '#D14343', width: 1.6, op: 0.65 },
              { dy: 12, color: '#F8F4EC', width: 1.2, op: 0.55 },
              { dy: 24, color: '#D14343', width: 1.6, op: 0.65 },
              { dy: 36, color: '#F8F4EC', width: 1.2, op: 0.55 },
              { dy: 48, color: '#D14343', width: 1.6, op: 0.65 },
            ].map((b, i) => (
              <path
                key={`bot-${i}`}
                d={`M0 ${700 + b.dy} C 360 ${790 + b.dy}, 720 ${610 + b.dy}, 1080 ${700 + b.dy} S 1440 ${700 + b.dy}, 1440 ${700 + b.dy} C 1800 ${790 + b.dy}, 2160 ${610 + b.dy}, 2520 ${700 + b.dy} S 2880 ${700 + b.dy}, 2880 ${700 + b.dy}`}
                stroke={b.color}
                strokeWidth={b.width}
                strokeOpacity={b.op}
              />
            ))}
          </g>
        </svg>
      </div>

      {/* Minimalist top bar with small Staff Login */}
      <header className="relative z-20 w-full max-w-6xl mx-auto px-4 sm:px-6 pt-5 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="inline-block w-2 h-2 rounded-full bg-[#E3B368] shadow-[0_0_10px_#E3B368]" />
          <span className="text-[11px] uppercase tracking-[0.22em] text-[#F8F4EC]/75">
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

      {/* Grand Mandir Line Art + Centered CTA */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 pb-10 text-center animate-fade-up">
        <div className="relative w-full max-w-5xl mx-auto -mt-4 sm:-mt-8 animate-mandir-float">
          {/* Warm golden glow behind Mandir */}
          <div
            className="absolute inset-x-16 inset-y-8 rounded-full blur-3xl opacity-35"
            style={{ background: 'radial-gradient(ellipse at center, #E3B368 0%, transparent 72%)' }}
          />
          {/* Big Mandir SVG with smooth edge-fade transparency on left, right & bottom */}
          <div
            className="relative w-full aspect-[1280/676]"
            style={{
              WebkitMaskImage: 'radial-gradient(ellipse 84% 78% at 50% 42%, rgba(0,0,0,1) 42%, rgba(0,0,0,0.45) 72%, rgba(0,0,0,0) 98%)',
              maskImage: 'radial-gradient(ellipse 84% 78% at 50% 42%, rgba(0,0,0,1) 42%, rgba(0,0,0,0.45) 72%, rgba(0,0,0,0) 98%)',
            }}
          >
            <img
              src={`${process.env.PUBLIC_URL}/lineart-jaipur.svg`}
              alt="BAPS Jaipur Mandir"
              className="w-full h-full object-contain select-none opacity-85"
              style={{
                filter: 'brightness(0) saturate(100%) invert(84%) sepia(28%) saturate(560%) hue-rotate(346deg) drop-shadow(0 0 24px rgba(227,179,104,0.4))',
              }}
            />
          </div>
        </div>

        <div className="relative z-20 -mt-10 sm:-mt-16 flex flex-col items-center">
          <h1 className="font-serif text-3xl sm:text-5xl text-[#F8F4EC] tracking-wide mb-2 drop-shadow-[0_4px_20px_rgba(0,0,0,0.7)]">
            BAPS Jaipur Utara
          </h1>
          <p className="text-sm sm:text-base text-[#F8F4EC]/75 max-w-md mb-7 drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)]">
            Guest Accommodation &amp; Stay Request Portal
          </p>

          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2.5 rounded-full bg-gradient-to-r from-[#E3B368] via-[#C77A34] to-[#B8792F] text-[#1A0D09] font-medium px-9 py-3.5 text-sm sm:text-base shadow-[0_12px_40px_rgba(227,179,104,0.4)] hover:scale-[1.04] hover:shadow-[0_16px_48px_rgba(227,179,104,0.55)] active:scale-[0.99] transition-all"
          >
            <CalendarPlus className="w-4 h-4" />
            Request a Stay
          </button>
        </div>
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
