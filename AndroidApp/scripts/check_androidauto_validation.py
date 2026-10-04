"""Gate phone manifests and lint without hiding new errors behind legacy lint policy."""
import argparse
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ANDROID = "{http://schemas.android.com/apk/res/android}"


def check(lint_report):
    errors = []
    for variant in ("Debug", "Release"):
        manifest = ROOT / f"app/build/intermediates/merged_manifests/androidauto{variant}/processAndroidauto{variant}Manifest/AndroidManifest.xml"
        root = ET.parse(manifest).getroot()
        sdk = root.find("uses-sdk")
        app = root.find("application")
        if root.get("package") != "com.example.obdapp.androidauto" or sdk.get(ANDROID + "targetSdkVersion") != "36":
            errors.append(f"{variant}: wrong phone package or target SDK")
        if variant == "Release" and app.get(ANDROID + "debuggable", "false") != "false":
            errors.append("Release: debuggable build")
        if app.get(ANDROID + "allowBackup") != "false":
            errors.append(f"{variant}: app data backup enabled")
        if any(p.get(ANDROID + "name") == "android.permission.ACCESS_BACKGROUND_LOCATION" for p in root.findall("uses-permission")):
            errors.append(f"{variant}: background location enabled")
        if any(r.get(ANDROID + "name") == "com.example.obdapp.BootReceiver" for r in app.findall("receiver")):
            errors.append(f"{variant}: boot collection enabled")
        car_service = next((s for s in app.findall("service") if s.get(ANDROID + "name") == "com.example.obdapp.car.ObdCarAppService"), None)
        if car_service is None or car_service.get(ANDROID + "exported") != "true":
            errors.append(f"{variant}: projected service missing")

    legacy_count = 0
    for issue in ET.parse(lint_report).getroot().findall("issue"):
        if issue.get("severity") not in ("Error", "Fatal"):
            continue
        locations = issue.findall("location")
        legacy = issue.get("id") == "ExpiredTargetSdkVersion" and len(locations) == 1
        if legacy:
            loc = locations[0]
            source = Path(loc.get("file", "")).resolve()
            line = int(loc.get("line", "0"))
            legacy = source == (ROOT / "app/build.gradle.kts").resolve() and line > 0
            if legacy:
                lines = source.read_text().splitlines()
                legacy = line <= len(lines) and lines[line - 1].strip() == "targetSdk = 29"
        if legacy:
            legacy_count += 1
        else:
            errors.append(f"Lint {issue.get('id')}: {issue.get('message')}")
    if legacy_count > 1:
        errors.append("Unexpected additional legacy SDK findings")
    if errors:
        raise ValueError("\n".join(errors))
    print(f"Android Auto manifest and lint gate passed; {legacy_count} documented legacy target finding.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lint-report", type=Path, default=ROOT / "app/build/reports/lint-results-androidautoDebug.xml")
    args = parser.parse_args()
    try:
        check(args.lint_report)
    except (ValueError, OSError, ET.ParseError, AttributeError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
