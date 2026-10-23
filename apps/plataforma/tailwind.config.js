/** @type {import('tailwindcss').Config} */
// Mesmos tokens do apps/web (protótipo aprovado), copiados: os dois apps não importam código um do outro.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        sidebar: { DEFAULT: '#10262C', hover: '#1A3840', ativo: '#0B5563', texto: '#C9D8DC' },
        primary: { DEFAULT: '#0B5563', hover: '#0B4450', claro: '#E3F0F2', borda: '#A9D2D8' },
        canvas: '#F3F5F6',
        ink: { DEFAULT: '#1A2126', suave: '#4A5861' },
        linha: '#D5DDE2',
        neutro: { bg: '#EEF2F4', fg: '#33424B', borda: '#D5DDE2' },
        perigo: { DEFAULT: '#B42318', bg: '#FEE4E2', borda: '#FDA29B' },
        aviso: { DEFAULT: '#93370D', bg: '#FEF0C7', borda: '#FEC84B' },
        ok: { DEFAULT: '#05603A', bg: '#DCFAE6', borda: '#75E0A7' },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: { cartao: '0 1px 2px rgba(16,38,44,.08)' },
    },
  },
  plugins: [],
};
