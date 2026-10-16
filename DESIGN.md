---
name: IPD Report
description: A calm, saturated ocean led workspace for shared inpatient census reporting and nursing handover.
colors:
  background: "#edf5f7"
  foreground: "#102a43"
  surface: "#ffffff"
  brand-navy: "#123b5d"
  brand-navy-strong: "#0b2944"
  brand-cyan: "#04a4b2"
  brand-cyan-strong: "#06717e"
  brand-aqua: "#64d3d0"
  brand-emerald: "#20a886"
  brand-emerald-strong: "#08705a"
  surface-aqua: "#dff5f4"
  surface-cyan: "#dceff5"
  surface-emerald: "#e2f4ed"
  muted: "#e5eff3"
  muted-foreground: "#526b7a"
  accent: "#c8eeee"
  accent-foreground: "#0c4e66"
  border: "#cadde5"
  input: "#a9c4d0"
  ring: "#04a4b2"
  surface-warning: "#fff1d6"
  surface-danger: "#fde4e5"
  destructive: "#c44850"
  destructive-strong: "#9f2933"
  category-1: "#1caf83"
  category-2: "#16a7b8"
  category-3: "#3578c6"
  category-4: "#e1a22b"
  category-5: "#cf4f57"
  category-1-surface: "#e6f7f1"
  category-2-surface: "#e2f6f8"
  category-3-surface: "#e8f0fa"
  category-4-surface: "#fff5df"
  category-5-surface: "#fbeaec"
typography:
  display:
    fontFamily: "Noto Sans Thai, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: "2.25rem"
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Noto Sans Thai, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: "2rem"
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Noto Sans Thai, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: "1.75rem"
  body:
    fontFamily: "Noto Sans Thai, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.5rem"
  label:
    fontFamily: "Noto Sans Thai, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: "1.25rem"
  data:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: "2rem"
    fontFeature: "tabular-nums"
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.75rem"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  section: "32px"
  page: "40px"
components:
  button-primary:
    backgroundColor: "{colors.brand-navy}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: "44px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: "44px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    height: "44px"
  date-picker:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    height: "44px"
  select:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    height: "44px"
  summary-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "20px"
  shift-selector:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    height: "44px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    height: "44px"
---

# Design System: IPD Report

## Overview

**Creative North Star: “Ocean Health Handover Current”**

The application treats one shift as a complete unit of work. A nurse selects a date and shift, reads totals and category mix, enters or corrects the census, and prepares the LINE handover from that same record. The visual direction is a modern, calm, saturated ocean palette: deep navy establishes trust, bright cyan carries interaction, aqua and pale blue surfaces create breathing room, and emerald confirms useful progress. The result is clinical enough for long ward sessions while carrying more energy than a neutral ledger.

The palette is expressed through layered solid surfaces. A pale blue canvas, cyan header, navy rail, white workspaces, aqua context bands, emerald next-step panels, amber reconciliation warnings, and coral errors make the information architecture visible at a glance. There are no gradients. Color is structural and semantic, with text, borders, icons, and labels carrying meaning alongside it.

The application renders the configured hospital and ward names wherever identity is shown. The ocean direction is the visual system; it does not replace that local identity with a product name. Noto Sans Thai keeps Thai labels legible at working sizes, while IBM Plex Mono with tabular numerals makes totals and rates easy to compare.

The Overview keeps recent records in date groups, ordered within each date as ดึก → เช้า → บ่าย. The active record is selected with aqua treatment, cyan border, foreground text, and a check mark. The same record context follows Overview, Entry, LINE, History, and Analytics. Settings remains available from the desktop rail and header menu without displacing the five daily-work destinations.

**Key Characteristics:**

- Shift-first workflow with one selected record shared by totals, category mix, and handover actions.
- Layered solid surfaces built from navy, cyan, aqua, pale blue, emerald, amber, and coral.
- Semantic patient categories progress green → cyan → blue → amber → coral.
- Numeric emphasis through tabular data, clear Thai labels, and explicit units.
- Soft 6–12px corners, restrained shadows, and touch targets of at least 44px.
- A fixed desktop rail and five-item mobile bottom navigation preserve the same routes.

## Colors

The system uses the ocean direction as a full interface language. Surface color is allowed to carry hierarchy, so related work areas can be recognized before reading every label. All surfaces are opaque solid colors; no gradient token or gradient treatment belongs in this system.

### Brand and action

- **Brand Navy** (`colors.brand-navy`, `#123b5d`): Desktop rail, primary buttons, strong headings, and the highest-priority action.
- **Brand Navy Strong** (`colors.brand-navy-strong`, `#0b2944`): Hover state for navy actions and the dark rail foundation.
- **Brand Cyan** (`colors.brand-cyan`, `#04a4b2`): Focus ring, active mobile navigation, links, active border, and high-visibility interaction state.
- **Brand Cyan Strong** (`colors.brand-cyan-strong`, `#06717e`): Accessible cyan text and high-contrast emphasis on light surfaces. Use the bright Brand Cyan for fills and focus rings.
- **Brand Aqua** (`colors.brand-aqua`, `#64d3d0`): Mark icon, selection highlight, and light contrast against navy.
- **Brand Emerald** (`colors.brand-emerald`, `#20a886`): Positive next-step action, success treatment, and the active rail indicator.
- **Brand Emerald Strong** (`colors.brand-emerald-strong`, `#08705a`): Accessible emerald text and high-contrast positive emphasis. Use the bright Brand Emerald for fills.

### Surfaces

- **Background** (`colors.background`, `#edf5f7`): Main application canvas and mobile drawer surface.
- **Surface Aqua** (`colors.surface-aqua`, `#dff5f4`): Sticky header, mobile bottom navigation, and light ocean context.
- **Surface Cyan** (`colors.surface-cyan`, `#dceff5`): Hovered outline controls and blue context layers.
- **Surface Emerald** (`colors.surface-emerald`, `#e2f4ed`): Next-step panel, positive notices, and empty-state icon treatment.
- **Surface Warning** (`colors.surface-warning`, `#fff1d6`): Reconciliation and amber readiness warnings.
- **Surface Danger** (`colors.surface-danger`, `#fde4e5`): Error notices and destructive status blocks.
- **Surface** (`colors.surface`, `#ffffff`): Cards, forms, tables, previews, and readable content areas.
- **Muted** (`colors.muted`, `#e5eff3`): Metric bands, notes, skeletons, and secondary grouping.

### Text, rules, and status

- **Foreground** (`colors.foreground`, `#102a43`): Primary text and data.
- **Muted Foreground** (`colors.muted-foreground`, `#526b7a`): Metadata, helper text, timestamps, and secondary labels.
- **Border** (`colors.border`, `#cadde5`): Card boundaries, table rules, and separators.
- **Input** (`colors.input`, `#a9c4d0`): Field and outline-control borders.
- **Accent** (`colors.accent`, `#c8eeee`) and **Accent Foreground** (`colors.accent-foreground`, `#0c4e66`): Selected and quiet interactive surfaces.
- **Destructive** (`colors.destructive`, `#c44850`): Bright coral fills for invalid fields, failed-operation surfaces, and destructive actions.
- **Destructive Strong** (`colors.destructive-strong`, `#9f2933`): Accessible coral text, error headings, and high-contrast destructive emphasis.

### Patient category spectrum

The category spectrum is always shown with its Thai label and number. It progresses with care demand: **Category 1 Green** (`#1caf83`, surface `#e6f7f1`), **Category 2 Cyan** (`#16a7b8`, surface `#e2f6f8`), **Category 3 Blue** (`#3578c6`, surface `#e8f0fa`), **Category 4 Amber** (`#e1a22b`, surface `#fff5df`), and **Category 5 Coral** (`#cf4f57`, surface `#fbeaec`). Bright category tokens are for solid fills and donut/legend marks; each paired surface token provides a quiet background. They are semantic, not decorative.

**The Layered Surface Rule.** Give each workspace a clear solid surface role before adding elevation: background canvas, navy navigation, aqua header/navigation, white content, emerald progress, amber warning, or coral error. Use bright tokens for fills and paired strong tokens for accessible text. Keep the selected record legible through border, text, background, and icon cues together.

## Typography

**Display and body:** Noto Sans Thai with `ui-sans-serif`, `system-ui`, and `sans-serif` fallbacks. This is the working voice for Thai headings, labels, form values, and instructions.

**Data:** IBM Plex Mono with `ui-monospace`, SFMono-Regular, Menlo, Monaco, Consolas, and `monospace` fallbacks. Use tabular numerals for totals, rates, capacity, counts, and chart readouts.

### Hierarchy

- **Display:** 600, `1.875rem`, `2.25rem` line-height, tight tracking for large page titles.
- **Headline:** 600, `1.5rem`, `2rem` line-height for shift summary, entry, LINE, and history headings.
- **Title:** 600, `1.25rem`, `1.75rem` line-height for panels and sections.
- **Body:** 400, `1rem`, `1.5rem` line-height for primary reading and form text.
- **Label:** 500, `0.875rem`, `1.25rem` line-height for navigation, controls, and metadata.
- **Data:** 600, `1.5rem`, `2rem` line-height with tabular numerals for scan-critical values.

**The Data Voice Rule.** Mono is for quantities and rates. Thai headings, instructions, and messages stay in Noto Sans Thai.

## Layout

At `lg` and above, the fixed left rail is 256px wide and the sticky header begins after the rail. The main content uses a centered `1500px` maximum, 40px horizontal padding on large screens, 16px padding on smaller screens, and a 64px header. Overview leads with the shift summary and recent grouped shifts, then places recent history beside a 320px next-step panel at `xl`. Entry, LINE, History, Analytics, and Settings use the same content frame.

The desktop rail is solid Brand Navy with a Brand Aqua mark, configured ward name, configured hospital name, five work destinations, and a separate Settings route. The sticky header uses a translucent Surface Aqua layer with backdrop blur, refresh/settings controls, and the primary “บันทึกยอดเวร” action. The mobile drawer exposes the same routes when opened; the persistent five-item bottom navigation stays at least 64px high and includes safe-area padding.

Recent shifts are grouped by report date. Groups scroll horizontally with snap behavior below `sm`, become a two-column grid at `sm`, and a three-column grid at `xl`. Within each group, shifts use `SHIFT_ORDER` and the operational order ดึก → เช้า → บ่าย. Forms collapse to one column, tables become stacked records where appropriate, and LINE configuration/editor content becomes a vertical flow.

The spacing rhythm uses 4px increments: 8/12/16px control gaps, 20px compact card padding, 28px larger workspace padding, and 32px section gaps. The selected date, shift, totals, category mix, and handover actions remain one readable context even when the route changes.

## Elevation and depth

Color layering does most of the separation. Cards use a 1px Border rule and a white surface; the overview and analytics cards use the small default shadow; the Entry workspace uses `0 8px 24px rgba(18,59,93,0.08)`; destructive confirmation uses the shared dialog shadow. Controls and metric cells do not float independently.

**The Solid Surface Rule.** Do not introduce gradients, glassy color blends, or decorative shadows. Use the prescribed opaque surfaces, borders, and one calm shadow when a workspace boundary needs help.

## Shapes and interaction

The root radius is 12px. Main cards use `rounded-xl` (12px), grouped sections use `rounded-lg` (8px), controls use `rounded-md` (6px), and status badges use `rounded-full`. Category swatches are small 2–4px rounded squares. Borders remain 1px.

Buttons, date fields, selects, numeric steppers, filter controls, shift selectors, nav items, and mobile navigation expose at least 44px of interaction height. Numeric inputs use 48px where the form gives the value extra weight. Focus uses the Brand Cyan ring with a visible 3px outline. Error fields use coral/destructive borders and helper text; amber is reserved for reconciliation and readiness warnings. Reduced-motion users receive the same state changes without prolonged transitions.

## Components

### Buttons

The default primary button is Brand Navy with white text and a 44px height; its hover state is Brand Navy Strong. Emerald is used for the Overview next-step action, with Brand Emerald Strong for text and high-contrast emphasis on pale surfaces. Brand Cyan Strong serves the same text role for cyan. Outline buttons use Input border, a white or transparent surface, and Surface Cyan on hover. All controls keep icon and Thai label aligned with an 8px gap.

### Shift selector and summary

The shift summary card combines report date, shift, update time, four key statistics, occupancy status, movement totals, nursing workload, category donut, note, edit action, LINE action, copy action, and next-shift action. Recent date groups are compact white-on-background cards. The selected shift uses Accent/Surface Aqua, Brand Cyan border, foreground text, and a check icon with `aria-pressed`, never color alone.

### Census entry

Entry uses date-only ISO `yyyy-MM-dd` at storage/API boundaries while displaying editable `dd/MM/yyyy` Buddhist Era text with Latin digits. The DatePicker uses `@daypicker/buddhist` 10.0.2 / React Day Picker, a 44px calendar target, conditional clear action, native required validation, and inline invalid-date feedback. Numeric fields use adjacent 44px decrement/increment controls, disable decrement at zero, and keep category totals reconciliation visible.

### Select and LINE

The controlled shadcn/Radix Select provides keyboard navigation, 44px triggers/options, selected check state, and explicit empty/disabled states. Settings places the verified LINE Group ID Select beside a manual text fallback.

The entry preview is read-only and uses the same shared report settings as the editable LINE route. When settings are unavailable, it shows an unavailable status and recovery hint rather than inventing a default message. When category reporting is enabled, every generated report uses `ประเภทผู้ป่วย` followed by exactly five labeled lines in this order:

`ประเภท 1 (อาการน้อยสุด): [count] ราย`
`ประเภท 2 (อาการน้อย): [count] ราย`
`ประเภท 3 (อาการปานกลาง): [count] ราย`
`ประเภท 4 (อาการหนัก / กึ่งวิกฤต): [count] ราย`
`ประเภท 5 (วิกฤต / หนักมาก): [count] ราย`

The preview, manual copy flow, and scheduled delivery share this contract and omit the whole block when category reporting is disabled.

### Analytics and history

Analytics uses a four-cell metric band, an SVG patient-versus-capacity trend chart with selectable points, one category donut, and a five-item non-wrapping legend. Category values and rates use tabular numerals. Shift movement is one ruled table with exactly three rows in ดึก → เช้า → บ่าย order and columns for admissions, discharges, referrals, and average patients. History supports search, date/shift filtering, edit, delete, CSV export, and LINE actions; desktop uses a table and mobile uses stacked records.

### Settings

Settings is a grouped workflow for configured hospital/ward identity, default bed capacity, report format and sections, LINE Group ID, reporting times, readiness, and delivery history. It keeps secrets out of the UI, reports server credentials and verified groups as readiness signals, and only enables scheduled reporting when token, verified destination, and schedule are valid. Accepted provider requests are recorded as accepted outcomes, not as proof that recipients read the message. Empty delivery history is a real empty state.

## Do's and Don'ts

### Do

- Keep the ocean palette across every route: navy rail, cyan interaction, aqua/pale-blue context, white workspaces, emerald progress, amber warnings, and coral errors. Use bright tokens for fills and strong tokens for accessible text.
- Preserve the configured hospital and ward identity in the rail, header, report preview, and Settings surface.
- Use solid surfaces only; use borders and one calm shadow to establish depth.
- Keep 44px minimum interaction height and safe-area padding on mobile navigation.
- Show dates, shift labels, and units beside key totals; use tabular numerals for comparisons.
- Group recent shifts by date, order them ดึก → เช้า → บ่าย, and expose selected state through text, border, background, and check mark.
- Keep the LINE category block shared across preview, manual copy, and scheduled delivery.
- Keep validation and reconciliation messages near the affected field or section.
- Treat an empty database and empty delivery history as real empty states with a clear next action.

### Don't

- Do not call the product Ocean Health or replace the configured hospital/ward names with a generic brand label.
- Do not use gradients, gradient tokens, or decorative color blends.
- Do not reintroduce retired brand token names or their associated color roles.
- Do not turn every number into a saturated card; use white workspaces, muted bands, borders, and the semantic surface colors with intent.
- Do not use category colors without their category labels or rely on color alone for status.
- Do not wrap the category legend or split the three shift movement comparisons into separate cards.
- Do not invent patient records or imply that mobile behavior is a native-device claim; the tested mobile surface is a 390px Chrome viewport.
