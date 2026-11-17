"""Build a reviewable extension ZIP from an explicit runtime allowlist."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "src"
manifest = json.loads((SOURCE / "manifest.json").read_text(encoding="utf-8"))
files = [
    "manifest.json", "defaults.js", "config.js", "vault.js", "model-policy.js", "ui.js",
    "background.js", "translation.js", "dom.js", "content.js", "button.js", "content.css", "privacy.html",
    "adapters/linear.js", "adapters/litellm.js", "adapters/steam.js",
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

def write_zip(output, manifest_object):
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(files + ["LICENSE"]):
            if name == "manifest.json":
                blob = json.dumps(manifest_object, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
            else:
                blob = (ROOT / name if name == "LICENSE" else SOURCE / name).read_bytes()
            info = zipfile.ZipInfo(name, date_time=(2026, 9, 17, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, blob)
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None:
            raise SystemExit("ZIP verification failed")
    print(f"Created {output} ({len(files)+1} files, {output.stat().st_size} bytes)")
    print(f"SHA256 {hashlib.sha256(output.read_bytes()).hexdigest()}")


# 默认构建：按需授权，不声明常驻网站权限。
write_zip(ROOT / "dist" / f"transLite-{manifest['version']}.zip", manifest)

# 全站授权版：给没有扩展工具栏的浏览器（Steam 内置 CEF 等）。
# 那里没有 popup 也没有 chrome://extensions，可选权限永远授不下来，
# 所以只能把网站权限写成必需的，由浏览器在加载时直接授予，按钮才注入得进去。
if "--all-sites" in sys.argv[1:]:
    variant = json.loads(json.dumps(manifest))
    variant.pop("optional_host_permissions", None)
    # 老内核会因 minimum_chrome_version 直接拒绝加载，这一版同时放宽。
    variant.pop("minimum_chrome_version", None)
    variant["host_permissions"] = ["http://*/*", "https://*/*"]
    # 参考沉浸式翻译：把整套脚本静态注入，不依赖 chrome.scripting（Chromium 88+ 才有）。
    # Steam 的 CEF 内核通常更老，靠后台 executeScript 注入会静默失败。
    variant["content_scripts"] = [{
        "matches": ["http://*/*", "https://*/*"],
        # Steam 客户端自己的界面页（steamloopback.host）不注入。
        "exclude_matches": ["*://steamloopback.host/*"],
        "js": ["defaults.js", "adapters/litellm.js", "adapters/linear.js", "adapters/steam.js", "dom.js", "content.js", "button.js"],
        "css": ["content.css"],
        "run_at": "document_idle",
    }]
    variant["description"] = manifest["description"] + "（全站授权版）"
    folder = ROOT / "dist" / "steam"
    if folder.exists():
        shutil.rmtree(folder)
    for name in files:
        target = folder / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if name == "manifest.json":
            target.write_text(json.dumps(variant, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        else:
            shutil.copy2(SOURCE / name, target)
    shutil.copy2(ROOT / "LICENSE", folder / "LICENSE")
    print(f"Created {folder} (unpacked, load this folder)")
    write_zip(ROOT / "dist" / f"transLite-{manifest['version']}-all-sites.zip", variant)
