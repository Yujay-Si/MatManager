"""生成 tabBar 图标（81x81 PNG，含常态/选中态）。

用法： python tools/gen-tab-icons.py
输出： images/tab-single.png / tab-single-on.png / tab-batch... / tab-history... / tab-params...
"""

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 81
SCALE = 4            # 先按 4 倍绘制，再缩小，边缘更平滑
NORMAL = (124, 138, 130, 255)   # #7c8a82
ACTIVE = (23, 62, 48, 255)      # #173e30
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "images"
OUT.mkdir(parents=True, exist_ok=True)


def canvas():
    image = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE), (0, 0, 0, 0))
    return image, ImageDraw.Draw(image)


def s(value):
    return int(round(value * SCALE))


def stroke(draw, points, color, width=5.4):
    draw.line(points, fill=color, width=s(width), joint="curve")


def rounded(draw, box, color, width=5.4, radius=6):
    draw.rounded_rectangle([s(v) for v in box], radius=s(radius), outline=color, width=s(width))


def draw_single(color):
    """文档 + 三条数据行"""
    image, draw = canvas()
    rounded(draw, (20, 13, 61, 68), color, 5.2, 9)
    stroke(draw, [(s(30), s(28)), (s(51), s(28))], color, 4.4)
    stroke(draw, [(s(30), s(39)), (s(51), s(39))], color, 4.4)
    stroke(draw, [(s(30), s(50)), (s(43), s(50))], color, 4.4)
    return image


def draw_batch(color):
    """2x2 网格"""
    image, draw = canvas()
    boxes = [(16, 16, 37, 37), (44, 16, 65, 37), (16, 44, 37, 65), (44, 44, 65, 65)]
    for box in boxes:
        rounded(draw, box, color, 4.8, 6)
    return image


def draw_history(color):
    """时钟"""
    image, draw = canvas()
    draw.ellipse([s(15), s(15), s(66), s(66)], outline=color, width=s(5.2))
    stroke(draw, [(s(40.5), s(27)), (s(40.5), s(42))], color, 4.8)
    stroke(draw, [(s(40.5), s(42)), (s(52), s(47))], color, 4.8)
    draw.ellipse([s(36), s(37), s(45), s(46)], fill=color)
    return image


def draw_params(color):
    """三条滑杆 + 旋钮"""
    image, draw = canvas()
    rows = [(24, 30), (45, 52), (66, 40)]
    for y, knob_x in rows:
        stroke(draw, [(s(14), s(y)), (s(67), s(y))], color, 4.2)
        r = 7.6
        draw.ellipse(
            [s(knob_x - r), s(y - r), s(knob_x + r), s(y + r)],
            fill=(255, 255, 255, 255),
            outline=color,
            width=s(4.2),
        )
    return image


ICONS = {
    "tab-single": draw_single,
    "tab-batch": draw_batch,
    "tab-history": draw_history,
    "tab-params": draw_params,
}


def main():
    for name, painter in ICONS.items():
        for suffix, color in (("", NORMAL), ("-on", ACTIVE)):
            image = painter(color).resize((SIZE, SIZE), Image.LANCZOS)
            path = OUT / f"{name}{suffix}.png"
            image.save(path, "PNG", optimize=True)
            print(f"{path.relative_to(ROOT)}  {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
