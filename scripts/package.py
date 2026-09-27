"""Package all runtime files together for Flatpak's single-file picker grant."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

import shutil

root = Path(__file__).resolve().parent.parent
version = json.loads((root / "manifest.json").read_text())["version"]
output = root / "dist" / f"media-controls-{version}.xpi"
output_zip = root / "dist" / f"media-controls-{version}.zip"
output.parent.mkdir(exist_ok=True)
files = ["manifest.json", "background.js", "page-hook.js", "relay.js",
         "popup.html", "popup.js", "popup.css", "LICENSE",
         "LICENSE-APACHE-2.0.txt", "THIRD_PARTY_NOTICES.md"]
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(root / name, name)
    for icon in sorted((root / "icons").glob("*.png")):
        archive.write(icon, str(icon.relative_to(root)))
shutil.copyfile(output, output_zip)
print(output)
print(output_zip)
