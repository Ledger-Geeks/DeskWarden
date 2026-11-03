/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "#050505",
        card: "#111113",
        raised: "#19191c",
        ink: "#ededed",
        brand: "#ff2d20",
        danger: "#fb7185",
      },
      fontFamily: {
        sans: ['"Outfit Variable"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono Variable"', "ui-monospace", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
