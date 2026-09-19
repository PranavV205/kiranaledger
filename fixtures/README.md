# Fixtures

`extracted/*.json` are real Amazon Textract `AnalyzeExpense` outputs, mapped
onto the `ExtractedBill` contract in `lib/types.ts`. The ledger track builds
against these so it never has to wait on the extraction track.

`bills/synthetic/*.png` are **generated placeholders**, not real bills. They
exist so the four demo cases are testable today. Replace them with photographs
of actual supplier bills, creased and angled, and regenerate the JSON: Textract
behaves differently on a real photo than on clean rendered text, and that
difference is the thing worth finding before the demo rather than during it.

## The four cases

| Fixture | Exercises |
|---|---|
| `sharma-01` | Baseline. Establishes supplier history and per item prices. |
| `sharma-02` | **Price jump.** Toor Dal 118.00 to 145.00, +22.9%. The other three items move 2 to 5% and must not flag. |
| `sharma-02-rephoto` | **Duplicate.** The same bill photographed again. Same bill number, same total. |
| `verma-01` | **Due soon.** Different supplier, due 2026-09-23. |
