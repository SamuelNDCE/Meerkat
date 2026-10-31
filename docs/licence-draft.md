# Fair Credit Community Licence 1.0 (DRAFT)

> **Status: a draft for discussion. It has not been reviewed by a lawyer and is not yet the licence of this repository.** The licence in force is still [`LICENSE`](../LICENSE) (PolyForm Noncommercial 1.0.0). This draft says what the author wants to happen; a solicitor should check the wording before it is adopted. The decisions that are still open are listed at the end.

**The idea in one paragraph.** People can use, change and share Meerkat for anything, free. Organisations can use it too, free, but they must say publicly that they use someone else's work. Nobody may sell Meerkat itself, or a service that is mainly Meerkat. A company that builds Meerkat into its own product and sells *that* may do so if it credits Meerkat and links to the repository. Companies that want to do more than that can ask for a commercial licence.

---

## 1. Words used

- **Licensor**: the author, SamuelNDCE, and anyone the author names as co-owner in the repository.
- **Software**: Meerkat, in the version this licence came with, including its documentation.
- **You**: whoever is using the Software. If You use it for an Organisation, the Organisation is also "You" for the duties in sections 4 and 5.
- **Individual**: a natural person using the Software for themselves, including for their own unpaid projects, study and hobbies, and for freelance or self-employed work done by that person alone.
- **Organisation**: a company, partnership, charity, school, public body or any other group, and anyone using the Software for the work or benefit of one. An employee who uses the Software at work does so for their employer, so the employer is the Organisation.
- **Sell**: to receive money or anything else of value in exchange for the Software, for a copy of it, or for access to it. A subscription, a licence fee, a "pro" edition, a hosted or managed service and a paid download are all selling.
- **Product**: a program, service or device You make available that has its own purpose, and that includes, runs or depends on the Software as one part among others.
- **Extension**: a separate work (such as a pack of extra checks) that uses the Software through its documented plug-in interface (`meerkat.config.json`, packs and the check format) and does not copy the Software's own code.
- **Modified Version**: the Software with changes to its own files, or a work that copies a substantial part of them.
- **Credit Notice**: the text in section 4.

## 2. What You may do

The Licensor grants You a worldwide, free, non-exclusive licence, for as long as You follow this licence, to run, study, copy, change and share the Software for any purpose that this licence does not forbid. It includes a licence under any patent claim the Licensor can license that the Software would otherwise infringe, but only for using the Software as provided.

Anyone who gets the Software from You gets the licence **directly from the Licensor**, on these same terms. You cannot give anyone better terms or worse ones.

## 3. Individuals

An Individual has no duty beyond keeping the licence text and the `Required Notice:` line with any copy they share.

## 4. Organisations: say that You use it

An Organisation may use the Software inside the Organisation, on any number of machines, free of charge. It must, within **60 days** of first using the Software and for as long as it keeps using it, publish a Credit Notice somewhere the public can read, for example a credits, "open source" or "acknowledgements" page of its website or product, its documentation, or the README of a public repository:

> This organisation uses Meerkat, by SamuelNDCE (https://github.com/SamuelNDCE/Meerkat), under the Fair Credit Community Licence.

It may add its own words. If an Organisation truly cannot publish anything (for example because of a legal duty of secrecy), it must ask the Licensor for written permission to put the notice in its customer documentation instead.

## 5. Products and selling

1. **Not allowed without a commercial licence:** to Sell the Software itself, a Modified Version, or a copy of either; or to Sell a hosted, managed or subscription service whose main purpose is to run the Software or to give others the Software's results. The test is what the customer is mainly paying for: if it is Meerkat's job, it is selling Meerkat.
2. **Allowed:** to include the Software in a Product and Sell the Product, if (a) the Product is more than the Software, (b) the Product's documentation and its website listing say, in plain words, that it includes or uses Meerkat by SamuelNDCE and link to https://github.com/SamuelNDCE/Meerkat, and (c) the Software inside it keeps this licence and the `Required Notice:` line.
3. **Allowed:** to charge for services around the Software that are Yours, such as consulting, training, support, setting it up, or running it for a client as part of delivering Your own work.
4. **Allowed:** to make and Sell Extensions, under any licence You choose. An Extension is Your own work.
5. Results that the Software produces about Your project (reports, logs, screenshots) are Yours.
6. Using affiliates, contractors, resellers or other arrangements to get around this section is a breach of it.

## 6. Modified Versions

A Modified Version must carry a clear notice that it was changed, by whom, and when; must not suggest the Licensor made or approves it; and, if You share it with anyone outside Your own Organisation, You must make its complete source available to them under this licence. *(Open decision D1.)*

## 6A. Built for people: no telemetry, open connections, AI only by choice

1. **No telemetry.** The Software does not collect or send data about You, Your projects or Your machine, and the Licensor will not add anything that does. A Modified Version that You share must not add telemetry either, unless the person running it has clearly switched it on (an opt-in, off by default), and it says in plain words what is sent and where.
2. **Open connections.** Anyone may connect the Software to any application's test harness, including applications made by the Licensor or by Perpetual Technologies, and may write Extensions and harnesses for it. An Organisation doing so has the same duties as any other under sections 4 and 5, so the Licensor's own companies must credit and link to the repository like everyone else.
3. **AI is optional and visible.** Checks that use an AI model are off unless You turn them on. They say before they run what they will send and to which model, and they do not run at all when no model can be reached or no key or login is found. The Software never sends code to a model on its own.

## 7. Name and look

This licence gives no right to the name "Meerkat" as the name of Your own product, or to the pixel-art meerkat mascot or the project's logos, except to say truthfully what Your work is or works with ("compatible with Meerkat", "includes Meerkat").

## 8. Contributions

Anything You send to the Licensor to be included in the Software is licensed to the Licensor under this licence, and You also give the Licensor the right to license it to others on other terms (this is what makes a commercial licence possible). You promise it is Yours to give. *(Open decision D2.)*

## 9. Commercial licences

The Licensor may grant anyone other terms in writing, for a fee or not. That does not change the terms for anyone else.

## 10. If something goes wrong

If You break this licence, Your rights under it end. They come back, once, if You put things right within **30 days** of the Licensor telling You in writing what is wrong (for example by publishing the Credit Notice or stopping the sale). A second breach ends them for good unless the Licensor decides otherwise.

Copies that other people received from You in good faith keep their licence, because it comes from the Licensor (section 2).

## 11. Versions

The terms You got with a copy of the Software cannot be taken away from that copy. The Licensor may release later versions of the Software under different terms; that does not change the terms of earlier ones.

## 12. No warranty, limited liability

The Software is provided "as is", without any warranty or condition of any kind. As far as the law allows, the Licensor is not liable for any loss arising from its use, and in any case not for more than You paid for the Software (which is usually nothing). Nothing here limits liability that the law does not allow to be limited.

## 13. The small print

This licence is governed by the law of **[England and Wales] *(Open decision D3)***. If part of it is unenforceable, the rest stays. Not enforcing a term once is not giving it up. This is the whole licence for the Software; nothing said elsewhere changes it unless the Licensor signs it. Where the Software contains other people's work, it keeps their licence, listed in the repository.

Required Notice: Copyright (c) 2026 SamuelNDCE (https://github.com/SamuelNDCE/Meerkat)

---

## Review notes: gaps looked for, and what this draft does about each

| Gap that could be abused | How the draft closes it |
|---|---|
| "I'm not selling it, I'm hosting it" (software as a service) | "Sell" includes hosted and managed services; section 5.1 |
| Bundling it into a paid product to dodge the ban | Allowed only with credit and link, and only if the Product is more than the Software; 5.2 |
| A free tier that upsells, or a "pro" edition | Counted as selling; "Sell" covers any exchange of value |
| Employees or contractors using it so the company is not "using" it | The employer is the Organisation; 1 and 5.6 |
| Shell companies, resellers, affiliates | 5.6 |
| A company hiding that it uses it | Public Credit Notice within 60 days; 4 |
| A fork renamed to pass as the original | Section 7 (name and mascot), section 6 (marking changes) |
| A fork kept private after a company improves it | Section 6 (share source if shared outside the Organisation), pending D1 |
| Downstream users losing their rights if a company breaks the licence | Direct licence from the Licensor; 2 and 10 |
| The author changing terms and trapping earlier users | Versions cannot be revoked; 11 |
| Charging for add-ons people write for it | Extensions are free to sell; 5.4 |
| Output of the tool being claimed by the licensor | 5.5 |
| Patents | Patent licence in 2 |
| Contributors who later object to a commercial licence | Contribution grant in 8, pending D2 |
| Endless fight after one slip | 30-day cure; 10 |

## Open decisions (yours, then a lawyer's)

- **D1: Share-alike for modified copies (section 6).** On: improvements to Meerkat must be published. Off: companies can keep private forks for internal use only (they already may; the question is only about sharing outside the organisation).
- **D2: Contributor grant (section 8).** Needed only if you ever want to sell commercial licences.
- **D3: Governing law and court.** England and Wales is a placeholder.
- **D4: Small organisations.** Today every Organisation, however small, must publish the notice. You could exempt, say, groups of under five people or registered charities.
- **D5: Name.** "Fair Credit Community Licence" is a working title. It can be hosted on the Perpetual Technologies site if you want, with the text kept identical to this one.
- **D6: The no-telemetry promise (section 6A.1) binds you too.** Anything you later add that reports usage, even anonymously, would need to be opt-in. You may prefer to promise only "none today" so that you keep the option.
- **Not open source in the strict sense.** Because it forbids selling Meerkat and requires a public notice, the Open Source Initiative would not approve it. Call it "source-available" or "community licence", not "open source".
- **A solicitor should read it** before this replaces PolyForm. Nothing in this file is legal advice.
