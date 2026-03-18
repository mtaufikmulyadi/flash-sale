"""
Flash Sale — One-click Docker + Redis setup for Windows
--------------------------------------------------------
Run with:  python setup.py
Requires:  Python 3.8+ (built-in on most Windows machines)
           Run as normal user — script will self-elevate if needed
"""

import subprocess
import sys
import os
import time
import urllib.request
import ctypes
import platform
import json
from pathlib import Path


# ----------------------------------------------------------------
# Colours for terminal output (Windows 10+ supports ANSI)
# ----------------------------------------------------------------
os.system("")  # enable ANSI codes on Windows

RESET  = "\033[0m"
BOLD   = "\033[1m"
GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"
CYAN   = "\033[96m"
DIM    = "\033[2m"

def ok(msg):    print(f"  {GREEN}✓{RESET}  {msg}")
def info(msg):  print(f"  {CYAN}→{RESET}  {msg}")
def warn(msg):  print(f"  {YELLOW}!{RESET}  {msg}")
def err(msg):   print(f"  {RED}✗{RESET}  {msg}")
def step(msg):  print(f"\n{BOLD}{msg}{RESET}")
def dim(msg):   print(f"  {DIM}{msg}{RESET}")


# ----------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------

def run(cmd: list[str], capture=True, timeout=30) -> subprocess.CompletedProcess:
    """Run a command, return the result. Never raises — check .returncode."""
    try:
        return subprocess.run(
            cmd,
            capture_output=capture,
            text=True,
            timeout=timeout,
        )
    except FileNotFoundError:
        r = subprocess.CompletedProcess(cmd, returncode=1)
        r.stdout = ""
        r.stderr = "command not found"
        return r
    except subprocess.TimeoutExpired:
        r = subprocess.CompletedProcess(cmd, returncode=1)
        r.stdout = ""
        r.stderr = "timed out"
        return r


def is_windows() -> bool:
    return platform.system() == "Windows"


def is_admin() -> bool:
    try:
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except Exception:
        return False


def elevate_if_needed():
    """Re-launch the script with admin rights if not already elevated."""
    if is_windows() and not is_admin():
        warn("Requesting admin rights to install Docker...")
        # Re-run this script elevated
        ctypes.windll.shell32.ShellExecuteW(
            None, "runas", sys.executable, " ".join(sys.argv), None, 1
        )
        sys.exit(0)


def wait_with_dots(message: str, seconds: int):
    print(f"  {CYAN}→{RESET}  {message}", end="", flush=True)
    for _ in range(seconds):
        time.sleep(1)
        print(".", end="", flush=True)
    print()


# ----------------------------------------------------------------
# Step 1 — Check Python version
# ----------------------------------------------------------------

def check_python():
    step("Step 1 — Checking Python version")
    version = sys.version_info
    if version.major < 3 or (version.major == 3 and version.minor < 8):
        err(f"Python 3.8+ required. You have {version.major}.{version.minor}")
        err("Download from https://python.org")
        sys.exit(1)
    ok(f"Python {version.major}.{version.minor}.{version.micro}")


# ----------------------------------------------------------------
# Step 2 — Check / install Docker
# ----------------------------------------------------------------

DOCKER_INSTALLER_URL = (
    "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe"
)
DOCKER_INSTALLER_PATH = Path(os.environ.get("TEMP", "C:\\Temp")) / "DockerDesktopInstaller.exe"


def is_docker_installed() -> bool:
    r = run(["docker", "--version"])
    return r.returncode == 0


def is_docker_running() -> bool:
    r = run(["docker", "info"])
    return r.returncode == 0


def download_docker():
    info("Downloading Docker Desktop (~600 MB) — this may take a few minutes...")
    def progress(block, block_size, total):
        downloaded = block * block_size
        if total > 0:
            pct = min(100, downloaded * 100 // total)
            mb  = downloaded // (1024 * 1024)
            print(f"\r  {CYAN}→{RESET}  {pct}% ({mb} MB)", end="", flush=True)

    try:
        urllib.request.urlretrieve(DOCKER_INSTALLER_URL, DOCKER_INSTALLER_PATH, progress)
        print()  # newline after progress
        ok("Download complete")
    except Exception as e:
        print()
        err(f"Download failed: {e}")
        err("Please download manually: https://www.docker.com/products/docker-desktop/")
        sys.exit(1)


def install_docker():
    info("Running Docker Desktop installer (silent install)...")
    info("This will take 2–5 minutes. Please wait...")
    r = run(
        [str(DOCKER_INSTALLER_PATH), "install", "--quiet", "--accept-license"],
        capture=False,
        timeout=600,
    )
    if r.returncode != 0:
        err("Docker installer exited with an error.")
        err("Try installing manually: https://www.docker.com/products/docker-desktop/")
        sys.exit(1)
    ok("Docker Desktop installed")


def check_docker():
    step("Step 2 — Checking Docker")

    if is_docker_installed():
        r = run(["docker", "--version"])
        ok(f"Docker already installed — {r.stdout.strip()}")
    else:
        warn("Docker not found. Installing Docker Desktop...")

        if is_windows():
            elevate_if_needed()
            download_docker()
            install_docker()

            print()
            warn("Docker Desktop was just installed.")
            warn("Please do the following:")
            print()
            print(f"  {BOLD}1. Open Docker Desktop from the Start Menu{RESET}")
            print(f"  {BOLD}2. Wait until you see 'Engine running' in the bottom left{RESET}")
            print(f"  {BOLD}3. Re-run this script: python setup.py{RESET}")
            print()
            input("  Press Enter once Docker Desktop is open and running...")
        else:
            err("Auto-install only supported on Windows.")
            err("Please install Docker from: https://docs.docker.com/get-docker/")
            sys.exit(1)

    # Check engine is actually running
    info("Checking Docker engine is running...")
    attempts = 0
    while not is_docker_running():
        attempts += 1
        if attempts == 1:
            warn("Docker engine is not running yet.")
            warn("Please open Docker Desktop and wait for it to start.")
            print()
        if attempts > 12:
            err("Docker engine still not running after 60 seconds.")
            err("Open Docker Desktop, wait for 'Engine running', then re-run this script.")
            sys.exit(1)
        wait_with_dots("  Waiting for Docker engine", 5)

    ok("Docker engine is running")


# ----------------------------------------------------------------
# Step 3 — Pull Redis image
# ----------------------------------------------------------------

def is_redis_image_pulled() -> bool:
    r = run(["docker", "images", "-q", "redis:alpine"])
    return r.returncode == 0 and r.stdout.strip() != ""


def check_redis_image():
    step("Step 3 — Redis Docker image")

    if is_redis_image_pulled():
        ok("redis:alpine image already downloaded")
        return

    info("Pulling redis:alpine image (~10 MB)...")
    r = run(["docker", "pull", "redis:alpine"], capture=False, timeout=120)
    if r.returncode != 0:
        err("Failed to pull Redis image. Check your internet connection.")
        sys.exit(1)
    ok("redis:alpine image downloaded")


# ----------------------------------------------------------------
# Step 4 — Create / start the Redis container
# ----------------------------------------------------------------

CONTAINER_NAME = "flash-sale-redis"
REDIS_PORT     = 6379


def container_exists() -> bool:
    r = run(["docker", "ps", "-a", "--filter", f"name={CONTAINER_NAME}", "--format", "{{.Names}}"])
    return CONTAINER_NAME in (r.stdout or "")


def container_running() -> bool:
    r = run(["docker", "ps", "--filter", f"name={CONTAINER_NAME}", "--format", "{{.Names}}"])
    return CONTAINER_NAME in (r.stdout or "")


def create_container():
    info(f"Creating container '{CONTAINER_NAME}' on port {REDIS_PORT}...")
    r = run([
        "docker", "run",
        "-d",
        "--name", CONTAINER_NAME,
        "-p", f"{REDIS_PORT}:{REDIS_PORT}",
        "--restart", "unless-stopped",   # auto-start on Docker Desktop launch
        "redis:alpine",
    ])
    if r.returncode != 0:
        err(f"Failed to create container: {r.stderr.strip()}")
        sys.exit(1)
    ok(f"Container '{CONTAINER_NAME}' created")


def start_container():
    info(f"Starting existing container '{CONTAINER_NAME}'...")
    r = run(["docker", "start", CONTAINER_NAME])
    if r.returncode != 0:
        err(f"Failed to start container: {r.stderr.strip()}")
        sys.exit(1)
    ok(f"Container '{CONTAINER_NAME}' started")


def setup_redis_container():
    step("Step 4 — Redis container")

    if container_running():
        ok(f"Container '{CONTAINER_NAME}' is already running")
        return

    if container_exists():
        warn(f"Container '{CONTAINER_NAME}' exists but is stopped — starting it...")
        start_container()
    else:
        create_container()

    # Give Redis a moment to initialise
    time.sleep(1)


# ----------------------------------------------------------------
# Step 5 — Verify with PING
# ----------------------------------------------------------------

def verify_redis():
    step("Step 5 — Verifying Redis connection")

    info("Sending PING to Redis...")
    attempts = 0
    while True:
        r = run(["docker", "exec", CONTAINER_NAME, "redis-cli", "ping"])
        if r.returncode == 0 and "PONG" in r.stdout:
            ok(f"Redis replied: {r.stdout.strip()}")
            return
        attempts += 1
        if attempts >= 5:
            err("Redis is not responding after multiple attempts.")
            err(f"Check container logs: docker logs {CONTAINER_NAME}")
            sys.exit(1)
        wait_with_dots("Waiting for Redis to be ready", 2)


# ----------------------------------------------------------------
# Step 6 — Print .env reminder
# ----------------------------------------------------------------

def print_env_reminder():
    step("Step 6 — Environment config")

    env_path = Path(".env")
    if env_path.exists():
        ok(".env file already exists — no changes needed")
    else:
        example = Path(".env.example")
        if example.exists():
            import shutil
            shutil.copy(".env.example", ".env")
            ok(".env created from .env.example")
        else:
            warn(".env.example not found — make sure you're in the flash-sale project folder")

    dim(f"REDIS_HOST=127.0.0.1  (already correct for Docker)")
    dim(f"REDIS_PORT=6379        (already correct for Docker)")


# ----------------------------------------------------------------
# Summary
# ----------------------------------------------------------------

def print_summary():
    print()
    print(f"  {'─' * 52}")
    print(f"  {BOLD}{GREEN}Everything is ready!{RESET}")
    print(f"  {'─' * 52}")
    print()
    print(f"  {GREEN}✓{RESET}  Docker Desktop    running")
    print(f"  {GREEN}✓{RESET}  Redis container   {CONTAINER_NAME} → port {REDIS_PORT}")
    print(f"  {GREEN}✓{RESET}  Connection        PONG confirmed")
    print()
    print(f"  {BOLD}Next steps:{RESET}")
    print()
    print(f"  {CYAN}1.{RESET} cd flash-sale")
    print(f"  {CYAN}2.{RESET} npm install")
    print(f"  {CYAN}3.{RESET} npm run test:unit")
    print()
    print(f"  {DIM}To stop Redis:   docker stop {CONTAINER_NAME}{RESET}")
    print(f"  {DIM}To start again:  docker start {CONTAINER_NAME}{RESET}")
    print(f"  {DIM}To open CLI:     docker exec -it {CONTAINER_NAME} redis-cli{RESET}")
    print()


# ----------------------------------------------------------------
# Main
# ----------------------------------------------------------------

def main():
    print()
    print(f"  {BOLD}Flash Sale — Redis Setup{RESET}")
    print(f"  {DIM}Windows · Docker · Redis Alpine{RESET}")
    print()

    if not is_windows():
        warn("This script is designed for Windows.")
        warn("On macOS: brew install redis && brew services start redis")
        warn("On Linux: sudo apt install redis-server")
        print()

    check_python()
    check_docker()
    check_redis_image()
    setup_redis_container()
    verify_redis()
    print_env_reminder()
    print_summary()

    input("  Press Enter to exit...")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
        warn("Setup cancelled.")
        sys.exit(0)
