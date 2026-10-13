# FMPR – Médecine : how the thesis lists were downloaded

| | |
|---|---|
| **What you get** | FMPR Médecine thesis lists, `M1969.pdf` → `M2025.pdf` (57 files) |
| **Source** | `http://biblio.medramo.ac.ma/bib/THESES/MEDECINE/` (2025 from Google Drive) |
| **Requirements** | Windows, internet connection |

## Steps

0. Put `download-fmpr-medecine.ps1` in a folder (for example `Documents\fmpr`).
1. Open a terminal in that folder, in either of these ways:
   - Right-click inside the folder → **Open in Terminal**
   - **or** click the File Explorer address bar, type `cmd` and press Enter
2. Run this command:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\download-fmpr-medecine.ps1
   ```

   > `-ExecutionPolicy Bypass` only applies to this run. It does not change your Windows settings.

3. Wait for it to finish (about 3–5 minutes plus download time).

## Result

- Folder `fmpr-medecine\` containing `M1969.pdf` … `M2025.pdf`
- Archive `fmpr-medecine.zip`
- The last line should read: `57 / 57 fichiers`

## Notes

- A yellow **PAS UN PDF** line or a red **ECHEC** line means that year needs checking.
- It is safe to re-run: files already downloaded are skipped.
- Thesis number format: `M0012024` = **M** (Médecine) + **001** (order of defence) + **2024** (year of defence).
