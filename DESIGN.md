# Atmospheric Sanctuary Design Laws

This document defines the foundational design principles, component laws, and aesthetic constraints for the 7ay.de Organizer. Adhere to these strictly to maintain the sanctuary's high-instrument, oceanic aesthetic.

---

## 🏛️ Layout Architecture
- **2:1 Split Pane:** LHS (Worktree/Focus) and RHS (Task List).
- **Glass Foundation:** Use `backdrop-filter: blur(32px)` and semi-transparent backgrounds (`rgba(255,255,255,0.03)`) for all primary surfaces.
- **Symmetry Parity:** All task cards must be exactly `480px` wide.

## 🎨 Color Palette & Materiality

### Core Atmospheric Colors
- **Obsidian (`#090a0f`):** The absolute base.
- **Ink (`#f4f0ea`):** Washi-inspired contrast for standard text.
- **Honey Gold (`#e8b004`):** **STRICT EXCLUSIVITY.** Only used for Focus, Selection, and Hover glows.

### Domain Materials (Oceanic)
Every domain has a dedicated **Material Gradient** (for borders/tiles) and a **Solid Luminous Color** (for typography).
- **CTI (Teal):** Asagi (`#5E9C95` grad, `#99f6e4` text).
- **CSD (Cobalt):** Ruri (`#3b6978` grad, `#93c5fd` text).
- **PER (Indigo):** Aizome (`#1f3b4d` grad, `#60a5fa` text).
- **ECM (Earth):** Wood (`#5d4037` grad, `#d7ccc8` text).
- **GRA (Purple):** Murasaki (`#6b4e71` grad, `#e9d5ff` text).

### Temporal Weather (Urgency Hues)
Apply as **subtle background gradients only**. Do not tint text or tiles.
- **Canyon Red (`#c15c3d`):** Due Today/Tomorrow.
- **Warm Amber (`#e8b004`):** Due within 3 days.
- **Marble Grey (`rgba(255,255,255,0.4)`):** Due within a week.
- **Bamboo Green:** Abolished from backgrounds; reserved for the small indicator line only.

---

## 🎴 Component Laws

### The Task Card
- **Border:** Thick `4px` material border via `::after` pseudo-element.
- **Dashed State:** Archived tasks use a dashed material border and `0.85` opacity.
- **Footer Group:** Task Name and Blocker summaries must be grouped in a flexbox `card-footer` to handle multi-line wrapping without overlap.
- **No Pure White:** Task names must use their domain's luminous color.

### The Action Cluster (Top-Left)
Icons are dissolved (borderless, low-opacity) and pinned to `10px 10px`.
- **Order:** `Archive/Restore` → `Edit (✎)` → `Drag (⠿)` → `Donut Indicator`.
- **Vertical Alignment:** Perfectly centered at `height: 24px`.

### The Donut Indicator
- **Style:** Hollow ring (`border: 3px solid`, `background: transparent`).
- **Logic:** Must match the `getTaskHue()` temporal frequency.

### The Sanctuary Indicator Line
- **Structure:** 20 proportional vertical bars (`2px` wide, `12px` high).
- **Housing:** Contained within a full-width glass `status-tile` in the header.

---

## 🖱️ Interaction Principles
- **Drag Handle Only:** Reordering is strictly restricted to the `⠿` icon. The card body is for selection and focus.
- **Modal Supremacy:** Edits never happen inline. Date tiles and names are non-clickable on the card; all mutations occur in the glass modal.
- **Selection Glow:** A selected card gains a solid Honey Gold border (`3px`) and a large `80px` outer glow.

## 🔡 Typography
- **Primary:** Lexend Deca.
- **Weights:** 
    - Names: `500`
    - Metadata/Labels: `800` (All-caps)
    - Identity: `900` (Letter-spacing: `4px`)
