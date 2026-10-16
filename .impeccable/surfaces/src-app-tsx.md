---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/components", "src/index.css"]
---

# Ocean Health visual direction for the shift handover workspace

Mode: Operate. Support nurses entering shift totals and ward heads examining shared records. Preserve existing census, history, analytics, CSV, and editable clipboard reports. Mobile and desktop are equally supported. Empty data is real, never populated with invented records.

The visual system is an ocean-led rebrand applied across the whole workspace: modern, calm, saturated, and built from layered solid colors. Use Brand Navy (`#123b5d`) for the desktop rail and primary hierarchy, Brand Cyan (`#04a4b2`) for interaction and focus, Brand Aqua (`#64d3d0`) and pale blue surfaces for context, Brand Emerald (`#20a886`) for positive next steps, amber for reconciliation, and coral for errors. Do not use gradients. Preserve the configured `wardName` and `hospitalName` in the rail, header, report preview, and Settings; the visual direction never becomes a product name.

## Direction contract

THESIS: One shift is a complete unit of work, with its totals, category mix, and handover message kept together rather than scattered among summary cards.

OWN-WORLD: Ocean Health visual direction across the entire app: navy navigation, cyan interaction, aqua and pale-blue context surfaces, white workspaces, emerald progress, amber warnings, coral errors, Noto Sans Thai text, tabular counts, and flat ruled groups. Every surface is a solid color. Ward and hospital identity remains configured data.

STORY: Select a date/shift, inspect totals, enter or correct the census, then prepare and copy its LINE summary. Heads reach history and period analytics from the same navigation.

FIRST VIEWPORT: Desktop has a fixed 256px Brand Navy rail, a 64px Surface Aqua sticky header, and a wide shift summary with entry and LINE actions, followed by recent shifts beside the detailed workspace. Mobile has the current date/shift, summary, primary entry action, report controls, a five-destination bottom navigation, and a drawer for Settings.

OVERVIEW RECENT SHIFTS: The Overview takes the newest records, groups them by report date, and renders one date group at a time. Sort available shifts inside every date group in the operational order ดึก → เช้า → บ่าย, using `SHIFT_ORDER` rather than label sorting. The selected record is the active summary/report context and exposes selected styling with Accent/Surface Aqua, Brand Cyan border, foreground text, a check mark, and `aria-pressed`. On mobile, date groups stay in a horizontally scrollable snap row; at `sm` and above they become a grid. Keep each group a compact ruled background card with shift buttons at least 44px high.

CATEGORY SPECTRUM: Patient categories use green → cyan → blue → amber → coral in fixed order. Bright fill tokens are `#1caf83`, `#16a7b8`, `#3578c6`, `#e1a22b`, `#cf4f57`; paired surfaces are `#e6f7f1`, `#e2f6f8`, `#e8f0fa`, `#fff5df`, `#fbeaec`. Use bright tokens for donut/legend marks and solid fills, paired surface tokens for quiet backgrounds, and labels/numbers so color is never the only cue.

LINE CATEGORY CONTENT: When category reporting is enabled, the generated report contains the heading `ประเภทผู้ป่วย` and five labeled care-demand/count lines in this fixed order: `ประเภท 1 (อาการน้อยสุด): [count] ราย`, `ประเภท 2 (อาการน้อย): [count] ราย`, `ประเภท 3 (อาการปานกลาง): [count] ราย`, `ประเภท 4 (อาการหนัก / กึ่งวิกฤต): [count] ราย`, `ประเภท 5 (วิกฤต / หนักมาก): [count] ราย`. The entry form preview, editable manual LINE text/copy flow, and scheduled delivery must call the same summary contract so labels and counts cannot drift; disabling category reporting omits the block as a unit.

ANALYTICS: Keep the category distribution as one donut with a short five-item legend. Legend labels remain on one line (`white-space: nowrap`) so the key stays compact and scannable; category values and rates use aligned tabular numerals. Compare movement in one ruled table with exactly three data rows in the operational order ดึก → เช้า → บ่าย; show admissions, discharges, referrals, and average patients as columns rather than separate shift cards.

FORM: Nursing handover strip, candidate 6 of the grounded list, seed 2d44fb26; user selected assigned direction with code-first. Signature interaction: shift selection updates the summary and its corresponding report together without losing context.

ENTRY PREVIEW: The census entry form presents a read-only LINE message preview using the draft and the sender's shared report settings. It has no clipboard action. While report settings are unavailable, show a clear unavailable status and recovery hint instead of rendering a default message.

DATE CONTROL: Entry and history date fields use the shared DatePicker with an editable `dd/MM/yyyy` Buddhist Era display, Latin digits, Thai Buddhist calendar labels from `@daypicker/buddhist` 10.0.2, a conditional clear icon for optional values, a 44px calendar icon target, and native plus inline invalid-date validation. The model remains a date-only ISO `yyyy-MM-dd` string for storage and API boundaries.

SELECT CONTROL: Shift and history filters use the controlled shadcn/Radix Select primitive with keyboard navigation, 44px triggers and options, and an explicit empty state. Settings keeps the verified Group ID Select beside its manual text input fallback.

RESPONSIVE AND ACCESSIBILITY: Use a 1500px content maximum, `lg` rail offset, `xl` supporting columns, 16px mobile page padding, safe-area bottom padding, and 44px minimum targets. Keep visible focus rings, semantic labels, non-color selected/error cues, reduced-motion behavior, and real empty/error/loading states.
