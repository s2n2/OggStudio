"""Checks the cast upload storage (chunks, resume, same file kept once, pruning)."""
import importlib.util, sys, tempfile, types, time, os
from pathlib import Path

# Stub the Home Assistant / aiohttp imports: only the plain functions are tested.
for name in ["aiohttp", "homeassistant", "homeassistant.components", "homeassistant.components.http", "homeassistant.core"]:
    sys.modules.setdefault(name, types.ModuleType(name))
sys.modules["aiohttp"].web = types.SimpleNamespace(Request=object, Response=object, StreamResponse=object)
sys.modules["homeassistant.components.http"].HomeAssistantView = object
sys.modules["homeassistant.core"].HomeAssistant = object
spec = importlib.util.spec_from_file_location("video", Path(__file__).parent.parent / "custom_components/oggstudio/video.py")
v = importlib.util.module_from_spec(spec); spec.loader.exec_module(v)

assert v.file_id("My clip (1).MP4", 1234) == "My_clip_1-1234.mp4"
assert v.file_id("../../etc/passwd", 5) == "passwd-5.mp4"
assert v.FILE_RE.match(v.file_id("x" * 99 + ".webm", 10))
with tempfile.TemporaryDirectory() as d:
    folder = Path(d) / "oggstudio"
    data = os.urandom(25)
    path = folder / v.file_id("a.mp4", len(data))
    assert v._received(path, 25) == 0
    assert v._append(path, 0, data[:10], 25) == 10
    assert v._append(path, 0, data[:10], 25) == 10          # out of step: unchanged
    assert v._received(path, 25) == 10                      # resume point
    assert v._append(path, 10, data[10:], 25) == 25
    assert path.read_bytes() == data and v._received(path, 25) == 25
    for i in range(5):
        p = folder / v.file_id(f"v{i}.mp4", 3)
        v._append(p, 0, b"abc", 3); time.sleep(0.02)
    left = sorted(p.name for p in folder.iterdir())
    assert len(left) == v.KEEP and "v4-3.mp4" in left, left
print("OggStudio video storage passed")
