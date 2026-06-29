/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
        mono: ['DM Mono', 'monospace'],
      },
      colors: {
        primary:      '#006285',
        'blue-sky':   '#0099CC',
        'green-deep': '#00A86B',
        'green-mint': '#00C48C',
        'navy-dark':  '#0A1628',
        navy:         '#1A3A5C',
        'gray-mid':   '#888888',
        'gray-light': '#E5E7EB',
        'bg-page':    '#F8FAFC',
      },
    },
  },
  plugins: [],
};
