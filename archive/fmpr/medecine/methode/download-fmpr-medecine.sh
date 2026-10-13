#!/usr/bin/env bash
# Télécharge les listes de thèses FMPR Médecine 1969-2025 dans ./fmpr-medecine/
# Poli : 1 fichier à la fois, pause de 3 s, reprise si interrompu, fichiers déjà présents ignorés.
set -u
DIR="fmpr-medecine"; mkdir -p "$DIR"
UA="Mozilla/5.0 (étudiant FMPM - usage personnel)"
for y in $(seq 1969 2024); do
  f="$DIR/M$y.pdf"
  [ -s "$f" ] && { echo "déjà là : $f"; continue; }
  curl -fsSL -A "$UA" --retry 3 -C - -o "$f" "http://biblio.medramo.ac.ma/bib/THESES/MEDECINE/M$y.pdf" \
    && echo "OK  $y" || { echo "ÉCHEC $y"; rm -f "$f"; }
  sleep 3
done
# 2025 (Google Drive)
[ -s "$DIR/M2025.pdf" ] || curl -fsSL -o "$DIR/M2025.pdf" \
  "https://drive.usercontent.google.com/download?id=1OaWNQ1-rcdcI4WI5_vhbwsFUz26xM7Qg&export=download&confirm=t" \
  && echo "OK  2025"
# Contrôle : tout fichier qui n'est pas un vrai PDF est signalé
for f in "$DIR"/*.pdf; do head -c4 "$f" | grep -q '%PDF' || echo "PAS UN PDF : $f"; done
ls "$DIR" | wc -l
zip -qr fmpr-medecine.zip "$DIR" && echo "→ fmpr-medecine.zip prêt à joindre"
