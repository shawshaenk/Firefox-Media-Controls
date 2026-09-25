"""Create a source-only archive for Mozilla Add-ons reviewers."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import json

root = Path(__file__).resolve().parent.parent
version = json.loads((root / "manifest.json").read_text(encoding="utf-8"))["version"]
output = root / "dist" / f"media-controls-source-{version}.zip"
output.parent.mkdir(exist_ok=True)

files = [
    "README.md",
    "LICENSE",
    "LICENSE-APACHE-2.0.txt",
    "THIRD_PARTY_NOTICES.md",
    "manifest.json",
    "package.json",
    "package-lock.json",
    "requirements-build.txt",
    "tsconfig.json",
    "build.js",
    "EXTENSION_DEMO.png",
    "icons/beamed-notes.svg",
]
for directory, suffix in (("src", "*"), ("scripts", "*.py"), ("tests", "*.cjs")):
    files.extend(str(path.relative_to(root)) for path in (root / directory).rglob(suffix) if path.is_file())

with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for name in sorted(files):
        archive.write(root / name, f"media-controls-source-{version}/{name}")

print(output)
