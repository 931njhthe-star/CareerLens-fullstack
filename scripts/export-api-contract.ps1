[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Version
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?(?:\+[0-9A-Za-z][0-9A-Za-z.-]*)?$') {
    throw 'Version must be a semantic version such as 1.0.0.'
}

$taskBackendRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskContractRoot = Join-Path $taskBackendRoot 'contracts/openapi'
$taskSourceUri = $null
$taskIsUri = [System.Uri]::TryCreate($Source, [System.UriKind]::Absolute, [ref]$taskSourceUri)
if ($taskIsUri -and $taskSourceUri.Scheme -in @('http', 'https')) {
    $taskResponse = Invoke-WebRequest -Uri $taskSourceUri.AbsoluteUri -TimeoutSec 30
    $taskContent = [string]$taskResponse.Content
} elseif ($Source -match '://') {
    throw 'Source URL must use HTTP or HTTPS.'
} else {
    $taskSourceFile = Get-Item -LiteralPath $Source -ErrorAction Stop
    if ($taskSourceFile.PSIsContainer) { throw 'Source must be an OpenAPI JSON file.' }
    $taskContent = [System.IO.File]::ReadAllText($taskSourceFile.FullName)
}

$taskEncoding = [System.Text.UTF8Encoding]::new($false)
$taskContent = $taskContent.TrimStart([char]0xFEFF)
$taskBytes = $taskEncoding.GetBytes($taskContent)
if ($taskBytes.Length -gt 10MB) { throw 'OpenAPI JSON must not exceed 10 MiB.' }

if ([string]::IsNullOrWhiteSpace($taskContent) -or -not $taskContent.TrimStart().StartsWith('{')) {
    throw 'OpenAPI JSON must have an object root.'
}
$taskDocument = $taskContent | ConvertFrom-Json -ErrorAction Stop
if ($taskDocument -isnot [pscustomobject]) { throw 'OpenAPI JSON must be an object.' }
$taskOpenapi = $taskDocument.PSObject.Properties['openapi']
$taskInfo = $taskDocument.PSObject.Properties['info']
$taskPaths = $taskDocument.PSObject.Properties['paths']
if ($null -eq $taskOpenapi -or $taskOpenapi.Value -isnot [string] -or $taskOpenapi.Value -notmatch '^3\.[0-9]+\.[0-9]+$') {
    throw 'An OpenAPI 3.x version is required.'
}
if ($null -eq $taskInfo -or $taskInfo.Value -isnot [pscustomobject]) { throw 'OpenAPI info must be an object.' }
$taskInfoVersion = $taskInfo.Value.PSObject.Properties['version']
if ($null -eq $taskInfoVersion -or $taskInfoVersion.Value -isnot [string] -or $taskInfoVersion.Value -cne $Version) {
    throw 'OpenAPI info.version must exactly match Version.'
}
if ($null -eq $taskPaths -or $taskPaths.Value -isnot [pscustomobject]) { throw 'OpenAPI paths must be an object.' }

$taskHasher = [System.Security.Cryptography.SHA256]::Create()
try {
    $taskHash = [BitConverter]::ToString($taskHasher.ComputeHash($taskBytes)).Replace('-', '').ToLowerInvariant()
} finally { $taskHasher.Dispose() }

$taskRelease = [System.IO.Path]::GetFullPath((Join-Path $taskContractRoot ('v' + $Version)))
$taskContractBoundary = [System.IO.Path]::GetFullPath($taskContractRoot).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
if (-not $taskRelease.StartsWith($taskContractBoundary, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Release destination is outside contracts/openapi.'
}
if (Test-Path -LiteralPath $taskRelease) {
    $taskExistingSpec = Join-Path $taskRelease 'openapi.json'
    $taskExistingManifestPath = Join-Path $taskRelease 'manifest.json'
    if (-not (Test-Path -LiteralPath $taskExistingSpec -PathType Leaf) -or -not (Test-Path -LiteralPath $taskExistingManifestPath -PathType Leaf)) {
        throw 'Existing release is incomplete; inspect it before exporting.'
    }
    $taskExistingHash = (Get-FileHash -LiteralPath $taskExistingSpec -Algorithm SHA256).Hash.ToLowerInvariant()
    $taskExistingManifest = Get-Content -LiteralPath $taskExistingManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $taskExistingVersionProperty = $taskExistingManifest.PSObject.Properties['version']
    $taskExistingHashProperty = $taskExistingManifest.PSObject.Properties['sha256']
    if ($taskExistingHash -cne $taskHash -or $null -eq $taskExistingVersionProperty -or $taskExistingVersionProperty.Value -cne $Version -or $null -eq $taskExistingHashProperty -or $taskExistingHashProperty.Value -cne $taskHash) {
        throw 'This contract version already exists with different or inconsistent content. Increment Version.'
    }
    [pscustomobject]@{ status = 'unchanged'; version = $Version; sha256 = $taskHash; path = $taskRelease } | ConvertTo-Json -Compress
    exit 0
}

New-Item -ItemType Directory -Path $taskContractRoot -Force | Out-Null
$taskStage = [System.IO.Path]::GetFullPath((Join-Path $taskContractRoot ('.export-' + [guid]::NewGuid().ToString('N'))))
if (-not $taskStage.StartsWith($taskContractBoundary, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid temporary path.' }
New-Item -ItemType Directory -Path $taskStage | Out-Null
try {
    [System.IO.File]::WriteAllBytes((Join-Path $taskStage 'openapi.json'), $taskBytes)
    $taskManifest = [ordered]@{ schema_version = 1; version = $Version; sha256 = $taskHash; format = 'openapi' } | ConvertTo-Json
    [System.IO.File]::WriteAllText((Join-Path $taskStage 'manifest.json'), $taskManifest + [Environment]::NewLine, $taskEncoding)
    Move-Item -LiteralPath $taskStage -Destination $taskRelease
} finally {
    if (Test-Path -LiteralPath $taskStage) {
        $taskResolvedStage = [System.IO.Path]::GetFullPath($taskStage)
        if (-not $taskResolvedStage.StartsWith($taskContractBoundary, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid cleanup path.' }
        Remove-Item -LiteralPath $taskResolvedStage -Recurse -Force
    }
}
[pscustomobject]@{ status = 'created'; version = $Version; sha256 = $taskHash; path = $taskRelease } | ConvertTo-Json -Compress
