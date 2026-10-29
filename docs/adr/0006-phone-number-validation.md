# 0006. India-only phone validation, canonical E.164 storage

Status: accepted

## Context

The form collects a phone number, and the dashboard must support searching by it. Those two requirements are connected in a way that is easy to miss: search is a substring match, so it is only reliable if every stored number has exactly one possible representation.

If `9876543210`, `+91 98765 43210` and `098765-43210` are all stored as typed, then searching for any one of them misses the other two, and the feature appears to work while silently failing.

## Decision

Validate as an Indian mobile number and store canonically as `+91XXXXXXXXXX`.

Accepted input tolerates spaces, hyphens, parentheses, dots, en dashes, a `+91` or `0091` country prefix, and a leading trunk zero. Everything normalizes to one form.

The canonical form is enforced twice: by the shared Zod schema, and by a `CHECK (phone ~ '^\+91[6-9][0-9]{9}$')` constraint in `schema.sql`. The constraint is what makes it true rather than merely intended, since it holds even for a direct database connection.

Search normalizes the query the same way, reducing it to digits and dropping a leading trunk zero, so however an admin types the number it matches the stored form.

## Alternatives considered

**`libphonenumber-js`.**
Google's data, maintained, handles every country. It is the right answer for an international product. Rejected here for two reasons: the audience is Indian schools, students and parents, so the other 200 numbering plans are dead weight in a browser bundle; and its permissiveness works against the canonical-storage requirement, since accepting arbitrary international numbers means the `CHECK` constraint has to go, and with it the guarantee search depends on.

**Store whatever the user typed, normalize only at search time.**
Rejected. It pushes the problem to every reader of the column, and any consumer that forgets is silently broken. Normalizing on write means the column has one meaning.

**Accept landlines as well as mobiles.**
Considered for the School user type. Rejected because Indian landline formats vary by STD code length, which makes a single regex either wrong or so loose it stops being a constraint. In practice an institution gives a mobile contact. This is the sharpest limitation of the decision and is stated rather than buried.

## Consequences

One number has one representation, so substring search is correct by construction and the trigram index on the column is meaningful.

Validation is zero-dependency, fast, and unit-tested across prefix forms, separator forms and the invalid cases, including the ambiguity that a twelve-digit number starting `91` is a country code while an eleven-digit one starting `9` is not.

A non-Indian number cannot be submitted. For this product that is correct. Supporting one would mean replacing the regex `CHECK` with a looser format constraint and adopting `libphonenumber-js` at the boundary, which is a contained change in `packages/contracts/src/phone.ts` and one line of DDL.
