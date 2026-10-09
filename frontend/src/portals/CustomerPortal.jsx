import React, { useState, useEffect } from 'react';
import CustomerBookingForm from '../components/CustomerBookingForm';
import { fetchArray, fetchObject } from '../lib/api';

/**
 * CustomerPortal
 *
 * Public — no login required, per spec. Loads room types and the T&C text for
 * the form. ID photos are NOT collected here: the guest is asked to carry a
 * government ID and Reception records it at check-in, so no sensitive image
 * ever touches the public cloud (and /id-uploads isn't even mounted there).
 */
export default function CustomerPortal({ apiBaseUrl }) {
  const [roomTypes, setRoomTypes] = useState([]);
  const [termsText, setTermsText] = useState('');

  useEffect(() => {
    fetchArray(`${apiBaseUrl}/inventory/room-types`).then((rows) =>
      setRoomTypes(rows.map((rt) => ({ id: rt.id, name: rt.name, basePrice: rt.base_price })))
    );
    fetchObject(`${apiBaseUrl}/settings`).then((s) => setTermsText(s.terms_and_conditions ?? ''));
  }, [apiBaseUrl]);

  const handleSubmit = async (payload) => {
    const res = await fetch(`${apiBaseUrl}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error === 'ROOM_TYPE_FULL' ? 'That room type just filled up — please pick another.' : 'Submission failed.');
    }
    return res.json();
  };

  return (
    <div className="min-h-screen bg-[#2B1610] py-10">
      <CustomerBookingForm
        roomTypes={roomTypes}
        apiBaseUrl={apiBaseUrl}
        onSubmit={handleSubmit}
        termsText={termsText}
      />
    </div>
  );
}
