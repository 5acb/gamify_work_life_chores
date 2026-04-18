# Evolution of the Atmospheric Sanctuary

This document chronicles the design journey and architectural evolution of the 7ay.de Organizer, moving from a functional utility to a polished, cinematic productivity sanctuary.

## The Vision
The goal was to evolve the UI into an **"Atmospheric Sanctuary"**—a 2:1 split-pane interface that fuses skeuomorphic glass aesthetics with a functional oceanic palette. Every interaction was designed to feel intentional, grounded, and high-instrument.

---

## The Journey: Phase by Phase

### 1. State Unification (The "Done is Archived" Law)
*   **The Problem:** The app previously had separate "Done" and "Archived" states, leading to redundant clicks and confusing grey-out logic.
*   **The Solution:** Unified them into a single terminal state. Marking a task as "Archive" now implicitly marks it as "Done."
*   **Aesthetic Shift:** Archived tasks are no longer "dead." They are desaturated, feature faded text, and a dashed material border—a "slight hint" of their past presence.

### 2. Positional Precision & Dissolved Actions
*   **The Problem:** Action buttons (Edit/Archive) were floating in tile containers, making them feel clunky and capturing clicks inconsistently.
*   **The Solution:** Actions were "dissolved"—rendered as borderless, low-opacity icons pinned to the **absolute top-left** (`10px 10px`).
*   **Refinement:** Swapped order (Archive first, then Edit) and added a dedicated **Drag Handle** (`⠿`) to separate navigation from reordering.

### 3. Material Immersion (Oceanic Resonance)
*   **The Problem:** Task names were solid white or simple gradients, which often felt "dirty" against the dark backgrounds.
*   **The Solution:** Task names now use **solid, luminous material colors** (Mint Teal, Sky Blue, Lavender) for perfect contrast.
*   **GRA Transformation:** Shifted the `GRA` domain from "too orange" Amber to a deep **Murasaki Purple** gradient with Lavender typography.

### 4. Atmospheric Urgency (Temporal Weather)
*   **The Problem:** Functional colors (Red/Green) were competing with domain identities.
*   **The Solution:** Urgency colors were restricted to **Subtle Background Hues**.
    *   🔴 **Canyon Red:** Due today/tomorrow (`8%` glow).
    *   🟠 **Warm Amber:** Due within 3 days (`4%` glow).
    *   ⚪ **Marble Grey:** Due within a week (`2%` shift).
    *   **Bamboo Removal:** Initially tried green backgrounds for standard tasks, but removed them to reduce visual noise. Sanctuary is "dark and quiet" by default.

### 5. Instrumental Header & The Indicator Line
*   **The Problem:** Status distribution was represented by 20 loose dots, which looked cluttered and didn't scale well.
*   **The Solution:** Created the **Sanctuary Indicator Line**—20 proportional vertical bars housed in a full-width glass tile. It looks like a high-end data instrument.

### 6. The Donut Indicator
*   **The Problem:** Solid "jewel" circles felt heavy and skeuomorphic in a way that blocked the glass texture.
*   **The Solution:** Replaced them with **Donut Indicators**—glowing hollow rings. These are perfectly aligned with the action icons to provide a "temporal frequency" at a glance.

---

## What Worked vs. What Didn't

### ✅ What Worked
*   **Helper Abstractions:** Moving urgency logic into `getTaskHue()` ensured that background tints, header bars, and donuts were always in sync.
*   **Flexbox Grouping:** The `card-footer` container solved text-overlap bugs by allowing the task name and blocker tile to stack naturally as the name wrapped.
*   **Persistent UI State:** Integrating `Sortable.js` with a backend `ui-state` endpoint made the drag-to-reorder feature feel robust and professional.
*   **Locked Date Tiles:** Moving date edits strictly to the modal prevented accidental UI breakage and improved stability.

### ❌ What Didn't Work
*   **Inline Editing:** Attempting to click-to-edit dates directly on the card was fragile and caused accidental activations during drags. It was abolished in favor of the Modal.
*   **Green Tints (Bamboo):** Green backgrounds for "safe" tasks made the UI feel like a traffic light. Removing them returned the app to its "Sanctuary" aesthetic.
*   **Absolute Positioning for Text:** Initially used `bottom: 20px` for everything, which caused overlap when task names were long. Flex containers were the necessary fix.

---

## The "Why"
Every decision was driven by the **Reduction of Anxiety**. By isolating functional urgency (hues/donuts) from identity (domain colors) and ensuring absolute layout precision, the app provides a sense of control and calm even during a "grad school crunch."
