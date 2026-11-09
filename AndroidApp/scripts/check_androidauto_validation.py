"""Gate phone manifests and lint without hiding new errors behind legacy lint policy."""
import argparse
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ANDROID = "{http://schemas.android.com/apk/res/android}"


def check(lint_report, personal_lint_report):
    errors = []
    flavors = (
        ("androidauto", "com.example.obdapp.androidauto", "ObdCarAppService", "IOT"),
        ("androidautopersonal", "com.example.obdapp.androidauto.personal", "PersonalCarAppService", "NAVIGATION"),
    )
    for flavor, package, service, category in flavors:
        for variant in ("Debug", "Release"):
            task_flavor = flavor[0].upper() + flavor[1:]
            manifest = ROOT / f"app/build/intermediates/merged_manifests/{flavor}{variant}/process{task_flavor}{variant}Manifest/AndroidManifest.xml"
            root = ET.parse(manifest).getroot()
            sdk = root.find("uses-sdk")
            app = root.find("application")
            label = f"{flavor}{variant}"
            if root.get("package") != package or sdk.get(ANDROID + "targetSdkVersion") != "36":
                errors.append(f"{label}: wrong phone package or target SDK")
            if variant == "Release" and app.get(ANDROID + "debuggable", "false") != "false":
                errors.append(f"{label}: debuggable release")
            if app.get(ANDROID + "allowBackup") != "false":
                errors.append(f"{label}: app data backup enabled")
            permissions = {p.get(ANDROID + "name") for p in root.findall("uses-permission")}
            if "android.permission.ACCESS_BACKGROUND_LOCATION" in permissions:
                errors.append(f"{label}: background location enabled")
            if any(r.get(ANDROID + "name") == "com.example.obdapp.BootReceiver" for r in app.findall("receiver")):
                errors.append(f"{label}: boot collection enabled")
            car_service = next((s for s in app.findall("service") if s.get(ANDROID + "name") == f"com.example.obdapp.car.{service}"), None)
            if car_service is None or car_service.get(ANDROID + "exported") != "true":
                errors.append(f"{label}: projected service missing")
            else:
                categories = {c.get(ANDROID + "name") for f in car_service.findall("intent-filter") for c in f.findall("category")}
                if categories != {f"androidx.car.app.category.{category}"}:
                    errors.append(f"{label}: incorrect car category")
            surface_permissions = {"androidx.car.app.ACCESS_SURFACE", "androidx.car.app.NAVIGATION_TEMPLATES"}
            if flavor == "androidautopersonal" and not surface_permissions <= permissions:
                errors.append(f"{label}: personal surface permissions missing")
            if flavor == "androidauto" and surface_permissions & permissions:
                errors.append(f"{label}: personal-only surface permission leaked into standard projection")

    legacy_total = 0
    for report in (lint_report, personal_lint_report):
        legacy_count = 0
        for issue in ET.parse(report).getroot().findall("issue"):
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
                errors.append(f"{report.name}: Lint {issue.get('id')}: {issue.get('message')}")
        if legacy_count > 1:
            errors.append(f"{report.name}: unexpected additional legacy SDK findings")
        legacy_total += legacy_count
    if errors:
        raise ValueError("\n".join(errors))
    print(f"Both Android Auto flavors passed manifest/lint validation; {legacy_total} documented legacy findings across two reports.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lint-report", type=Path, default=ROOT / "app/build/reports/lint-results-androidautoDebug.xml")
    parser.add_argument("--personal-lint-report", type=Path, default=ROOT / "app/build/reports/lint-results-androidautopersonalDebug.xml")
    args = parser.parse_args()
    try:
        check(args.lint_report, args.personal_lint_report)
    except (ValueError, OSError, ET.ParseError, AttributeError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
