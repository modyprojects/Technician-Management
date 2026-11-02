# Step 0 review screenshots

Fictitious data only. Taken with `npm run screenshots` (Playwright, Chromium) from a local production
build of commit `76b4aa2`, at 390 x 844, 820 x 1180 and 1440 x 900 px. Demo references come from
`docs/demo.html` with its demo bar hidden.

| Width | Technician shell | Office shell | Other |
|---|---|---|---|
| 390 | `390-app-tech.png` vs `390-demo-tech.png` | `390-app-office.png` vs `390-demo-office.png` | `390-app-showcase.png`, `390-app-home.png`, `390-app-404.png` |
| 820 | `820-app-tech.png` vs `820-demo-tech.png` | `820-app-office.png` vs `820-demo-office.png` | `820-app-showcase.png`, `820-app-home.png`, `820-app-404.png` |
| 1440 | `1440-app-tech.png` vs `1440-demo-tech.png` | `1440-app-office.png` vs `1440-demo-office.png` | `1440-app-showcase.png`, `1440-app-home.png`, `1440-app-404.png`, `1440-app-sizes.png` |

Expected differences from the demo: the pickup card (Step 3) and the Excel button (PENDING OF-14) are not
in Step 0; the manager navigation includes Settings (SE-03); the office table shows 14 sample rows; the
technician layout above 900 px continues the tablet layout with header and navigation content on the
760 px column (TE-31); the bottom navigation stays at the bottom of the screen (TE-32). Both approved 2026-11-02. Visual review round 1 (2026-11-02): next-visit card actions 50/50 from
600 px (TE-33); table column alignment and sizing (G-07).
