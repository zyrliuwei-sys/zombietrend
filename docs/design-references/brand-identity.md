# ZombieTrend AI brand identity: "The Zombie Issue"

## Design read

Reading this as: a premium consumer landing page for TikTok / Reels / Shorts
creators, in an editorial magazine language (a fashion monthly's special
issue about the zombie love story trend), leaning toward native CSS, a
didone serif and printed rules.

Dials: DESIGN_VARIANCE 7, MOTION_INTENSITY 3, VISUAL_DENSITY 4.

## Why a magazine

Every competitor in the AI-trend space is a dark tool page. A paper-and-ink
special edition makes ZombieTrend AI recognisable at a glance and treats the
trend as what it is: a love story told in photographs.

## Palette (light-only; same values in `:root` and `.dark`)

| Role      | Hex       | Used for                                  |
| --------- | --------- | ----------------------------------------- |
| Paper     | `#f3eee4` | Page background                           |
| Paper hi  | `#faf7f0` | Cards, prints, form, prompt card          |
| Paper lo  | `#ebe4d6` | Generator band, image placeholders        |
| Ink       | `#151413` | Type, strong rules, selected states       |
| Ink soft  | `#3b3732` | Body copy                                 |
| Muted     | `#6b655c` | Secondary copy                            |
| Rule      | `#d3cbbc` | Hairlines between rows / columns          |
| Blood red | `#a8231b` | The only accent: CTAs, drop cap, numerals |

Page tokens: `src/styles/zombie-trend.css` (`--zt-*`). shadcn tokens in
`src/styles/globals.css` mirror them (`--primary` = blood red,
`--radius: 0.125rem`), so pricing, auth, settings, admin and legal match.

## Type

- Display: Bodoni Moda Variable (nameplate, headlines, italic pull quotes,
  cover lines, numerals). Chinese falls back to Noto Serif SC / Songti SC.
- Body / UI: DM Sans Variable. Nav and labels in small caps (uppercase,
  0.12em tracking).
- Prompt card: system monospace.

## Signature

1. The nameplate: "ZombieTrend AI" set full width like a magazine title,
   with an italic deck between a single and a double rule.
2. The contact sheet: the four beats as tilted prints, three in black and
   white and the flashback in colour.

Supporting moves: cover lines that link into the page, a two-column article
with a red drop cap and a centred pull quote, red italic numerals for the
steps, a ruled comparison table, a recipe-card prompt with a red top band, a
colophon footer under a double rule.

## Shape and motion

- Square corners everywhere. Printed rules instead of shadows; the only
  shadows are under the "prints".
- Motion: the nameplate inks in once; prints straighten on hover; image hover
  zoom 3%. All off under `prefers-reduced-motion`.

## Logo

Bodoni "Z" in a ruled frame with a red underline (`public/logo.svg`);
favicon is a paper "Z" on blood red (`public/favicon.svg`).

## Rules

- No em-dashes in any visible copy (en or zh).
- No dark mode, no gradients, no glow, no pills, no three-equal-card rows.
- Never show blood, wounds or gore in imagery (the red is typographic only).
