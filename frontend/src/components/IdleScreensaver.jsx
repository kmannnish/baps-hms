import React, { useState, useEffect, useRef } from 'react';

const IDLE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * IdleScreensaver
 *
 * After 5 minutes of no mouse/keyboard/touch/scroll activity in Reception,
 * displays the animated BAPS Jaipur Mandir + BAPS Dhaja ribbons screensaver
 * (without the Request a Stay button). Any click, tap, or keystroke wakes it
 * up immediately with all unsaved/incomplete form state intact underneath.
 */
export default function IdleScreensaver({ timeoutMs = IDLE_MS }) {
  const [sleeping, setSleeping] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    const resetTimer = () => {
      setSleeping(false);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setSleeping(true), timeoutMs);
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [timeoutMs]);

  if (!sleeping) return null;

  return (
    <div
      onClick={() => setSleeping(false)}
      className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-gradient-to-b from-[#140906] via-[#26130D] to-[#120805] text-[#F8F4EC] cursor-pointer select-none animate-fade-up"
    >
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

      {/* Top subtle Mandir header */}
      <header className="relative z-20 w-full max-w-6xl mx-auto px-6 pt-5 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="inline-block w-2 h-2 rounded-full bg-[#E3B368] shadow-[0_0_10px_#E3B368]" />
          <span className="text-[11px] uppercase tracking-[0.22em] text-[#F8F4EC]/75">
            BAPS Shri Swaminarayan Mandir · Jaipur
          </span>
        </div>
      </header>

      {/* Grand Mandir Line Art */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 pb-10 text-center">
        <div className="relative w-full max-w-5xl mx-auto -mt-4 sm:-mt-8 animate-mandir-float">
          <div
            className="absolute inset-x-16 inset-y-8 rounded-full blur-3xl opacity-35"
            style={{ background: 'radial-gradient(ellipse at center, #E3B368 0%, transparent 72%)' }}
          />
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
              className="w-full h-full object-contain opacity-85"
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
          <p className="text-xs sm:text-sm text-[#F8F4EC]/55 tracking-wide">
            Click anywhere or press any key to resume Reception Desk
          </p>
        </div>
      </main>
    </div>
  );
}
