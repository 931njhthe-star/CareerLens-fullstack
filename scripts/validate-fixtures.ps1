[CmdletBinding()]
param(
    [string]$Manifest = 'evaluations/datasets/cases.json'
)

$ErrorActionPreference = 'Stop'
$backendRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))

function Resolve-SafeFile {
    param(
        [object]$Value,
        [string]$AllowedDirectory,
        [string]$Field,
        [string]$Extension = ''
    )

    if ($Value -isnot [string] -or [string]::IsNullOrWhiteSpace($Value)) {
        throw "$Field must be a non-empty string."
    }
    if ([System.IO.Path]::IsPathRooted($Value) -or $Value -match ':' -or $Value -match '(^|[\\/])\.\.([\\/]|$)') {
        throw "$Field must be a backend-relative path without a drive, absolute root, or '..': $Value"
    }
    foreach ($segment in ($Value -split '[\\/]')) {
        # Win32 can trim trailing dots/spaces before accessing a file. Reject
        # those ambiguous segments before performing the absolute boundary check.
        if ($segment -match '[. ]$') {
            throw "$Field cannot contain a path segment ending in a dot or space: $Value"
        }
    }

    $separator = [System.IO.Path]::DirectorySeparatorChar
    $nativePath = $Value.Replace('/', $separator).Replace('\', $separator)
    $resolvedPath = [System.IO.Path]::GetFullPath((Join-Path $backendRoot $nativePath))
    $allowedRoot = [System.IO.Path]::GetFullPath((Join-Path $backendRoot $AllowedDirectory))
    $allowedPrefix = $allowedRoot.TrimEnd([char[]]@('/', '\')) + $separator
    if (-not $resolvedPath.StartsWith($allowedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Field must remain under ${AllowedDirectory}: $Value"
    }
    if ($Extension -and [System.IO.Path]::GetExtension($resolvedPath) -ine $Extension) {
        throw "$Field must name a $Extension file: $Value"
    }
    if (-not [System.IO.File]::Exists($resolvedPath)) {
        throw "$Field file does not exist: $Value"
    }

    # Check every existing path component to block junction/symlink escapes.
    $componentPath = $resolvedPath
    while ($true) {
        $item = Get-Item -LiteralPath $componentPath -Force
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "$Field cannot reference a reparse point: $Value"
        }
        if ($componentPath.Equals($backendRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            break
        }
        $componentPath = Split-Path -Parent $componentPath
        if ([string]::IsNullOrWhiteSpace($componentPath)) {
            throw "$Field could not be confined to the backend root: $Value"
        }
    }
    return $resolvedPath
}

function Read-JsonObject {
    param([string]$Path, [string]$Label)
    try {
        $json = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
        # Windows PowerShell may enumerate a top-level JSON array during output.
        # Check the source root before converting so [ {...} ] is never an object.
        if ([string]::IsNullOrWhiteSpace($json) -or -not $json.TrimStart().StartsWith('{')) {
            throw "$Label must have a JSON object root."
        }
        $value = $json | ConvertFrom-Json
    }
    catch {
        throw "$Label is not valid JSON: $($_.Exception.Message)"
    }
    if ($value -isnot [System.Management.Automation.PSCustomObject]) {
        throw "$Label must be a JSON object."
    }
    return $value
}

function Assert-Version {
    param([object]$Value, [string]$Label)
    if (($Value -isnot [int] -and $Value -isnot [long]) -or $Value -ne 1) {
        throw "$Label schema_version must be the integer 1."
    }
}

function Assert-Id {
    param([object]$Value, [string]$Label)
    if ($Value -isnot [string] -or $Value -cnotmatch '^[a-z0-9]+(-[a-z0-9]+)*$') {
        throw "$Label must contain lowercase letters/digits with optional single hyphens between words."
    }
}

try {
    $manifestFile = Resolve-SafeFile -Value $Manifest -AllowedDirectory 'evaluations/datasets' -Field 'Manifest' -Extension '.json'
    $document = Read-JsonObject -Path $manifestFile -Label 'Manifest'
    Assert-Version -Value $document.schema_version -Label 'Manifest'
    if ($document.cases -isnot [System.Array]) {
        throw 'Manifest cases must be a JSON array.'
    }

    $caseIds = @{}
    foreach ($case in $document.cases) {
        if ($case -isnot [System.Management.Automation.PSCustomObject]) {
            throw 'Each case must be a JSON object.'
        }
        Assert-Id -Value $case.case_id -Label 'case_id'
        Assert-Id -Value $case.resume_id -Label "$($case.case_id) resume_id"
        Assert-Id -Value $case.job_id -Label "$($case.case_id) job_id"
        if ($caseIds.ContainsKey($case.case_id)) {
            throw "Duplicate case_id: $($case.case_id)"
        }
        $caseIds[$case.case_id] = $true

        $null = Resolve-SafeFile -Value $case.resume_path -AllowedDirectory 'tests/fixtures/resumes' -Field "$($case.case_id) resume_path"
        $null = Resolve-SafeFile -Value $case.job_path -AllowedDirectory 'tests/fixtures/job_postings' -Field "$($case.case_id) job_path"
        $expectedFile = Resolve-SafeFile -Value $case.expected_path -AllowedDirectory 'evaluations/datasets' -Field "$($case.case_id) expected_path" -Extension '.json'
        $expected = Read-JsonObject -Path $expectedFile -Label "$($case.case_id) expected file"
        Assert-Version -Value $expected.schema_version -Label "$($case.case_id) expected file"
        if ($expected.case_id -isnot [string] -or $expected.case_id -cne $case.case_id) {
            throw "Expected file case_id must match $($case.case_id)."
        }
        if ($expected.expected -isnot [System.Management.Automation.PSCustomObject]) {
            throw "$($case.case_id) expected file must have an expected JSON object."
        }
    }

    if ($document.cases.Count -eq 0) {
        Write-Output 'PASS: 0 cases; structure only. No resume/job data or analysis behavior was validated.'
    }
    else {
        Write-Output "PASS: $($document.cases.Count) case(s); manifest structure, confined file references, and expected JSON envelopes are valid. Analysis behavior was not validated."
    }
    exit 0
}
catch {
    Write-Error -Message "Fixture validation failed: $($_.Exception.Message)" -ErrorAction Continue
    exit 1
}
