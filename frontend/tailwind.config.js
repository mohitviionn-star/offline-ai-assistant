/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Primary text — warm near-black, not cold deep navy. Easier on
        // long reads and reads "AI assistant" instead of "dashboard".
        ink: "#1c1d22",
        brand: {
          900: "#0b1220",
          800: "#111a2e",
          700: "#1c2a44",
        },
        // Restrained accent (deeper than blue-600 so it reads "enterprise" not "consumer")
        accent: "#1d4ed8",
        // Status colors
        good: "#047857",   // emerald-700
        warn: "#b45309",   // amber-700
        bad:  "#b91c1c",   // red-700
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,0.04), 0 1px 1px rgba(15,23,42,0.03)",
      },
    },
  },
  plugins: [],
};
