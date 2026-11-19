param([Parameter(Mandatory=$true)][string]$Cache)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$destination = Join-Path $Cache 'python-3.12.10'
$stage = Join-Path $Cache ([Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    $zip = Join-Path $stage 'python.zip'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://api.nuget.org/v3-flatcontainer/python/3.12.10/python.3.12.10.nupkg' -OutFile $zip
    $digest = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($zip)
    try {
        $hash = [BitConverter]::ToString($digest.ComputeHash($stream)).Replace('-', '')
    } finally {
        $stream.Dispose()
        $digest.Dispose()
    }
    if ($hash -ne '0EB85C2DFCCCCF1B17352DE4C397F69194035B7D37149EACC16F1147D93DE3B8') {
        throw 'La descarga del motor no supero la verificacion.'
    }
    $expanded = Join-Path $stage 'extracted'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $expanded)
    if (!(Test-Path $destination)) { Move-Item -LiteralPath $expanded -Destination $destination }
} finally {
    Remove-Item -LiteralPath $stage -Recurse -Force
}
