---
version: 1
slug: "settings"
primary_target: "src/app/settings/page.tsx"
related_targets:
  - "src/App.tsx"
  - "src/components/SettingsPanel.tsx"
  - "src/services/settingsService.ts"
  - "src/components/LineReportGenerator.tsx"
  - "src/components/LatestShiftOverview.tsx"
  - "src/components/CensusFormModal.tsx"
  - "src/utils/censusUtils.ts"
  - "src/index.css"
---

# Shared ward settings

Mode: Operate. Nurses and ward heads configure the shared ward identity and report defaults used by every new census and handover preview.

## Direction contract

THESIS: Settings are one continuous, grouped workflow for ward identity, bed defaults, report content, LINE scheduling, and delivery history.

OWN-WORLD: Use the whole-system ocean direction: Brand Navy navigation and hierarchy, Brand Cyan interaction, Brand Aqua and pale-blue context layers, white workspaces, Brand Emerald progress, amber warnings, and coral errors. Surfaces are layered solid colors with no gradients. Use Noto Sans Thai for Thai copy and tabular values for measured data. Preserve the configured `hospitalName` and `wardName`; the visual direction does not replace local identity.

STORY: Confirm the ward names, establish defaults, preview report sections, understand LINE readiness, set fixed Asia/Bangkok shift times, then inspect real delivery outcomes.

FIRST VIEWPORT: Desktop keeps the fixed Brand Navy rail and header Settings destination; mobile exposes Settings from the header menu while the bottom navigation remains five destinations. The page begins with configured ward/hospital identity and bed defaults, then report preview, LINE schedule, readiness, and history. Use white grouped workspaces on the Ocean Background with the existing 12px card geometry.

FORM: Extend the ocean shift-handover contract from `.impeccable/surfaces/src-app-tsx.md` (Nursing handover strip, candidate 6, seed 2d44fb26) into a grouped settings workflow. Use labeled Field/FieldGroup controls, shadcn/Radix Select where an option list is needed, manual text inputs where a verified Group ID may be pasted, visible inline errors, and 44px touch targets. Bright tokens are for solid fills; strong tokens (`brand-cyan-strong`, `brand-emerald-strong`, and `destructive-strong`) are for accessible text and high-contrast emphasis. A dirty draft remains stable during shared settings polling. Editing an existing census keeps its saved capacity.

CONTROL CONTRACT: Date fields use the shared DatePicker: an editable text field with a conditional clear action for optional values and a 44px calendar icon target that opens a Popover containing the Buddhist calendar from `@daypicker/buddhist` 10.0.2 / React Day Picker. The display is `dd/MM/yyyy` in Buddhist Era with Latin digits; the value remains date-only ISO `yyyy-MM-dd`. Native and inline invalid-date validation stay visible near the field. Select menus use the controlled Radix primitive with an explicit empty state; the Settings LINE group uses the verified Group ID Select alongside a manual input fallback.

STATES: LINE remains off until all required configuration is ready. Show environment readiness booleans and verified webhook-discovered groups; never request or display secrets. Use Surface Emerald for positive readiness, Surface Warning for incomplete reconciliation, and Surface Danger with Destructive Strong text for errors. Empty delivery history is a clear empty state and never fabricated.

FINISH: Settings save errors stay near the affected field and recover without discarding other draft values. New settings affect new forms and report previews; existing saved records retain their capacity and history.

REPORT CONTENT: LINE previews and automatic messages contain the reporting date,
shift, selected figures, and optional note. Ward identity belongs in the
application chrome; hospital, ward, and reporter names are omitted from the
message body.
