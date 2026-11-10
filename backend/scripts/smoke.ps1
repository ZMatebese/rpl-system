<#
    End-to-end lifecycle smoke test against a running API — PowerShell version.

    Equivalent to scripts/smoke.sh, for Windows. Needs no jq, curl or Python:
    it uses only built-in PowerShell cmdlets.

        cd backend
        npm start                      # in another terminal, leave running
        .\scripts\smoke.ps1

    If PowerShell refuses to run the script, allow local scripts for this
    session only:
        Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#>

param([string]$Api = 'http://localhost:4000')

$ErrorActionPreference = 'Stop'

# --- helpers --------------------------------------------------------------

function Invoke-Api {
    <#  Returns a PSCustomObject with .Status and .Body (parsed JSON or raw
        text). Does not throw on an HTTP error status, because this script
        asserts on refusals as much as on successes. #>
    param(
        [string]$Method = 'GET',
        [string]$Path,
        $Body,
        [string]$Token,
        [hashtable]$Form
    )

    $headers = @{}
    if ($Token) { $headers['Authorization'] = "Bearer $Token" }

    $req = @{
        Uri             = "$Api$Path"
        Method          = $Method
        Headers         = $headers
        UseBasicParsing = $true
    }
    if ($PSBoundParameters.ContainsKey('Body') -and $null -ne $Body) {
        $req['Body'] = ($Body | ConvertTo-Json -Compress -Depth 10)
        $req['ContentType'] = 'application/json'
    }
    if ($Form) { $req['Form'] = $Form }

    try {
        $resp = Invoke-WebRequest @req
        $status = [int]$resp.StatusCode
        $content = $resp.Content
    }
    catch {
        # Both Windows PowerShell 5.1 and PowerShell 7 land here on 4xx/5xx,
        # but expose the response slightly differently.
        $r = $_.Exception.Response
        if ($null -eq $r) { throw }
        $status = [int]$r.StatusCode
        $content = ''
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            $content = $_.ErrorDetails.Message
        }
        elseif ($r.GetResponseStream) {
            $sr = New-Object System.IO.StreamReader($r.GetResponseStream())
            $content = $sr.ReadToEnd()
            $sr.Close()
        }
    }

    $parsed = $null
    if ($content) {
        try { $parsed = $content | ConvertFrom-Json } catch { $parsed = $content }
    }
    [PSCustomObject]@{ Status = $status; Body = $parsed; Raw = $content }
}

function Get-Token([string]$Email, [string]$Password) {
    $r = Invoke-Api -Method POST -Path '/api/auth/login' -Body @{ email = $Email; password = $Password }
    if ($r.Status -ne 200) { throw "login failed for $Email (HTTP $($r.Status)): $($r.Raw)" }
    $r.Body.token
}

function Assert-Status($Actual, $Expected, $What) {
    if ($Actual -ne $Expected) {
        Write-Host "   FAIL: $What (expected $Expected, got $Actual)" -ForegroundColor Red
        exit 1
    }
}

# PowerShell 5.1 has no -Form parameter on Invoke-WebRequest, so multipart is
# assembled by hand. This keeps the script working on a stock Windows install.
function Send-Evidence {
    param([int]$ApplicationId, [string]$Token, [string]$FilePath,
          [string]$ContentType, [string]$EvidenceType = 'OTHER', [string]$Description = '')

    $boundary = [System.Guid]::NewGuid().ToString()
    $fileName = [System.IO.Path]::GetFileName($FilePath)
    $fileBytes = [System.IO.File]::ReadAllBytes($FilePath)
    $enc = [System.Text.Encoding]::UTF8
    $LF = "`r`n"

    $pre = $enc.GetBytes(
        "--$boundary$LF" +
        "Content-Disposition: form-data; name=`"evidenceType`"$LF$LF$EvidenceType$LF" +
        "--$boundary$LF" +
        "Content-Disposition: form-data; name=`"description`"$LF$LF$Description$LF" +
        "--$boundary$LF" +
        "Content-Disposition: form-data; name=`"file`"; filename=`"$fileName`"$LF" +
        "Content-Type: $ContentType$LF$LF")
    $post = $enc.GetBytes("$LF--$boundary--$LF")

    $body = New-Object byte[] ($pre.Length + $fileBytes.Length + $post.Length)
    [Array]::Copy($pre, 0, $body, 0, $pre.Length)
    [Array]::Copy($fileBytes, 0, $body, $pre.Length, $fileBytes.Length)
    [Array]::Copy($post, 0, $body, $pre.Length + $fileBytes.Length, $post.Length)

    try {
        $resp = Invoke-WebRequest -Uri "$Api/api/applications/$ApplicationId/evidence" `
            -Method POST -UseBasicParsing `
            -Headers @{ Authorization = "Bearer $Token" } `
            -ContentType "multipart/form-data; boundary=$boundary" `
            -Body $body
        $status = [int]$resp.StatusCode
        $content = $resp.Content
    }
    catch {
        $r = $_.Exception.Response
        if ($null -eq $r) { throw }
        $status = [int]$r.StatusCode
        $content = if ($_.ErrorDetails) { $_.ErrorDetails.Message } else { '' }
    }

    $parsed = $null
    if ($content) { try { $parsed = $content | ConvertFrom-Json } catch { } }
    [PSCustomObject]@{ Status = $status; Body = $parsed }
}

# --- the run --------------------------------------------------------------

Write-Host "RPL lifecycle smoke test against $Api`n"

Write-Host '== 1. Applicant logs in'
$appToken = Get-Token 'applicant@rpl.local' 'Applicant#2026'
Write-Host '   token acquired'

Write-Host '== 2. Applicant creates a draft application'
$quals = Invoke-Api -Path '/api/qualifications' -Token $appToken
$qualId = $quals.Body.qualifications[0].id
$create = Invoke-Api -Method POST -Path '/api/applications' -Token $appToken -Body @{
    qualificationId = $qualId
    motivation      = '15 years of systems administration experience across identity management and directory services.'
}
Assert-Status $create.Status 201 'application was not created'
$appId = $create.Body.application.id
Write-Host "   application #$appId created in DRAFT"

Write-Host '== 3. Submit WITHOUT evidence (guard must refuse with 422)'
$r = Invoke-Api -Method POST -Path "/api/applications/$appId/submit" -Token $appToken
Write-Host "   HTTP $($r.Status)  $($r.Raw)"
Assert-Status $r.Status 422 'guard did not refuse'

Write-Host '== 4. Attach evidence'
$pdf = Join-Path $env:TEMP 'rpl-cv.pdf'
Set-Content -Path $pdf -Value "%PDF-1.4`n1 0 obj<</Type/Catalog>>endobj`ntrailer<</Root 1 0 R>>" -NoNewline -Encoding ASCII
$up = Send-Evidence -ApplicationId $appId -Token $appToken -FilePath $pdf `
    -ContentType 'application/pdf' -EvidenceType 'CV' -Description 'Curriculum vitae'
Assert-Status $up.Status 201 'evidence upload failed'
Write-Host "   stored as $($up.Body.evidence.stored_filename)"

Write-Host '== 5. Reject a disallowed file type (expect 415)'
$bad = Join-Path $env:TEMP 'rpl-bad.sh'
Set-Content -Path $bad -Value '#!/bin/sh' -Encoding ASCII
$r = Send-Evidence -ApplicationId $appId -Token $appToken -FilePath $bad -ContentType 'application/x-sh'
Write-Host "   HTTP $($r.Status)"
Assert-Status $r.Status 415 'disallowed type accepted'

Write-Host '== 6. Submit again (guard now satisfied)'
$r = Invoke-Api -Method POST -Path "/api/applications/$appId/submit" -Token $appToken
Assert-Status $r.Status 200 'submission failed'
Write-Host "   status now $($r.Body.application.status)"

Write-Host '== 7. Applicant attempts an ADMIN endpoint (expect 403)'
$r = Invoke-Api -Path '/api/applications/queue' -Token $appToken
Write-Host "   HTTP $($r.Status)"
Assert-Status $r.Status 403 'cross-role access allowed'

Write-Host '== 8. Administrator logs in and allocates an assessor'
$admToken = Get-Token 'admin@rpl.local' 'Admin#2026'
$assessors = Invoke-Api -Path '/api/admin/assessors' -Token $admToken
# Pinned by email so the negative test below uses a genuinely different
# assessor regardless of list ordering.
$assessorId = ($assessors.Body.assessors | Where-Object { $_.email -eq 'assessor@rpl.local' }).id
$r = Invoke-Api -Method POST -Path "/api/applications/$appId/allocate" -Token $admToken -Body @{ assessorId = $assessorId }
Assert-Status $r.Status 200 'allocation failed'
Write-Host "   status now $($r.Body.application.status)"

Write-Host '== 9. Wrong assessor attempts the assessment (expect 403)'
$wrongToken = Get-Token 'assessor2@rpl.local' 'Assessor#2026'
$ratings = @{ currency = 'MET'; authenticity = 'MET'; sufficiency = 'MET'; relevance = 'MET'; level = 'MET' }
$r = Invoke-Api -Method POST -Path "/api/applications/$appId/assessment" -Token $wrongToken -Body @{
    criterionRatings = $ratings; comments = 'x'; recommendation = 'RECOMMEND_APPROVE'
}
Write-Host "   HTTP $($r.Status)"
Assert-Status $r.Status 403 'unallocated assessor permitted'

Write-Host '== 10. Allocated assessor records the assessment'
$asrToken = Get-Token 'assessor@rpl.local' 'Assessor#2026'
$r = Invoke-Api -Method POST -Path "/api/applications/$appId/assessment" -Token $asrToken -Body @{
    criterionRatings = @{ currency = 'MET'; authenticity = 'MET'; sufficiency = 'PARTIALLY_MET'; relevance = 'MET'; level = 'MET' }
    comments         = 'Substantial relevant experience evidenced. Sufficiency marginal on the project management outcome.'
    recommendation   = 'RECOMMEND_APPROVE'
}
Assert-Status $r.Status 201 'assessment was refused'
Write-Host "   status now $($r.Body.application.status)"

Write-Host '== 11. Administrator ratifies the outcome'
$r = Invoke-Api -Method POST -Path "/api/applications/$appId/outcome" -Token $admToken -Body @{
    decision = 'approve'; rationale = 'Assessment supports the claim. Credit granted for two modules.'
}
Assert-Status $r.Status 200 'outcome was refused'
Write-Host "   status now $($r.Body.application.status)"

Write-Host '== 12. Audit trail'
$audit = Invoke-Api -Path "/api/applications/$appId/audit" -Token $admToken
foreach ($h in $audit.Body.history) {
    $prev = if ($null -eq $h.previous_status) { 'None' } else { $h.previous_status }
    '   {0}  {1,20} -> {2,-20} by {3} {4} ({5})' -f `
        $h.changed_at, $prev, $h.new_status, $h.actor_first_name, $h.actor_surname, $h.actor_role
}

Write-Host '== 13. Terminal state is terminal (expect 409)'
$r = Invoke-Api -Method POST -Path "/api/applications/$appId/outcome" -Token $admToken -Body @{
    decision = 'reject'; rationale = 'changed my mind'
}
Write-Host "   HTTP $($r.Status)"
Assert-Status $r.Status 409 'terminal state mutated'

Write-Host ''
Write-Host 'ALL LIFECYCLE CHECKS PASSED' -ForegroundColor Green
