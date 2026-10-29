# 0014. A record panel for enquiry actions, and flat surfaces instead of nested cards

Status: accepted

## Context

Two problems with the admin surface, reported together.

**The dashboard was a read-only table.** An enquiry's full message was truncated to one line, there was nowhere to record what happened when someone rang the applicant back, and nobody owned anything. The status rail was the only action on the page. Against the brief that is complete; against what the word "CRM" promises it is not, because the work a staff member actually does to an enquiry had no home.

**Every region was a bordered card.** Five stat cards in a row, a filter card, a table card, each with its own border, radius and shadow, stacked with gaps between them. The effect is the look that generative tools converge on: visually busy, with the page's real structure buried under uniform containers that all carry the same weight. Nothing was wrong with any single card; the problem was that there were seven of them and none of them meant anything.

## Decision

### Actions, drawn from what established CRMs actually offer

Surveyed HubSpot's lead records, which is the most documented of the mainstream products. The actions that recur across it and its peers, reduced to the ones this data model can honestly support:

| Action | Implemented as |
|---|---|
| Open the record | A slide-over panel, not a route |
| Read the full submission | The panel's message section, unwrapped |
| Advance the status | The existing rail, in both the row and the panel |
| Assign an owner | `inquiries.assigned_to_admin_id`, set from the panel |
| Record internal notes | `inquiry_notes`, append plus author-only delete |
| See what happened and who did it | A timeline read from the append-only security log |
| Contact the person | `tel:` and pre-addressed `mailto:` actions |
| Work a slice of the queue | Status and owner filters, including "Mine" and "Unassigned" |

Deliberately **not** built: tasks and reminders (needs a scheduler this has no runtime for), email-from-the-app (the provider is wired for one transactional message, not a mail client), custom fields, pipelines and deal values (this is an enquiry inbox, not a sales pipeline), and bulk editing (a destructive multi-row write deserves more care than the remaining time allowed, and a half-built one is worse than none).

**A panel rather than a page.** A staff member works a queue: open, read, act, close, next. A route change would discard the scroll position and the filters on every record, so the list stays mounted behind the panel.

**The timeline reads from `security_events` rather than a second history table.** Status changes and assignments are already audited there. A parallel history table would be a second record of the same facts, free to disagree with the first. The cost is one expression index on `detail ->> 'inquiryId'`, which is cheap and is the only query that filters on a key inside the JSON.

### Surfaces

One bordered surface per *object*, not per region.

- The toolbar and the table are one container with an internal rule, because they are one thing: a list and the controls that filter it.
- The five status figures became a tab strip with a single underline for the active one. They were already five numbers in five boxes; as tabs they also *do* something, since the number you want to act on is now the control that filters to it.
- Inside the panel, sections are separated by hairlines and a small uppercase label. No nested cards.
- Shadow is reserved for the one element that genuinely floats, the panel.

## Alternatives considered

**A full record page at `/admin/inquiries/:id`.**
Deep-linkable, which a panel is not. Rejected because the dominant use is triage, and losing the list's position on every record is a worse cost than losing a shareable URL for an internal queue. Worth revisiting if someone needs to send a colleague a link to one enquiry.

**A modal dialog.**
Same focus handling, less room, and it blocks the list entirely rather than keeping it visible alongside. A slide-over is the pattern the mainstream products settled on for exactly this.

**Keeping the cards and just adding the panel.**
Would have satisfied the functional half of the request and left the visual half untouched. The two were reported together because they are the same complaint: the page did not communicate what mattered.

**Editing the applicant's own details (name, email, message).**
Rejected deliberately. Those fields are what a member of the public submitted; staff correcting them in place would destroy the record of what was actually received. Notes exist for the staff's own account of events.

## Consequences

Two tables and one column added, four endpoints added, and one expression index. Notes are author-only for deletion, which is enforced as a predicate in the `DELETE` statement rather than a read-then-compare, so there is no gap between the check and the write, and "not yours" is answered identically to "no such note" so the response cannot confirm another author's note exists.

The panel is a dialog, so it owes a keyboard user focus on open, Escape to close, and a labelled region. It has all three. It is not a focus trap, which is the one accessibility shortcut taken here and is recorded as such rather than claimed as complete.
