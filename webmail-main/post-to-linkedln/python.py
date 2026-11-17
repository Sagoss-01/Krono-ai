#!/usr/bin/env python3
"""
Génère toutes les icônes PWA nécessaires depuis public/logo.png
Usage : python3 generate_icons.py
Dépendance : pip install Pillow
"""

from PIL import Image, ImageDraw
import os

SRC     = "public/logo.png"
OUT_DIR = "public"
# Couleur de fond (identique à background_color dans manifest.json)
BG_COLOR = (6, 13, 26)      # #060d1a

def make_square_canvas(img, size, bg=BG_COLOR):
    """Centre le logo sur un carré avec fond coloré."""
    canvas = Image.new("RGBA", (size, size), (*bg, 255))
    # Calculer le ratio pour que le logo occupe ~70% du canvas
    ratio  = (size * 0.70) / max(img.width, img.height)
    new_w  = int(img.width  * ratio)
    new_h  = int(img.height * ratio)
    resized = img.resize((new_w, new_h), Image.LANCZOS)
    x = (size - new_w) // 2
    y = (size - new_h) // 2
    # Gérer la transparence si le logo a un canal alpha
    if resized.mode == "RGBA":
        canvas.paste(resized, (x, y), resized)
    else:
        canvas.paste(resized, (x, y))
    return canvas

def make_maskable(img, size, bg=BG_COLOR):
    """
    Icône maskable : logo centré dans la zone safe (80% du canvas).
    Le fond couvre tout le carré pour que le masque ne coupe rien d'important.
    """
    canvas = Image.new("RGBA", (size, size), (*bg, 255))
    safe   = int(size * 0.80)
    ratio  = (safe * 0.70) / max(img.width, img.height)
    new_w  = int(img.width  * ratio)
    new_h  = int(img.height * ratio)
    resized = img.resize((new_w, new_h), Image.LANCZOS)
    x = (size - new_w) // 2
    y = (size - new_h) // 2
    if resized.mode == "RGBA":
        canvas.paste(resized, (x, y), resized)
    else:
        canvas.paste(resized, (x, y))
    return canvas

def save_png(img, path):
    # Convertir en RGB si pas besoin de transparence (favicon/maskable)
    final = img.convert("RGBA")
    final.save(path, "PNG", optimize=True)
    kb = os.path.getsize(path) // 1024
    print(f"  ✓ {path}  ({img.size[0]}x{img.size[1]}px, {kb} KB)")

def main():
    if not os.path.exists(SRC):
        print(f"❌ Fichier source introuvable : {SRC}")
        print("   Lance ce script depuis la racine du projet.")
        return

    src = Image.open(SRC).convert("RGBA")
    print(f"Source : {SRC}  {src.size[0]}x{src.size[1]}px\n")

    icons = [
        # (fichier, taille, type)
        ("logo-192.png",      192, "normal"),
        ("logo-512.png",      512, "normal"),
        ("logo.png",          512, "normal"),          # remplace l'original
        ("logo-maskable.png", 512, "maskable"),
        ("logo-no-bg.png",    512, "no-bg"),
    ]

    for filename, size, kind in icons:
        out_path = os.path.join(OUT_DIR, filename)
        if kind == "maskable":
            img = make_maskable(src, size)
        elif kind == "no-bg":
            # Version sans fond : logo centré sur fond transparent
            canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            ratio  = (size * 0.80) / max(src.width, src.height)
            new_w  = int(src.width  * ratio)
            new_h  = int(src.height * ratio)
            resized = src.resize((new_w, new_h), Image.LANCZOS)
            x = (size - new_w) // 2
            y = (size - new_h) // 2
            canvas.paste(resized, (x, y), resized)
            img = canvas
        else:
            img = make_square_canvas(src, size)
        save_png(img, out_path)

    print("\n✅ Toutes les icônes ont été générées dans public/")
    print("\nVérifie que ton manifest.json contient bien :")
    print('  { "src": "/logo-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" }')
    print('  { "src": "/logo-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" }')
    print('  { "src": "/logo-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" }')
    print('  { "src": "/logo-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }')

if __name__ == "__main__":
    main()

