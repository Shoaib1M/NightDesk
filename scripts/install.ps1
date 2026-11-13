# Builds Nightdesk and installs it to a permanent folder outside the project, so rebuilding or
# moving the project never breaks the shortcuts, the taskbar pin or the start-with-Windows entry.
#   npm run install-app
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$built = Join-Path $root 'release\Nightdesk-win32-x64'
$dest = Join-Path $env:LOCALAPPDATA 'Programs\Nightdesk'
$exe = Join-Path $dest 'Nightdesk.exe'

# Build first, while the installed app keeps running.
Set-Location $root
npm run build
if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $built 'resources\app.asar'))) { throw 'Build failed; the installed copy was left untouched.' }

# Ask the running app to quit cleanly: launching any copy with --quit hands the request to the
# running one, which saves and closes its database. Only force it if it has not gone after 20 s.
if (Get-Process Nightdesk -ErrorAction SilentlyContinue) {
  Start-Process (Join-Path $built 'Nightdesk.exe') -ArgumentList '--quit'
  for ($i = 0; $i -lt 40 -and (Get-Process Nightdesk -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
  if (Get-Process Nightdesk -ErrorAction SilentlyContinue) {
    Write-Warning 'Nightdesk did not close by itself; forcing it.'
    Get-Process Nightdesk -ErrorAction SilentlyContinue | Stop-Process -Force
  }
  Start-Sleep -Seconds 1
}

robocopy $built $dest /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copy failed (robocopy $LASTEXITCODE)." }
if (-not (Test-Path (Join-Path $dest 'resources\app.asar'))) { throw 'Install is incomplete.' }

# One shortcut on the Desktop and one in the Start Menu; repoint any taskbar pins; drop duplicates.
$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$programs = [Environment]::GetFolderPath('Programs')
$taskbar = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
$links = @((Join-Path $desktop 'Nightdesk.lnk'), (Join-Path $programs 'Nightdesk.lnk'))
if (Test-Path $taskbar) { $links += Get-ChildItem $taskbar -Filter 'Nightdesk*.lnk' | ForEach-Object FullName }
foreach ($path in $links) {
  $lnk = $ws.CreateShortcut($path)
  $lnk.TargetPath = $exe
  $lnk.Arguments = ''
  $lnk.WorkingDirectory = $dest
  $lnk.IconLocation = "$exe,0"
  $lnk.Description = 'Nightdesk'
  $lnk.Save()
}
Get-ChildItem $desktop, $programs -Filter 'Nightdesk (*).lnk' -ErrorAction SilentlyContinue | Remove-Item -Force

# The first start after the data move must come from the taskbar or Start menu (see main.js), so only
# relaunch automatically once the data already lives in %USERPROFILE%\.nightdesk.
if (Test-Path (Join-Path $env:USERPROFILE '.nightdesk\nightdesk.db')) { Start-Process $exe; "Installed to $dest and started" }
else { "Installed to $dest. Open Nightdesk from the taskbar to finish moving your data." }
