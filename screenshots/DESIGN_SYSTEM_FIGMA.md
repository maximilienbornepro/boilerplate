# Boilerplate Platform — Design System for Figma Make

## Concept

**Terminal dark UI** — monospace font everywhere, sharp corners (no border-radius > 4px), no drop shadows (border-based shadows only), cyan accent, pure black backgrounds.

---

## Typography

| Token | Value | px equiv |
|-------|-------|----------|
| Font family | `'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', 'Consolas', monospace` | — |
| `--font-size-xs` | `0.6875rem` | 11px |
| `--font-size-sm` | `0.75rem` | 12px |
| `--font-size-base` | `0.8125rem` | **13px** (body default) |
| `--font-size-md` | `0.875rem` | 14px |
| `--font-size-lg` | `1rem` | 16px |
| `--font-size-xl` | `1.125rem` | 18px |
| `--font-size-2xl` | `1.25rem` | 20px |
| `--font-size-3xl` | `1.5rem` | 24px |

**Font weights:** Normal 400 / Medium 500 / Semibold 600 / Bold 700

**Line heights:** Tight 1.2 / Normal 1.5 / Relaxed 1.6

**Letter spacing:** Always 0 (monospace — never spaced out)

**Text transform:** never `uppercase` on buttons

---

## Colors — Dark Mode (default)

### Backgrounds

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg-primary` | `#000000` | Page background |
| `--bg-secondary` | `#0a0a0a` | Nav, sidebar |
| `--bg-tertiary` | `#050505` | Subtle offset |
| `--bg-card` | `#0d0d0d` | Cards, panels |
| `--bg-input` | `#0a0a0a` | Input fields |
| `--bg-hover` | `#1a1a1a` | Hover state |

### Text

| Token | Hex | Usage |
|-------|-----|-------|
| `--text-primary` | `#e0e0e0` | Main text |
| `--text-secondary` | `#a0a0a0` | Labels, sub-text |
| `--text-muted` | `#666666` | Placeholders, hints |
| `--text-light` | `#444444` | Disabled |
| `--text-inverse` | `#ffffff` | Text on accent bg |

### Borders

| Token | Hex/Value | Usage |
|-------|-----------|-------|
| `--border-color` | `#1e1e1e` | Standard border |
| `--border-light` | `rgba(255,255,255,0.04)` | Subtle separator |

### Accent — Cyan

| Token | Hex | Usage |
|-------|-----|-------|
| `--accent-primary` | `#00bcd4` | Primary CTA, links, focus rings |
| `--accent-primary-hover` | `#00acc1` | CTA hover |
| `--accent-secondary` | `#26c6da` | Secondary accent |
| `--accent-light` | `rgba(0,188,212,0.12)` | Accent backgrounds |
| `--accent-gradient` | `linear-gradient(135deg, #00bcd4 0%, #26c6da 100%)` | Gradient accent |

### Status Colors (ANSI palette)

| Token | Hex | Usage |
|-------|-----|-------|
| `--success` | `#4caf50` | Green |
| `--success-hover` | `#43a047` | — |
| `--success-bg` | `rgba(76,175,80,0.1)` | Success bg |
| `--warning` | `#ff9800` | Orange |
| `--warning-bg` | `rgba(255,152,0,0.1)` | Warning bg |
| `--error` | `#f44336` | Red |
| `--error-bg` | `rgba(244,67,54,0.1)` | Error bg |
| `--info` | `#2196f3` | Blue |
| `--info-bg` | `rgba(33,150,243,0.1)` | Info bg |

---

## Colors — Light Mode (`data-theme="light"`)

### Backgrounds

| Token | Hex |
|-------|-----|
| `--bg-primary` | `#f0f0f0` |
| `--bg-secondary` | `#fafafa` |
| `--bg-card` | `#ffffff` |
| `--bg-input` | `#f5f5f5` |
| `--bg-hover` | `#e8e8e8` |

### Text

| Token | Hex |
|-------|-----|
| `--text-primary` | `#1a1a1a` |
| `--text-secondary` | `#333333` |
| `--text-muted` | `#777777` |

### Borders
`--border-color`: `#d0d0d0`

### Accent (light mode — darker teal)

| Token | Hex |
|-------|-----|
| `--accent-primary` | `#00838f` |
| `--accent-primary-hover` | `#006064` |

---

## Spacing

| Token | Value | px |
|-------|-------|----|
| `--spacing-2xs` | `0.125rem` | 2px |
| `--spacing-xs` | `0.25rem` | 4px |
| `--spacing-sm` | `0.5rem` | 8px |
| `--spacing-md` | `0.75rem` | **12px** |
| `--spacing-lg` | `1rem` | 16px |
| `--spacing-xl` | `1.5rem` | 24px |
| `--spacing-2xl` | `2rem` | 32px |
| `--spacing-3xl` | `3rem` | 48px |

---

## Border Radius — Sharp!

All radii are intentionally very small (terminal aesthetic).

| Token | Value |
|-------|-------|
| `--radius-xs` | `1px` |
| `--radius-sm` | `2px` |
| `--radius-md` | `3px` |
| `--radius-lg` | `4px` |
| `--radius-xl` | `4px` |
| `--radius-full` | `4px` (NOT 9999px — sharp!) |

---

## Shadows — Border-based, no blur

No `box-shadow` with blur. All shadows are `0 0 0 1px <color>` (outline effect).

| Token | Value |
|-------|-------|
| `--shadow-sm` | `0 0 0 1px #1e1e1e` |
| `--shadow-md` | `0 0 0 1px #1e1e1e` |
| `--shadow-focus` | `0 0 0 1px #00bcd4` |
| `--shadow-accent-md` | `0 0 0 1px #00bcd4` |
| `--shadow-success-md` | `0 0 0 1px #4caf50` |

---

## Transitions — Snappy

| Token | Value |
|-------|-------|
| `--transition-fast` | `0.08s ease` |
| `--transition-normal` | `0.12s ease` |
| `--transition-slow` | `0.15s ease` |

---

## Z-Index

| Token | Value |
|-------|-------|
| `--z-dropdown` | `100` |
| `--z-modal` | `2000` |
| `--z-toast` | `3000` |
| `--z-tooltip` | `4000` |

---

## Component Rules

### Buttons
- Font: monospace, no uppercase, no letter-spacing
- Shape: `border-radius: 2–3px` (sharp)
- Primary: `background: var(--accent-primary)`, `color: #000`, bold
- Secondary: transparent bg, `border: 1px solid var(--border-color)`
- Danger: `border: 1px solid var(--error)`, red text
- Hover: darken by one shade, same border

### Cards / Panels
- `background: var(--bg-card)` = `#0d0d0d`
- `border: 1px solid var(--border-color)` = `#1e1e1e`
- `border-radius: 3–4px`
- No drop shadow, no glow

### Inputs
- `background: var(--bg-input)` = `#0a0a0a`
- `border: 1px solid var(--border-color)`
- `border-radius: 2–3px`
- Focus: `border-color: var(--accent-primary)` + `outline: 1px solid var(--accent-primary)`
- Font: monospace, 13px

### Navigation (SharedNav)
- Top bar: `background: #000`, height: ~44px
- Left: hamburger icon + logo `>_` + app name with dot indicator
- Right: module-specific actions + user badge
- Module dot: colored per module

### Module Colors (dot indicator in nav)
Each module has its own accent color for the dot in the nav:

| Module | Color |
|--------|-------|
| Congés | cyan `#22d3ee` |
| Roadmap | purple `#a855f7` |
| SuiViTess | green `#22c55e` |
| Delivery | red `#ef4444` |
| Mon CV | sky `#0ea5e9` |
| Assistant RAG | amber `#f59e0b` |

### Modals
- `background: #0d0d0d`
- `border: 1px solid #1e1e1e`
- `border-radius: 3px`
- Backdrop: `rgba(0,0,0,0.85)`
- No blur behind modal

### Tags / Badges
- `background: rgba(color, 0.1)`
- `border: 1px solid rgba(color, 0.4)`
- `border-radius: 2px`
- Text: color variant, uppercase, 11px

### Scrollbars
- Width: `6px`
- Track: transparent
- Thumb: `#333333` → hover `#555555`
- `border-radius: 0` (sharp)

### Section Labels / Headings
- Uppercase, monospace, `--text-secondary` (#a0a0a0)
- Font-size: 11–12px
- Letter-spacing: 0

---

## Key UI Patterns

### "Terminal prompt" logo
`>_` in cyan, monospace bold — used as the brand mark

### Status dots
Small filled circles (`8–10px`), colored per module, in the nav bar

### Progress indicators / ATS scores
- Colored numbers: green (>70%), yellow/orange (40–70%), red (<40%)
- No progress bars with rounded ends — use sharp rectangles

### Lists
- Full-width rows separated by `border-bottom: 1px solid #1e1e1e`
- Hover: `background: #1a1a1a`
- Active: `border-left: 2px solid var(--accent-primary)`

### Headers / Page titles
- `font-size: 1rem` (16px), monospace, white
- SubTitle: `font-size: 12px`, `--text-secondary`

---

## CSS Variables to paste into Figma tokens plugin

```css
/* Paste into Figma Tokens / Style Dictionary */

/* DARK MODE */
--bg-primary: #000000;
--bg-secondary: #0a0a0a;
--bg-card: #0d0d0d;
--bg-input: #0a0a0a;
--bg-hover: #1a1a1a;
--text-primary: #e0e0e0;
--text-secondary: #a0a0a0;
--text-muted: #666666;
--border-color: #1e1e1e;
--accent-primary: #00bcd4;
--accent-secondary: #26c6da;
--success: #4caf50;
--warning: #ff9800;
--error: #f44336;
--info: #2196f3;

/* SPACING (in px) */
--spacing-xs: 4;
--spacing-sm: 8;
--spacing-md: 12;
--spacing-lg: 16;
--spacing-xl: 24;
--spacing-2xl: 32;

/* RADIUS (in px) */
--radius-sm: 2;
--radius-md: 3;
--radius-lg: 4;

/* FONT SIZE (in px) */
--font-size-xs: 11;
--font-size-sm: 12;
--font-size-base: 13;
--font-size-md: 14;
--font-size-lg: 16;
```
