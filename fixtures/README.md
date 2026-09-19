# Fixtures

`extracted/*.json` are real Amazon Textract `AnalyzeExpense` outputs run through
`lib/extract`, on the `ExtractedBill` contract. The ledger track builds against
these so it never waits on the extraction track.

`bills/synthetic/*` are **generated placeholders, not real bills**. Replace them
with photographs of actual supplier bills and regenerate the JSON. Textract
behaves differently on a creased photo than on rendered text, and that
difference is worth finding before the demo rather than during it.

## The cases

| Fixture | Exercises |
|---|---|
| `sharma-01` | Baseline. Establishes supplier history and per item prices. |
| `sharma-02` | **Price jump.** Toor Dal 118.00 to 145.00, +22.9%. The other three items move 2 to 5% and must not flag. |
| `sharma-02-rephoto` | **Duplicate.** The same bill photographed again. Same bill number, same total. |
| `verma-01` | **Due soon.** Different supplier, due 2026-09-23. |
| `blurry-01` | **Degraded photo.** Blurred, rotated, underexposed, heavily compressed. |

## What the degraded case taught us

Worth reading before trusting any of this on a real photo.

Textract returned `blurry-01` at **99.5% confidence** with `Basmati Rice`
priced at **8** instead of 88, a rate wrong by a factor of ten. Its confidence
score describes how sure it is of the characters it saw, **not whether the
result makes sense**, so confidence alone would never have caught this.

What caught it was the row contradicting itself: 20 × 8 is 160, not the 1760
printed as the amount. `lib/extract` now trusts the line total in that
situation, because the total is corroborated by the bill total while the rate
is corroborated by nothing, and recovers the rate as 1760 ÷ 20 = 88.

The item names on that fixture are still wrong (`Basnati Hope`,
`Sunflower OF`). That is the real limitation and it is worth naming out loud
in the demo: on a bad photo the words degrade, but the arithmetic check means
the **money** still lands correctly in the ledger, which is what every
downstream comparison depends on.
