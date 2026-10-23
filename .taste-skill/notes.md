# Delaware Mandir workshop ticket redesign

## Brief reading

This is a public utility for Mandir members who may be uncomfortable with technology. Its single job is to help someone choose poster printing or foam cutting, complete one clear form, and leave with a ticket code they can track.

## Subject inventory

- Delaware Mandir and its volunteer workshop
- One workshop ticket shared by poster printing and foam cutting
- Poster work limited to 24 inches wide
- Foam supplied in 1-inch and 2-inch thicknesses
- Artwork or example files supplied with the request
- Department or group attached to each job
- A needed-by date rather than technical scheduling language
- One private `DM-…` ticket code
- A visible number in line
- A stored material-cost estimate
- Staff and material availability determine timing
- The printed job ticket and receipt are the system’s natural artifacts

## Argument

1. Anyone can start the right workshop request. → Two plain-language service choices appear immediately.
2. The form asks only for information the workshop needs. → Contact details, finished size, quantity, material, date, and files are grouped in reading order.
3. The requester leaves with something tangible. → The receipt gives one large ticket code and clear next actions.
4. Progress is easy to check later. → A single-field tracker accepts the same code.

## Direction

Chosen deal: `one-motif`, seed `542339668`.

Why: the clipped corner of a physical workshop job ticket can carry the composition without adding unfamiliar controls or decorative technology. The alternative photograph-led directions would depend on imagery the Mandir does not currently own and could falsely imply another workshop or staff.

No redraws.

## Idea and live thing

On this page, **the Delaware Mandir workshop job ticket** becomes **the clipped-corner sheet that organizes every stage**.

Live thing: choosing poster printing or foam cutting changes the questions and requirements to match that job. It is already the most useful interaction on the page, works with keyboard and touch, and has a plain two-button fallback.

## Copy deck

- Hero: “What do you need help with?”
- Support: “Choose one workshop service. We’ll guide you through the right questions.”
- Choices: “Poster printing” and “Foam cutting,” each followed by concrete examples.
- Form: “Tell us about your job” with “Your information” and “Job details.”
- Submission reassurance: “After you submit, we’ll give you one ticket code to save.”
- Tracker: “Track a ticket” and one field for the receipt code.

## Baseline critique

ROUND 0

Seen in one second: Two large outlined option cards.

Idea (one sentence): A clear form, but no visual idea beyond familiar cards.

Live thing: Choosing a service reveals its form.

Layout words by section: hero=centred stack / choices=card list / tracker=card.

Scores: design 6.4 · usability 8.3 · creativity 5.8 · content 7.8 → overall 7.0.

Caps applied: No imagery and no signature motion cap design; the page is a utility, so clarity takes priority over adding unrelated stock photography.

Top three problems:

1. Desktop fold: every important item sits in the same centred 760px column, so the page reads as a neat template rather than a composed service.
2. Desktop fold: outlined cards, outlined tracker, and the header rule make borders do nearly all of the visual work.
3. Desktop fold: the physical ticket artifact never appears, so the interface could belong to any request system.
## Round 1 — final critique

- direction: one-motif, seed `542339668`, no redraws
- idea: Turn the workshop request into a calm, clipped-corner job ticket that feels considered without making the form harder to use.
- live thing: Choosing poster printing or foam cutting reveals only the fields required for that service.
- layouts: split ticket field (service choice), sticky split (request form), inverted split (tracker), monument wordmark (footer)
- visible in one second: a workshop ticket and the instruction “Choose what you need.”
- fixed after review:
  1. Shortened the display scale so the hero title holds to two lines on desktop.
  2. Shortened the form-title measure so it also holds to two lines.
  3. Kept all first-paint content readable while retaining a restrained clipped-corner reveal for JavaScript-enabled browsers.
- remaining tradeoffs:
  1. No Mandir-owned workshop photography was available, so the design intentionally uses typography, color, and the ticket motif instead of unrelated stock imagery.
  2. The optional Chrome-based multi-width inspector could not run because Chrome, Edge, and Chromium are not installed in the environment; responsive rules were reviewed in source and the available in-app browser.
  3. The job form remains naturally scroll-heavy, mitigated by a single-column reading order, persistent section context on desktop, large controls, and conditional fields.
- final scores: design 6.5/10 (imagery-floor cap applied), usability 9.0/10, creativity 8.0/10, content 8.2/10; weighted overall 7.7/10
- verification: production build passed; 77 tests passed; data audit passed; design lint reported 0 failures and one non-design warning for request-key hexadecimal padding.
