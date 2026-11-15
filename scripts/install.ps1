# Installs the latest MarkdownEditor release on Windows, for the current user (no admin):
#
#   irm https://raw.githubusercontent.com/MahirHamiAbrar/MarkdownViewer/main/scripts/install.ps1 | iex
#
# Downloads the setup .exe, checks it against the release's SHA256SUMS and runs it silently.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # the progress bar makes Invoke-WebRequest very slow
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = 'MahirHamiAbrar/MarkdownViewer'
$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'markdowneditor-installer' }
$setup = $release.assets | Where-Object { $_.name -like '*_x64-setup.exe' } | Select-Object -First 1
$sums = $release.assets | Where-Object { $_.name -eq 'SHA256SUMS' } | Select-Object -First 1
if (-not $setup -or -not $sums) { throw "Release $($release.tag_name) has no Windows installer." }

$dir = Join-Path ([IO.Path]::GetTempPath()) ("markdowneditor-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $dir | Out-Null
try {
    $exe = Join-Path $dir $setup.name
    Write-Host "==> Downloading MarkdownEditor $($release.tag_name)"
    Invoke-WebRequest $setup.browser_download_url -OutFile $exe -UseBasicParsing

    $want = (Invoke-WebRequest $sums.browser_download_url -UseBasicParsing).Content -split "`n" |
        ForEach-Object { $f = $_.Trim() -split '\s+\*?'; if ($f[1] -eq $setup.name) { $f[0] } } |
        Select-Object -First 1
    $got = (Get-FileHash $exe -Algorithm SHA256).Hash
    if (-not $want -or $got -ne $want.ToUpper()) { throw "Checksum mismatch for $($setup.name); not installing." }

    Write-Host '==> Installing'
    $p = Start-Process -FilePath $exe -ArgumentList '/S' -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "Installer exited with code $($p.ExitCode)." }
    Write-Host "==> MarkdownEditor $($release.tag_name) installed. Find it in the Start menu."
}
finally {
    Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
}
