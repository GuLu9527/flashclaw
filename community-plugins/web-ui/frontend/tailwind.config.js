/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        gold: { DEFAULT: '#F0B429', light: '#FFD666', dark: '#C68A1A' },
        lobster: '#E05252',
        pixel: {
          bg: '#0f1419',
          surface: '#1c2128',
          border: '#30363d',
          text: '#C9D1D9',
          muted: '#8B949E',
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
