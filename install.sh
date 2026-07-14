#!/usr/bin/env bash
# odoodev-gui installer for Linux (Debian/Ubuntu via .deb, other distros via AppImage)
# Usage: curl -fsSL https://raw.githubusercontent.com/equitania/odoodev-gui/main/install.sh | bash
set -euo pipefail

REPO_OWNER="equitania"
REPO_NAME="odoodev-gui"
INSTALLER_URL="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/install.sh"
RELEASES_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest"
DOWNLOAD_BASE_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest/download"
LATEST_JSON_URL="${DOWNLOAD_BASE_URL}/latest.json"
ICON_URL="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/src-tauri/icons/128x128.png"

APP_NAME="odoodev-gui"
APPIMAGE_INSTALL_DIR="${HOME}/.local/bin"
APPIMAGE_STATE_DIR="${HOME}/.local/share/${APP_NAME}"
APPIMAGE_VERSION_MARKER="${APPIMAGE_STATE_DIR}/version"
DESKTOP_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons/hicolor/128x128/apps"

TMP_DIR=""

if [[ -t 1 && -z "${NO_COLOR:-}" && "${TERM:-dumb}" != "dumb" ]]; then
  COLOR_INFO=$'\033[38;5;110m'
  COLOR_WARN=$'\033[38;5;214m'
  COLOR_ERROR=$'\033[38;5;203m'
  COLOR_SUCCESS=$'\033[38;5;78m'
  COLOR_ACCENT=$'\033[1;38;5;45m'
  COLOR_RESET=$'\033[0m'
else
  COLOR_INFO=""
  COLOR_WARN=""
  COLOR_ERROR=""
  COLOR_SUCCESS=""
  COLOR_ACCENT=""
  COLOR_RESET=""
fi

log_info() {
  printf '%s==>%s %s\n' "$COLOR_INFO" "$COLOR_RESET" "$*"
}

log_warn() {
  printf '%swarn:%s %s\n' "$COLOR_WARN" "$COLOR_RESET" "$*"
}

log_error() {
  printf '%serror:%s %s\n' "$COLOR_ERROR" "$COLOR_RESET" "$*" >&2
}

log_success() {
  printf '%s✓%s %s\n' "$COLOR_SUCCESS" "$COLOR_RESET" "$*"
}

section() {
  printf '\n%s%s%s\n' "$COLOR_ACCENT" "$*" "$COLOR_RESET"
}

fail() {
  log_error "$*"
  exit 1
}

print_usage() {
  cat <<EOF
odoodev-gui installer for Linux

Usage:
  curl -fsSL ${INSTALLER_URL} | bash
  ./install.sh [--help]

Debian/Ubuntu (apt-based): downloads the latest .deb and installs it via
apt-get, which resolves all runtime dependencies (webkit2gtk etc.).
Other Linux distros: installs the AppImage to ${APPIMAGE_INSTALL_DIR}
with a desktop entry — no root required.

Re-running the script updates an existing installation to the latest release.

macOS/Windows: not handled by this script — download the installer manually
from ${RELEASES_URL}
EOF
}

curl_get() {
  local url="$1"
  curl \
    --proto '=https' \
    --tlsv1.2 \
    --fail \
    --silent \
    --show-error \
    --location \
    --retry 3 \
    --retry-delay 1 \
    --connect-timeout 10 \
    --max-time 30 \
    "$url"
}

download_file() {
  local url="$1"
  local destination="$2"
  curl \
    --proto '=https' \
    --tlsv1.2 \
    --fail \
    --silent \
    --show-error \
    --location \
    --retry 3 \
    --retry-delay 1 \
    --connect-timeout 15 \
    --max-time 600 \
    --output "$destination" \
    "$url"
}

require_command() {
  local name="$1"
  command -v "$name" >/dev/null 2>&1 || fail "Missing required command: $name"
}

ensure_supported_platform() {
  case "$(uname -s 2>/dev/null || true)" in
    Linux)
      if grep -qi microsoft /proc/version 2>/dev/null; then
        log_warn "Running under WSL — this installs the Linux build."
        log_warn "For a native Windows install, download the .exe installer from ${RELEASES_URL}"
      fi
      ;;
    Darwin)
      log_info "macOS detected."
      log_info "macOS builds are not yet code-signed/notarized for scripted install."
      log_info "Please download the .dmg manually from ${RELEASES_URL}"
      exit 0
      ;;
    *)
      fail "Unsupported operating system. This installer supports Linux only. Downloads: ${RELEASES_URL}"
      ;;
  esac
}

ensure_supported_arch() {
  local arch
  arch="$(uname -m 2>/dev/null || true)"
  case "$arch" in
    x86_64|amd64)
      ;;
    *)
      fail "Unsupported CPU architecture '$arch'. Only x86_64 Linux builds are published (no arm64 yet). Downloads: ${RELEASES_URL}"
      ;;
  esac
}

get_latest_version() {
  local version
  version="$(curl_get "$LATEST_JSON_URL" \
    | grep -m1 '"version"' \
    | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"v?([^"]+)".*/\1/')" || true
  [[ -n "$version" ]] || fail "Unable to determine the latest release version from ${LATEST_JSON_URL}"
  printf '%s\n' "$version"
}

get_installed_version_deb() {
  dpkg-query -W -f='${Version}' "$APP_NAME" 2>/dev/null || true
}

get_installed_version_appimage() {
  cat "$APPIMAGE_VERSION_MARKER" 2>/dev/null || true
}

has_apt() {
  command -v apt-get >/dev/null 2>&1
}

install_via_apt() {
  local version="$1"
  local deb_name="${APP_NAME}_${version}_amd64.deb"
  local deb_url="${DOWNLOAD_BASE_URL}/${deb_name}"
  local -a apt_prefix=()

  if [[ "$(id -u)" -ne 0 ]]; then
    command -v sudo >/dev/null 2>&1 || fail \
      "Installing the .deb requires root privileges, but neither root nor sudo is available."
    apt_prefix=(sudo)
    log_info "Root privileges are required for apt-get — sudo may prompt for your password."
  fi

  section "Installing ${APP_NAME} ${version} (.deb via apt-get)"
  log_info "Downloading ${deb_name}"
  download_file "$deb_url" "${TMP_DIR}/${deb_name}"

  log_info "Installing with apt-get (resolves runtime dependencies automatically)"
  "${apt_prefix[@]}" apt-get install -y "${TMP_DIR}/${deb_name}"

  log_success "${APP_NAME} ${version} installed"
  log_info "Launch it from your application menu or run: ${APP_NAME}"
}

libfuse_hint() {
  if command -v dnf >/dev/null 2>&1; then
    printf 'sudo dnf install fuse-libs\n'
  elif command -v zypper >/dev/null 2>&1; then
    printf 'sudo zypper install libfuse2\n'
  elif command -v pacman >/dev/null 2>&1; then
    printf 'sudo pacman -S fuse2\n'
  elif command -v apk >/dev/null 2>&1; then
    printf 'sudo apk add fuse\n'
  else
    printf 'install the libfuse2 package with your package manager\n'
  fi
}

check_libfuse2() {
  if ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; then
    return 0
  fi
  log_warn "libfuse2 was not found — AppImages need it to run directly."
  log_warn "Install it with: $(libfuse_hint)"
  log_warn "Alternatively run the app with: ${APP_NAME} --appimage-extract-and-run"
}

write_desktop_entry() {
  mkdir -p "$DESKTOP_DIR"
  cat >"${DESKTOP_DIR}/${APP_NAME}.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=odoodev-gui
Comment=Desktop GUI for the odoodev Odoo development CLI
Exec=${APPIMAGE_INSTALL_DIR}/${APP_NAME} %U
Icon=${APP_NAME}
Terminal=false
Categories=Development;
EOF
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
  fi
}

install_appimage() {
  local version="$1"
  local appimage_name="${APP_NAME}_${version}_amd64.AppImage"
  local appimage_url="${DOWNLOAD_BASE_URL}/${appimage_name}"

  section "Installing ${APP_NAME} ${version} (AppImage, user-local)"
  mkdir -p "$APPIMAGE_INSTALL_DIR" "$APPIMAGE_STATE_DIR" "$ICON_DIR"

  log_info "Downloading ${appimage_name}"
  download_file "$appimage_url" "${TMP_DIR}/${appimage_name}"
  install -m 755 "${TMP_DIR}/${appimage_name}" "${APPIMAGE_INSTALL_DIR}/${APP_NAME}"

  # Icon is cosmetic — never block the install on it
  download_file "$ICON_URL" "${ICON_DIR}/${APP_NAME}.png" 2>/dev/null || \
    log_warn "Could not download the application icon (install continues)."

  write_desktop_entry
  printf '%s\n' "$version" >"$APPIMAGE_VERSION_MARKER"

  log_success "${APP_NAME} ${version} installed to ${APPIMAGE_INSTALL_DIR}/${APP_NAME}"
  log_info "Launch it from your application menu or run: ${APPIMAGE_INSTALL_DIR}/${APP_NAME}"
  case ":$PATH:" in
    *":${APPIMAGE_INSTALL_DIR}:"*) ;;
    *) log_warn "${APPIMAGE_INSTALL_DIR} is not on your PATH — add it to launch '${APP_NAME}' by name." ;;
  esac
}

main() {
  case "${1:-}" in
    -h|--help)
      print_usage
      exit 0
      ;;
    "")
      ;;
    *)
      fail "Unknown argument: $1 (use --help)"
      ;;
  esac

  ensure_supported_platform
  ensure_supported_arch
  require_command curl

  section "Checking latest ${APP_NAME} release"
  local latest installed
  latest="$(get_latest_version)"
  log_info "Latest release: ${latest}"

  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT

  if has_apt; then
    installed="$(get_installed_version_deb)"
    if [[ -n "$installed" && "$installed" == "$latest" ]]; then
      log_success "${APP_NAME} ${installed} is already up to date"
      exit 0
    fi
    if [[ -n "$installed" ]]; then
      log_info "Updating from ${installed}"
    fi
    install_via_apt "$latest"
  else
    installed="$(get_installed_version_appimage)"
    if [[ -n "$installed" && "$installed" == "$latest" ]]; then
      log_success "${APP_NAME} ${installed} is already up to date"
      exit 0
    fi
    if [[ -n "$installed" ]]; then
      log_info "Updating from ${installed}"
    fi
    check_libfuse2
    install_appimage "$latest"
  fi
}

main "$@"
