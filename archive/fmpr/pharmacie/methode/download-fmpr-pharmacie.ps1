# Télécharge les listes de thèses FMPR Pharmacie 1990-2025 dans .\fmpr-pharmacie\
# Un fichier à la fois, pause de 3 s, fichiers déjà présents ignorés, contrôle PDF, zip final.
$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"   # accélère fortement Invoke-WebRequest
$dir = Join-Path (Get-Location) "fmpr-pharmacie"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$ua = "Mozilla/5.0 (etudiant FMPM - usage personnel)"

$jobs = @()
foreach ($y in 1990..2024) {
    $jobs += [pscustomobject]@{ Year = $y; Url = "http://biblio.medramo.ac.ma/bib/THESES/PHARMACIE/P$y.pdf" }
}
$jobs += [pscustomobject]@{ Year = 2025; Url = "https://drive.usercontent.google.com/download?id=1jc7nIVelqCUe7yharsa80K5kxnHFEoBn&export=download&confirm=t" }
$total = $jobs.Count

foreach ($j in $jobs) {
    $out = Join-Path $dir ("P{0}.pdf" -f $j.Year)
    if ((Test-Path $out) -and (Get-Item $out).Length -gt 0) { Write-Host "deja la : P$($j.Year).pdf"; continue }
    $ok = $false
    foreach ($try in 1..3) {
        try {
            Invoke-WebRequest -Uri $j.Url -OutFile $out -UserAgent $ua -TimeoutSec 120
            $ok = $true; break
        } catch { Start-Sleep -Seconds 5 }
    }
    if ($ok) { Write-Host "OK    $($j.Year)" -ForegroundColor Green }
    else     { Write-Host "ECHEC $($j.Year)" -ForegroundColor Red; Remove-Item $out -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 3
}

# Contrôle : signale tout fichier qui n'est pas un vrai PDF (page d'erreur enregistrée en .pdf)
Get-ChildItem $dir -Filter *.pdf | ForEach-Object {
    $fs = [System.IO.File]::OpenRead($_.FullName); $b = New-Object byte[] 4
    [void]$fs.Read($b, 0, 4); $fs.Close()
    if ([System.Text.Encoding]::ASCII.GetString($b) -ne "%PDF") { Write-Host "PAS UN PDF : $($_.Name)" -ForegroundColor Yellow }
}
$n = (Get-ChildItem $dir -Filter *.pdf).Count
Write-Host "$n / $total fichiers"

Compress-Archive -Path "$dir\*" -DestinationPath "fmpr-pharmacie.zip" -Force
Write-Host "-> fmpr-pharmacie.zip pret a joindre" -ForegroundColor Cyan
