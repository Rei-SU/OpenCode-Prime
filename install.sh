#!/usr/bin/env bash
set -euo pipefail

APP=opencode-prime
REPO="${OPENCODE_PRIME_REPO:-Rei-SU/OpenCode-Prime}"
VERSION="${VERSION:-}"
TAG="${OPENCODE_PRIME_TAG:-}"

RED='\033[0;31m'
GREEN='\033[0;32m'
MUTED='\033[0;2m'
NC='\033[0m'

usage() {
    cat <<EOF
OpenCode-Prime Installer

Usage: install.sh [options]

Options:
    -h, --help              Display this help message
    -r, --repo <repo>       GitHub repository to download from (default: $REPO)
    -v, --version <version> Install a specific release version (default: latest)
    -t, --tag <tag>         Exact release tag to download (overrides --version)

Examples:
    curl -fsSL https://raw.githubusercontent.com/Rei-SU/OpenCode-Prime/dev/install.sh | bash
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        -r|--repo)
            [[ -n "${2:-}" ]] && { REPO="$2"; shift 2; } || { echo -e "${RED}Error: --repo requires a value${NC}"; exit 1; }
            ;;
        -v|--version)
            [[ -n "${2:-}" ]] && { VERSION="${2#v}"; shift 2; } || { echo -e "${RED}Error: --version requires a value${NC}"; exit 1; }
            ;;
        -t|--tag)
            [[ -n "${2:-}" ]] && { TAG="$2"; shift 2; } || { echo -e "${RED}Error: --tag requires a value${NC}"; exit 1; }
            ;;
        *)
            echo -e "${RED}Error: Unknown option '$1'${NC}" >&2
            exit 1
            ;;
    esac
done

# --- Detect platform ---------------------------------------------------------
raw_os=$(uname -s)
case "$raw_os" in
    Darwin*) os="darwin" ;;
    Linux*) os="linux" ;;
    MINGW*|MSYS*|CYGWIN*) os="windows" ;;
    *) echo -e "${RED}Unsupported OS: $raw_os${NC}"; exit 1 ;;
esac

arch=$(uname -m)
case "$arch" in
    x86_64|amd64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) echo -e "${RED}Unsupported architecture: $arch${NC}"; exit 1 ;;
esac

# Rosetta translates x64 binaries on Apple Silicon; prefer the native arm64 build.
if [[ "$os" == "darwin" && "$arch" == "x64" ]]; then
    rosetta=$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)
    if [[ "$rosetta" == "1" ]]; then
        arch="arm64"
    fi
fi

if [[ "$os" == "windows" ]]; then
    echo -e "${RED}This script is for Linux/macOS. On Windows use:${NC}"
    echo -e "  irm https://raw.githubusercontent.com/Rei-SU/OpenCode-Prime/dev/install.ps1 | iex"
    exit 1
fi

archive_ext=".tar.gz"
if [[ "$os" == "darwin" ]]; then
    archive_ext=".zip"
fi

artifact="${APP}-${os}-${arch}${archive_ext}"
if [[ -n "$TAG" ]]; then
    url="https://github.com/${REPO}/releases/download/${TAG}/${artifact}"
elif [[ -n "$VERSION" ]]; then
    url="https://github.com/${REPO}/releases/download/v${VERSION}/${artifact}"
else
    url="https://github.com/${REPO}/releases/latest/download/${artifact}"
fi

INSTALL_DIR="$HOME/.opencode-prime/bin"
mkdir -p "$INSTALL_DIR"

# --- Download ---------------------------------------------------------------
echo -e "${MUTED}Downloading ${APP}${NC}"
tmp_dir="${TMPDIR:-/tmp}/opencode-prime_install_$$"
mkdir -p "$tmp_dir"
trap 'rm -rf "$tmp_dir"' EXIT

if ! curl -fSL --progress-bar -o "$tmp_dir/$artifact" "$url"; then
    echo -e "${RED}Failed to download ${url}${NC}"
    echo -e "${MUTED}Make sure the release exists: https://github.com/${REPO}/releases/tag/${TAG}${NC}"
    exit 1
fi

if [[ "$archive_ext" == ".tar.gz" ]]; then
    tar -xzf "$tmp_dir/$artifact" -C "$tmp_dir"
else
    unzip -q "$tmp_dir/$artifact" -d "$tmp_dir"
fi

bin_file=$(find "$tmp_dir" -type f -name "$APP" -print -quit)
if [[ -z "$bin_file" ]]; then
    echo -e "${RED}Archive did not contain the $APP binary${NC}"
    exit 1
fi

mv "$bin_file" "$INSTALL_DIR/$APP"
chmod 755 "$INSTALL_DIR/$APP"

# --- Verify -----------------------------------------------------------------
if ! "$INSTALL_DIR/$APP" --version >/dev/null 2>&1; then
    echo -e "${RED}Installed binary failed to run.${NC}"
    exit 1
fi

# --- PATH -------------------------------------------------------------------
if [[ ":$PATH:" == *":$INSTALL_DIR:"* ]]; then
    : # already on PATH
elif [[ -n "${GITHUB_ACTIONS-}" && "${GITHUB_ACTIONS}" == "true" ]]; then
    echo "$INSTALL_DIR" >> "$GITHUB_PATH"
else
    current_shell=$(basename "${SHELL:-}")
    case "$current_shell" in
        fish)
            line="fish_add_path $INSTALL_DIR"
            file="$HOME/.config/fish/config.fish"
            ;;
        zsh)
            line="export PATH=\"$INSTALL_DIR:\$PATH\""
            file="${ZDOTDIR:-$HOME}/.zshrc"
            ;;
        *)
            line="export PATH=\"$INSTALL_DIR:\$PATH\""
            file="$HOME/.bashrc"
            ;;
    esac
    if [[ -w "$file" ]] && ! grep -Fq "$line" "$file" 2>/dev/null; then
        echo "" >> "$file"
        echo "# opencode-prime" >> "$file"
        echo "$line" >> "$file"
        echo -e "${MUTED}Added opencode-prime to \$PATH in $file${NC}"
    else
        echo -e "${MUTED}Add opencode-prime to your PATH:${NC}"
        echo -e "  export PATH=\"$INSTALL_DIR:\$PATH\""
    fi
fi

export PATH="$INSTALL_DIR:$PATH"

# --- Success ----------------------------------------------------------------
version_output=$("$INSTALL_DIR/$APP" --version 2>&1)

echo -e ""
echo -e "${GREEN}✅ OpenCode-Prime installed successfully!${NC}"
echo -e ""
echo -e "Version:"
echo -e "${version_output}"
echo -e ""
echo -e "Repository:"
echo -e "https://github.com/${REPO}"
echo -e ""
echo -e "Run:"
echo -e ""
echo -e "opencode-prime"
echo -e ""
