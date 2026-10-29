---
name: calm-desktop-ui
description: Complete UI style guideline for designing and generating desktop application interfaces in a calm, soft, translucent, rounded-rectangle visual language (light + dark themes). Use this skill whenever the user asks for a desktop app UI, window, settings screen, file manager, chat app, sidebar layout, dialog, form, dashboard, dock, toolbar, login/verification screen, design system, or any component (button, input, toggle, menu, table, tabs, tooltip, toast, etc.) for Windows/macOS/Linux/Electron/Tauri/Qt/GTK/WPF/Flutter-desktop/web-as-desktop. Also use it when asked to "make it look clean / modern / eye-soothing", to theme an existing app, or to generate HTML/CSS/React/QML/XAML mockups of desktop software. Use even if the user does not name this style explicitly.
---

# Calm Desktop UI — Style Guideline

A design language for **desktop applications**: quiet, airy, soft-edged, translucent, with one accent color and generous spacing. It was distilled from three reference families:

1. **A light, frosted desktop environment** (floating dock, translucent windows, grouped settings cards, colored squircle icons, accent-color picker, segmented controls).
2. **A dark, minimal account/sign-up flow** (pure-black canvas, filled input wells, one bright blue primary action, dimmed modal over blurred content, confirmation states).
3. **A dark AI-chat workspace** (centered wordmark, outlined quick-action chips, soft suggestion rows, a rounded composer with leading/trailing icons, quiet disclaimer footer).

Everything below is written so an agent can generate UI from it **without seeing the screenshots**. Follow the numbered hard rules first, then tokens, then components, then screen recipes.

## Table of contents
1. Hard rules (never break)
2. Principles & personality
3. Design tokens (color, type, space, radius, elevation, motion, materials)
4. Iconography & imagery
5. Window chrome & app shell
6. Layout patterns & screen recipes
7. Components (A–Z catalogue)
8. States & interaction model
9. Accessibility, input, and platform behavior
10. UX details that make it feel finished
11. Implementation (CSS variables + snippets + framework mapping)
12. Anti-patterns & final checklist

---

## 1. Hard rules (never break)

1. **Rounded rectangles only. Never fully rounded.** No pills, no circles as UI containers. Every container, control, chip, badge, avatar, switch, checkbox, radio, slider handle, progress bar, scrollbar thumb, tooltip, tag, and icon tile uses a **rounded rectangle**.
   - **Radius cap rule:** `radius ≤ 30% of the element's shorter side` (and never `border-radius: 999px` / `50%` / `9999px`). A 32px-tall control gets 8px, not 16px. A 20px square gets 5–6px.
   - Where the real world normally uses circles (radio, switch knob, avatar, status dot, color swatch, loader), **translate them to rounded squares** as specified in §7.
   - Only exceptions: *glyph-level* strokes inside icons and *indeterminate spinner arcs* (the arc is a stroke, not a container). When in doubt, use the rounded-square version.
2. **Always ship both themes** (light and dark) from the same token names. Never hardcode hex in components; reference semantic tokens. Respect `prefers-color-scheme`, with a manual override (System / Light / Dark).
3. **One accent color at a time.** Accent is user-changeable (7 presets, §3.1). All interactive emphasis derives from it. Everything else is neutral.
4. **Calm over clever.** Low-contrast surfaces separated by tone and soft shadow, not heavy borders. No gradients on controls, no neon, no glow (except focus ring), no harsh black-on-white (use off-black on off-white).
5. **Clear hierarchy in ≤ 3 levels per screen**: page/section title → group/card → row/control. Never nest cards inside cards.
6. **Generous, consistent spacing** on a 4px grid. When unsure, add space, not borders.
7. **Every interactive element has all states** (default, hover, pressed, focus-visible, selected/active, disabled, loading where relevant) — see §8.
8. **Never rely on color alone** for meaning; pair with icon, text, or shape.
9. **Desktop-first ergonomics**: pointer + keyboard are primary. Hover affordances, right-click menus, shortcuts, resizable windows, multi-select, drag & drop, tooltips. Touch targets can be smaller than mobile (min 28px, default 32px) but never below 24px.
10. **Text is sentence case** (not Title Case, not ALL CAPS) everywhere except acronyms and keyboard keys.

---

## 2. Principles & personality

| Principle | Meaning in practice |
|---|---|
| **Soft** | Round-rect corners everywhere, soft shadows, low-contrast dividers, tinted not outlined fills. |
| **Light** | Translucent window materials (blur), airy padding, thin 1.5px line icons, regular-weight text with semibold only for titles. |
| **Quiet** | Neutral surfaces, one accent, muted secondary text, no decorative noise. |
| **Legible** | Strong text/background contrast for primary text (≥ 7:1 ideal, ≥ 4.5:1 minimum); secondary ≥ 4.5:1; large text ≥ 3:1. |
| **Predictable** | Same component = same look everywhere. Settings apply instantly unless destructive. |
| **Respectful** | No dark patterns; clear cancel; undo over confirm; honest empty/error states. |

Tone of voice (microcopy): short, friendly, direct, human. "Couldn't connect. Check your network and try again." Not "Error 0x80004005".

---

## 3. Design tokens

### 3.1 Color

All values are defaults; implement as CSS variables (§11). **Names are semantic — use names, not hex, in components.**

#### Neutral surfaces

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--bg-desktop` | soft pastel mesh (teal `#BFE3E6` → sky `#CFE0F5` → peach `#F6D9CC`) | deep mesh (navy `#0E1620` → plum `#1B1626` → teal `#0F2227`) | Wallpaper behind windows |
| `--bg-app` (window base) | `#FFFFFF` | `#1A1A1D` | Main content area |
| `--bg-app-translucent` | `rgba(255,255,255,.78)` | `rgba(28,28,31,.76)` | Windows with blur material |
| `--bg-sidebar` | `rgba(244,246,249,.82)` (solid fallback `#F4F6F9`) | `rgba(22,22,25,.80)` (fallback `#161619`) | Sidebars, nav panes |
| `--bg-inset` | `#F5F6F8` | `#141416` | Page background *behind* cards (settings canvas) |
| `--bg-card` | `#FFFFFF` | `#202024` | Cards / grouped sections on inset |
| `--bg-raised` | `#FFFFFF` | `#26262B` | Popovers, menus, dialogs |
| `--bg-field` | `#E4E8ED` | `#2A2A2F` | Input wells, selects, secondary buttons. Light value is deliberately deep enough to read as a control on gray surfaces (sidebar, settings cards); never use a lighter fill for fields in light theme |
| `--bg-field-hover` | `#DADFE6` | `#323238` | Hover on field/secondary |
| `--bg-field-pressed` | `#D0D6DE` | `#3A3A41` | Pressed |
| `--bg-hover` | `rgba(15,20,30,.05)` | `rgba(255,255,255,.06)` | Hover on list items / ghost buttons |
| `--bg-pressed` | `rgba(15,20,30,.09)` | `rgba(255,255,255,.10)` | Pressed on same |
| `--bg-selected` | `rgba(15,20,30,.07)` | `rgba(255,255,255,.09)` | Selected sidebar item (neutral selection) |
| `--bg-selected-accent` | `color-mix(in srgb, var(--accent) 12%, transparent)` | `color-mix(in srgb, var(--accent) 22%, transparent)` | Selected tags/breadcrumb current/list selection (accent selection) |
| `--bg-scrim` | `rgba(10,14,22,.38)` | `rgba(0,0,0,.62)` | Behind modals (+ blur 8px) |
| `--bg-oled` *(optional "True black")* | – | `#000000` | Optional OLED variant for full-screen/auth flows; raised surfaces then `#141414` / fields `#1F1F1F` |

#### Borders / dividers
| Token | Light | Dark |
|---|---|---|
| `--border-subtle` (dividers, card edge) | `rgba(15,20,30,.07)` | `rgba(255,255,255,.07)` |
| `--border-default` (outlined buttons, chips) | `rgba(15,20,30,.14)` | `rgba(255,255,255,.14)` |
| `--border-strong` (focus-adjacent, hovered outline) | `rgba(15,20,30,.26)` | `rgba(255,255,255,.26)` |
| `--border-window` (1px window hairline) | `rgba(0,0,0,.10)` | `rgba(255,255,255,.10)` |

#### Text
| Token | Light | Dark | Use |
|---|---|---|---|
| `--text-primary` | `#1B1D21` | `#F2F3F5` | Titles, body, control labels |
| `--text-secondary` | `#5E6571` | `#A3A9B4` | Descriptions, helper text, captions |
| `--text-tertiary` | `#8A909B` | `#767C88` | Placeholders, group labels, timestamps, disclaimers |
| `--text-disabled` | `#B5BAC3` | `#4F5560` | Disabled |
| `--text-on-accent` | `#FFFFFF` | `#FFFFFF` | Text on accent fill |
| `--text-link` | `var(--accent-text)` | `var(--accent-text)` | Links (underlined in legal/consent text; otherwise underline on hover) |

#### Accent presets (user-selectable; blue is default)
| Name | Light `--accent` | Dark `--accent` | Pressed (light/dark) |
|---|---|---|---|
| Blue (default) | `#2A7BEF` | `#4C8DFF` | `#1F66CF` / `#3B7BEB` |
| Red | `#F0505F` | `#FF6B78` | `#D93E4D` / `#F25765` |
| Green | `#2FB458` | `#4CCB73` | `#259A49` / `#3BB862` |
| Purple | `#7B5CF5` | `#9378FF` | `#6444DC` / `#8063F0` |
| Pink | `#D14FA8` | `#E56BC0` | `#B83D91` / `#D158AB` |
| Orange | `#FF9A2E` | `#FFB04F` | `#E8851A` / `#F29D3A` |
| Graphite | `#454C5C` | `#8C95A8` | `#363C4A` / `#7A8397` |

Derived tokens (compute from `--accent`):
- `--accent-hover`: lighten 6% (dark theme) / darken 4% (light theme).
- `--accent-text`: for text/links on neutral surfaces — light theme use accent darkened to ≥ 4.5:1 (blue → `#1F66CF`), dark theme use accent as is.
- `--accent-tint`: accent at 12% (light) / 22% (dark) over surface.
- `--accent-disabled`: accent at 28% over surface with `--text-on-accent` at 60% (see "loading/disabled primary").
- For **Orange** and **Green** light accents, text on accent fill must be `#1B1D21` if contrast < 4.5:1.

#### Status colors
| Token | Light | Dark | Tint bg (light/dark) |
|---|---|---|---|
| `--success` | `#1FA45A` | `#4CCB73` | `rgba(31,164,90,.12)` / `rgba(76,203,115,.18)` |
| `--warning` | `#D98E00` | `#F5B93A` | `rgba(217,142,0,.14)` / `rgba(245,185,58,.18)` |
| `--danger` | `#E5484D` | `#FF6B70` | `rgba(229,72,77,.12)` / `rgba(255,107,112,.18)` |
| `--info` | `var(--accent)` | `var(--accent)` | accent tint |

#### Icon-tile palette (colored rounded-square app/category icons, white glyph)
Use for sidebar category icons and app icons. Gradient is **very subtle** (top→bottom, +6% lightness → base).
Blue `#2F80F5` (network, Wi-Fi, Ethernet, Proxy) · Orange `#F5822E` (Hotspot, User) · Teal `#27B5C9` (Appearance) · Cyan `#35B7C4` (Background) · Violet `#8C7CF0` (Dock) · Pink `#F26B8A` (Notifications, Sound) · Indigo `#4F7CF0` (Bluetooth, Mouse) · Green `#35B864` (Messages, Success) · Slate `#6B7384` (System, Neutral) · Red `#EF5350` (Danger/Power) · Yellow `#F2B01E` (Tips, Warnings).
In dark theme reduce saturation ~8% and brightness ~5%; glyph stays white.

### 3.2 Typography

**Families**
- UI: `"Noto Sans", "Inter", "Segoe UI Variable", "SF Pro Text", system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Bengali", "Noto Sans Arabic", "Noto Sans CJK SC", sans-serif`. Always include script fallbacks (the reference UI shows Bengali date/time — non-Latin scripts must render cleanly).
- Mono/fixed: `"JetBrains Mono", "Nimbus Mono PS", "SF Mono", "Cascadia Code", Consolas, "Liberation Mono", monospace`.
- Wordmark/hero (rare, marketing/empty states): a wide geometric display face, weight 500–600, tight tracking −0.02em.

**Scale** (base "Small" = 13px; scale with the user's *Font size* setting: Small 13 / Medium 14 / Large 16 / Huge 18 → apply as root `font-size`, everything in `rem`)

| Role | Size (Small) | Weight | Line height | Tracking | Use |
|---|---|---|---|---|---|
| Display | 28px (2.15rem) | 600 | 1.2 | −0.02em | Welcome/hero, empty-state hero |
| Title 1 | 20px | 600 | 1.3 | −0.01em | Dialog titles on large dialogs, page headers |
| Title 2 (window/page title) | 15px | 600 | 1.35 | 0 | Window title, page title in header bar ("Appearance") |
| Title 3 (card/section heading) | 13px | 600 | 1.4 | 0 | Card headings ("Accent color", "Fonts") |
| Body | 13px | 400 | 1.5 | 0 | Default text, list rows, controls |
| Body strong | 13px | 500 | 1.5 | 0 | Emphasis, selected tab, buttons |
| Secondary | 12px | 400 | 1.45 | 0 | Descriptions under row titles |
| Caption / group label | 11px | 500 | 1.4 | +0.01em | Sidebar group labels ("Network and connection"), timestamps, footers |
| Mono | 12px | 400 | 1.55 | 0 | Code, paths, terminal |

Rules:
- Buttons, tabs, menu items: weight 500 (not 600).
- Use `font-variant-numeric: tabular-nums` for clocks, counters, timers ("Resend 28s"), tables.
- Max line length for reading text: 70–80ch. Settings descriptions max 60ch.
- Truncate with ellipsis; **paths truncate in the middle** (`/home/…/Downloads`).
- Don't underline except links in running text and legal/consent text.
- Letter-spacing only on display/caption sizes.

### 3.3 Spacing (4px base)

`--space-0: 0 · 1: 4 · 2: 8 · 3: 12 · 4: 16 · 5: 20 · 6: 24 · 8: 32 · 10: 40 · 12: 48 · 16: 64`

| Context | Value |
|---|---|
| Window content padding | 20–24px |
| Card padding | 16px (compact 12px) |
| Gap between cards | 16px |
| Row height in a card (settings row) | 48px (single-line) / 56–64px (with description) |
| Row internal gap (label ↔ control) | 16px min |
| Sidebar padding | 8px outer, items 32–36px tall, 2px between items |
| Sidebar group gap | 16px above group label, 6px below |
| Control height | **32px default**, 28px compact, 40px comfortable/large |
| Icon-to-text gap | 8px |
| Form field vertical stack gap | 12px (label 6px above control) |
| Dialog padding | 20–24px; button row 16px above |
| Toolbar height | 44–48px |
| Title bar height | 48px (integrated toolbar) |
| Status bar height | 28px |

Density modes: **Comfortable** (default; heights above), **Compact** (controls 28px, rows 36px, paddings −25%). Provide as a token multiplier `--density`.

### 3.4 Radius scale (all rounded rectangles)

| Token | px | Use |
|---|---|---|
| `--radius-xs` | 4 | Checkbox (18px box → 5), small badges, key-caps, scrollbar thumb, tag inside dense tables |
| `--radius-sm` | 6 | Icon tiles ≤ 24px, small buttons (28px), tooltips, progress bars, slider track |
| `--radius-md` | 8 | **Default**: buttons, inputs, selects, list items, menu items, chips, sidebar items, segmented control inner items |
| `--radius-lg` | 10 | Segmented control container, cards, search fields |
| `--radius-xl` | 12 | Windows (outer), dialogs, popovers/menus, large icon tiles (≥ 40px → 11–12), composer/chat input |
| `--radius-2xl` | 16 | Floating dock, large panels/sheets, hero cards |
| `--radius-3xl` | 20 | Max. Floating dock on large screens, onboarding hero panels |

Nested radii: **inner radius = outer radius − padding** (e.g., a card of 10 with 4px inset segmented item → 6–8). Never let an inner element have a larger radius than its container.
Window **maximized/fullscreen → radius 0**; snapped/tiled → radius 0 on snapped edges.

### 3.5 Elevation, borders & materials

| Level | Light | Dark | Use |
|---|---|---|---|
| 0 Flat | none | none | Cards on inset (tone separation only, plus `--border-subtle` 1px optional) |
| 1 Raised | `0 1px 2px rgba(20,30,50,.06), 0 1px 1px rgba(20,30,50,.04)` | `0 1px 2px rgba(0,0,0,.4)` | Segmented selected item, small buttons (optional) |
| 2 Floating | `0 6px 20px rgba(20,30,50,.10), 0 1px 3px rgba(20,30,50,.06)` | `0 8px 24px rgba(0,0,0,.45), 0 1px 3px rgba(0,0,0,.4)` | Menus, popovers, tooltips, dock |
| 3 Dialog | `0 16px 48px rgba(20,30,50,.18), 0 2px 8px rgba(20,30,50,.08)` | `0 20px 56px rgba(0,0,0,.6), 0 2px 8px rgba(0,0,0,.4)` | Modals |
| 4 Window | `0 12px 40px rgba(20,30,50,.20), 0 2px 8px rgba(20,30,50,.08)` + 1px `--border-window` | `0 16px 48px rgba(0,0,0,.55)` + 1px `--border-window` | Active window; inactive window shadow ≈ 55% |

**Translucent material ("frost")** — for windows, sidebars, dock, top bar, menus:
`backdrop-filter: blur(24px) saturate(1.4); background: var(--bg-app-translucent);`
- Menus/tooltips/dock: blur 20–30px.
- Modal scrim: `--bg-scrim` + `backdrop-filter: blur(8px)` (content behind goes soft & dim, as in the reference consent dialog).
- **Fallbacks**: if `prefers-reduced-transparency`, no blur support, or battery saver → use solid `--bg-app` / `--bg-sidebar` solid fallbacks. An "Always blur these apps" style setting may exist; default is blur on for shell surfaces, solid for dense data apps (tables, editors).
- Text on translucent surfaces must still meet contrast over the worst-case wallpaper; add a 1px inner highlight `inset 0 0 0 1px rgba(255,255,255,.35)` (light) / `rgba(255,255,255,.06)` (dark) to define edges.

### 3.6 Motion

| Token | Value | Use |
|---|---|---|
| `--dur-instant` | 80ms | Press feedback |
| `--dur-fast` | 120ms | Hover, toggle, color changes |
| `--dur-base` | 180ms | Menus, popovers, tooltips, tab underline/indicator slide |
| `--dur-slow` | 260ms | Dialogs, sheets, sidebar collapse, window open |
| `--ease-standard` | `cubic-bezier(.2,.0,.0,1)` | Most |
| `--ease-enter` | `cubic-bezier(.0,.0,.2,1)` | Elements entering |
| `--ease-exit` | `cubic-bezier(.4,.0,1,1)` | Elements leaving |
| `--ease-spring` | `cubic-bezier(.34,1.4,.64,1)` | Switch knob, dock icon bounce (subtle) |

Rules: animate `opacity`, `transform`, `background-color`, `box-shadow` only. Menus: fade + 4px translate + scale .98→1. Dialog: fade + scale .96→1 (scrim fades). Selected segmented item slides between positions (don't jump). Honor `prefers-reduced-motion` (replace with fades ≤ 100ms). Never block input on animation.

---

## 4. Iconography & imagery

- **Style**: outlined/line icons, **1.5px stroke** at 20px (1.25px at 16px, 1.75px at 24px), round caps & joins *(round joins are glyph-level, fine)*, 2px internal corner radius. No filled icons except: selected-state variants in nav and the colored tiles.
- **Sizes**: 14 (inline/window controls), 16 (menus, buttons, inputs), 20 (toolbar, sidebar), 24 (large buttons, empty states), 32 (card media), 48/64 (file icons/grid), 96+ (empty states, hero).
- **Color**: icons use `--text-secondary` by default, `--text-primary` on hover/active, `--accent` when selected/toggled-on, `--text-disabled` when disabled. Inherit with `currentColor`.
- **Colored icon tiles** (sidebar categories, app icons): rounded square, radius = 27% of size (20px → 5–6px, 40px → 11px, 56px → 14px), flat color with subtle top-light gradient, white 60%-size glyph, 1px inner border `rgba(255,255,255,.18)`. Optional soft shadow `0 1px 2px rgba(0,0,0,.15)`.
- **Folder/file icons**: soft blue folders with a lighter tab, a centered white glyph for special folders (e.g., a download arrow in a rounded-rect). File-type icons: rounded-rect page with folded corner (corner radius 4–6px), colored band for type.
- **Window controls**: thin 14px glyphs (minimize `—`, maximize `▢` with rounded corners, close `✕`), no fills at rest.
- **Chevrons**: 12–14px, stroke 1.5px; `⌄` for dropdowns/selects/model-pickers, `›` for navigation rows, `‹ ›` for back/forward.
- **Illustrations/empty states**: flat, soft-tonal, 2–3 tints of accent + neutral, rounded geometry only; max 160px; never photographic.
- **Avatars**: rounded square (radius 25–30%), initials on tinted bg if no image.
- **Imagery**: wallpapers soft and low-contrast; photos get 8–12px radius; never full-bleed hard edges inside cards.

---

## 5. Window chrome & app shell

### 5.1 Window
- Outer radius **12px** (floating), 0 when maximized/tiled. 1px hairline `--border-window`. Elevation 4. Min size 640×420 (apps with sidebar), dialogs 360×200.
- **Title bar = integrated toolbar** (48px): no separate heavy title strip. Left: optional sidebar-toggle icon button + back/forward chevrons + title/location. Center or left: title (Title 2). Right: contextual actions (view toggle, search) then window controls.
- Window controls: right-aligned, 3 × 28×28 hit areas (radius 8), icon 14px. Hover: `--bg-hover`; **close hover**: `--danger` at 14% bg with danger glyph (or solid danger with white glyph for strong feedback). Order: minimize, maximize/restore, close. On macOS-style hosts keep native traffic lights on the left but retain content styling.
- Inactive window: title and icons fade to `--text-tertiary`, shadow lighter, translucency reduces; sidebar selection becomes neutral gray.
- Drag region = title bar background; double-click toggles maximize. Interactive children are `no-drag`.
- Window edges: 6px invisible resize handles; cursor changes; snap to halves.

### 5.2 Shell layers (back → front)
1. Wallpaper (`--bg-desktop`)
2. **Top bar** (system strip, 28–32px, frosted, text 12px: left = launcher glyph in accent + current app name; right = tray icons (volume, battery with %, network), locale-aware clock `ddd D MMM h:mm A` in tabular numerals)
3. Windows
4. **Dock** (floating, bottom center, 10px from edge)
5. Menus/popovers/tooltips
6. Modals + scrim
7. Toasts/notifications (top-right under top bar, or bottom-right)

### 5.3 Dock (floating app launcher)
- Container: frosted, radius 16–20, padding 8px, gap 8px, elevation 2, 1px inner highlight, centered, `margin-bottom: 10px`.
- Items: 44px rounded-square colored tiles (radius 11–12). Hover: scale 1.12–1.18 with `--ease-spring` + tooltip label above (12px, frosted rounded 6px). Pressed: scale .96.
- Running indicator: **4×4px rounded square (radius 1.5)** under the icon, `--text-secondary`; active app uses `--accent`.
- Separator between pinned and trash: 1px × 28px `--border-default`.
- Bounce (once, 2 cycles, 8px) when an app needs attention; badge = small rounded-rect count at top-right (min 16×16, radius 5, `--danger` bg, white 10px/600 text).
- Right-click → context menu (Open, Keep in dock, Quit). Drag to reorder; others slide aside.

---

## 6. Layout patterns & screen recipes

### 6.1 Sidebar + content (default for most apps)
```
┌──────────────────────────────────────────────────────────────┐
│ ‹ ›  Title / Breadcrumb                [view][search]  ─ ▢ ✕ │ 48px title bar
├───────────────┬──────────────────────────────────────────────┤
│ Group label   │  Page title                                   │
│ ▣ Item        │  ┌ Card ────────────────────────────────────┐ │
│ ▣ Item (sel)  │  │ Heading                                  │ │
│               │  │ Row ─────────────────────── [control]    │ │
│ Group label   │  │ Row ─────────────────────── [control]    │ │
│ ▣ Item        │  └──────────────────────────────────────────┘ │
│ ▣ Item        │                                               │
└───────────────┴──────────────────────────────────────────────┘
 220px (180–260, resizable, collapsible)     fluid, max content 720–880px
```
- Sidebar: `--bg-sidebar`; items 32–36px, radius 8, icon tile 20px + 8px gap + label 13px; **selected = `--bg-selected`** (neutral) with text-primary and weight 500; hover `--bg-hover`. Group labels (Caption, `--text-tertiary`) sentence case. No dividers between groups — use spacing.
- Content: `--bg-inset` canvas, cards `--bg-card`. Center content with `max-width: 760px` for forms/settings; fluid for file/data views.
- Sticky header inside content (page title + search/actions) with frost + bottom `--border-subtle` appearing only after scroll.
- Sidebar collapses to icon-only (56px) under 720px window width; to hidden overlay under 560px.

### 6.2 Settings page recipe
- Page title (Title 2) in header bar. Under it, **cards** with `padding: 16px`, radius 10, gap 16.
- Each card: optional **heading** (Title 3) + optional description (Secondary) + rows.
- **Row**: left = label (Body) [+ description (Secondary, `--text-secondary`)]; right = control (aligned right, fixed control width 220–280px for selects, auto for switches/buttons). Rows divided by 1px `--border-subtle` inset 16px from left (or no dividers with 12px gap in simple cards).
- Vertical form variant (used in reference "Fonts"): label column 120px left, control fills remaining width.
- Special controls: accent swatch row (7 rounded squares), segmented size selector (Small/Medium/Large/Huge) spanning full row width, switch for binary settings.
- **Apply instantly**; show subtle inline "Saved" check (fade 1.5s) only for slow/async changes. Provide "Reset to default" ghost button where meaningful.
- Provide search at top of sidebar (⌘/Ctrl+F) that filters settings across pages.

### 6.3 File manager recipe
- Sidebar: **Favorites** (Home, Downloads…), **Locations** (Computer, drives, Trash). Drive items show a small usage bar (4px high, radius 2) beneath when hovered/selected.
- Title bar: `‹ ›` back/forward (28px ghost buttons, disabled = tertiary), current folder name (Title 2), right side: view-mode button (grid/list/columns) + window controls.
- Content (`--bg-app`, white): icon grid (cell 96×112, icon 56px, label 12px centered, 2 lines max with ellipsis, 8px gap); selected = rounded-rect (radius 10) `--bg-selected-accent` behind icon+label, label on accent fill with white text when focused; **rubber-band selection** rectangle: accent 14% fill + 1px accent border, radius 4.
- List view: table (see §7 Table) with columns Name, Modified, Size, Type; row 36px; zebra off.
- **Path bar** (bottom, 32px, `/ home testu`): breadcrumb segments as 24px-tall rounded-rect buttons (radius 6); hover = `--bg-hover`; **current segment** = `--bg-selected-accent` + `--accent-text`; separators are `/` in tertiary text. Click the bar's empty space → editable text path field.
- Empty folder: centered folder illustration + "This folder is empty" + hint "Drag files here to add them".
- Context menu items: Open, Open with ▸, Cut/Copy/Paste, Rename (F2), Move to trash (Del), Properties (Alt+Enter).

### 6.4 Chat / AI workspace recipe (dark-first, works in light)
```
┌──────────────────────────────────────────────────────────────┐
│ [▯ sidebar] [✎ new]        Brand  ·  Model name ⌄             │ header 48px
│                                                               │
│                                                               │
│               Brand wordmark (Display)                        │
│     Muted tagline sentence…                                   │
│     ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  (dashed 1px divider)     │
│     [ Suggestion row 1                          ]             │
│     [ Suggestion row 2                          ]             │
│     [ Suggestion row 3                          ]             │
│                                                               │
│     [⟲ Translate] [✎ Question answering] [◎ Vision Q&A]       │ chips (outlined)
│     ┌───────────────────────────────────────────────┐         │
│     │ 📷  Ask me anything                  🎤   ＋  │         │ composer
│     └───────────────────────────────────────────────┘         │
│          Quiet disclaimer, caption size, centered             │
└──────────────────────────────────────────────────────────────┘
```
- Canvas `--bg-app` (dark `#121214`, or true-black variant). Content column max-width 760px, centered.
- Header: left icon buttons (sidebar toggle, new chat) 32px ghost with outlined icons; center: brand small + **model selector** (text + `⌄`, opens menu of models with description and check on current).
- Suggestion rows: full-width left-aligned, `--bg-card`/`--bg-field`, radius 10, padding 10×14, 14px text, hover `--bg-field-hover`, click sends. Stack gap 8px.
- Quick-action chips: outlined (`1px --border-default`), radius 10–12, height 36, icon 16 + label 13/500, horizontal scroll with fade edges if overflow.
- **Composer**: radius 14–16, `--bg-field` or card + `--border-subtle`, min-height 52px, grows to 8 lines then scrolls; left icon (attach/camera), placeholder in `--text-tertiary`, right icon cluster (voice, add). When text present, the right primary becomes **Send** (accent fill, 32×32 rounded square, radius 8, arrow-up icon). `Enter` sends, `Shift+Enter` newline, `↑` edits last, `Esc` stops generation. Focus: border → `--accent` 1px + focus glow.
- Messages: user bubble = `--bg-field`, radius 12 (tail-less), right aligned, max 70% width; assistant = no bubble, full column, markdown typography, 1.6 line-height. Action row under assistant message (copy, regenerate, thumbs) — 28px ghost icon buttons, visible on hover/focus.
- Streaming: a 8×8 rounded-square caret blinking (opacity 1↔.3, 900ms); "Stop" button replaces Send.
- Footer disclaimer: Caption, `--text-tertiary`, centered, 12px below composer.

### 6.5 Auth / form flow recipe (sign-up, verification)
- Narrow centered column **360–420px** in a window or full-screen panel (`--bg-app`, optional true-black in dark). Top row: language select (left, ghost with `⌄`) and Help (right, ghost with shield/help icon). Title (Title 1/Display, centered). Intro text (Secondary, centered or left, max 48ch).
- Fields stacked, 12px gap, height 44px (comfortable), `--bg-field`, radius 10, **no border at rest**; password fields have trailing eye toggle (ghost 28px); helper text under group (Caption secondary): "8–16 characters, combining at least 2 of: digits, letters, special symbols."
- Consent: checkbox (rounded square) + sentence with inline underlined links, 13px, **wraps nicely**, hit area covers whole line.
- **Primary button** full width, 44px, radius 10, accent fill, white text 500. **Disabled until valid**; on submit → *loading state*: label stays, spinner (16px) left of label, fill becomes `--accent-disabled` (dark navy-ish tint), button not clickable; progress ≤ 300ms shows nothing extra.
- Bot/human verification (third-party widget) appears as a **popover card** over a dimmed form: `--bg-raised`, radius 10, elevation 3, 1px border; the form behind dims to 40% with blur, controls non-interactive.
- **Verification code step**: heading "Create account"/"Verify", line "Sent code to **email**" (email in `--accent-text`), single code field (or 6 individual rounded-square boxes, 48×56, radius 10, gap 8, auto-advance, paste splits digits), trailing **"Resend 28s"** in tertiary tabular text → becomes accent "Resend" link at 0; link "Can't receive verification code?" in accent; Submit button disabled until all digits entered, then enabled → loading → success. Auto-submit optional when full.
- Success: transition to the app; show first-time **consent dialog** (see §7 Dialog) with checkbox gating OK.

---

## 7. Components (A–Z)

> Conventions: heights assume comfortable density (32px). `r` = radius token. Transitions: `--dur-fast --ease-standard`. All components support light/dark through tokens. Focus ring for every focusable element: see §8.

### Accordion / disclosure
Header row 40px (icon optional, label 500, chevron `›` rotating 90°), full-width ghost, radius 8. Content area padded 12px 16px, animates height (180ms). Use inside cards for advanced options ("Advanced ▸"). Multi-open allowed by default.

### Alert / banner (inline)
Rounded-rect (r10), padding 12×14, `tint` bg of status + 1px border at 25% status, 16px status icon left, text (Body, title 500), optional action link right, optional close (ghost 24px). Never full-bleed; sits inside content column. Variants: info, success, warning, danger. Persistent banners for state problems ("You're offline"); transient → toast.

### Avatar
Rounded square, sizes 20/24/32/40/56/80, radius 25%. Image or initials (500 weight, 40% of size) on tinted bg derived from name hash (use icon-tile palette). Presence indicator: 8×8 rounded square (radius 2) with 2px `--bg-card` ring at bottom-right. Group: overlap −8px with 2px ring; "+3" overflow tile.

### Badge / counter
Min 16×16, padding 0 5px, radius 5, 10–11px/600. Colors: `--danger` (alerts), `--accent` (new), neutral `--bg-field` w/ secondary text (counts). Cap at "99+". Dot variant = 8×8 rounded square (radius 2).

### Breadcrumbs / path bar
Segment buttons 24–28px high, radius 6, 12–13px; separators `/` or `›` tertiary; **last segment = current**: accent tint bg + `--accent-text`, not a link. Collapse middle segments to `…` menu when overflowing. Keyboard: arrows move, Enter opens, Ctrl+L edits path as text.

### Button
Always rounded rect (r8; r6 at 28px; r10 at 40–44px), horizontal padding 14px (16px large), min-width 72px, label 13px/500, icon 16px with 8px gap, no uppercase.
| Variant | Rest | Hover | Pressed | Use |
|---|---|---|---|---|
| **Primary** | bg `--accent`, text on-accent | `--accent-hover` | `--accent-pressed` + scale .98 | The single main action per view |
| **Neutral primary (inverse)** | Light: bg `#1B1D21`, text white · Dark: bg `#F2F3F5`, text `#14161A` | ±6% | ±10% | Confirm in dialogs/consent on dark UIs ("OK") when accent shouldn't shout |
| **Secondary** | bg `--bg-field`, text primary | `--bg-field-hover` | `--bg-field-pressed` | Most actions ("Add", "Browse") |
| **Outline** | transparent, 1px `--border-default` | bg `--bg-hover`, border strong | `--bg-pressed` | Cancel, chips-like actions |
| **Ghost** | transparent, text secondary | `--bg-hover`, text primary | `--bg-pressed` | Toolbar, window controls, inline |
| **Destructive** | bg `--danger`, white text (or tint variant: danger text on danger-tint) | darker 6% | darker 10% | Delete/Reset — tint variant by default, solid only in the confirm dialog |
| **Link** | text `--accent-text` | underline | – | Inline navigation |
| **Icon button** | 28/32px square, r8, ghost | | | Toolbar |
| **Toggle button** | ghost; "on" = `--bg-selected-accent` + accent icon | | | Bold/italic, view modes |
| **Split button** | primary + 1px divider (`rgba(255,255,255,.3)`) + chevron part | | | Action + options |
- **Loading**: spinner 14–16px left of label, label persists, width fixed (no layout shift), `aria-busy`, disabled pointer. Fill dims to `--accent-disabled` (see tokens).
- **Disabled**: bg `--bg-field` at 60% (primary: `--accent-disabled`), text `--text-disabled`, `cursor: not-allowed`; offer a tooltip explaining *why* disabled.
- Button groups: gap 8px; primary on the **right** (Windows/Linux dialogs) with Cancel before it; on macOS-style hosts keep the same order — consistency within the app beats platform dogma. Default button responds to Enter, Cancel to Esc.
- Max 1 primary per view; never stack two accent-filled buttons side by side.

### Calendar / date picker
Popover (r12, elevation 2, 280px wide). Header: month/year (500) with prev/next ghost icon buttons; grid 7 columns, each day cell 36×36 rounded square (radius 8), today = 1px accent border, selected = accent fill + white text, range = accent tint rect with squared inner edges (radius 0 inside, 8 at ends), out-of-month tertiary, disabled strike-less tertiary. Footer: "Today" ghost + "Clear". Keyboard: arrows move day, PgUp/PgDn month, Shift+PgUp year, Enter selects, Esc closes. Date input accepts typed text with locale format and shows format hint placeholder.

### Card / grouped section
`--bg-card` on `--bg-inset`, radius 10 (large hero cards 16), padding 16, no shadow (light) / no shadow (dark) with optional 1px `--border-subtle`. Heading Title 3; rows inside separated by inset hairlines. Hover on clickable cards: bg `--bg-hover` overlay + elevation 1. Selected card: 1.5px accent border + accent tint.

### Checkbox
18×18 rounded square (**radius 5**), 1.5px `--border-strong` at rest, `--bg-card` fill. Checked: fill `--accent`, white check glyph (2px stroke, 12px). Indeterminate: white 8×2 rounded bar. Hover: border `--text-secondary`. Focus: ring. Label 13px with 8px gap; **entire label is the hit target**. Disabled 45% opacity. (The reference's circular checkbox must be rendered as a rounded square.)

### Chip / tag / filter
Height 28 (compact 22), padding 0 10px, radius 8 (22px → 6), 12–13px/500. Types: *filter chip* (outlined; selected → accent tint + accent text + check icon), *suggestion chip* (filled `--bg-field`), *input chip* (with trailing × 16px ghost), *status tag* (status tint bg + status text, radius 6). Group gap 8px, wraps.

### Color / accent picker
Row of 7 swatches, each **28×28 rounded square (radius 8)**, gap 12, filled with preset color. Selected: 2px `--bg-card` inner ring + 2px accent outer ring and a white check glyph centered. Hover: scale 1.06. Tooltip with color name. Custom color: "+" tile opening a popover (saturation/brightness square r8, hue slider, hex input, eyedropper). Changing accent applies live with 180ms color cross-fade.

### Combobox / Select (dropdown field)
Closed: like a text field (32px, `--bg-field`, r8, no border), value left (Body), trailing `⌄` 14px tertiary; hover `--bg-field-hover`; open: border 1px accent + chevron flips. Menu: popover (r12, elevation 2, padding 4) aligned to field width, max-height 280px scroll, items 32px (r6, hover bg, selected has leading check 14px & weight 500), optional group labels (Caption), type-ahead filtering, "No results" state. Searchable variant has an input at top. Keyboard: ↑↓ move, Enter select, Esc close, type to jump. The accompanying **Add** button for "add item to list" pairs (select + secondary button) sits on the same row, 12px gap, equal height.

### Command palette
Dialog-like popover (r12, 560px wide, elevation 3, centered at 20% from top), 44px search input (no border, large 15px text, leading search icon), results grouped with Caption labels, items 36px (icon, title, secondary path/hint, trailing shortcut key-caps), selected item `--bg-selected-accent`. Opens with Ctrl/⌘+K or Ctrl/⌘+Shift+P; Esc closes; fuzzy match highlights matched characters in accent-text weight 600.

### Context menu / dropdown menu
Popover frosted `--bg-raised` (r12, padding 4, min-width 200, max 320), elevation 2, 1px border subtle. Items 32px (r6, padding 0 10px, icon 16 + 8px gap, label, trailing shortcut in tertiary 12px or `›` for submenu). Hover/keyboard focus: `--bg-hover` (or accent fill with white text for strongly "native" menus — pick one globally; default is `--bg-hover`). Separators: 1px `--border-subtle`, 4px vertical margin. Destructive items text `--danger`. Disabled items tertiary. Submenus open after 150ms hover delay, on the right (flip if no space). Checkable items show check at left (reserve 20px). Position: at cursor, shift to stay in viewport. Close on outside click, Esc, window blur.

### Data table / data grid
Header row 36px sticky, `--bg-app`, text Caption/500 secondary, bottom `--border-default`; sortable columns show `▲▼` 10px on hover/active, resizable via 1px divider handle (hover accent). Rows 36px (compact 28, comfortable 44), hairline `--border-subtle`, hover `--bg-hover`, selected `--bg-selected-accent` (+ leading checkbox column on multi-select), focused row has inset focus ring. Numeric columns right-aligned, tabular-nums. Cell padding 0 12px. Truncate with ellipsis + tooltip. Selection: click, Ctrl/⌘-click toggle, Shift-click range, Ctrl+A. Row actions appear on hover at right (ghost icon buttons). Empty/loading/error states required. Pagination or virtualization >200 rows. Column menu (sort, hide, pin).

### Dialog / modal
Centered, `--bg-raised`, **radius 12**, elevation 3, 1px `--border-subtle`, width 360 (alert) / 440 (default) / 560–640 (form), max-height 80vh with scrolling body. Layout: **title** (Title 1 at 16–17px/600) left + **close** ghost icon button (28px, `✕` 16px) top-right; body (Body, `--text-secondary` for descriptions); optional checkbox ("I've read and agreed to the *User Agreement* and *Privacy Policy*", links accent); **footer buttons right-aligned**: Cancel (outline) then OK/Confirm (primary or neutral-primary), 32–36px, gap 8–12px; padding 20–24px; 16–20px gap between sections. Behavior: scrim + blur, focus trapped, focus starts on first input or primary-safe action (on destructive dialogs focus Cancel), Esc = cancel, Enter = default, click-outside closes only for non-destructive/no-data-loss dialogs. **Consent-gated OK stays disabled until the checkbox is checked** (disabled style, tooltip "Please accept to continue"). Animate in 260ms. Stack at most 2 levels.
Variants: **Alert** (icon tile 40px, title, text, 1–2 buttons), **Confirm destructive** (title "Delete 3 files?", text states consequence & whether undoable, buttons `Cancel` + `Delete` danger), **Form dialog**, **Progress dialog** (progress bar + Cancel), **Sheet** (attached to window top, slides down, for per-window tasks).

### Divider
1px `--border-subtle`; inset 16px in cards; vertical dividers 1px × 16–24px between toolbar groups. Dashed 1px `--border-default` (dash 4, gap 4) for soft section breaks in empty/hero states (as in the chat welcome).

### Drag & drop
Draggable items show grab affordance on hover (cursor `grab`); while dragging: item at 90% opacity with elevation 2, tilt 0°, drop targets show 2px dashed accent outline (r10) with accent tint; invalid targets show `not-allowed` cursor. Full-window file drop shows overlay (accent tint 8%, dashed accent border inset 12px r12, centered icon + "Drop files to upload"). Reordering lists: insertion line 2px accent (r1) with 6×6 rounded-square handle at left.

### Empty state
Centered column (max 360px): illustration/icon 64–96px (tonal), Title 3, Secondary text (1–2 lines), primary/secondary action. Never just blank. Variants: first-use (invite action), no results (suggest changing filters, "Clear filters"), error (retry), offline.

### File/folder grid item
See §6.3. Name label: 12px, center, 2 lines, middle-ellipsis for extension preservation (`very-long-na…me.pdf`). Rename inline with F2 (field replaces label, selecting name sans extension).

### Form layout
Labels above controls (Body strong 13/500, 6px gap) in dialogs/auth; label-left (120px column) in settings. Required marker: none by default (mark *optional* instead, tertiary). Helper text Caption secondary below control (4px gap); error replaces helper in `--danger` with 14px icon. Group related fields in cards. Validate **on blur** (not on each keystroke), re-validate live once an error is shown, never wipe user input. Primary action at the bottom-right (dialogs) or full-width (narrow auth). Preserve entered data on navigation errors. Autocomplete attributes set. Tab order = visual order.

### Input (text field)
Height 32 (auth/large 44), `--bg-field`, radius 8 (large: 10), padding 0 12px, text Body, placeholder `--text-tertiary`, **no border at rest** (tone only), hover `--bg-field-hover`, **focus**: bg `--bg-card`/field + 1px `--accent` border + 3px focus glow (`color-mix(accent 25%, transparent)`). Error: 1px `--danger` border + glow in danger 20%, helper in danger. Disabled: 55% opacity, no hover. Leading icon 16px (tertiary), trailing actions (clear ✕ ghost appears when non-empty; password eye toggle; spinner for async validation; check for valid). Read-only: transparent bg + 1px dashed `--border-default`. Selection color: accent at 30%. Email fields trim spaces, lowercase on blur.
- **Password**: masked bullets, eye toggle (`aria-pressed`), caps-lock warning inline (⚠ "Caps Lock is on"), strength meter optional (4 rounded-rect segments 4px high, gap 4, radius 2; weak=danger, fair=warning, good=accent, strong=success), rules hint below: "8–16 characters, combining at least 2 of: digits, letters, special symbols." Confirm field validates match on blur.
- **Number / stepper**: field + trailing stacked ▲▼ ghost buttons (each 14px tall, r4) or −/+ side buttons; ↑↓ keys step, Shift ×10; unit suffix tertiary.
- **Search**: leading magnifier, radius 10, `Esc` clears, `/` or Ctrl+F focuses, debounce 200ms, results count live region, recent searches in popover.
- **Textarea**: min 3 rows, auto-grow to max, resize handle bottom-right (rounded 6×6 grip), char counter at bottom-right when limit exists (tertiary → warning at 90% → danger at limit).
- **OTP/code**: see §6.5.
- **Inline-editable text**: shows as text with hover bg `--bg-hover` (r6) + pencil; click → field.

### Key-cap (keyboard shortcut)
Rounded-rect (r4) min 20×20, padding 0 6px, `--bg-field`, 1px `--border-subtle`, bottom border 2px darker, 11px/500 mono-ish. Show platform-appropriate glyphs (⌘ ⌥ ⇧ vs Ctrl Alt Shift).

### List / list item
Row 36–48px, padding 0 12px, radius 8 (rows are rounded rects inset 4–8px from the list edge, *not* full-bleed), leading icon/avatar, title (Body) + subtitle (Secondary), trailing meta/controls. Hover `--bg-hover`; selected neutral or accent tint; focused row ring inset. Navigation rows have `›`. Multi-select via checkboxes revealed on hover. Dividers optional.

### Menu bar (in-window)
Height 28–32, items r6 padding 0 10px, 13px; open menu highlights item with `--bg-selected`; hover-switch between menus when one is open; Alt toggles access keys (underline mnemonic).

### Navigation rail / sidebar item
See §6.1. Badge at right; trailing `+` ghost button on hover for "add" in group; drag to reorder; right-click menu; collapsed → tooltip with name.

### Notification / toast
Frosted `--bg-raised` card, r12, width 340, padding 12×14, elevation 2, leading 20px icon tile (status-colored r6) or app icon, title (500), body (Secondary, max 2 lines), actions as ghost/secondary small buttons (28px) under text, close ✕ on hover. Position top-right below top bar; stack gap 8px (max 3 visible; collapse older). Auto-dismiss: info/success 4s, warning 6s, errors persist until dismissed; pause on hover/focus; progress hairline optional 2px. Slide-in 180ms from edge. Includes Undo action for reversible operations ("Moved 3 files to Trash — Undo"). `role="status"` (polite) / `role="alert"` for errors. Notification center = panel (r16) grouped by app with "Clear all".

### Pagination / stepper
Pagination: ghost buttons 28×28 r8, current = accent tint + accent text. Wizard stepper: horizontal numbered **rounded-square** steps (24×24, r7) connected by 2px lines (r1): done = accent fill + check, current = accent border, upcoming = field. Footer: Back (outline) / Next (primary); Finish on last.

### Popover
`--bg-raised`, r12, elevation 2, 1px border subtle, padding 12–16, optional arrow (8px rotated rounded square) or none (preferred: 6px offset from anchor). Opens on click, Esc/outside-click closes, flips/shifts to stay inside the window, focus moves inside for interactive content.

### Progress
- **Linear (determinate)**: track 6px high, `--bg-field`, radius 3 (**never 999**), fill `--accent`, radius 3; animate width (180ms). Label above/side "42%" tabular. Indeterminate: 40% width rounded bar sliding L→R, 1.2s.
- **Disk/usage bar**: 4px high, r2; turns warning > 80%, danger > 95%.
- **Spinner**: 16/20/32px, 2px stroke arc `--accent` over a 20% track, 800ms linear (arc is a stroke — allowed). Alternative rounded-square "pulse" (3 rounded squares fading) for fully rounded-free style.
- **Skeleton**: rounded-rect blocks (r6–8) `--bg-field` with shimmer sweep (1.4s, 12% white/black), shape-matching content; show after 300ms of loading, keep ≥ 400ms to avoid flash.
- Long tasks: determinate with ETA + Cancel, notify on completion if window unfocused. Taskbar/dock progress mirrors.

### Radio button
18×18 **rounded square (radius 5)** with 1.5px border; selected: border + inner **8×8 rounded-square dot (radius 2) in accent**; (optionally fill accent with white 6px inner square). Group = vertical list gap 8px (or segmented/card radios for ≤ 4 visual options: cards r10 with 1.5px accent border when selected). Arrow keys move selection, Tab enters group once.

### Scrollbar
Overlay, auto-hide after 1s idle, width 10px hover-expanded track (thumb 6px → 8px), thumb `rgba(120,128,140,.45)` hover `.7`, **radius 3–4** (rounded rect), 2px transparent margin. Always show on hover over container and while scrolling. Use `scrollbar-gutter: stable` for content with fixed layouts. Scroll shadows: 12px gradient hairline at top/bottom edges when scrollable.

### Segmented control
Container: `--bg-field`, **radius 10**, padding 3px, height 36 (inner 30). Items: equal width (or content width for toolbars), radius 7–8, 13px/500, `--text-secondary`. **Selected item**: `--bg-card` (white in light; `#3A3A41` in dark) + elevation 1 + `--text-primary`; indicator slides 180ms. Hover on unselected: text primary. Supports icons. Keyboard: ←→ move & select, Home/End. Use for 2–5 mutually exclusive options (Small/Medium/Large/Huge, List/Grid, Light/Dark/System). Full-width within settings rows when ≥ 4 options.

### Sidebar toggle / split view / resizer
Splitter hit area 8px, visible 1px `--border-subtle`; hover → accent 1px + `col-resize`; double-click resets; min/max enforced; persists widths; collapse via drag-past-threshold or button.

### Slider
Track 6px high r3 `--bg-field`, filled portion accent; **thumb 18×18 rounded square (radius 5)**, `--bg-card` with 1.5px accent border (or accent fill + white 6px center), elevation 1; hover thumb scale 1.1 + 6px accent halo (r8); value tooltip above thumb while dragging (r6, 11px). Ticks: 2×6px r1 for discrete. Keyboard: arrows ±step, PgUp/PgDn ×10, Home/End. Dual-thumb range supported. Pair with numeric field for precision.

### Switch (toggle)
**Rounded-rect track 40×22, radius 7**; knob **rounded square 16×16, radius 5** inset 3px, white, elevation 1. Off: track `--border-strong`-tinted neutral (`rgba(15,20,30,.18)` light / `rgba(255,255,255,.18)` dark); On: track `--accent`. Knob slides 120ms `--ease-spring`. Hover: track +6%. Focus: ring. Disabled 45%. Label on the left in settings rows (switch right-aligned); never put "On/Off" text inside the track unless a11y mode. Applies immediately; use `role="switch"`.

### Tabs
- **Underline tabs** (page-level): height 36, items padding 0 12px, 13px/500; active text primary + 2px accent bar (radius 1) at bottom sliding; hover bg-hover r8 behind label.
- **Pill→(rounded-rect) tabs** (toolbars): see segmented control.
- **Document tabs** (browser/editor): height 32–36, rounded-top r8 (or full r8 inset in frost bar), active = `--bg-app`, inactive = transparent with hover bg, close ✕ 16px appears on hover (always on active), dirty dot = 6×6 rounded square, drag-reorder, overflow → scroll arrows + "all tabs" menu, `+` new tab ghost button, Ctrl+Tab cycles, Ctrl+W closes, middle-click closes, closed-tab undo Ctrl+Shift+T.

### Toolbar
Height 44–48, frosted or `--bg-app`, items 28–32px ghost icon buttons r8 with 4px gap; groups separated by 16px space or 1px vertical divider; primary action may be accent-filled. Overflow `⋯` menu when narrow (collapse by priority). Tooltips mandatory for icon-only buttons.

### Tooltip
Frosted dark bubble in both themes (`rgba(30,32,38,.92)`, text `#F2F3F5` 12px/400; in dark theme `rgba(60,62,70,.95)`), r6, padding 5×8, max-width 280, elevation 2, 6px offset, optional key-cap shortcut at right. Delay: show after 500ms hover (instant if another tooltip was visible < 300ms ago), hide on leave/press/Esc, appears on keyboard focus too. Never contain essential info or interactive content.

### Tree view
Row 28–32px, indent 16px per level, chevron `›` rotates 90° (12px), icon 16px, label; selected accent tint; keyboard: ←/→ collapse/expand, ↑↓ move, * expand all, type-ahead. Drag to reorder with insertion line. Lazy-load with spinner row.

### Window controls & title text
See §5.1.

### Status bar
28px, `--bg-sidebar`, 12px secondary text, left: status/selection count ("3 items selected, 12.4 MB"); right: zoom slider, encoding, line/col, notification icon. Items are ghost buttons (r6) where clickable.

### Terminal / code
Mono 12–13px, `--bg-inset` (dark `#101012`), r10 block with 12×14 padding, 1px border subtle, copy button ghost appears on hover top-right, language label Caption. Syntax colors: use accent family + neutral; ensure ≥ 4.5:1.

---

## 8. States & interaction model

| State | Treatment |
|---|---|
| **Rest** | Per component spec. |
| **Hover** | +1 tone step (`--bg-hover` overlay or field-hover); cursor `pointer` only for actionable items (not text inputs; `text` for fields; `default` for list rows that select). 120ms. |
| **Pressed/active** | +2 tone steps; scale .98 for buttons & dock icons; 80ms. |
| **Focus-visible** | **Never remove outlines.** Ring: `outline: 2px solid color-mix(in srgb, var(--accent) 70%, transparent); outline-offset: 2px;` radius follows element (+2). On inputs: accent border + 3px glow instead. Only on keyboard focus (`:focus-visible`). Ring contrast ≥ 3:1 against surroundings. |
| **Selected** | Neutral selection (sidebar nav): `--bg-selected`. Accent selection (items, chips, current crumb): `--bg-selected-accent` + accent text. Keep selection visible when window inactive but desaturate. |
| **Disabled** | 45–55% opacity or disabled tokens; no hover; `aria-disabled`; explanatory tooltip. |
| **Loading** | Spinner/skeleton; preserve layout; button shows inline spinner and ignores clicks; don't hide the previous content for refreshes (stale-while-revalidate). |
| **Error** | Danger border + message with icon, move focus to first invalid field on submit; summary banner for ≥ 3 errors; errors say what happened + how to fix. |
| **Success** | Brief check (accent/success) + toast/inline; no modals for success. |
| **Drag** | See Drag & drop. |
| **Empty** | See Empty state. |
| **Offline** | Persistent warning banner + disable network actions with explanations; queue actions if possible. |

**Keyboard model**: Tab/Shift+Tab traverse; arrows inside composite widgets (menus, tabs, lists, radios, trees, grids); Enter/Space activate; Esc dismisses the topmost layer; Home/End; PgUp/PgDn; type-ahead; F2 rename; Del delete; Ctrl/⌘+Z undo; F6 cycles panes; Ctrl/⌘+, opens settings; Ctrl/⌘+W close; F11 fullscreen. Show shortcuts in menus and tooltips.

**Pointer model**: single-click selects, double-click opens, right-click context menu, middle-click closes tab/opens in new, drag to move/reorder, Ctrl/⌘ for toggle-select and copy-drag, Shift for range, scroll wheel + Ctrl/⌘ zooms, hover intent delays (tooltips 500ms, submenus 150ms), Fitts-friendly edges (toolbar buttons reach window top).

---

## 9. Accessibility, input & platform behavior

- **Contrast**: text ≥ 4.5:1 (body), ≥ 3:1 (≥ 18px or bold 14px), UI boundaries/icons ≥ 3:1. Verify accent combos in both themes; auto-switch text on accent to dark when needed.
- **Semantics**: correct roles (`button`, `switch`, `tab`, `menu`, `dialog` with `aria-modal`, `listbox`, `grid`, `tree`, `status`, `alert`). Labels for every icon-only control. Dialog `aria-labelledby/describedby`. Live regions for toasts, search counts, async validation.
- **Focus management**: trap in modals; restore focus to trigger on close; skip-to-content; logical order; visible focus always.
- **Scaling**: honor system font size and the app *Font size* setting (Small/Medium/Large/Huge); layouts must reflow at 200% without clipping; use `rem`/`em` and min-heights, not fixed heights for text containers.
- **Motion/transparency/contrast preferences**: `prefers-reduced-motion`, `prefers-reduced-transparency` (solid surfaces), `prefers-contrast: more` (borders → `--border-strong`, text-secondary → primary-ish, remove translucency), forced-colors support (use system colors; keep borders).
- **Color-blind safety**: status uses icon + text + color; charts add patterns/labels.
- **Hit targets**: ≥ 28px (pointer), ≥ 36px for primary frequent actions; spacing ≥ 4px between adjacent targets.
- **Localization/RTL**: logical properties (`margin-inline-start`), mirror layouts & directional icons in RTL, never concatenate strings, allow 40% text expansion, locale-aware dates/numbers (e.g., Bengali digits when locale requires), font fallbacks per script, no text in images.
- **Input methods**: IME composition-safe inputs (don't act on Enter while composing), paste support, drag-drop, touchpad gestures (two-finger scroll, pinch zoom), pen/touch fallback bigger targets in tablet mode.
- **Platform integration**: respect system theme/accent, native file pickers/notifications/tray/global shortcuts, remember window size/position/state/last page per monitor, single-instance behavior, deep links, system sleep/resume safe, DPI-aware (crisp at 100–300%, 1px hairlines via device pixels).

---

## 10. UX details that make it feel finished

1. **Instant apply + feedback**: settings take effect immediately; accent change re-themes live; font size changes live preview.
2. **Undo over confirm**: toast with Undo (8s) for delete/move; reserve confirm dialogs for irreversible or bulk actions (say the count and consequence).
3. **Smart defaults & remembered choices**: restore last route, scroll position, sidebar width, sort order, view mode, window geometry, "don't ask again" on non-critical dialogs.
4. **Progressive disclosure**: basic settings visible; "Advanced" accordion collapsed; avoid overwhelming first view.
5. **Search everywhere**: settings, command palette, in-list filter with highlight; show "No results for “x”" + suggestions.
6. **Inline help**: description text beneath rows, info icon tooltips with "Learn more", first-run hints as dismissible coachmarks (popover with r12 and single "Got it").
7. **Prevent errors**: disable invalid actions *with reason*, constrain inputs (steppers, pickers), inline format hints ("8–16 characters…"), validate before network call, debounce.
8. **Forgiving inputs**: trim whitespace, accept pasted codes with spaces/dashes, case-insensitive emails, autofocus the first field, Enter submits forms, preserve inputs on error.
9. **Time-based UI**: show resend timers ("Resend 28s") in tabular numerals, convert to action when ready; relative times ("2 min ago") with absolute in tooltip; auto-refresh quietly.
10. **Perceived performance**: optimistic UI, skeletons after 300ms, never spinner-only full pages, keep content while refreshing, animate layout changes (≤ 180ms), lazy-load heavy views, show real progress for >2s tasks.
11. **Truncation & overflow**: ellipsis + full text on hover/tooltip; middle-ellipsis for paths/filenames; wrap descriptions; never overlap controls.
12. **Selection clarity**: show counts ("3 selected"), bulk-action bar appears in the toolbar (slide down 180ms), "Select all", clear with Esc.
13. **Window-resize resilience**: define breakpoints for *window width* (≥ 960 comfortable, 720–959 compact, < 720 collapsed sidebar). Content centers w/ max width; toolbars collapse into `⋯`.
14. **Consent & legal**: link text underlined accent, opens in default browser (indicate with ↗ icon) or in-app sheet; checkbox must be explicit (never pre-checked); gate OK/Continue on it.
15. **Security UX**: mask secrets by default with reveal toggle, auto-hide after 10s, clipboard clear for copied secrets, session timeout warning 60s before logout, show last-signed-in info on sensitive pages.
16. **Third-party/embedded content** (captcha, web views): frame with consistent radius, dim background, ensure keyboard escape route, show skeleton while loading, error fallback with retry.
17. **Status transparency**: connectivity indicator in top bar/status bar, sync state ("Saved just now"), background tasks list with cancel.
18. **Sound & haptics**: none by default; optional subtle sounds for completed/errors under system settings.
19. **Onboarding**: ≤ 3 steps; skip always available; show value first; default to system theme; finish with a clear first action.
20. **Delight, sparingly**: dock bounce, accent cross-fade, smooth indicator slides, subtle success check draw (200ms). Never loop animations at rest.
21. **Consistency checks**: same icon = same meaning; same verb for same action ("Add", not "Create/New/Insert" mixed); same position for primary actions.
22. **Copy**: sentence case, verbs on buttons ("Save changes", "Delete 3 files"), avoid "OK" except for pure acknowledgments or consent; error copy = what + why + fix; no exclamation marks except celebrations.
23. **Dark theme specifics**: avoid pure white text blocks (use `#F2F3F5`), reduce shadow reliance (use tone layering: base → card → raised each +3–4% lightness), desaturate large colored areas, keep accent slightly lighter for contrast; images get 4% dim.
24. **Printing/export**: print stylesheet uses light tokens, no translucency.

---

## 11. Implementation

### 11.1 Token sheet (CSS variables, copy as-is)

```css
:root {
  color-scheme: light dark;
  /* spacing */
  --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-5:20px; --space-6:24px; --space-8:32px;
  /* radius — ALL rounded rects, never 999px/50% */
  --radius-xs:4px; --radius-sm:6px; --radius-md:8px; --radius-lg:10px; --radius-xl:12px; --radius-2xl:16px; --radius-3xl:20px;
  /* type */
  --font-ui:"Noto Sans","Inter","Segoe UI Variable","SF Pro Text",system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Bengali","Noto Sans Arabic","Noto Sans CJK SC",sans-serif;
  --font-mono:"JetBrains Mono","Nimbus Mono PS","SF Mono","Cascadia Code",Consolas,monospace;
  --fs-root:13px; /* Small 13 / Medium 14 / Large 16 / Huge 18 */
  /* motion */
  --dur-instant:80ms; --dur-fast:120ms; --dur-base:180ms; --dur-slow:260ms;
  --ease-standard:cubic-bezier(.2,0,0,1); --ease-enter:cubic-bezier(0,0,.2,1); --ease-exit:cubic-bezier(.4,0,1,1); --ease-spring:cubic-bezier(.34,1.4,.64,1);
  /* control sizes */
  --h-control:32px; --h-control-sm:28px; --h-control-lg:40px; --h-field-auth:44px;
  /* accent (default blue) — swap with [data-accent] */
  --accent:#2A7BEF; --accent-hover:#2472DE; --accent-pressed:#1F66CF; --accent-text:#1F66CF;
}

/* ===== LIGHT ===== */
:root, [data-theme="light"] {
  --bg-app:#FFFFFF; --bg-app-translucent:rgba(255,255,255,.78);
  --bg-sidebar:rgba(244,246,249,.82); --bg-inset:#F5F6F8; --bg-card:#FFFFFF; --bg-raised:#FFFFFF;
  --bg-field:#E4E8ED; --bg-field-hover:#DADFE6; --bg-field-pressed:#D0D6DE;
  --bg-hover:rgba(15,20,30,.05); --bg-pressed:rgba(15,20,30,.09); --bg-selected:rgba(15,20,30,.07);
  --bg-selected-accent:color-mix(in srgb,var(--accent) 12%,transparent);
  --bg-scrim:rgba(10,14,22,.38);
  --border-subtle:rgba(15,20,30,.07); --border-default:rgba(15,20,30,.14); --border-strong:rgba(15,20,30,.26); --border-window:rgba(0,0,0,.10);
  --text-primary:#1B1D21; --text-secondary:#5E6571; --text-tertiary:#8A909B; --text-disabled:#B5BAC3; --text-on-accent:#FFFFFF;
  --success:#1FA45A; --warning:#D98E00; --danger:#E5484D;
  --shadow-1:0 1px 2px rgba(20,30,50,.06),0 1px 1px rgba(20,30,50,.04);
  --shadow-2:0 6px 20px rgba(20,30,50,.10),0 1px 3px rgba(20,30,50,.06);
  --shadow-3:0 16px 48px rgba(20,30,50,.18),0 2px 8px rgba(20,30,50,.08);
  --shadow-window:0 12px 40px rgba(20,30,50,.20),0 2px 8px rgba(20,30,50,.08);
  --switch-off:rgba(15,20,30,.18);
  --focus-ring:0 0 0 2px var(--bg-app),0 0 0 4px color-mix(in srgb,var(--accent) 70%,transparent);
  --focus-glow:0 0 0 3px color-mix(in srgb,var(--accent) 25%,transparent);
}

/* ===== DARK ===== */
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { /* same as [data-theme="dark"] below */ } }
[data-theme="dark"] {
  --accent:#4C8DFF; --accent-hover:#6099FF; --accent-pressed:#3B7BEB; --accent-text:#4C8DFF;
  --bg-app:#1A1A1D; --bg-app-translucent:rgba(28,28,31,.76);
  --bg-sidebar:rgba(22,22,25,.80); --bg-inset:#141416; --bg-card:#202024; --bg-raised:#26262B;
  --bg-field:#2A2A2F; --bg-field-hover:#323238; --bg-field-pressed:#3A3A41;
  --bg-hover:rgba(255,255,255,.06); --bg-pressed:rgba(255,255,255,.10); --bg-selected:rgba(255,255,255,.09);
  --bg-selected-accent:color-mix(in srgb,var(--accent) 22%,transparent);
  --bg-scrim:rgba(0,0,0,.62);
  --border-subtle:rgba(255,255,255,.07); --border-default:rgba(255,255,255,.14); --border-strong:rgba(255,255,255,.26); --border-window:rgba(255,255,255,.10);
  --text-primary:#F2F3F5; --text-secondary:#A3A9B4; --text-tertiary:#767C88; --text-disabled:#4F5560;
  --success:#4CCB73; --warning:#F5B93A; --danger:#FF6B70;
  --shadow-1:0 1px 2px rgba(0,0,0,.4);
  --shadow-2:0 8px 24px rgba(0,0,0,.45),0 1px 3px rgba(0,0,0,.4);
  --shadow-3:0 20px 56px rgba(0,0,0,.6),0 2px 8px rgba(0,0,0,.4);
  --shadow-window:0 16px 48px rgba(0,0,0,.55);
  --switch-off:rgba(255,255,255,.18);
}
[data-theme="dark"][data-oled="true"] { --bg-app:#000; --bg-inset:#000; --bg-card:#141414; --bg-raised:#1A1A1A; --bg-field:#1F1F1F; --bg-field-hover:#272727; }

/* Accent presets */
[data-accent="red"]    { --accent:#F0505F; --accent-hover:#E5424F; --accent-pressed:#D93E4D; --accent-text:#D93E4D; }
[data-accent="green"]  { --accent:#2FB458; --accent-hover:#2AA550; --accent-pressed:#259A49; --accent-text:#1F8A40; }
[data-accent="purple"] { --accent:#7B5CF5; --accent-hover:#7050EA; --accent-pressed:#6444DC; --accent-text:#6444DC; }
[data-accent="pink"]   { --accent:#D14FA8; --accent-hover:#C5429C; --accent-pressed:#B83D91; --accent-text:#B83D91; }
[data-accent="orange"] { --accent:#FF9A2E; --accent-hover:#F58F22; --accent-pressed:#E8851A; --accent-text:#B35F00; --text-on-accent:#1B1D21; }
[data-accent="graphite"]{ --accent:#454C5C; --accent-hover:#3C4352; --accent-pressed:#363C4A; --accent-text:#363C4A; }
/* In dark theme, use the Dark column values from §3.1 for each preset. */
```

### 11.2 Key component snippets

```css
* { box-sizing: border-box; }
html { font-size: var(--fs-root); }
body { margin:0; font-family:var(--font-ui); color:var(--text-primary); background:var(--bg-inset); line-height:1.5; -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility; }
:focus-visible { outline:none; box-shadow:var(--focus-ring); }

/* Window */
.window { background:var(--bg-app-translucent); backdrop-filter:blur(24px) saturate(1.4); border:1px solid var(--border-window); border-radius:var(--radius-xl); box-shadow:var(--shadow-window); overflow:hidden; }
.titlebar { height:48px; display:flex; align-items:center; gap:8px; padding:0 12px 0 16px; -webkit-app-region:drag; }
.titlebar button { -webkit-app-region:no-drag; }

/* Buttons */
.btn { height:var(--h-control); padding:0 14px; border:0; border-radius:var(--radius-md); font:500 1rem var(--font-ui); display:inline-flex; align-items:center; justify-content:center; gap:8px; cursor:pointer; background:var(--bg-field); color:var(--text-primary); transition:background var(--dur-fast) var(--ease-standard), transform var(--dur-instant); }
.btn:hover { background:var(--bg-field-hover); } .btn:active { background:var(--bg-field-pressed); transform:scale(.98); }
.btn--primary { background:var(--accent); color:var(--text-on-accent); } .btn--primary:hover { background:var(--accent-hover); } .btn--primary:active { background:var(--accent-pressed); }
.btn--neutral { background:var(--text-primary); color:var(--bg-app); }
.btn--outline { background:transparent; box-shadow:inset 0 0 0 1px var(--border-default); }
.btn--ghost { background:transparent; color:var(--text-secondary); } .btn--ghost:hover { background:var(--bg-hover); color:var(--text-primary); }
.btn--danger-tint { background:color-mix(in srgb,var(--danger) 14%,transparent); color:var(--danger); }
.btn[disabled], .btn[aria-busy="true"] { cursor:not-allowed; }
.btn--primary[disabled], .btn--primary[aria-busy="true"] { background:color-mix(in srgb,var(--accent) 28%,var(--bg-app)); color:color-mix(in srgb,var(--text-on-accent) 60%,transparent); }
.btn-icon { width:var(--h-control); padding:0; }

/* Inputs */
.field { height:var(--h-control); width:100%; padding:0 12px; border:1px solid transparent; border-radius:var(--radius-md); background:var(--bg-field); color:var(--text-primary); font:inherit; transition:background var(--dur-fast), border-color var(--dur-fast), box-shadow var(--dur-fast); }
.field::placeholder { color:var(--text-tertiary); }
.field:hover { background:var(--bg-field-hover); }
.field:focus { outline:none; background:var(--bg-card); border-color:var(--accent); box-shadow:var(--focus-glow); }
.field[aria-invalid="true"] { border-color:var(--danger); box-shadow:0 0 0 3px color-mix(in srgb,var(--danger) 20%,transparent); }
.field--auth { height:44px; border-radius:var(--radius-lg); }

/* Card & row */
.card { background:var(--bg-card); border-radius:var(--radius-lg); padding:16px; }
.row { display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:48px; }
.row + .row { border-top:1px solid var(--border-subtle); }

/* Sidebar item */
.nav-item { height:34px; display:flex; align-items:center; gap:8px; padding:0 10px; border-radius:var(--radius-md); color:var(--text-primary); }
.nav-item:hover { background:var(--bg-hover); } .nav-item[aria-current="page"] { background:var(--bg-selected); font-weight:500; }
.nav-group-label { font:500 .85rem var(--font-ui); color:var(--text-tertiary); padding:16px 10px 6px; }
.icon-tile { width:20px; height:20px; border-radius:6px; display:grid; place-items:center; color:#fff; } /* 27% radius */

/* Segmented control */
.segmented { display:flex; padding:3px; gap:2px; background:var(--bg-field); border-radius:var(--radius-lg); }
.segmented > button { flex:1; height:30px; border:0; border-radius:7px; background:transparent; color:var(--text-secondary); font:500 1rem var(--font-ui); }
.segmented > button[aria-pressed="true"] { background:var(--bg-card); color:var(--text-primary); box-shadow:var(--shadow-1); }

/* Switch — rounded rect, NOT a pill */
.switch { width:40px; height:22px; border-radius:7px; background:var(--switch-off); position:relative; transition:background var(--dur-fast); border:0; }
.switch::after { content:""; position:absolute; top:3px; left:3px; width:16px; height:16px; border-radius:5px; background:#fff; box-shadow:var(--shadow-1); transition:transform var(--dur-fast) var(--ease-spring); }
.switch[aria-checked="true"] { background:var(--accent); } .switch[aria-checked="true"]::after { transform:translateX(18px); }

/* Checkbox / radio — both rounded squares */
.check { width:18px; height:18px; border-radius:5px; box-shadow:inset 0 0 0 1.5px var(--border-strong); background:var(--bg-card); display:grid; place-items:center; }
.check[aria-checked="true"] { background:var(--accent); box-shadow:none; color:#fff; }
.radio { width:18px; height:18px; border-radius:5px; box-shadow:inset 0 0 0 1.5px var(--border-strong); display:grid; place-items:center; }
.radio[aria-checked="true"] { box-shadow:inset 0 0 0 1.5px var(--accent); } .radio[aria-checked="true"]::after { content:""; width:8px; height:8px; border-radius:2px; background:var(--accent); }

/* Swatch */
.swatch { width:28px; height:28px; border-radius:8px; border:0; background:var(--c); }
.swatch[aria-checked="true"] { box-shadow:0 0 0 2px var(--bg-card),0 0 0 4px var(--c); }

/* Progress */
.progress { height:6px; border-radius:3px; background:var(--bg-field); overflow:hidden; } .progress > i { display:block; height:100%; border-radius:3px; background:var(--accent); }

/* Menu / popover / dialog */
.popover { background:var(--bg-raised); border:1px solid var(--border-subtle); border-radius:var(--radius-xl); box-shadow:var(--shadow-2); padding:4px; backdrop-filter:blur(24px) saturate(1.4); }
.menu-item { height:32px; display:flex; align-items:center; gap:8px; padding:0 10px; border-radius:var(--radius-sm); } .menu-item:hover, .menu-item[data-active] { background:var(--bg-hover); }
.scrim { position:fixed; inset:0; background:var(--bg-scrim); backdrop-filter:blur(8px); }
.dialog { background:var(--bg-raised); border-radius:var(--radius-xl); box-shadow:var(--shadow-3); border:1px solid var(--border-subtle); padding:20px; width:min(440px,92vw); }
.dialog__footer { display:flex; justify-content:flex-end; gap:8px; margin-top:20px; }

/* Dock */
.dock { display:flex; gap:8px; padding:8px; border-radius:var(--radius-2xl); background:var(--bg-app-translucent); backdrop-filter:blur(24px) saturate(1.4); box-shadow:var(--shadow-2), inset 0 0 0 1px rgba(255,255,255,.35); }
.dock__item { width:44px; height:44px; border-radius:12px; transition:transform var(--dur-base) var(--ease-spring); } .dock__item:hover { transform:scale(1.15); }
.dock__run { width:4px; height:4px; border-radius:1.5px; background:var(--text-secondary); margin:2px auto 0; }

/* Scrollbar (rounded rect) */
*::-webkit-scrollbar { width:10px; height:10px; } *::-webkit-scrollbar-thumb { background:rgba(120,128,140,.45); border-radius:4px; border:2px solid transparent; background-clip:content-box; } *::-webkit-scrollbar-thumb:hover { background:rgba(120,128,140,.7); background-clip:content-box; }

@media (prefers-reduced-transparency: reduce) { .window,.dock,.popover,.scrim { backdrop-filter:none; } :root { --bg-app-translucent:var(--bg-app); } }
@media (prefers-reduced-motion: reduce) { *,*::before,*::after { animation-duration:.01ms!important; transition-duration:.01ms!important; } }
```

### 11.3 Framework mapping
- **Electron/Tauri/web**: use the CSS above; frameless window with custom `.titlebar`; enable vibrancy/acrylic/mica (`backgroundMaterial` on Windows 11, `vibrancy` on macOS, compositor blur on KDE/GNOME where available), else solid fallback.
- **Qt/QML (e.g., Qt Quick Controls 2 / Kirigami-like)**: build a `Theme` singleton exposing the tokens; set `radius` properties from the scale; use `MultiEffect`/`FastBlur` for frost; custom `Switch`, `CheckBox`, `RadioButton`, `Slider` with `Rectangle { radius }` (never `width/2`).
- **GTK4/libadwaita-style**: CSS provider with same variables (`@define-color`), radius via `border-radius`, window `.csd` radius 12px.
- **WPF/WinUI/XAML**: `CornerRadius` from scale (never `Height/2`), resource dictionaries per theme, `Mica`/`Acrylic` backdrops.
- **Flutter desktop**: `ThemeData` extension with token classes; `BorderRadius.circular(8)` etc.; `BackdropFilter` for frost.
- Generate **both** themes by default and expose a theme + accent + font-size + density switcher in Settings → Appearance (System/Light/Dark, 7 accents, Small/Medium/Large/Huge, Comfortable/Compact, "Always blur these apps").

---

## 12. Anti-patterns & final checklist

**Never:**
- Pills, circles, `border-radius: 50% / 999px`, circular avatars/radios/switch knobs/swatches/status dots/badges.
- Heavy 1px dark borders on every element; drop shadows on cards in dark theme; gradients on buttons; neon glows; pure `#000` text on pure `#fff` (except OLED canvas variant for backgrounds only).
- Multiple accent-filled buttons in one view; accent used for decoration; more than one accent color on a screen (status colors excepted).
- ALL CAPS labels, Title Case buttons, centered long paragraphs, placeholder-as-label, color-only error indication.
- Modals for non-blocking info; nested modals; auto-dismissing errors; disabled buttons without explanation.
- Mixed icon styles (filled + outlined + multicolor) except colored icon tiles; icons without labels in primary navigation.
- Full-bleed rows that touch card edges (inset them); card-in-card; more than 3 text sizes in one card.
- Layout shift on loading/hover/validation; scrollbars that change layout width.
- Hardcoded hex in components; theme-specific component forks.

**Pre-flight checklist (run before delivering any UI):**
- [ ] Every container/control radius ≤ 30% of its shortest side; no `999px`/`50%`.
- [ ] Light **and** dark render correctly; contrast verified; accent swappable.
- [ ] Spacing on 4px grid; control height 32 (28/40/44 variants intentional).
- [ ] One primary action per view; secondary/ghost used elsewhere.
- [ ] All states implemented: hover, pressed, focus-visible, selected, disabled, loading, error, empty.
- [ ] Sidebar: group labels (caption, tertiary), selected neutral tint, colored icon tiles; content in cards on inset canvas.
- [ ] Dialogs: title + close, right-aligned Cancel (outline) + confirm, scrim with blur, focus trapped, Esc/Enter work.
- [ ] Inputs: tone-filled wells, accent focus border + glow, helper/error text, password eye toggle, trailing clear/status.
- [ ] Keyboard fully operable; tooltips on icon-only controls; shortcuts displayed.
- [ ] Translucency has solid fallback; motion respects reduced-motion.
- [ ] Copy is sentence case, concise, actionable; destructive actions are undoable or confirm with consequence.
- [ ] Font-size setting (Small→Huge), RTL, and multi-script fallbacks do not break layout.
- [ ] Empty, offline, error, and first-run states designed, not omitted.
