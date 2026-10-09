import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Camera, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';

/**
 * MobileIdCapture
 *
 * The page a receptionist's phone opens after scanning the QR code from
 * QRUploadTrigger.jsx. Routed at /upload-id/:sessionId. The QR encodes this
 * exact frontend's own LAN URL, so the phone just needs to be on the same
 * WiFi as the Reception PC — no internet, no cloud account.
 *
 * `capture="environment"` opens the rear camera directly on most mobile
 * browsers instead of a file picker.
 *
 * props.apiBaseUrl: the backend's LAN URL, e.g. http://192.168.1.42:4000
 */
export default function MobileIdCapture({ apiBaseUrl }) {
  const { sessionId } = useParams();
  const [status, setStatus] = useState('idle'); // idle | uploading | done | error
  const [errorMessage, setErrorMessage] = useState('');

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !sessionId) return;

    setStatus('uploading');
    setErrorMessage('');
    try {
      const formData = new FormData();
      formData.append('photo', file);

      const res = await fetch(`${apiBaseUrl}/id-uploads/${sessionId}`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error === 'SESSION_NOT_FOUND_OR_EXPIRED'
            ? 'This code has expired. Ask the desk to generate a new one.'
            : 'Upload failed. Check your connection and try again.'
        );
      }

      setStatus('done');
    } catch (err) {
      setErrorMessage(err.message);
      setStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-[#2B1610] flex items-center justify-center px-4">
      <div className="max-w-xs w-full bg-[#F8F4EC] p-8 text-center">
        {status === 'idle' && (
          <>
            <Camera className="w-8 h-8 text-[#B8792F] mx-auto mb-4" strokeWidth={1.5} />
            <h1 className="font-serif text-lg text-[#2B1610] mb-2">Take a photo of the ID</h1>
            <p className="text-sm text-[#2B1610]/50 mb-6">
              This will appear at the reception desk automatically.
            </p>
            <label className="block w-full bg-[#2B1610] text-[#F8F4EC] py-3 text-sm cursor-pointer">
              Open camera
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFile}
              />
            </label>
          </>
        )}

        {status === 'uploading' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <Loader2 className="w-8 h-8 text-[#B8792F] animate-spin" strokeWidth={1.5} />
            <p className="text-sm text-[#2B1610]/60">Uploading…</p>
          </div>
        )}

        {status === 'done' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle2 className="w-8 h-8 text-[#4A6D5C]" strokeWidth={1.5} />
            <p className="text-sm text-[#2B1610]/70">
              Done — it's showing on the reception screen now. You can close this tab.
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <AlertCircle className="w-8 h-8 text-[#8C3B3B]" strokeWidth={1.5} />
            <p className="text-sm text-[#8C3B3B]">{errorMessage}</p>
            <button
              onClick={() => setStatus('idle')}
              className="text-sm text-[#B8792F] hover:underline"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
