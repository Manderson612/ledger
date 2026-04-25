/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#e8f4f0',
          100: '#c5e3d8',
          200: '#9ecfbe',
          300: '#72baa3',
          400: '#4dab8e',
          500: '#1D9E75',
          600: '#178f68',
          700: '#0f7d59',
          800: '#086b4a',
          900: '#034d33',
        },
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'monospace'],
      },
    },
  },
  plugins: [],
}
