# Rewrites cccshow's tenant_id in a raw data-only dump (produced locally from
# nf_cccshow, since cccshow only exists on the dev machine, never on this
# server) to a target tenant's own tenant_id, then restores it into that
# tenant's existing database. Reusable: run it again with a different
# -TargetTenantId / -TargetDatabase to clone into any other tenant.
#
# The dump is DATA ONLY (--no-create-info --complete-insert --insert-ignore,
# __drizzle_migrations excluded) — it never touches the target's schema or
# its own migration history, matching the pattern already used for the
# nf_ccc reconciliation on 16 Nov. INSERT IGNORE means rows that collide on
# primary key with something already in the target (e.g. the shared system
# reference tables — nob_master, lob_master, country_master, role_master,
# etc., which carry no tenant_id and are identical in every tenant) are
# silently skipped rather than erroring.
#
# company_id, nob_id and lob_id are NOT rewritten: a freshly onboarded
# tenant's company keeps the standard zero id (00000000-0000-0000-0000-000000000000),
# and NOB/LOB are global system rows — both already match between cccshow
# and any other tenant without changes.
#
# BACK UP THE TARGET DATABASE BEFORE RUNNING THIS. It is not reversible by
# this script.
#
# Usage:
#   .\clone-cccshow-to-tenant.ps1 `
#     -DumpFile "C:\path\cccshow-data-only.sql" `
#     -TargetTenantId "11111111-2222-3333-4444-555555555555" `
#     -TargetDatabase "nf_testanshu"
#
# Find the target tenant_id first:
#   mysql -u root -p -e "SELECT tenant_id, db_name FROM nf_master.tenant_master WHERE tenant_code='testanshu';"

param(
    [Parameter(Mandatory = $true)][string]$DumpFile,
    [Parameter(Mandatory = $true)][string]$TargetTenantId,
    [Parameter(Mandatory = $true)][string]$TargetDatabase,
    [string]$MysqlExe = "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe",
    [string]$MysqlUser = "root"
)

$ErrorActionPreference = "Stop"
$SourceTenantId = "f70a44ef-4dfb-4724-b1fb-ed7f9ef23718"  # cccshow's own tenant_id — fixed, do not change

if (-not (Test-Path $DumpFile)) {
    throw "Dump file not found: $DumpFile"
}
if ($TargetTenantId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
    throw "TargetTenantId doesn't look like a UUID: $TargetTenantId"
}
if (-not (Test-Path $MysqlExe)) {
    throw "mysql.exe not found at $MysqlExe — pass -MysqlExe with the correct path."
}

Write-Host "Rewriting tenant_id $SourceTenantId -> $TargetTenantId ..."
$rewritten = "$DumpFile.for-$TargetTenantId.sql"
(Get-Content $DumpFile -Raw) -replace [regex]::Escape($SourceTenantId), $TargetTenantId |
    Set-Content -Path $rewritten -NoNewline -Encoding UTF8
Write-Host "Rewritten file: $rewritten"

Write-Host ""
Write-Host "About to INSERT (IGNORE on conflict) cccshow's full dataset into database '$TargetDatabase'."
Write-Host "Make sure you have already backed up $TargetDatabase — this is not reversible by this script."
$confirm = Read-Host "Type the database name again to confirm"
if ($confirm -ne $TargetDatabase) {
    throw "Confirmation did not match '$TargetDatabase'; aborting without restoring anything."
}

Write-Host "Restoring into $TargetDatabase ..."
# Piping the dump through stdin and an interactive -p password prompt both want
# stdin, so the password goes through MYSQL_PWD instead (PS 5.1-compatible
# SecureString handling — no -AsPlainText, which needs PowerShell 7+).
if (-not $env:MYSQL_PWD) {
    $securePwd = Read-Host "MySQL password for $MysqlUser" -AsSecureString
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePwd)
    try {
        $env:MYSQL_PWD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    } finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}
try {
    Get-Content $rewritten -Raw | & $MysqlExe -u $MysqlUser $TargetDatabase
    if ($LASTEXITCODE -ne 0) {
        throw "mysql exited with code $LASTEXITCODE — restore did not complete cleanly."
    }
} finally {
    Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue
}
Write-Host "Restore complete."
