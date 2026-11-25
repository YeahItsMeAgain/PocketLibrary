# Libgen fixtures

Captured live on **2026-11-25** from `https://libgen.li` (UTC), with a desktop
Chrome User-Agent. Tests never touch the network; they replay these files from a
local HTTP server.

| File | Source URL |
|---|---|
| `libgen-rock-paper-scissors.html` | `https://libgen.li/index.php?req=Rock+Paper+Scissors+Alice+Feeney&res=25` |
| `libgen-rock-paper-scissors-p2.html` | `https://libgen.li/index.php?req=Rock+Paper+Scissors+Alice+Feeney&res=25&page=2` |
| `slum-status.json` | `https://open-slum.org/status.json` (full snapshot, used only for the hint parser) |

Page 1 reports **Files 43** and 25 rows; page 2 has 18 rows with no md5 overlap.
The acceptance EPUB is `a1423442916f2f3def9517a3bf4dee48`
(`Alice Feeney - Rock Paper Scissors (2021, Flatiron Books)`, 3 MB, 106 pages,
file id 98756682).

Refresh these only when Libgen's markup changes; a live smoke test belongs
outside CI.
