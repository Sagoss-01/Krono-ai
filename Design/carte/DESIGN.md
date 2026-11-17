---
name: Digital Atelier
colors:
  surface: '#fdf8f8'
  surface-dim: '#ddd9d8'
  surface-bright: '#fdf8f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f7f3f2'
  surface-container: '#f1edec'
  surface-container-high: '#ebe7e6'
  surface-container-highest: '#e5e2e1'
  on-surface: '#1c1b1b'
  on-surface-variant: '#444748'
  inverse-surface: '#313030'
  inverse-on-surface: '#f4f0ef'
  outline: '#747878'
  outline-variant: '#c4c7c7'
  surface-tint: '#5f5e5e'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#1c1b1b'
  on-primary-container: '#858383'
  inverse-primary: '#c8c6c5'
  secondary: '#0050cc'
  on-secondary: '#ffffff'
  secondary-container: '#0266ff'
  on-secondary-container: '#f9f7ff'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#1c1b1a'
  on-tertiary-container: '#868381'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e5e2e1'
  primary-fixed-dim: '#c8c6c5'
  on-primary-fixed: '#1c1b1b'
  on-primary-fixed-variant: '#474646'
  secondary-fixed: '#dae1ff'
  secondary-fixed-dim: '#b3c5ff'
  on-secondary-fixed: '#001849'
  on-secondary-fixed-variant: '#003fa4'
  tertiary-fixed: '#e6e1df'
  tertiary-fixed-dim: '#cac6c3'
  on-tertiary-fixed: '#1c1b1a'
  on-tertiary-fixed-variant: '#484645'
  background: '#fdf8f8'
  on-background: '#1c1b1b'
  surface-variant: '#e5e2e1'
typography:
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
  title-md:
    fontFamily: Hanken Grotesk
    fontSize: 20px
    fontWeight: '500'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1'
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  gutter: 24px
  margin: 32px
  container-max: 1280px
---

## Brand & Style
The design system embodies the "Digital Atelier"—a workspace for precision, craft, and technological fluency. It targets a sophisticated audience of creators and architects of information who value clarity over decoration. 

The aesthetic is **Minimalist** with a **Tactile** edge. It utilizes expansive whitespace, sharp typographic hierarchy, and functional "ink-trap" color accents. The UI should evoke a sense of quiet power, high-end stationery, and industrial engineering. Every element exists for a reason; movement is kinetic but disciplined, and the overall atmosphere is one of focused, premium productivity.

## Colors
The palette is rooted in a "paper and ink" philosophy. The foundation is a warm off-white (`#F9F9F8`), providing a more premium, less clinical feel than pure white. 

- **Primary:** Deep Charcoal (`#121212`) for high-legibility text and structural strokes.
- **Surface:** Pure White (`#FFFFFF`) for elevated cards and modal containers.
- **Functional Accents:** These are used sparingly as "kinetic signals":
    - **Emerald Green:** Indicates flexibility, growth, or successful paths.
    - **Crimson Red:** Highlights hard constraints or errors.
    - **Vibrant Orange:** Signals warnings or scheduling conflicts.
    - **Electric Blue:** Reserved strictly for AI-assisted or generative features.

## Typography
The typographic system uses a trio of typefaces to delineate function. **Hanken Grotesk** provides a sharp, contemporary edge for headlines. **Inter** handles the heavy lifting of body copy with its neutral, highly legible glyphs. **Geist** (a monospaced-inspired sans) is used for labels, metadata, and technical data, reinforcing the "Atelier" precision.

Maintain tight tracking on display styles and generous line heights for body text to ensure a luxurious reading experience. Use the label style for all small-scale UI metadata to give it a technical, structured feel.

## Layout & Spacing
The layout follows a **Fixed Grid** philosophy for desktop, transitioning to a fluid model for mobile. We utilize a 12-column grid with 24px gutters. 

Spacing is governed by a 4px base unit. To maintain the "Minimalist" feel, use `xl` (40px) or larger for vertical section separation. Containers should have generous internal padding (at least 24px) to allow content to breathe against the light background. Alignment should be strict and mathematical; use the `label-sm` font to align with the start of grid columns for a blueprint-like appearance.

## Elevation & Depth
Depth is achieved through **Tonal Layers** and **Low-Contrast Outlines** rather than heavy shadows. 

1. **Level 0 (Base):** Off-white background.
2. **Level 1 (Cards):** Pure white surface with a subtle 1px border in a very light gray (`#E5E5E5`).
3. **Level 2 (Dropdowns/Modals):** Pure white surface with a refined, highly diffused shadow (0px 10px 30px rgba(0,0,0,0.04)).

This approach keeps the interface feeling "flat" and architectural, preventing the muddiness often found in light-mode shadow work.

## Shapes
In keeping with the precision-tooled aesthetic, shapes use a **Soft** roundedness (0.25rem). This provides just enough approachability to avoid the harshness of sharp corners while maintaining an architectural, structured silhouette. 

Buttons and input fields should strictly adhere to the `rounded-sm` (4px) or `rounded-md` (8px) rules. Avoid pill shapes unless used for small, functional tags (Chips).

## Components

- **Buttons:** Primary buttons are solid Charcoal with white text. Secondary buttons are outlined in 1px Charcoal. Hover states should utilize a slight shift toward the functional blue or a subtle background tint.
- **Inputs:** Use a 1px light gray border that transitions to Charcoal on focus. The label should use the `label-sm` (Geist) font, sitting just above the input field.
- **Chips:** Small, technical-looking pills with a light gray background. When active, they use the functional color palette (Emerald for flexibility, etc.) as a left-side indicator dot.
- **Cards:** White surfaces with 4px corner radius. Use a top-border accent (2px) of a functional color if the card represents a specific state (e.g., a "Flexible Task" card gets an Emerald top-border).
- **AI Elements:** Any component powered by AI should feature an "Electric Blue" glow or a subtle background mesh gradient of Blue and Off-white, signaling a departure from standard logic into generative space.