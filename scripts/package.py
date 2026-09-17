"""Build a reviewable extension ZIP from an explicit runtime allowlist."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "src"
manifest = json.loads((SOURCE / "manifest.json").read_text(encoding="utf-8"))
files = [
    "manifest.json", "defaults.js", "config.js", "vault.js", "model-policy.js", "ui.js",
    "background.js", "translation.js", "dom.js", "content.js", "content.css", "privacy.html",
    "adapters/linear.js", "adapters/litellm.js",
    "options/options.html", "options/options.js", "options/options.css",
    "popup/popup.html", "popup/popup.js", "popup/popup.css", "images/1.png",
]
if manifest["manifest_version"] != 3 or manifest.get("host_permissions") or manifest.get("content_scripts"):
    raise SystemExit("Expected MV3 with optional website access and no all-site content script")
if not re.fullmatch(r"\d+\.\d+\.\d+", manifest["version"]):
    raise SystemExit("Invalid release version")
for name in files:
    item = SOURCE / name
    if not item.is_file():
        raise SystemExit(f"Missing runtime file: {name}")
    if item.suffix == ".js":
        subprocess.run(["node", "--check", str(item)], check=True, capture_output=True)
    if item.suffix == ".html":
        for link in re.findall(r'(?:src|href)="([^"]+)"', item.read_text(encoding="utf-8")):
            if link.startswith(("#", "https:", "http:")):
                continue
            resolved = (item.parent / link).resolve()
            if not resolved.is_relative_to(SOURCE.resolve()) or resolved.relative_to(SOURCE).as_posix() not in files:
                raise SystemExit(f"Unpackaged HTML reference: {name}: {link}")
for name in [manifest["background"]["service_worker"], manifest["options_page"], manifest["action"]["default_popup"], *manifest["icons"].values()]:
    if name not in files:
        raise SystemExit(f"Unpackaged manifest reference: {name}")
if (ROOT / "privacy.html").read_bytes() != (SOURCE / "privacy.html").read_bytes():
    raise SystemExit("Public and bundled privacy policies differ")

output = ROOT / "dist" / f"transLite-{manifest['version']}.zip"
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name in sorted(files + ["LICENSE"]):
        item = ROOT / name if name == "LICENSE" else SOURCE / name
        info = zipfile.ZipInfo(name, date_time=(2026, 9, 17, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, item.read_bytes())
with zipfile.ZipFile(output) as archive:
    if archive.testzip() is not None:
        raise SystemExit("ZIP verification failed")
print(f"Created {output} ({len(files)+1} files, {output.stat().st_size} bytes)")
print(f"SHA256 {hashlib.sha256(output.read_bytes()).hexdigest()}")
