# Notes on the Fair Credit Community Licence

The licence is in [`LICENSE`](../LICENSE). This page explains how it was checked, what it borrows, and what is still open. It is not legal advice, and it has not been reviewed by a solicitor.

## How it was checked

The text was compared, clause by clause, with five published licences read in full on 2026-10-31 (the Apache and MPL texts were re-fetched in full to check the cells that a first, cut-off fetch could not show):

| Licence | Why it is a useful comparison |
|---|---|
| Apache License 2.0 | the standard permissive licence; the model for contributions, patents, notices and redistribution |
| Mozilla Public License 2.0 | file-level share-alike, reinstatement after a breach, and "no other rights" wording |
| Elastic License 2.0 | bans offering the software as a hosted or managed service, with a 30-day cure |
| PolyForm Shield 1.0.0 | defines what "competing" means, affiliates, and what happens when the author's own business changes |
| Business Source License 1.1 | each version is licensed separately; breach ends rights for all versions; an optional date after which a version becomes open |

## Clause by clause

One table. "Yes" means the licence has the clause, "no" means it does not, and the last column says what Meerkat's licence does.

| Clause | Apache 2.0 | MPL 2.0 | Elastic 2.0 | PolyForm Shield | BSL 1.1 | Meerkat licence |
|---|---|---|---|---|---|---|
| Acceptance by use | no | no | yes | yes | no | yes, section 1 |
| Free use, change, share | yes | yes | yes | yes | non-production only | yes, section 3 |
| Patent licence | yes | yes | yes | yes | no | yes, section 4 |
| Patent licence ends if You sue | yes | yes | yes | yes | no | yes, section 4 |
| Affiliates counted as one | yes | yes | yes | yes | only for buying a licence | yes, section 2 |
| Direct licence from the author to every recipient | yes | yes | no | no | no | yes, section 3 |
| Mark changed files | yes | no | yes | no | no | yes, section 7 |
| Keep notices | yes | yes | yes | yes | yes | yes, section 7 |
| Share-alike for changed copies | no | per file | no | no | no | yes, section 7 (D1) |
| No hosted or managed service | no | no | yes | partly | via a use grant | yes, section 8 |
| No selling the software itself | no | no | no | partly | via a use grant | yes, section 8 |
| Building it into a paid product | yes | yes | yes | yes | via a use grant | yes with credit and a link, section 8 |
| Public credit by organisations | no | no | no | no | no | yes, section 6 (new) |
| No telemetry promise | no | no | no | no | no | yes, section 9 (new) |
| Contributions licensed to the author | yes | yes | no | no | no | yes, section 11 |
| Contributor promises the work is theirs | no | yes | no | no | no | yes, section 11 |
| Trademarks and logos not licensed | yes | yes | yes | no | yes | yes, section 10 |
| Fair use preserved | no | yes | no | yes | no | yes, section 13 |
| "No other rights implied" | no | yes | yes | yes | no | yes, section 13 |
| Breach ends rights, with a cure period | patent only | 30 or 60 days | 30 days | 32 days | immediate | 30 days, then permanent on a repeat, section 14 |
| Recipients keep their rights if You breach | not stated | yes (5.3) | not stated | not stated | no | yes, section 14 |
| Each version licensed separately | no | no | no | no | yes | yes, section 15 |
| Warranty disclaimer in capitals | yes | yes | no | no | yes | yes, section 16 |
| Liability limit | yes | yes | yes | yes | no | yes, section 17 |
| Governing law and courts | no | defendant's courts | no | no | no | yes, England and Wales, section 18 |
| Assignment, notices, severability, no waiver | partly | yes | no | no | no | yes, section 18 |
| Summary that does not bind | no | no | no | no | no | yes, "for convenience only" |

## What was added after the comparison

Gaps the first draft had, and how each was closed:

| Gap | Fix |
|---|---|
| No "by using it you agree" clause | Section 1, copied from Elastic and PolyForm |
| "Contribution" and "Contributor" were not defined | Section 2 and 11, from Apache |
| Nothing said a plug-in is not a copy of the software | The "Extension" definition, from Apache's rule that separable works are not derivative |
| "Hosted service" was vague | Section 2 uses Elastic's wording: access to any substantial set of the features |
| Company groups could dodge the credit duty | "Affiliate" and "control" in section 2, from Apache, MPL and PolyForm |
| No patent protection against a lawsuit | Patent clause that ends on a claim, from Apache, MPL, Elastic and PolyForm |
| No statement that fair use is untouched, or that no other rights are implied | Section 13, from MPL and PolyForm |
| Breach could end everyone's rights | Section 14: recipients keep their licence; reinstatement once, from MPL and Elastic |
| The plain-English summary could contradict the legal text | The summary is declared "for convenience only" and loses to the numbered terms |
| Reading rules were missing | "Including means without limitation", English text wins, headings do not count |
| No way to give notice | Section 18.6: a repository issue, or the listed contact |
| No assignment clause | Section 18.5: the author may transfer, the licence stays |
| Credit duty had no end | Section 6.4: it ends 6 months after the organisation stops using it |
| Credit notice could imply endorsement | Section 6.1 |
| Liability limit could cover things the law forbids | Section 17 keeps death, personal injury and fraud outside the limit |
| Changed copies could be shared without source | Section 7.4 |
| No example of how to mark a file | The header at the end of the licence |

## Still open

These are decisions for the author, and then for a solicitor.

| Question | What the licence does now | The alternative |
|---|---|---|
| D1: share-alike for changed copies that are shared outside an organisation (section 7.4) | required | drop it, so private and shared forks are the same |
| D2: the contributor grant that lets the author relicense (section 11) | included, so a commercial licence is possible | drop it, and every contributor's work stays under this licence only |
| D3: governing law (section 18.1) | England and Wales, assumed from the author's location | change to the right place |
| D4: very small organisations (section 6) | all must publish the notice | exempt groups under a set size, or registered charities |
| D5: the name | "Fair Credit Community Licence", a working title | rename it, and host the text on the Perpetual Technologies site if you want, unchanged |
| D6: the no-telemetry promise (section 9.1) | binds the author too | promise "none today" only |
| D7: a change date, as the Business Source License has | none | after, say, four years each version becomes MIT or Apache 2.0, which is very "for the people" but gives up the sale ban on old versions |

## What it is not

- **Not open source in the strict sense.** It forbids selling the software and requires organisations to credit it, so the Open Source Initiative would not approve it. Call it source-available or a community licence.
- **Not an SPDX-listed licence.** The identifier `FCCL-1.0` is not registered. Some tools will report it as unknown, which is why the README says what it is.
- **Not reviewed by a lawyer.** A solicitor should read it before anyone relies on it in a dispute. The clause list above was checked against the published text of the five licences, not against case law.
