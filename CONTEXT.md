# Inpatient Census

Shift-based aggregate inpatient reporting for Ongkharak Hospital.

## Language

**Census record**:
Aggregate ward patient counts for one calendar date and one shift. It is not an individual patient record.
_Avoid_: Patient record, medical record

**Shift**:
One of the existing reporting periods: night (00:00–08:00), morning (08:00–16:00), or afternoon (16:00–24:00).

**Patient category**:
One of five existing care-demand categories, from category 1 (lowest care demand) to category 5 (critical care).

**Nursing workload estimate**:
The sum of category counts multiplied by their existing daily care-hour weights: 1.5, 2.5, 3.5, 5.5, and 7.5 hours. It is an estimate, not a recorded staffing total.

**LINE summary**:
Shift-summary text containing the reporting date, shift, selected census figures,
and optional note. Hospital, ward, and reporter names are excluded from its body.
When patient categories are included, each category carries its care-demand label
and count on a separate line. The same generated summary is used by previews,
manual copying, and scheduled delivery.
_Avoid_: LINE delivery receipt

**Scheduled report slot**:
A census reporting date and shift with a configured reporting time. Its identity
remains distinct from an editable census record.

**Missing-data notice**:
A group message stating that the due report slot has no recorded census. It
contains no inferred patient totals.

**Accepted LINE request**:
A report or notice whose push request was accepted by LINE. It is not proof of
individual receipt or reading.

**Nurse**:
An invited, active user who records and updates shared ward census data, reviews
history, and prepares LINE summaries.

**Ward head**:
An invited, active user responsible for ward administration, including census
deletion, analytics, exports, shared settings, LINE automation, and user access.
_Avoid_: Admin, administrator

**Invitation**:
A time-limited authorization for one normalized Google email address to join as
a nurse or ward head. It is not an emailed link or a reusable access token.

**Audit entry**:
An immutable account of a census or administration change, including its actor
and the relevant before-and-after state. Historical data without an actor is
attributed to System.

**User profile**:
The authenticated user's confirmed first name, last name, and nickname. A user
whose profile is incomplete must finish it before accessing ward functions.
Google display names may prefill the form but are not treated as confirmation.
