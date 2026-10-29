# 0009. Visual design direction

Status: accepted

## Context

Two surfaces with opposite needs share one codebase.

The public form is the first thing a stranger sees. It has to read as trustworthy and easy, on a phone, to a parent who may be unsure whether they are in the right place at all.

The admin dashboard is a working tool. It has to be dense, scannable and calm, because staff read it all day.

Designing both from one neutral component kit would serve neither.

## Decision

**Direction: slate and marigold.**

Grounded in the subject rather than in a palette generator. *Hunar* means skill or craft, and the categories include Concert alongside Scholarship and Admission, so this is an organisation about drawing talent out of schoolchildren and then putting it on a stage. Two things carry that: the writing slate, which is still what Indian primary schooling looks like, and marigold, which is what celebration looks like.

Tokens:

| Token | Value | Role |
|---|---|---|
| `--ink` | `#15303B` | text and dashboard chrome, a deep teal-slate rather than black |
| `--canvas` | `#EEF3F5` | page ground, a cool washed-slate grey |
| `--surface` | `#FFFFFF` | cards and table rows |
| `--marigold` | `#E8872E` | primary action, used once per screen |
| `--sage` | `#3E7A68` | resolved and success |
| `--clay` | `#A33B32` | errors and destructive actions |

Type: one display face, **Bricolage Grotesque** (variable), for headings and the numerals in the summary. Body and UI use the system stack. One webfont rather than two, because Core Web Vitals is a stated requirement and a second family buys nothing a weight does not.

**Signature element: the status rail.**

Inquiry status is not an arbitrary label, it is a sequence: New, In Progress, Resolved, Closed. So it renders as a connected four-step rail rather than a dropdown. An admin sees how far an inquiry has travelled without reading a word, and advancing it is clicking forward along the rail.

## Alternatives considered

Three looks dominate AI-generated design right now, and all three were deliberately avoided because they appear regardless of subject:

**Warm cream (around `#F4F1EA`) with a high-contrast serif display and a terracotta accent.** The nearest miss, because a warm paper ground is genuinely apt for an education product. Rejected on the serif in particular: a display serif signals heritage and institution, and this organisation's pitch is a child's talent, not an old school's prestige. The ground here is cool rather than cream for the same reason, so it reads as slate rather than parchment.

**Near-black with a single acid accent.** Rejected on audience. It reads as developer tooling or a crypto product, and the public form is being read by a parent deciding whether this organisation is real.

**Broadsheet: hairline rules, zero radius, dense newspaper columns.** Tempting for the dashboard, where density is a virtue. Rejected because the same tokens then have to serve the public form, where hairline rules and zero radius read as austere and bureaucratic, which is the opposite of the required impression.

**A component library's default theme, shadcn or similar.** Fastest route and the one that most reliably produces something competent. Rejected because competent and anonymous is still anonymous, and the brief's own wording is "simple and clean", which is a request for considered rather than for default.

**Numbered markers (01 / 02 / 03) as a structural device.** Rejected everywhere except the status rail. Numbering is only honest when the content is genuinely a sequence; on a feature list or a form it is decoration pretending to be information. Status is a real sequence, so it is the one place numbering earns its keep.

## Consequences

The two surfaces share tokens but not density. The form is single-column and generous; the dashboard is tabular and tight. One palette, two rhythms.

Marigold appears once per screen, on the single primary action. Spending it everywhere would make the primary action invisible, which is the usual failure of a bright accent.

The status rail is the one place boldness is spent. Everything around it stays quiet, and that is deliberate: a memorable element only reads as memorable against restraint.

A quality floor applies regardless of direction, because it is a stated requirement rather than a matter of taste: responsive to mobile, visible keyboard focus, labels associated programmatically, errors announced, AA contrast, and `prefers-reduced-motion` honoured. The direction is not allowed to cost any of those.
