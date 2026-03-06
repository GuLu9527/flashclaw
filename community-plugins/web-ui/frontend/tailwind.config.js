/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        gold: { DEFAULT: '#D4A017', light: '#FFE066', dark: '#B8860B' },
        pixel: {
          bg: '#1a1a2e',
          surface: '#16213e',
          border: '#0f3460',
          text: '#e0e0e0',
          muted: '#8892b0',
        },
      },
      fontFamily: {
        pixel: ['"Press Start 2P"', 'monospace'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};
