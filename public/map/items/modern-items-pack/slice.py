import os
from PIL import Image

CELL = 64
BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "sliced")

def crop_cell(im, row, col, pad=2):
    x0, y0 = col * CELL, row * CELL
    cell = im.crop((x0, y0, x0 + CELL, y0 + CELL))
    bbox = cell.getbbox()
    if bbox is None:
        return None
    l, t, r, b = bbox
    l = max(0, l - pad); t = max(0, t - pad)
    r = min(CELL, r + pad); b = min(CELL, b + pad)
    return cell.crop((l, t, r, b))

def save(im, row, col, category, name):
    cell = crop_cell(im, row, col)
    if cell is None:
        print(f"  EMPTY r{row}c{col} expected {category}/{name}")
        return
    folder = os.path.join(OUT, category)
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"{name}.png")
    cell.save(path)
    print(f"  saved {category}/{name}.png")

# ---- common_items.png : 7 cols x 9 rows ----
im = Image.open(os.path.join(BASE, "common_items.png")).convert("RGBA")
print("common_items.png")
gem_colors = ["blue", "purple", "black", "yellow", "red", "green", "orange"]
for c, color in enumerate(gem_colors):
    save(im, 0, c, "gems", f"gem_{color}")

key_colors = ["silver", "gold"]
for c, color in enumerate(key_colors):
    save(im, 1, c, "keys", f"key_{color}")

flashlight_colors = ["black", "silver", "yellow", "navy"]
for c, color in enumerate(flashlight_colors):
    save(im, 2, c, "flashlights", f"flashlight_{color}")

book_colors = ["black", "red", "green", "blue", "purple", "yellow"]
for c, color in enumerate(book_colors):
    save(im, 3, c, "books", f"book_standing_a_{color}")
for c, color in enumerate(book_colors):
    save(im, 4, c, "books", f"book_standing_b_{color}")

cash_colors = ["green", "gold", "blue"]
for c, color in enumerate(cash_colors):
    save(im, 5, c, "cash", f"cash_stack_{color}")

glasses_colors = ["black", "blue", "red", "green"]
for c, color in enumerate(glasses_colors):
    save(im, 6, c, "sunglasses", f"sunglasses_thin_{color}")
for c, color in enumerate(glasses_colors):
    save(im, 7, c, "sunglasses", f"sunglasses_thick_{color}")

book_flat_colors = ["black", "red", "green", "blue"]
for c, color in enumerate(book_flat_colors):
    save(im, 8, c, "books", f"book_flat_{color}")

# ---- eletronics_items.png : 7 cols x 6 rows ----
im = Image.open(os.path.join(BASE, "eletronics_items.png")).convert("RGBA")
print("eletronics_items.png")
save(im, 0, 0, "handhelds", "handheld_console_blue")

watch_colors = ["black", "white", "brown"]
for c, color in enumerate(watch_colors):
    save(im, 1, c, "watches", f"watch_{color}")

save(im, 2, 0, "usb_drives", "usb_drive_red")

radio_colors = ["black", "blue", "yellow", "red"]
for c, color in enumerate(radio_colors):
    save(im, 3, c, "radios", f"radio_{color}")

headphone_colors = ["black", "red", "cyan", "teal", "yellow", "purple", "white"]
for c, color in enumerate(headphone_colors):
    save(im, 4, c, "headphones", f"headphones_{color}")

battery_colors = ["orange", "red", "lightblue", "redflash", "blue", "yellow", "green"]
for c, color in enumerate(battery_colors):
    save(im, 5, c, "batteries", f"battery_{color}")

# ---- food_items.png : 8 cols x 7 rows ----
im = Image.open(os.path.join(BASE, "food_items.png")).convert("RGBA")
print("food_items.png")
can_colors = ["red", "green", "blue", "purple", "orange", "yellow"]
for c, color in enumerate(can_colors):
    save(im, 0, c, "cans", f"can_ring_{color}")

coffee_names = ["brown_lid", "blue_lid", "dark_brown", "white", "brown2", "cream", "green_small", "green_cup"]
for c, name in enumerate(coffee_names):
    save(im, 1, c, "coffee", f"coffee_{name}")

for c, color in enumerate(can_colors):
    save(im, 2, c, "cans", f"can_plain_{color}")

bottle_colors = ["blue_cap", "black_cap", "clear_cap", "red_sport"]
for c, name in enumerate(bottle_colors):
    save(im, 3, c, "bottles", f"bottle_{name}")

apple_colors = ["red", "green", "darkred", "yellow"]
for c, color in enumerate(apple_colors):
    save(im, 4, c, "fruit", f"apple_{color}")

banana_names = ["yellow", "green", "green_single"]
for c, name in enumerate(banana_names):
    save(im, 5, c, "fruit", f"banana_{name}")

choco_names = ["dark_red_label", "red", "green", "white_wrapper"]
for c, name in enumerate(choco_names):
    save(im, 6, c, "chocolate", f"chocolate_{name}")

# ---- health_items.png : 5 cols x 3 rows ----
im = Image.open(os.path.join(BASE, "health_items.png")).convert("RGBA")
print("health_items.png")
kit_colors = ["green", "red", "white"]
for c, color in enumerate(kit_colors):
    save(im, 0, c, "first_aid_kits", f"first_aid_kit_{color}")

syringe_colors = ["blue", "green", "empty", "red", "yellow"]
for c, color in enumerate(syringe_colors):
    save(im, 1, c, "syringes", f"syringe_{color}")

pill_colors = ["red", "blue"]
for c, color in enumerate(pill_colors):
    save(im, 2, c, "pill_bottles", f"pill_bottle_{color}")

# ---- weapons_items.png : 5 cols x 6 rows ----
im = Image.open(os.path.join(BASE, "weapons_items.png")).convert("RGBA")
print("weapons_items.png")
ammo_colors = ["red", "green", "blue"]
for c, color in enumerate(ammo_colors):
    save(im, 0, c, "ammo_boxes", f"ammo_box_a_{color}")
for c, color in enumerate(ammo_colors):
    save(im, 1, c, "ammo_boxes", f"ammo_box_b_{color}")

pistol_colors = ["black", "gray", "silver", "tan"]
for c, color in enumerate(pistol_colors):
    save(im, 2, c, "pistols", f"pistol_{color}")

knife_colors = ["gray_black_handle", "gray_gray_handle", "gray_brown_handle", "brown", "green_black"]
for c, color in enumerate(knife_colors):
    save(im, 3, c, "knives", f"knife_{color}")

knuckle_colors = ["gold", "silver", "black"]
for c, color in enumerate(knuckle_colors):
    save(im, 4, c, "brass_knuckles", f"brass_knuckles_{color}")

save(im, 5, 0, "revolvers", "revolver_brown_gold")

print("Done.")
