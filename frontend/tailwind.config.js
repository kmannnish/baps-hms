/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Every component uses `font-serif` for headings — this maps it to
        // Lora (loaded in index.css) instead of Tailwind's generic serif
        // stack, which is what gives the "carved signage" look.
        serif: ['Lora', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
