# Registra la tarea programada "iPasto - Vigilar crecimiento (potreros)" (una vez por dia, 9:00).
# Correr una sola vez en la PC, desde PowerShell, despues del merge a main:
#   powershell -ExecutionPolicy Bypass -File C:\Users\Pedro\repos\potreros\scripts\ipasto\instalar_tarea_ipasto.ps1
# Es idempotente: si la tarea ya existe, la reemplaza.
# Para ver el resultado: Get-ScheduledTaskInfo -TaskName "iPasto - Vigilar crecimiento (potreros)"
# Para correrla ya:      Start-ScheduledTask -TaskName "iPasto - Vigilar crecimiento (potreros)"

$ErrorActionPreference = "Stop"
$nombre = "iPasto - Vigilar crecimiento (potreros)"
$repo = "C:\Users\Pedro\repos\potreros"
if (-not (Test-Path "$repo\scripts\ipasto\bajar_crecimiento.py")) { throw "Falta el script en ${repo}: primero mergear la rama y actualizar main" }
$script = Join-Path $repo "scripts\ipasto\bajar_crecimiento.py"

# pythonw.exe no abre ventana; si no existe, usa python.exe
$py = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
if (-not $py) { $py = (Get-Command python.exe -ErrorAction Stop).Source }

$accion = New-ScheduledTaskAction -Execute $py -Argument "`"$script`"" -WorkingDirectory $repo
$disparador = New-ScheduledTaskTrigger -Daily -At "09:00"
$config = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
$usuario = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $usuario -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger $disparador -Settings $config -Principal $principal -Force | Out-Null
Write-Host "Tarea registrada: $nombre (todos los dias a las 9:00)." -ForegroundColor Green
Write-Host "Ver el estado:  Get-ScheduledTaskInfo -TaskName '$nombre'"
Write-Host "Correrla ya:    Start-ScheduledTask -TaskName '$nombre'"
