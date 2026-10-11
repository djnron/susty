# data/

Source data behind Susty's water figures (METHODOLOGY §16). Nothing here is
loaded by the site; `tools/water-factors.mjs` turns it into the generated
tables in `index.html` (`WATER_GRIDS`, `WATER_US_SUB`) and `api/grid.js`
(`FUEL_WATER`), and `tools/water.test.mjs` checks them.

| File | What | Source | How it was made |
|---|---|---|---|
| `larsen-drews-2019-appendix-b.csv` | Every value in Appendix B, "Median water consumption" (L/MWh), 219 values, with journal page, PDF page and table row (1–56, top to bottom, counting empty rows) | Larsen & Drews (2019), Sci. Total Environ. 651, 2044–2058, CC BY; PDF from https://zenodo.org/records/1468438 (MD5 `ed0fd0c76bd54f9e5fee5e85b7a9f2f1`) | Transcribed twice, independently: (1) from the PDF's word coordinates (`pdftotext -bbox`, columns by header x, rows by y; page 14 rows sit 36 pt above page 13's); (2) by eye from page images at 170 dpi. The two agreed on all 219 values. |
| `macknick-2012-crosscheck.csv` | Macknick et al. (2012) consumption medians (gal/MWh, × 3.785411784) against the "Macknick et al. 2012 (1)" column of Appendix B | Environ. Res. Lett. 7 045802, Tables 1–2, read from the IOP article page | Computed; `result` is `match` within 0.2%. Discrepancies: nuclear pond value printed in L&D's "Dry" row; geothermal values do not match. |
| `ember-2024-generation-mix.csv` | 2024 generation by fuel (TWh), nine Ember fuels, for every `GRIDS` key | Ember yearly full release, long format (the file `tools/ember-grids.mjs` reads) | `node tools/water-factors.mjs --ember FILE`. A fuel Ember omits counts as zero only if the rest sum to Ember's Total Generation (±0.5%). |
| `egrid2023-rev2-subregion-mix.csv` | Generation resource mix (fractions) by eGRID subregion, 27 subregions | EPA eGRID2023 Summary Tables Rev 2, Table 2 (https://www.epa.gov/system/files/documents/2025-06/summary_tables_rev2.xlsx, created 03/27/2025) | Extracted with openpyxl from Table 2, values as published (EPA: "percentages may not sum to 100 due to rounding"; the tool normalises). |
