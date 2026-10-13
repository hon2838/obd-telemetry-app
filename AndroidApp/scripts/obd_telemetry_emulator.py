#!/usr/bin/env python3
"""
OBD Telemetry Emulator for AndroidApp
Simulates vehicle CAN/OBD-2 sensor data and broadcasts live updates
to the Android app running on an emulator or physical head unit via ADB.

Action: com.example.obdapp.MOCK_TELEMETRY
"""

import argparse
import math
import subprocess
import sys
import time


def get_default_device() -> str:
    """Find the first available ADB device (preferring emulator-5554)."""
    try:
        res = subprocess.run(["adb", "devices"], capture_output=True, text=True, check=True)
        lines = [line.strip() for line in res.stdout.splitlines() if "\tdevice" in line]
        devices = [line.split("\t")[0] for line in lines]
        if not devices:
            print("❌ No ADB devices found. Ensure an emulator or device is connected.")
            sys.exit(1)
        if "emulator-5554" in devices:
            return "emulator-5554"
        return devices[0]
    except Exception as e:
        print(f"❌ Failed to run adb devices: {e}")
        sys.exit(1)


def broadcast_telemetry(device: str, telemetry: dict):
    """Broadcast telemetry dictionary to Android app via adb."""
    cmd = [
        "adb", "-s", device, "shell", "am", "broadcast",
        "-a", "com.example.obdapp.MOCK_TELEMETRY",
        "-p", "com.example.obdapp",
    ]
    
    if "speed" in telemetry:
        cmd += ["--ef", "speed", f"{telemetry['speed']:.1f}"]
    if "rpm" in telemetry:
        cmd += ["--ei", "rpm", str(int(telemetry["rpm"]))]
    if "coolant" in telemetry:
        cmd += ["--ei", "coolant", str(int(telemetry["coolant"]))]
    if "throttle" in telemetry:
        cmd += ["--ei", "throttle", str(int(telemetry["throttle"]))]
    if "load" in telemetry:
        cmd += ["--ei", "load", str(int(telemetry["load"]))]
    if "volt" in telemetry:
        cmd += ["--ef", "volt", f"{telemetry['volt']:.1f}"]
    if "iat" in telemetry:
        cmd += ["--ei", "iat", str(int(telemetry["iat"]))]
    if "map" in telemetry:
        cmd += ["--ei", "map", str(int(telemetry["map"]))]
    if "maf" in telemetry:
        cmd += ["--ef", "maf", f"{telemetry['maf']:.1f}"]
    if "fuel_status" in telemetry:
        cmd += ["--ei", "fuel_status", str(int(telemetry["fuel_status"]))]
    if "estimated_fuel_rate_lph" in telemetry:
        cmd += ["--ef", "estimated_fuel_rate_lph", f"{telemetry['estimated_fuel_rate_lph']:.2f}"]
    if "estimated_fuel_economy_kml" in telemetry:
        cmd += ["--ef", "estimated_fuel_economy_kml", f"{telemetry['estimated_fuel_economy_kml']:.2f}"]
    if "speed_source" in telemetry:
        cmd += ["--es", "speed_source", f"'{telemetry['speed_source']}'"]
    if "timestamp" in telemetry:
        cmd += ["--el", "timestamp", str(int(telemetry["timestamp"]))]

    res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0 and res.stderr:
        print(f"\n⚠️ Broadcast error: {res.stderr.strip()}", file=sys.stderr)


def run_simulation(device: str, profile: str, duration_sec: float, rate_hz: float):
    dt = 1.0 / rate_hz
    start_time = time.time()
    step = 0

    # Physics state
    speed = 0.0
    rpm = 800.0
    coolant = 75.0
    throttle = 0.0
    load = 20.0
    gear = 1
    volt = 14.2
    
    gear_ratios = [0.0, 3.8, 2.3, 1.5, 1.1, 0.85, 0.7]

    print(f"\n🚗 Starting OBD Telemetry Simulation")
    print(f"   Target Device:  {device}")
    print(f"   Profile:        {profile}")
    print(f"   Update Rate:    {rate_hz:.1f} Hz (dt={dt*1000:.1f} ms)")
    print(f"   Duration:       {duration_sec if duration_sec > 0 else 'Continuous'} sec")
    print("=" * 68)

    try:
        while True:
            elapsed = time.time() - start_time
            if duration_sec > 0 and elapsed >= duration_sec:
                break

            if profile == "dyno_pull":
                cycle = elapsed % 25.0
                if cycle < 16.0:  # Accelerating
                    throttle = min(100.0, 40.0 + (cycle / 16.0) * 60.0)
                    load = min(98.0, 35.0 + throttle * 0.6)
                    speed += (1.8 - speed * 0.007) * (throttle / 100.0)
                    speed = min(175.0, speed)
                    
                    if speed < 32.0:
                        gear = 1
                    elif speed < 65.0:
                        gear = 2
                    elif speed < 105.0:
                        gear = 3
                    elif speed < 145.0:
                        gear = 4
                    else:
                        gear = 5

                    gear_mult = gear_ratios[gear] * 42.0
                    rpm = 850.0 + speed * gear_mult
                    if rpm > 6800.0:
                        rpm = 6800.0
                else:  # Decelerating
                    throttle = 0.0
                    load = 18.0
                    speed = max(0.0, speed - 15.0 * dt * 4.0)
                    rpm = max(800.0, 800.0 + speed * 25.0)

            elif profile == "highway_cruise":
                throttle = 28.0 + 4.0 * math.sin(elapsed * 0.4)
                load = 32.0 + 6.0 * math.sin(elapsed * 0.3)
                speed = 112.0 + 6.0 * math.sin(elapsed * 0.2)
                rpm = 2350.0 + (speed - 110.0) * 35.0

            elif profile == "city_traffic":
                cycle = elapsed % 18.0
                if cycle < 7.0:
                    throttle = 35.0
                    load = 48.0
                    speed = min(55.0, speed + 1.2)
                    rpm = 1200.0 + speed * 45.0
                elif cycle < 12.0:
                    throttle = 15.0
                    load = 28.0
                    rpm = 1800.0
                else:
                    throttle = 0.0
                    load = 18.0
                    speed = max(0.0, speed - 2.0)
                    rpm = max(780.0, 780.0 + speed * 20.0)

            else:  # idle
                throttle = 0.0
                load = 19.0 + 1.5 * math.sin(elapsed)
                speed = 0.0
                rpm = 780.0 + 25.0 * math.sin(elapsed * 1.5)

            coolant = min(92.0, 75.0 + (elapsed * 0.5))
            volt = 14.1 + 0.15 * math.sin(elapsed * 0.5) - (0.1 if load > 70 else 0.0)
            iat = 28 + int(math.sin(elapsed * 0.05) * 4)
            map_kpa = int(32 + load * 0.8)
            maf_gs = max(2.5, (rpm / 800.0) * (load / 25.0) * 3.2)
            fuel_rate = max(0.8, maf_gs * 0.28)
            fuel_kml = (speed / fuel_rate) if fuel_rate > 0 and speed > 5 else 0.0

            data = {
                "speed": speed,
                "rpm": rpm,
                "coolant": coolant,
                "throttle": throttle,
                "load": load,
                "volt": volt,
                "iat": iat,
                "map": map_kpa,
                "maf": maf_gs,
                "fuel_status": 2,
                "estimated_fuel_rate_lph": fuel_rate,
                "estimated_fuel_economy_kml": fuel_kml,
                "speed_source": "OBD_EMU",
                "timestamp": int(time.time() * 1000),
            }

            broadcast_telemetry(device, data)
            step += 1

            sys.stdout.write(
                f"\r⏱ {elapsed:5.1f}s | Speed: {speed:5.1f} km/h | "
                f"RPM: {int(rpm):4d} | Throttle: {throttle:4.1f}% | "
                f"Load: {load:4.1f}% | Coolant: {coolant:4.1f}°C | "
                f"Volt: {volt:.2f}V"
            )
            sys.stdout.flush()

            time.sleep(dt)

    except KeyboardInterrupt:
        print("\n\nSimulation stopped by user.")

    print(f"\n✅ Simulation completed: {step} broadcasts sent.\n")


def main():
    parser = argparse.ArgumentParser(description="OBD Telemetry Emulator for AndroidApp")
    parser.add_argument("--device", "-d", default=None, help="ADB target device serial (e.g. emulator-5554)")
    parser.add_argument(
        "--profile", "-p",
        choices=["dyno_pull", "highway_cruise", "city_traffic", "idle"],
        default="dyno_pull",
        help="Driving simulation profile"
    )
    parser.add_argument("--duration", "-t", type=float, default=10.0, help="Duration in seconds (0 for infinite)")
    parser.add_argument("--rate", "-r", type=float, default=10.0, help="Broadcast rate in Hz (default: 10 Hz)")

    args = parser.parse_args()
    target_device = args.device or get_default_device()
    run_simulation(target_device, args.profile, args.duration, args.rate)


if __name__ == "__main__":
    main()
