"""Prepara/instala el arreglo local de Hermes sin actualizar ni tocar credenciales.

Preparar: python scripts/hermes/preparar_watchdog.py
Instalar: usar el mismo comando con --instalar (requiere escritura fuera del repo).
El parche se rehúsa a aplicarse si cambió el código de origen esperado.
"""
import argparse
import difflib
import hashlib
import os
from pathlib import Path
import shutil

HERMES = Path.home() / "AppData/Local/hermes/hermes-agent"
TARGET = HERMES / "plugins/platforms/whatsapp/adapter.py"
STAGE = Path(__file__).resolve().parent / "watchdog_preparado"
MARKER = "    async def _watch_bridge_health("

WATCHDOG = '''    async def _watch_bridge_health(self, *, interval: float = 10.0,
                                   failure_limit: int = 3,
                                   disconnect_grace: float = 120.0) -> None:
        """A live PID is not liveness: escalate a wedged transport to the existing reconnect watcher.

        Independent of message handling (which can await media or a slow turn).
        Brief WhatsApp disconnects get time to reconnect without killing the session.
        The normal fatal handler owns bounded teardown/reconnect; no port-wide kill here.
        """
        failures = 0
        disconnected_since = None
        degraded = False
        loop = asyncio.get_running_loop()
        while self._running and not self._shutting_down:
            await asyncio.sleep(interval)
            if not self._running or self._shutting_down:
                return
            reason = None
            code = "whatsapp_bridge_unresponsive"
            try:
                ok, data = await asyncio.wait_for(self._probe_bridge_health(), timeout=3.0)
                if not ok or not isinstance(data, dict) or not isinstance(data.get("status"), str):
                    raise ValueError("invalid bridge health response")
                if data["status"] == "connected":
                    failures = 0
                    disconnected_since = None
                    if degraded:
                        self._write_runtime_status_safe("watchdog_recovered", platform_state="connected",
                                                        error_code=None, error_message=None)
                        degraded = False
                    continue
                failures = 0  # HTTP is alive; allow the socket's own reconnection to work.
                if disconnected_since is None:
                    disconnected_since = loop.time()
                reason = "WhatsApp socket remains disconnected"
                code = "whatsapp_bridge_disconnected"
                exhausted = loop.time() - disconnected_since >= disconnect_grace
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                failures += 1
                reason = f"Bridge health failed ({type(exc).__name__}), attempt {failures}/{failure_limit}"
                exhausted = failures >= failure_limit
            if not self._running or self._shutting_down:
                return
            if not degraded:
                logger.warning("[%s] %s", self.name, reason)
                self._write_runtime_status_safe("watchdog_degraded", platform_state="retrying",
                                                error_code=code, error_message=reason)
                degraded = True
            if exhausted:
                logger.error("[%s] %s; requesting automatic bridge recovery", self.name, reason)
                self._set_fatal_error(code, reason, retryable=True)
                await self._notify_fatal_error()
                return

'''


def patched(source):
    if MARKER in source:
        raise ValueError("El watchdog ya está instalado; no sobrescribirlo.")
    replacements = [
        ("        self._bridge_log_fh = self._bridge_log = self._poll_task = self._http_session = None\n",
         "        self._bridge_log_fh = self._bridge_log = self._poll_task = self._http_session = None\n        self._bridge_health_task = None\n"),
        ("        self._poll_task = asyncio.create_task(self._poll_messages())\n",
         "        self._shutting_down = False\n        self._poll_task = asyncio.create_task(self._poll_messages())\n        self._bridge_health_task = asyncio.create_task(self._watch_bridge_health())\n"),
        ("    async def _poll_messages(self) -> None:\n", WATCHDOG + "    async def _poll_messages(self) -> None:\n"),
        ("        self._shutting_down = True  # flip BEFORE signalling so send()/poll loop don't report the intentional exit as fatal\n",
         "        self._shutting_down = True  # flip BEFORE signalling so send()/poll loop don't report the intentional exit as fatal\n        await cancel_task(getattr(self, '_bridge_health_task', None))\n        self._bridge_health_task = None\n"),
    ]
    for old, new in replacements:
        if source.count(old) != 1:
            raise ValueError("El código instalado cambió; revisar el parche antes de aplicarlo.")
        source = source.replace(old, new)
    compile(source, str(TARGET), "exec")
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instalar", action="store_true")
    args = parser.parse_args()
    original = TARGET.read_bytes()
    source = original.decode("utf-8").replace("\r\n", "\n")
    result = patched(source)
    STAGE.mkdir(exist_ok=True)
    digest = hashlib.sha256(original).hexdigest()
    if args.instalar:
        # Require that the prepared, tested artifact still matches this exact input.
        if (STAGE / "original.sha256").read_text().strip() != digest:
            raise ValueError("El original cambió desde la preparación; volver a preparar y probar.")
        prepared = (STAGE / "adapter.py").read_text(encoding="utf-8")
        if prepared != result:
            raise ValueError("El resultado preparado no coincide; volver a probar.")
        backup = TARGET.with_name("adapter.py.pre-watchdog-" + digest[:12])
        if not backup.exists():
            shutil.copy2(TARGET, backup)
        # Atomic replacement; existing running Python code remains intact until restart.
        temporary = TARGET.with_suffix(".watchdog.tmp")
        temporary.write_text(result, encoding="utf-8", newline="\n")
        os.replace(temporary, TARGET)
        print("Watchdog instalado. Copia anterior:", backup)
    else:
        (STAGE / "adapter.py").write_text(result, encoding="utf-8", newline="\n")
        (STAGE / "original.sha256").write_text(digest + "\n")
        diff = difflib.unified_diff(source.splitlines(True), result.splitlines(True),
                                    fromfile="adapter.py.original", tofile="adapter.py.watchdog")
        (STAGE / "watchdog.diff").write_text("".join(diff), encoding="utf-8")
        print("Parche preparado en", STAGE)


if __name__ == "__main__":
    main()
