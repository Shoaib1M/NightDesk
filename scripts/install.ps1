# Builds Nightdesk and installs it to a permanent folder outside the project, so rebuilding or
# moving the project never breaks the shortcuts, the taskbar pin or the start-with-Windows entry.
#   npm run install-app
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$built = Join-Path $root 'release\Nightdesk-win32-x64'
$dest = Join-Path $env:LOCALAPPDATA 'Programs\Nightdesk'
$exe = Join-Path $dest 'Nightdesk.exe'

# Ask a running copy to quit cleanly (it saves and closes its database), and only force it after 15 s.
$running = Get-Process Nightdesk -ErrorAction SilentlyContinue | Where-Object Path | Select-Object -First 1
if ($running) {
  Start-Process $running.Path -ArgumentList '--quit'
  for ($i = 0; $i -lt 30 -and (Get-Process Nightdesk -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
  Get-Process Nightdesk -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 1
}

Set-Location $root
npm run build
if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $built 'resources\app.asar'))) { throw 'Build failed; the installed copy was left untouched.' }

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

Start-Process $exe
"Installed to $dest"
