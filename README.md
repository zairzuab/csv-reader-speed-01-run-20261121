# Fast broken-CSV reader

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/zairzuab/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/zairzuab/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A dependency-free, fast drop-in for make.fun's csv-reader 1.0.0, built for the
make.fun bounty
[Read broken CSV files faster, 21 November 2026](https://make.fun/bounty/csv-reader-speed-01-run-20261121).

`solve.js` exports `run(input)` returning exactly csv-reader 1.0.0's
`{columns, rows, errors}` for each case's `{text, header}`. `main.ts` is the
harness driver: it reads `/input/cases.json` and writes
`/output/answers.json`.

## How it is fast

Two tiers, no character-by-character loop anywhere:

- **Fast tier (most records):** a record whose first line holds no quote and
  no stray CR is one line slice + one `split(',')` — the whole record's
  fields in a single C++ scan.
- **Slow tier (quoted fields, stray CRs, unterminated quotes, junk):** the
  same policy as csv-reader, but every scan jumps with `indexOf` and every
  field is a slice. An unquoted field is one straight-line computation (two
  `indexOf` calls, one slice, one CR check); field readers write into shared
  slots instead of allocating a fresh object per field.

## What "broken CSV" means here

Exactly csv-reader 1.0.0's policy, reimplemented field for field:

- U+FEFF at the very start is dropped.
- A record ends at LF or CRLF; a line with no characters is no record.
- Outside quotes a CR not followed by LF is dropped (`stray_cr`).
- A field opening with a quote runs to the next quote that is not doubled;
  `""` inside is one quote, and each CRLF or lone CR inside reads as LF;
  what follows its closing quote, up to the next comma or line break, is
  appended as it stands (`quote_junk`, when the field ends); a quote that
  never closes is a literal character and the text after it is read again as
  unquoted (`unterminated_quote`).
- A quote inside an unquoted field is a literal character.
- Fields stay strings, never trimmed or converted.
- `columns` is the first record when `header` is true, else null; rows are
  padded with `""` (`short_row`) or cut (`long_row`) to the first record's
  width. Each error is `{code, line, row}` in the order met.

## Local grade

On the kit's practice set (6 cases, ~10.5 MB), median CPU time per whole
set, Node 24 on this VM:

| | solve | parse + solve + stringify |
|---|---|---|
| this entry | ~248 ms | ~438 ms |
| house baseline (csv-reader 1.0.0) | ~1008 ms | ~1198 ms |

Correct on all 6 practice cases (scorer `passed: 1`, 6/6) and on 120
further cases drawn from the kit's own generator with fresh seeds — byte
identical to the reference oracle on every one.

## Run it

```sh
MAKEFUN_INPUT_DIR=./practice/input MAKEFUN_OUTPUT_DIR=./out node main.ts
```

Node 22+, no dependencies, no network.
