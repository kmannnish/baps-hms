import React, { useState, useEffect, useRef, useCallback } from 'react';
import { QrCode, X, CheckCircle2, Smartphone, RefreshCcw } from 'lucide-react';
import QRCode from 'qrcode';
import { useAuth } from '../context/AuthContext';

/**
 * QRUploadTrigger
 *
 * Reception clicks "Upload ID" on the PC. This asks the backend for a
 * session id, builds a QR code pointing at THIS PC's own current URL
 * (window.location.origin) plus /upload-id/<sessionId> — since the phone
 * scanning it is on the same WiFi network, that LAN address is reachable
 * directly, no cloud service involved.
 *
 * When the phone finishes uploading, the backend emits a Socket.io event
 * ('id-upload:completed') on the same shared connection the rest of the
 * app already uses — reused here instead of standing up a separate
 * realtime service.
 *
 * props.apiBaseUrl, props.onUploaded: (imageUrl) => void
 */
export default function QRUploadTrigger({ apiBaseUrl, onUploaded }) {
  const { socket } = useAuth();
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [status, setStatus] = useState('pending'); // pending | uploaded
  const [imageUrl, setImageUrl] = useState(null);
  const [error, setError] = useState('');

  const startSession = useCallback(async () => {
    setError('');
    setStatus('pending');
    setImageUrl(null);
    try {
      const res = await fetch(`${apiBaseUrl}/id-uploads/session`, { method: 'POST' });
      const { sessionId: id } = await res.json();
      setSessionId(id);

      // Same-origin LAN URL — reachable by any device on the same WiFi as
      // this PC, no cloud service needed.
      const uploadUrl = `${window.location.origin}/upload-id/${id}`;
      const dataUrl = await QRCode.toDataURL(uploadUrl, { margin: 1, width: 260 });
      setQrDataUrl(dataUrl);
    } catch (err) {
      setError('Could not reach the server. Check the connection and try again.');
    }
  }, [apiBaseUrl]);

  const openModal = () => {
    setOpen(true);
    startSession();
  };

  const closeModal = () => setOpen(false);

  // Listen on the shared socket for this specific session's completion
  useEffect(() => {
    if (!socket || !sessionId) return;
    const handler = (payload) => {
      if (payload.sessionId !== sessionId) return;
      setStatus('uploaded');
      setImageUrl(payload.imageUrl);
      onUploaded?.(payload.imageUrl);
    };
    socket.on('id-upload:completed', handler);
    return () => socket.off('id-upload:completed', handler);
  }, [socket, sessionId, onUploaded]);

  return (
    <>
      <button
        onClick={openModal}
        className="flex items-center gap-2 border border-[#2B1610]/20 text-[#2B1610] px-4 py-2.5 text-sm hover:bg-[#2B1610]/5"
      >
        <QrCode className="w-4 h-4" /> Upload ID
      </button>

      {open && (
        <div className="fixed inset-0 bg-[#2B1610]/60 flex items-center justify-center p-4 z-50">
          <div className="bg-[#F8F4EC] max-w-xs w-full p-6 relative text-center">
            <button
              onClick={closeModal}
              className="absolute top-4 right-4 text-[#2B1610]/40 hover:text-[#2B1610]"
            >
              <X className="w-5 h-5" />
            </button>

            {error && <p className="text-sm text-[#8C3B3B] mb-4">{error}</p>}

            {status === 'pending' && !error && (
              <>
                <h3 className="font-serif text-lg text-[#2B1610] mb-1">Scan to upload ID</h3>
                <p className="text-xs text-[#2B1610]/50 mb-4 flex items-center justify-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5" /> Phone must be on the same WiFi network
                </p>
                {qrDataUrl && (
                  <img src={qrDataUrl} alt="Scan to upload ID" className="mx-auto border border-[#2B1610]/10" />
                )}
                <button
                  onClick={startSession}
                  className="mt-4 flex items-center gap-1.5 mx-auto text-xs text-[#B8792F] hover:underline"
                >
                  <RefreshCcw className="w-3.5 h-3.5" /> Generate a new code
                </button>
              </>
            )}

            {status === 'uploaded' && (
              <>
                <CheckCircle2 className="w-8 h-8 text-[#4A6D5C] mx-auto mb-3" strokeWidth={1.5} />
                <h3 className="font-serif text-lg text-[#2B1610] mb-3">ID received</h3>
                <img
                  src={`${apiBaseUrl}${imageUrl}`}
                  alt="Uploaded ID"
                  className="mx-auto max-h-64 border border-[#2B1610]/10 mb-4"
                />
                <button
                  onClick={closeModal}
                  className="w-full bg-[#2B1610] text-[#F8F4EC] py-2.5 text-sm hover:bg-[#3d2118]"
                >
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
