#!/usr/bin/env bash
# ============================================================================
# Build Hyve Validator Dashboard desktop app (.deb + .AppImage)
# ============================================================================
#
# Prerequisites:
#   - Node.js 18+ and npm
#   - On Ubuntu: sudo apt install dpkg fakeroot
#
# Usage:
#   cd desktop/
#   ./build.sh          # builds both .deb and .AppImage
#   ./build.sh deb      # builds only .deb
#   ./build.sh appimage # builds only .AppImage
#
# Output:
#   desktop/dist/hyve-validator-dashboard_1.0.0_amd64.deb
#   desktop/dist/Hyve Validator Dashboard-1.0.0.AppImage
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

TARGET="${1:-all}"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║   Building Hyve Validator Dashboard Desktop App  ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
    echo "✗ Node.js not found. Install with:"
    echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
    echo "  sudo apt install nodejs"
    exit 1
fi
echo "✓ Node.js $(node --version)"

# Check npm
if ! command -v npm &>/dev/null; then
    echo "✗ npm not found."
    exit 1
fi
echo "✓ npm $(npm --version)"

# Create minimal tray icon if missing
if [[ ! -d "$SCRIPT_DIR/assets" ]]; then
    mkdir -p "$SCRIPT_DIR/assets"
fi
if [[ ! -f "$SCRIPT_DIR/assets/icon.png" ]]; then
    echo "⚠ No icon.png found — generating placeholder..."
    # Generate a simple 256x256 green circle icon using Python
    python3 -c "
import struct, zlib, io

def create_png(width, height):
    def chunk(ctype, data):
        c = ctype + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    raw = b''
    cx, cy, r = width//2, height//2, width//2 - 4
    for y in range(height):
        raw += b'\x00'  # filter none
        for x in range(width):
            dx, dy = x - cx, y - cy
            if dx*dx + dy*dy <= r*r:
                raw += b'\x3f\xb9\x50\xff'  # green
            elif dx*dx + dy*dy <= (r+2)*(r+2):
                raw += b'\x21\x26\x2d\xff'  # border
            else:
                raw += b'\x00\x00\x00\x00'  # transparent
    return (b'\x89PNG\r\n\x1a\n' +
            chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(raw)) +
            chunk(b'IEND', b''))
with open('assets/icon.png', 'wb') as f:
    f.write(create_png(256, 256))
print('  Generated placeholder icon (256x256 green circle)')
" 2>/dev/null || echo "  Could not generate icon (non-critical)"
fi

# Install dependencies
echo ""
echo "Installing npm dependencies..."
npm install

# Build
echo ""
case "$TARGET" in
    deb)
        echo "Building .deb package..."
        npx electron-builder --linux deb
        ;;
    appimage)
        echo "Building AppImage..."
        npx electron-builder --linux AppImage
        ;;
    all|*)
        echo "Building .deb and AppImage..."
        npx electron-builder --linux deb AppImage
        ;;
esac

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║                 Build Complete!                  ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Output files:"
ls -lh dist/*.deb dist/*.AppImage 2>/dev/null || echo "  (check dist/ directory)"
echo ""
echo "Install .deb:       sudo dpkg -i dist/*.deb"
echo "Run AppImage:       chmod +x dist/*.AppImage && ./dist/*.AppImage"
echo ""
