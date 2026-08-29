$ErrorActionPreference = 'Stop'

$taskName = 'Route 100 Watch Collector'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$existingNodePath = $existingTask.Actions | Select-Object -First 1 -ExpandProperty Execute
$nodePath = if ($nodeCommand) { $nodeCommand.Source } elseif ($existingNodePath -and (Test-Path $existingNodePath)) { $existingNodePath } else { $null }
if (-not $nodePath) {
  throw 'Node.js was not found. Install Node.js or repair the existing scheduled task before registering it.'
}
$collectorPath = Join-Path $PSScriptRoot 'collector.mjs'
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction `
  -Execute $nodePath `
  -Argument ('"{0}"' -f $collectorPath) `
  -WorkingDirectory (Split-Path $collectorPath)

$triggers = @(
  New-ScheduledTaskTrigger -Daily -At '6:45 AM'
  New-ScheduledTaskTrigger -Daily -At '3:00 PM'
)

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 75) `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -DontStopOnIdleEnd `
  -WakeToRun

$principal = New-ScheduledTaskPrincipal `
  -UserId $currentUser `
  -LogonType Interactive `
  -RunLevel Limited

$task = New-ScheduledTask `
  -Action $action `
  -Trigger $triggers `
  -Settings $settings `
  -Principal $principal `
  -Description 'Collect Route 100 predictions once per minute from 6:45-7:45 AM and 3:00-4:00 PM.'

Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null
Get-ScheduledTask -TaskName $taskName | Get-ScheduledTaskInfo
