"""Prueba el adaptador preparado con HTTP real y HERMES_HOME descartable.

Ejecutar con el Python de Hermes: .../venv/Scripts/python.exe scripts/hermes/test_watchdog.py
No se conecta a WhatsApp, Supabase ni al gateway instalado.
"""
import asyncio
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest

TEST_HOME = tempfile.TemporaryDirectory(prefix="hermes-watchdog-")
os.environ["HERMES_HOME"] = TEST_HOME.name
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
sys.dont_write_bytecode = True
for key in list(os.environ):
    if key.endswith(("_API_KEY", "_TOKEN", "_SECRET", "_PASSWORD", "_CREDENTIALS")):
        os.environ.pop(key, None)

ROOT = Path.home() / "AppData/Local/hermes/hermes-agent"
sys.path.insert(0, str(ROOT))
import aiohttp
from aiohttp import web
from gateway.config import PlatformConfig

spec = importlib.util.spec_from_file_location("watchdog_adapter_under_test", Path(__file__).parent / "watchdog_preparado/adapter.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class WatchdogTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.statuses = []
        self.hits = 0
        self.notified = []
        self.health = {"status": "connected"}
        self.mode = "normal"

        async def health(request):
            self.hits += 1
            if self.mode == "http500":
                return web.Response(status=500)
            if self.mode == "transient" and self.hits <= 2:
                return web.Response(status=500)
            if self.mode == "hang":
                await asyncio.sleep(60)
            return web.json_response(self.health)

        app = web.Application()
        app.router.add_get("/health", health)
        self.runner = web.AppRunner(app, shutdown_timeout=0.01)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        self.adapter = module.WhatsAppAdapter(PlatformConfig(enabled=True, extra={"bridge_port": port}))
        self.adapter._running = True
        self.adapter._write_runtime_status_safe = lambda context, **kw: self.statuses.append(kw)

        async def fatal(adapter):
            self.notified.append((adapter.fatal_error_code, adapter.fatal_error_retryable))

        self.adapter._fatal_error_handler = fatal
        self.task = None

    async def asyncTearDown(self):
        if self.task and not self.task.done():
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
        await self.runner.cleanup()

    def watch(self, **kw):
        self.task = asyncio.create_task(self.adapter._watch_bridge_health(interval=0.01, **kw))
        return self.task

    async def until(self, predicate):
        async def wait():
            while not predicate():
                await asyncio.sleep(0.01)
        await asyncio.wait_for(wait(), 4)

    async def test_idle_healthy_bridge_never_restarts(self):
        self.watch()
        await self.until(lambda: self.hits >= 4)
        self.assertGreaterEqual(self.hits, 3)
        self.assertEqual(self.notified, [])

    async def test_three_http_failures_activate_existing_recovery(self):
        self.mode = "http500"
        await asyncio.wait_for(self.watch(), 2)
        self.assertEqual(self.hits, 3)
        self.assertEqual(self.notified, [("whatsapp_bridge_unresponsive", True)])
        self.assertFalse(self.adapter._running)
        self.assertEqual(self.statuses[0]["platform_state"], "retrying")

    async def test_two_failures_then_recovery_do_not_restart(self):
        self.mode = "transient"
        self.watch()
        await self.until(lambda: self.statuses and self.statuses[-1]["platform_state"] == "connected")
        self.assertGreaterEqual(self.hits, 3)
        self.assertEqual(self.notified, [])
        self.assertEqual(self.statuses[-1]["platform_state"], "connected")

    async def test_hung_http_handler_is_detected_with_live_server(self):
        self.mode = "hang"
        await asyncio.wait_for(self.watch(), 9)
        self.assertEqual(self.hits, 3)
        self.assertEqual(self.notified, [("whatsapp_bridge_unresponsive", True)])

    async def test_disconnected_http200_is_not_healthy(self):
        self.health = {"status": "disconnected"}
        await asyncio.wait_for(self.watch(disconnect_grace=0.06), 2)
        self.assertEqual(self.notified, [("whatsapp_bridge_disconnected", True)])
        self.assertGreaterEqual(self.hits, 2)

    async def test_brief_disconnect_gets_grace_period(self):
        self.health = {"status": "disconnected"}
        self.watch(disconnect_grace=3)
        await self.until(lambda: bool(self.statuses))
        self.health = {"status": "connected"}
        await self.until(lambda: self.statuses[-1]["platform_state"] == "connected")
        self.assertEqual(self.notified, [])
        self.assertEqual(self.statuses[-1]["platform_state"], "connected")

    async def test_invalid_json_shape_is_not_healthy(self):
        self.health = []
        await asyncio.wait_for(self.watch(), 2)
        self.assertEqual(self.notified, [("whatsapp_bridge_unresponsive", True)])

    async def test_stopping_does_not_trigger_recovery(self):
        self.mode = "http500"
        self.adapter._shutting_down = True
        await asyncio.wait_for(self.watch(), 2)
        self.assertEqual(self.notified, [])
        self.assertEqual(self.hits, 0)

    async def test_disconnect_cancels_watchdog_and_closes_http(self):
        self.watch()
        task = self.task
        self.adapter._bridge_health_task = task
        self.adapter._poll_task = None
        self.adapter._http_session = aiohttp.ClientSession()
        session = self.adapter._http_session
        self.adapter._session_path = Path(TEST_HOME.name) / "session"
        await self.adapter.disconnect()
        self.assertTrue(task.done())
        self.assertTrue(session.closed)
        self.assertIsNone(self.adapter._bridge_health_task)
        self.assertEqual(self.notified, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
