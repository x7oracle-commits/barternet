/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        barter: {
          bg: "#0f1117",
          surface: "#1a1d2e",
          card: "#242740",
          accent: "#6c63ff",
          green: "#4ade80",
          amber: "#fbbf24",
          red: "#f87171",
          text: "#e2e8f0",
          muted: "#64748b",
        },
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out",
      },
    },
  },
  plugins: [],
};
