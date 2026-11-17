---
name: Aura Kinetic
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#393939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353534'
  on-surface: '#e5e2e1'
  on-surface-variant: '#c2c6d6'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#8c909f'
  outline-variant: '#424754'
  surface-tint: '#adc6ff'
  primary: '#adc6ff'
  on-primary: '#002e6a'
  primary-container: '#4d8eff'
  on-primary-container: '#00285d'
  inverse-primary: '#005ac2'
  secondary: '#4edea3'
  on-secondary: '#003824'
  secondary-container: '#00a572'
  on-secondary-container: '#00311f'
  tertiary: '#ffb690'
  on-tertiary: '#552100'
  tertiary-container: '#ec6a06'
  on-tertiary-container: '#4a1c00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a42'
  on-primary-fixed-variant: '#004395'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#ffdbca'
  tertiary-fixed-dim: '#ffb690'
  on-tertiary-fixed: '#341100'
  on-tertiary-fixed-variant: '#783200'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.01em
  title-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  container-padding: 20px
  stack-gap: 12px
---

## Brand & Style
The design system embodies a premium, futuristic AI assistant that feels both ethereal and high-performance. The brand personality is "The Quiet Engine"—a sophisticated, unobtrusive partner that manages complexity with effortless precision.

The visual style is a fusion of **Minimalism** and **Glassmorphism**. It relies on deep obsidian surfaces, high-contrast typography, and "kinetic" light sources. The aesthetic is inspired by high-fidelity dashboard designs, utilizing translucent layers and vibrant neon accents to indicate AI activity and schedule urgency. The emotional goal is to provide the user with a sense of absolute control and technological sophistication.

## Colors
The palette is rooted in a deep charcoal black foundation to reduce eye strain and emphasize the "Kinetic" light effects.

*   **Electric Blue (#3B82F6):** Represents the AI's "soul." Used for voice wave patterns, active AI thinking states, and primary calls to action.
*   **Emerald Green (#10B981):** Signifies "Flow." Used for flexible tasks that can be moved or optimized.
*   **Crimson Red (#EF4444):** Denotes "Hard Constraints." Used for non-negotiable meetings and critical deadline alerts.
*   **Vibrant Orange (#F97316):** Alerts the user to "Friction." Used for scheduling conflicts or overlapping events.
*   **Neutral Palette:** The background is a pure Deep Charcoal (#121212). Secondary surfaces use a slightly lifted Obsidian (#1E1E1E).

## Typography
The system uses **Inter** for its systematic, neutral, and highly legible characteristics. The type hierarchy relies on heavy weight variances to create focus in a dense scheduling environment.

- **Headlines:** Large, bold, and slightly tracked-in for a modern, "Dribbble-esque" look.
- **Micro-copy:** Uses `label-caps` for metadata like time-stamps or task categories to distinguish them from primary task names.
- **AI Interactions:** When the AI is "speaking" or "thinking," use `body-lg` with medium weight to ensure the assistant's voice feels prominent.

## Layout & Spacing
This design system utilizes a **Fluid Grid** optimized for mobile constraints. 

- **The 8px Rhythm:** All spacing and sizing must be multiples of 4px or 8px to maintain vertical rhythm.
- **Safe Zones:** Content is inset by a `container-padding` of 20px on the horizontal axis. 
- **Dynamic Timeline:** In the schedule view, the vertical axis is fluid, with 15-minute increments mapped to `sm` spacing units.
- **Breathable Density:** Despite the "utility" nature of a calendar, maximize whitespace around task clusters to prevent visual "noise."

## Elevation & Depth
Depth is not communicated through traditional heavy shadows, but through **Tonal Layering** and **Glassmorphism**.

1.  **Level 0 (Base):** Deep Charcoal (#121212).
2.  **Level 1 (Cards/Containers):** Semi-transparent black (approx 40% opacity) with a 20px `backdrop-blur`.
3.  **Level 2 (Modals/Popovers):** Higher opacity glass with a thin 1px "Neon Border" in a low-opacity version of the Primary Blue color.
4.  **The Glow:** Active AI elements or urgent alerts use an `ambient-glow`—a soft, colored drop-shadow with a blur radius of 30px and 10% opacity, color-matched to the task type (Emerald, Crimson, etc.).

## Shapes
The shape language is **Soft Rounded**. 

- **Primary Containers:** 1rem (16px) corner radius provides a modern, friendly feel that balances the "cold" dark theme.
- **Interactive Elements:** Buttons and input fields follow the `rounded-lg` (16px) standard.
- **Micro-elements:** Chips and tags use `rounded-xl` (24px) to create a "pill" look, making them feel like distinct, touchable objects on the timeline.
- **Neon Borders:** Every glass container features a 1px inner stroke to define its silhouette against the dark background.

## Components
- **Kinetic Buttons:** Primary buttons are Electric Blue with a subtle inner glow. Secondary buttons use a "Ghost" style—transparent with a 1px Electric Blue border.
- **Glass Task Cards:** Scheduling blocks are translucent. The left edge features a 4px solid accent bar (Green, Red, or Orange) to denote status, while the rest of the card uses glassmorphism.
- **AI Voice Wave:** A fluid, multi-layered gradient component that reacts to voice input, using the full color spectrum of the primary blue.
- **Conflict Chips:** Small, high-contrast Orange pills that appear at the intersection of overlapping tasks.
- **Input Fields:** Minimalist underlines or subtly filled glass containers. When focused, the bottom border glows Electric Blue.
- **Dynamic Timeline:** A vertical thread that connects events, with "Aura Nodes" (small glowing dots) representing AI-suggested optimization points.