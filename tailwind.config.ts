import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/**/*.{ts,tsx}", "./client/index.html"],
  theme: {
    extend: {
      fontFamily: {
        roman:  ["Cinzel", "Georgia", "serif"],
        "roman-deco": ["Cinzel Decorative", "serif"],
        display: ["Cinzel", "Georgia", "serif"],
        sans:   ["DM Sans", "sans-serif"],
        mono:   ["DM Mono", "monospace"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        gold: {
          100: "hsl(48 100% 96%)",
          200: "hsl(46 95% 85%)",
          300: "hsl(44 90% 72%)",
          400: "hsl(43 88% 60%)",
          500: "hsl(42 85% 50%)",
          600: "hsl(40 80% 40%)",
          700: "hsl(38 75% 30%)",
        },
        cave: {
          950: "hsl(220 18% 4%)",
          900: "hsl(222 16% 7%)",
          850: "hsl(220 15% 9%)",
          800: "hsl(218 14% 11%)",
          750: "hsl(216 13% 13%)",
          700: "hsl(214 12% 16%)",
          600: "hsl(212 10% 22%)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
