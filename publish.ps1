$ErrorActionPreference = "Stop"
$git = Join-Path $env:LOCALAPPDATA "Programs\MinGit\cmd\git.exe"
$gh = Join-Path $env:LOCALAPPDATA "Programs\gh\bin\gh.exe"
Set-Location $PSScriptRoot

if (-not (Test-Path $git)) { throw "Git ontbreekt. Vraag in Cursor om Git opnieuw te zetten." }
if (-not (Test-Path $gh)) { throw "GitHub CLI ontbreekt. Log eerst in via Cursor." }

& $git add -A
$pending = & $git status --porcelain
if (-not $pending) {
  Write-Output "Geen lokale wijzigingen. Alleen opnieuw naar GitHub zetten..."
} else {
  $message = $args[0]
  if (-not $message) { $message = "Update WorkLog." }
  & $git -c user.name="hofb85" -c user.email="hofb85@users.noreply.github.com" commit -m $message
}

$token = & $gh auth token
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$token"))
& $git -c "http.extraHeader=Authorization: Basic $basic" push origin HEAD:publish
Write-Output "Klaar. Code: https://github.com/hofb85/worklog-app"
Write-Output "App:  https://hofb85.github.io/worklog-app/"
