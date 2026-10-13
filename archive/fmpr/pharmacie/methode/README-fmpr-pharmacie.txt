FMPR - PHARMACIE : HOW THE THESIS LISTS WERE DOWNLOADED
=======================================================

What you get : the FMPR Pharmacie thesis lists, P1990.pdf -> P2025.pdf (36 files)
Source       : http://biblio.medramo.ac.ma/bib/THESES/PHARMACIE/  (2025 from Google Drive)
Requirements : Windows, internet connection

STEPS
-----
0. Put download-fmpr-pharmacie.ps1 in a folder (for example Documents\fmpr).

1. Open a terminal in that folder, in either of these ways:
   - Right-click inside the folder -> "Open in Terminal"
   - OR click the File Explorer address bar, type  cmd  and press Enter

2. Run this command:

   powershell -ExecutionPolicy Bypass -File .\download-fmpr-pharmacie.ps1

   (-ExecutionPolicy Bypass only applies to this run, it does not change your Windows settings.)

3. Wait for it to finish.

RESULT
------
- Folder  fmpr-pharmacie\  containing P1990.pdf ... P2025.pdf
- Archive fmpr-pharmacie.zip
- Last line should read : 36 / 36 fichiers

NOTES
-----
- Yellow line "PAS UN PDF" or red line "ECHEC" = that year needs checking.
- Safe to re-run : files already downloaded are skipped.
- Thesis number format : P0132022 = P (Pharmacie) + 013 (order of defence) + 2022 (year of defence).
