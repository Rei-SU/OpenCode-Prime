$ErrorActionPreference = "Stop"

$App = "opencode-prime"
$Repo = if ($env:OPENCODE_PRIME_REPO) { $env:OPENCODE_PRIME_REPO } else { "Rei-SU/OpenCode-Prime" }
$Version = $env:VERSION
$Tag = $env:OPENCODE_PRIME_TAG

# --- Detect platform ---------------------------------------------------------
$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
    "AMD64" { "x64" }
    "ARM64" { "arm64" }
    "x86" { "x64" }
    default { throw "Unsupported architecture: $env:PROCESSOR_ARCHITECTURE" }
}

$artifact = "${App}-windows-${arch}.zip"
if ($Tag) {
    $url = "https://github.com/${Repo}/releases/download/${Tag}/${artifact}"
}
elseif ($Version) {
    $url = "https://github.com/${Repo}/releases/download/v${Version}/${artifact}"
}
else {
    $url = "https://github.com/${Repo}/releases/latest/download/${artifact}"
}

$installDir = Join-Path $env:LOCALAPPDATA "Programs\opencode-prime\bin"
New-Item -ItemType Directory -Path $installDir -Force | Out-Null

# --- Download ---------------------------------------------------------------
Write-Host "Downloading ${App} ${Tag}..." -ForegroundColor DarkGray
$tmp = Join-Path $env:TEMP ("opencode-prime_install_" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

try {
    Invoke-WebRequest -Uri $url -OutFile (Join-Path $tmp $artifact) -UseBasicParsing

    Expand-Archive -Path (Join-Path $tmp $artifact) -DestinationPath $tmp -Force

    $exe = Get-ChildItem -Path $tmp -Filter "$App.exe" -File -Recurse | Select-Object -First 1
    if (-not $exe) {
        throw "Archive did not contain the $App.exe binary"
    }

    Copy-Item -Path $exe.FullName -Destination (Join-Path $installDir "$App.exe") -Force

    # --- Verify --------------------------------------------------------------
    $installed = Join-Path $installDir "$App.exe"
    & $installed --version | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Installed binary failed to run."
    }

    # --- PATH -----------------------------------------------------------------
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$installDir*") {
        $newPath = if ([string]::IsNullOrEmpty($userPath)) { $installDir } else { "$installDir;$userPath" }
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Write-Host "Added opencode-prime to your user PATH." -ForegroundColor DarkGray
    }
    $env:Path = "$installDir;$env:Path"

    # --- Success --------------------------------------------------------------
    $versionOutput = (& $installed --version 2>&1 | Out-String).Trim()

    Write-Host ""
    Write-Host "$([char]0x2705) OpenCode-Prime installed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Version:"
    Write-Host $versionOutput
    Write-Host ""
    Write-Host "Repository:"
    Write-Host "https://github.com/$Repo"
    Write-Host ""
    Write-Host "Run:"
    Write-Host ""
    Write-Host "opencode-prime"
    Write-Host ""
    Write-Host "Note: this build is not code-signed, so Windows SmartScreen may show a warning." -ForegroundColor DarkGray
    Write-Host "      Select 'More info' then 'Run anyway' to proceed." -ForegroundColor DarkGray
}
finally {
    Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
