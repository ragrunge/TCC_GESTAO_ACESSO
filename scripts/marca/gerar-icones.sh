#!/usr/bin/env bash
# Gera os ícones do sistema de Gestão de Acesso (símbolo 1b · Portal, vindo do Claude Design) a partir dos SVGs desta pasta.
# Requer rsvg-convert (brew install librsvg) e python3. Rodar da raiz do monorepo: bash scripts/marca/gerar-icones.sh
set -euo pipefail
cd "$(dirname "$0")"
WEB=../../apps/web/public
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

ARCO='<path d="M9.5 24.5V15a6.5 6.5 0 0 1 13 0v9.5" fill="none" stroke="#FFFFFF" stroke-width="3.2" stroke-linecap="round"/><circle cx="16" cy="19.5" r="2.8" fill="#A9D2D8"/>'

# Favicon SVG.
cp simbolo-32.svg "$WEB/favicon.svg"

# Ícone "any" do PWA: o símbolo com cantos arredondados e fundo transparente.
rsvg-convert -w 192 -h 192 simbolo-32.svg -o "$WEB/icon-192.png"
rsvg-convert -w 512 -h 512 simbolo-32.svg -o "$WEB/icon-512.png"

# Maskable e apple-touch: fundo cheio (o sistema aplica a máscara) e desenho a 80%, dentro da zona segura.
echo "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><rect width=\"32\" height=\"32\" fill=\"#0B5563\"/><g transform=\"translate(16 16) scale(0.8) translate(-16 -16)\">$ARCO</g></svg>" > "$TMP/cheio.svg"
rsvg-convert -w 192 -h 192 -b '#0B5563' "$TMP/cheio.svg" -o "$WEB/icon-maskable-192.png"
rsvg-convert -w 512 -h 512 -b '#0B5563' "$TMP/cheio.svg" -o "$WEB/icon-maskable-512.png"
rsvg-convert -w 180 -h 180 -b '#0B5563' "$TMP/cheio.svg" -o "$WEB/apple-touch-icon.png"

# favicon.ico: camada de 16 com a variante desenhada na grade de 16 e camada de 32 com o símbolo normal.
rsvg-convert -w 16 -h 16 simbolo-16.svg -o "$TMP/16.png"
rsvg-convert -w 32 -h 32 simbolo-32.svg -o "$TMP/32.png"
python3 - "$TMP/16.png" "$TMP/32.png" "$WEB/favicon.ico" <<'PY'
import struct, sys
pngs = [open(p, 'rb').read() for p in sys.argv[1:3]]
cab = struct.pack('<HHH', 0, 1, len(pngs))
desloc = 6 + 16 * len(pngs); dirs = b''
for tam, dado in zip((16, 32), pngs):
    dirs += struct.pack('<BBBBHHII', tam, tam, 0, 0, 1, 32, len(dado), desloc); desloc += len(dado)
open(sys.argv[3], 'wb').write(cab + dirs + b''.join(pngs))
PY

# Imagem de compartilhamento (Open Graph).
rsvg-convert -w 1200 -h 630 og-image.svg -o "$WEB/og-image.png"
echo "ícones gerados"
