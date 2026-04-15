# Callstack — Design Style & Tone of Voice

Source: Figma file *Website — Callstack 3.5 (Copy)* — Home frame (`22202:226409`, dark theme) and subpage frame (`22235:35814`, light theme). All tokens, type, color, and radii are taken directly from the file's published variables. Copy observations are drawn from the frames themselves.

---

## 1. Visual Style

### 1.1 Foundation

The design is **dual-theme**: every semantic token (`Callstack/Text/*`, `Callstack/Border/*`, `Callstack/Button/*`) mirrors between a dark variant (black surface, white text) and a light variant (white surface, black text). The **Home frame is dark**; **subpages and content-heavy pages are light**, with strategic dark sections used as "breaks" — case-study bands, closing CTAs, and hero visuals. There is one accent — a vivid purple — that is used for energy and atmosphere (imagery, glow, highlights), not as flat UI fill. The overall feel is sharp, high-contrast, and technical, with a subtle grain/glow effect on white elements that adds texture without warmth.

Layouts are full-bleed and asymmetrical: a content column on the left, an abstract visual panel on the right. Cards sit on the canvas with hairline borders rather than raised shadows — the page feels etched, not layered. The content grid caps at a 640px reading column (`Stroke/max-width/6-col`), which keeps headline and body copy tight even at wide viewports.

### 1.2 Color Tokens

The accent and base neutrals are shared across themes. The semantic tokens invert.

**Shared**

| Token | Value | Usage |
| --- | --- | --- |
| `Callstack/Accent` | `#8232FF` | Brand accent — used in imagery, glow, highlights |
| `Callstack/Background/Primary` | `#000000` | Primary dark surface; also the "strategic dark section" on light pages |
| `Callstack/Background/Secondary` | `#FFFFFF0A` | 4% white panel — subtle layering on dark surfaces |
| `Color/Neutral Light` | `#CFCED5` | Light neutral accents |
| `Color/Neutral Darkest` | `#201F24` | Deepest neutral (near-black, not pure) |
| `Opacity/White 5` | `#FFFFFF0D` | White overlay at 5% |
| `Opacity/Neutral Darkest 40` | `#15141566` | Darkest neutral at 40% |

**Dark theme (Home frame)**

| Token | Value |
| --- | --- |
| `Callstack/Text/Primary` | `#FFFFFF` |
| `Callstack/Text/Secondary` | `#FFFFFF` @ 60% (`#ffffff99`) |
| `Callstack/Text/Tertiary` | `#FFFFFF` @ 40% (`#ffffff66`) |
| `Callstack/Border/Primary` | `#FFFFFF` @ 8% (`#ffffff14`) |
| `Callstack/Foreground/Primary` | `#0000000A` |
| `Callstack/Foreground/Secondary` | `#838289` |

**Light theme (subpage frame)**

| Token | Value |
| --- | --- |
| `Callstack/Text/Primary` | `#000000` |
| `Callstack/Text/Secondary` | `#000000` @ 60% (`#00000099`) |
| `Callstack/Text/Tertiary` | `#000000` @ 40% (`#00000066`) |
| `Callstack/Border/Primary` | `#000000` @ 8% (`#00000014`) |
| `Callstack/Border/Secondary` | `#000000` @ 4% (`#0000000A`) — finer nested borders |
| `Callstack/Foreground/Primary` | `#0000000A` |
| `Callstack/Foreground/Secondary` | `#FFFFFF14` |

White text (on dark) carries a **grain + 8px white drop-shadow glow** (`White Effect`: `GRAIN radius 1.5` + `DROP_SHADOW #FFFFFF, offset 0, radius 8`). This is the subtle halation you see on the logo and key headings — it's a token, not a one-off.

### 1.3 Typography

Three families do all the work:

- **Alliance No.2 Medium** — display/heading. Tight letter-spacing (-4), line-height 1.1 on H1–H3 and 1.2 on H4. This is where the voice of the brand sits visually.
- **Switzer Variable** (Regular 400 / Medium 500) — body and UI copy. Line-height 1.5, letter-spacing -2 across all sizes.
- **Geist Mono Medium** — taglines and eyebrows only. 12px, line-height 20, letter-spacing -4.

Desktop scale, straight from the file:

| Token | Family | Size | Line-height | Weight |
| --- | --- | --- | --- | --- |
| `Heading/Desktop/H1` | Alliance No.2 | 60 | 1.1 | 500 |
| `Heading/Desktop/H2` | Alliance No.2 | 44 | 1.1 | 500 |
| `Heading/Desktop/H3` | Alliance No.2 | 36 | 1.1 | 500 |
| `Heading/Desktop/H4` | Alliance No.2 | 22 | 1.2 | 500 |
| `Heading/Desktop/H5` | Alliance No.2 | 20 | 1.2 | 500 |
| `Heading/Desktop/Tagline` | Geist Mono | 12 | 20 | 500 |
| `Text/Medium/Normal` | Switzer | 18 | 1.5 | 400 |
| `Text/Medium/Medium` | Switzer | 18 | 1.5 | 500 |
| `Text/Regular/Normal` | Switzer | 16 | 1.5 | 400 |
| `Text/Regular/Medium` | Switzer | 16 | 1.5 | 500 |
| `Text/Small/Normal` | Switzer | 14 | 1.5 | 400 |
| `Text/Small/Medium` | Switzer | 14 | 1.5 | 500 |
| `Text/Tiny/Normal` | Switzer | 12 | 1.5 | 400 |
| `Text/Tiny/Medium` | Switzer | 12 | 1.5 | 500 |

Pattern to follow: a Geist Mono tagline sits above an Alliance No.2 heading, followed by a Switzer supporting line. The mono tagline acts like a section label — short, uppercase-feeling, machined — and makes the heading feel more monumental by contrast.

### 1.4 Buttons

Two variants, both sharp-cornered (the only radius tokens in the file are `Radius/Small = 2` and `Radius/Medium = 4` — there are no pill buttons). Buttons invert with theme: the primary button is always the **maximum-contrast fill** on its surface.

**On dark surfaces**
- **Primary:** background `#FFFFFF`, label `#000000`, icon tint `#00000014`.
- **Secondary:** transparent fill, border `#FFFFFF29`, label `#FFFFFF`, icon tint `#0000000A`.

**On light surfaces**
- **Primary:** background `#000000`, label `#FFFFFF`, icon tint `#FFFFFF3D`.
- **Secondary:** transparent fill, border `#00000029`, label `#000000`, icon tint `#0000000A`.

Icons live inside buttons at near-transparent tints, so they register as a textural detail rather than a graphic element. The effect is confident and restrained — no colored fills, no hover ornament.

### 1.5 Borders, Radii & Dividers

- `Radius/Small: 2` and `Radius/Medium: 4` — corners are nearly square. Cards and buttons feel architectural, not friendly.
- `Stroke/Divider Width: 1` — all section separators are single-pixel hairlines. Color inverts by theme: `#FFFFFF14` on dark surfaces, `#00000014` on light surfaces. No thick rules, no gradients.
- `Border/Secondary` (`#0000000A` on light) is used for nested, lower-emphasis frames — for example inside cards or sub-rows of a comparison table.
- `Stroke/max-width/6-col: 640` — long-form copy is capped at 640px for a tight, editorial measure.

### 1.6 Imagery

Imagery is full-bleed, abstract, and purple-saturated on black — cosmic, macro, slightly liquid, with visible grain. It reads as AI-generated texture, not stock photography and not iconography. Each card or lane pairs a short copy block with one of these visual panels on the right. The purple in the imagery does the emotional lifting so the UI around it can stay monochrome.

### 1.7 Layout & Rhythm

The Home frame (dark) moves through a predictable rhythm: a hero with a tagline + H1 + CTA, a full-width logo row, a sequence of asymmetric content-left / visual-right cards with hairline borders, a dark testimonial/social-proof band, a case-study grid, and a final black-on-purple CTA moment ("Stop planning. Start shipping.").

Subpages (light) follow the same skeleton but invert the base surface: white canvas, black type, `#00000014` hairlines, and **strategic dark inserts** — the visual panel inside each asymmetric row is a black card with a purple image, creating the same rhythm as the dark home but on a white page. Feature sections often follow a "content left (light) / dark card right" pattern, and a full-width dark band (e.g. "One engineer, multiple agents. Shipping in parallel.") marks the section break into the case-study grid. A comparison/engagement table ("What an engagement looks like") uses `Border/Secondary` for its inner rows so the nested structure reads without getting visually loud.

Sections are separated by 1px hairlines (theme-appropriate) — never by color blocks. Vertical rhythm is generous; sections breathe.

---

## 2. Tone of Voice

### 2.1 Character

The voice on this page is **declarative, compact, and commanding**. Sentences are short. Ideas come in pairs — a tension and its resolution, a problem and its action. Adjectives are rare; verbs do the work. The reader is addressed as an adult making a decision, not a prospect being nurtured.

### 2.2 Voice Attributes

- **Parallel.** Statements move in pairs or triplets with matching structure. *"The market moved. The window is closing." / "Stop planning. Start shipping." / "Named clients, real numbers. See what we shipped."*
- **Commanding.** Verbs lead. *Stop. Start. Pick. Ship. Set.*
- **Confident, without swagger.** *"We don't follow best practices. We set them."* — earned, not boastful.
- **Technical and honest.** *"AI-Native Engineering. React & React Native."* says exactly what the work is, without adjectives.
- **Economical.** Most headlines are two short sentences. No sentence on the page runs long.

### 2.3 Copy Patterns

**From the Home frame:**

- **Hero headline:** category + scope, stated flat. *"AI-Native Engineering. React & React Native."*
- **Section intro:** a truism that pressures the reader. *"The market moved. The window is closing."*
- **Navigation / eyebrow:** a single promise. *"Everything AI-Native, under one roof."*
- **Directive:** a two-part instruction. *"From chaos to control. Pick what to start."*
- **Proof band:** named result, stated plainly. *"Named clients, real numbers. See what we shipped."*
- **Closing CTA:** an opposed pair. *"Stop planning. Start shipping."*
- **Tagline / voice line:** *"We don't follow best practices. We set them."*

**From the subpage (light):**

- **Hero headline (outcome-first):** *"Ship faster than your roadmap expects."*
- **Hero subtitle (problem recap, two beats):** *"Your roadmap keeps growing, but your team can't keep up. The backlog isn't moving."*
- **Feature headlines (possessive + promise):** *"Your features? Our habits. Engineered at AI speed." / "One codebase. Every platform." / "Move your stack without disrupting your team." / "Make what you have work harder."*
- **Section label for process:** *"What an engagement looks like."*
- **Dark interstitial (parallel clauses):** *"One engineer, multiple agents. Shipping in parallel."*
- **CTA band (validation + push):** *"Your challenge is real."*
- **Self-serve branch:** *"Want to build it on your own?"*

The subpage introduces a small twist to the voice: **possessive framing** (*"Your features? Our habits."*) that positions Callstack and the reader on the same side of the table. Use it sparingly — one or two times per page — to avoid sounding like a template.

### 2.4 Rules

- Prefer **two short sentences** to one long one.
- Use **parallel structure** — if the first clause starts with a verb, the second clause should too.
- **Delete adjectives and qualifiers** before shipping copy ("leading," "innovative," "world-class," "helps you," "enables you to").
- Lead with the **uncomfortable truth or command**, then the action.
- Taglines (Geist Mono) are short and directional — section labels, not sentences.
- CTAs are **commands**: *Start. Ship. Pick. See. Book.* Never *Learn more* or *Get in touch*.
- Credentials are phrased as statements of fact, not accolades.

### 2.5 Do / Don't

**Do:** *"We don't follow best practices. We set them."*
**Don't:** *"At Callstack, we pride ourselves on setting industry-leading best practices."*

**Do:** *"Named clients, real numbers. See what we shipped."*
**Don't:** *"Discover our impressive portfolio of work with world-class enterprise clients."*

**Do:** *"Stop planning. Start shipping."*
**Don't:** *"Let us help you move from planning to execution."*

---

## 3. Quick Reference

| | |
| --- | --- |
| Theme model | Dual — dark (Home) + light (subpages), inverted semantic tokens |
| Surfaces | `#000000` (dark) / `#FFFFFF` (light) |
| Accent | `#8232FF` (imagery / glow only — not flat fills) |
| Heading font | Alliance No.2 Medium — 60 / 44 / 36 / 22 / 20 |
| Tagline font | Geist Mono Medium — 12 / 20 |
| Body font | Switzer Variable — 18 / 16 / 14 / 12 at 1.5 line-height |
| Radii | 2 (small), 4 (medium) — no pills |
| Divider | 1px — `#FFFFFF14` on dark, `#00000014` on light |
| Nested border | `#0000000A` (light) |
| Max reading width | 640px |
| Signature effect | Grain 1.5 + white drop-shadow glow on white elements |
| Primary button | White-on-black (dark) / Black-on-white (light) — always max contrast |
| Voice | Declarative, parallel, commanding, economical |
