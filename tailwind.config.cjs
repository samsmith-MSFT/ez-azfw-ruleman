/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    // Square, console-like geometry: containers have no radius, controls barely any.
    borderRadius: {
      none: '0',
      sm: '2px',
      DEFAULT: '2px',
      full: '9999px',
    },
    extend: {
      colors: {
        ink: {
          950: '#0B1524',
          900: '#0F1B2D',
          850: '#132238',
          800: '#192B45',
          700: '#213759',
        },
        line: '#24385A',
        fg: {
          DEFAULT: '#E4EAF3',
          muted: '#93A4BD',
          faint: '#62748F',
        },
        azure: {
          DEFAULT: '#3A96DD',
          hover: '#55A8E8',
          deep: '#1F6FB2',
        },
        // Amber is reserved for uncommitted (candidate) state.
        candidate: {
          DEFAULT: '#E9A23B',
          hover: '#F2B358',
          ink: '#2A1C05',
        },
        allow: '#3FB27F',
        deny: '#E5534B',
        dnat: '#9A7BEA',
      },
      fontFamily: {
        sans: [
          '"Atkinson Hyperlegible Next Variable"',
          '"Segoe UI"',
          'system-ui',
          'sans-serif',
        ],
        mono: [
          '"Atkinson Hyperlegible Mono Variable"',
          'Consolas',
          'monospace',
        ],
      },
      fontSize: {
        xs: ['12px', '16px'],
        sm: ['13px', '18px'],
        base: ['14px', '20px'],
        lg: ['16px', '22px'],
        xl: ['20px', '26px'],
      },
      keyframes: {
        'tray-in': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
      },
      animation: {
        'tray-in': 'tray-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
    },
  },
  plugins: [],
};
