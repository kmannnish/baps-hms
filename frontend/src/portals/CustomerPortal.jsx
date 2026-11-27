import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import CustomerBookingForm from '../components/CustomerBookingForm';
import { fetchArray, fetchObject } from '../lib/api';

/**
 * CustomerPortal
 *
 * Public stay-request page with animated abstract light backdrop, shimmering
 * Jaipur Mandir line-art hero, a subtle Staff Login button, and the Request
 * Stay form directly below.
 */
export default function CustomerPortal({ apiBaseUrl }) {
  const [roomTypes, setRoomTypes] = useState([]);
  const [termsText, setTermsText] = useState('');
  const [formConfig, setFormConfig] = useState(null);

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
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-[#170B08] via-[#2B1610] to-[#1A0D09] text-[#F8F4EC]">
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
      <header className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 pt-4 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="inline-block w-2 h-2 rounded-full bg-[#E3B368] shadow-[0_0_10px_#E3B368]" />
          <span className="text-[11px] uppercase tracking-[0.22em] text-[#F8F4EC]/70">
            BAPS Shri Swaminarayan Mandir · Jaipur
          </span>
        </div>
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 rounded-full border border-[#F8F4EC]/15 bg-white/5 backdrop-blur-md px-3 py-1.5 text-xs text-[#F8F4EC]/80 hover:bg-white/15 hover:text-white transition-all"
        >
          <LogIn className="w-3 h-3 text-[#E3B368]" /> Staff Login
        </Link>
      </header>

      {/* Luminous animated Mandir Line-Art Hero */}
      <div className="relative z-10 max-w-3xl mx-auto px-4 pt-3 pb-2 text-center">
        <div className="relative mx-auto w-full max-w-xl aspect-[1280/676] animate-mandir-float">
          {/* Soft golden radial aura behind Mandir */}
          <div
            className="absolute inset-x-12 inset-y-6 rounded-full blur-2xl opacity-30"
            style={{ background: 'radial-gradient(ellipse at center, #E3B368 0%, transparent 72%)' }}
          />
          {/* Shimmering gold-masked SVG line art */}
          <div
            aria-label="BAPS Jaipur Mandir"
            className="relative w-full h-full animate-shimmer-gold"
            style={{
              backgroundImage: 'linear-gradient(120deg, #F8F4EC 0%, #E3B368 35%, #C77A34 65%, #F8F4EC 100%)',
              WebkitMaskImage: `url(${process.env.PUBLIC_URL}/lineart-jaipur.svg)`,
              maskImage: `url(${process.env.PUBLIC_URL}/lineart-jaipur.svg)`,
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center',
              maskPosition: 'center',
              WebkitMaskSize: 'contain',
              maskSize: 'contain',
            }}
          />
        </div>
      </div>

      {/* Main Request Stay Form */}
      <main className="relative z-10 px-4 pb-14 -mt-4 sm:-mt-8 animate-fade-up">
        <CustomerBookingForm
          roomTypes={roomTypes}
          apiBaseUrl={apiBaseUrl}
          onSubmit={handleSubmit}
          termsText={termsText}
          formConfig={formConfig}
        />
      </main>
    </div>
  );
}
