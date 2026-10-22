# Registra la tarea programada "Potreros - Pasar traslados a Excel" (cada hora).
# Correr una sola vez en la PC, desde PowerShell, en la carpeta del clon del repo:
#   powershell -ExecutionPolicy Bypass -File scripts\dicose\instalar_tarea_traslados.ps1
# Es idempotente: si la tarea ya existe, la reemplaza.
# Para ver el resultado: Get-ScheduledTaskInfo -TaskName "Potreros - Pasar traslados a Excel"
# Para correrla ya:      Start-ScheduledTask -TaskName "Potreros - Pasar traslados a Excel"

$ErrorActionPreference = "Stop"
$nombre = "Potreros - Pasar traslados a Excel"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$script = Join-Path $repo "scripts\dicose\pasar_traslados_automatico.py"
if (-not (Test-Path $script)) { throw "No encuentro $script. Correr desde el clon de potreros." }

# pythonw.exe no abre ventana; si no existe, usa python.exe
$py = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
if (-not $py) { $py = (Get-Command python.exe -ErrorAction Stop).Source }

$accion = New-ScheduledTaskAction -Execute $py -Argument "`"$script`"" -WorkingDirectory $repo
$inicio = (Get-Date).Date.AddMinutes(5)
$disparador = New-ScheduledTaskTrigger -Once -At $inicio -RepetitionInterval (New-TimeSpan -Hours 1)
$config = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$usuario = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $usuario -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger $disparador -Settings $config -Principal $principal -Force | Out-Null
Write-Host "Tarea registrada: $nombre (cada hora, desde $inicio)." -ForegroundColor Green
Write-Host "Ver el estado:  Get-ScheduledTaskInfo -TaskName '$nombre'"
Write-Host "Correrla ya:    Start-ScheduledTask -TaskName '$nombre'"
