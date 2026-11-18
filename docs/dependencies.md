# Third-party dependency record

## SheetJS Community Edition (`xlsx`) 0.20.3

Added 2026-11-17 for server-side Kill Sheet workbook parsing (`.xls` and
`.xlsx`).

- **Source:** `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`
- **Version:** exactly `0.20.3`, pinned in `package.json` and `pnpm-lock.yaml`.
- **SHA-512:** `a0b0eade3c3b01c2ea2961f60210a9553665f267fa5f661178ff8d7a1d12254cd5fc1759623b61f78b46e6da22301d4f3eb62dc4e09f6a850292fb6e1fedc024`
- **Lockfile integrity:** `sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==`.
- **Licence:** Apache-2.0.
- **Runtime check:** `xlsx.version === 0.20.3` under Node `v24.15.0`.

The public npm registry's `xlsx@0.18.5` is not used: it is stale and affected
by CVE-2023-30533 and CVE-2024-22363. SheetJS identifies its CDN as the
authoritative distribution and documents the relevant fixes in 0.19.3 and
0.20.2 respectively. `pnpm audit --prod` was run after installation; it did
not report an advisory for this exact SheetJS dependency, but it did report
unrelated existing dependency advisories. No audit warning was suppressed.
