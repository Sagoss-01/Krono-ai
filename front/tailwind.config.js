/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        "inverse-on-surface": "#0f172a",
        "surface-dim": "#0a1220",
        "surface-container-lowest": "#060d1a",
        "on-secondary-fixed": "#002113",
        "outline-variant": "rgba(3, 92, 128, 0.22)",
        "tertiary-container": "rgba(139, 92, 246, 0.2)",
        "on-tertiary-fixed-variant": "#c4b5fd",
        "background": "#060d1a",
        "primary-fixed-dim": "#7dd3fc",
        "inverse-surface": "#f1f5f9",
        "on-error": "#ffffff",
        "on-secondary-container": "#6ffbbe",
        "secondary-fixed": "#006d4a",
        "surface-variant": "#0f1e35",
        "on-primary-fixed-variant": "#7dd3fc",
        "secondary": "#22c55e", // Green
        "secondary-blue": "#00d2ff", // Electric Blue
        "on-tertiary-fixed": "#f5f3ff",
        "on-primary": "#ffffff",
        "primary": "#035c80", // TechSphere Accent
        "primary-black": "#000000",
        "on-tertiary": "#ffffff",
        "surface": "#0c1526", // TechSphere Panel
        "primary-container": "rgba(3, 92, 128, 0.25)",
        "on-surface-variant": "#cbd5e1",
        "inverse-primary": "#035c80",
        "outline": "#94a3b8",
        "tertiary-fixed-dim": "#c4b5fd",
        "primary-fixed": "rgba(3, 92, 128, 0.35)",
        "on-secondary": "#ffffff",
        "on-secondary-fixed-variant": "#6ffbbe",
        "surface-container-highest": "#162a4d",
        "surface-bright": "#0f1e35",
        "on-surface": "#f1f5f9", // Crisp white text
        "on-tertiary-container": "#e0e7ff",
        "secondary-container": "rgba(34, 197, 94, 0.15)",
        "surface-container-low": "#0a1322",
        "error-container": "rgba(239, 68, 68, 0.2)",
        "on-primary-container": "#e0f2fe",
        "on-error-container": "#fca5a5",
        "surface-container": "#0f1e35", // TechSphere Card
        "surface-container-high": "#13233e",
        "surface-tint": "#00d2ff",
        "secondary-fixed-dim": "#4edea3",
        "tertiary-fixed": "#8b5cf6",
        "on-primary-fixed": "#ffffff",
        "error": "#ef4444", // Crimson Red
        "tertiary": "#8b5cf6", // Violet Cyber
        "on-background": "#f1f5f9"
      },
      borderRadius: {
        "DEFAULT": "0.25rem",
        "lg": "0.5rem",
        "xl": "0.75rem",
        "full": "9999px"
      },
      spacing: {
        "stack-gap": "12px",
        "lg": "24px",
        "xl": "32px",
        "md": "16px",
        "sm": "12px",
        "base": "4px",
        "container-padding": "20px",
        "xs": "8px"
      },
      fontFamily: {
        "sans": ["Sora", "Inter", "sans-serif"],
        "sora": ["Sora", "sans-serif"],
        "mono": ["JetBrains Mono", "monospace"],
        "hanken": ["Sora", "Hanken Grotesk", "sans-serif"],
        "inter": ["Inter", "sans-serif"],
        "geist": ["JetBrains Mono", "Geist", "monospace"],
      }
    },
  },
  plugins: [],
}
