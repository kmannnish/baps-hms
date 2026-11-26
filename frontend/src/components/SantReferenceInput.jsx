import React, { useState, useEffect, useRef } from 'react';

/**
 * SantReferenceInput
 *
 * Renders Sant reference name + mobile inputs respecting Admin's
 * `required` / `optional` / `hidden` configuration, with debounced
 * type-ahead autocomplete for previously entered Sant names (when `token`
 * is present, i.e. Reception desk).
 */
export default function SantReferenceInput({
  nameValue,
  mobileValue,
  onChange,
  apiBaseUrl,
  token = null,
  nameRule = 'optional',
  mobileRule = 'optional',
  inputClassName = 'border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full',
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const handleOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  useEffect(() => {
    if (!token || !open || nameRule === 'hidden') return;
    const q = (nameValue || '').trim();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `${apiBaseUrl}/bookings/sant-references?q=${encodeURIComponent(q)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (res.ok) {
          const rows = await res.json();
          setSuggestions(Array.isArray(rows) ? rows : []);
        }
      } catch {
        /* ignore network errors for autocomplete */
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [nameValue, open, token, apiBaseUrl, nameRule]);

  if (nameRule === 'hidden' && mobileRule === 'hidden') return null;

  const pick = (item) => {
    onChange({
      santReferenceName: item.name,
      ...(mobileRule !== 'hidden' && item.mobile ? { santReferenceMobile: item.mobile } : {}),
    });
    setOpen(false);
  };

  return (
    <div className={`grid ${nameRule !== 'hidden' && mobileRule !== 'hidden' ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
      {nameRule !== 'hidden' && (
        <div className="relative" ref={wrapRef}>
          <input
            placeholder={`Sant reference — name ${nameRule === 'required' ? '*' : '(optional)'}`}
            value={nameValue}
            onFocus={() => token && setOpen(true)}
            onChange={(e) => {
              onChange({ santReferenceName: e.target.value });
              if (token) setOpen(true);
            }}
            className={inputClassName}
          />
          {open && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-0.5 bg-white border border-[#2B1610]/20 shadow-lg z-50 max-h-44 overflow-y-auto">
              {suggestions.map((s, idx) => (
                <button
                  type="button"
                  key={`${s.name}-${idx}`}
                  onMouseDown={(e) => { e.preventDefault(); pick(s); }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-[#B8792F]/10 flex items-center justify-between gap-2 border-b border-[#2B1610]/5 last:border-0"
                >
                  <span className="font-medium text-[#2B1610] truncate">{s.name}</span>
                  {s.mobile && <span className="text-[#2B1610]/50 shrink-0">{s.mobile}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {mobileRule !== 'hidden' && (
        <input
          placeholder={`Sant reference — number ${mobileRule === 'required' ? '*' : '(optional)'}`}
          value={mobileValue}
          onChange={(e) => onChange({ santReferenceMobile: e.target.value })}
          className={inputClassName}
        />
      )}
    </div>
  );
}
