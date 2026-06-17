"""滑块验证码图像生成。

用 Pillow 生成一张带随机缺口背景图 + 滑块小块的 PNG，并以 data URL 形式返回。
缺口 x 坐标由服务端随机决定，随图像一起交给前端，但真正的目标 x 仅写入 JWT（见
auth_helpers.generate_slider_challenge），前端无法篡改。
"""

from __future__ import annotations

import base64
import io
import random
import uuid

from PIL import Image, ImageDraw, ImageFilter

# 图像几何参数（与前端 SliderCaptcha 组件约定一致）。
BG_WIDTH = 320
BG_HEIGHT = 160
SLIDER_WIDTH = 44  # 滑块小块宽度
SLIDER_HEIGHT = 44  # 滑块小块高度
PUZZLE_RADIUS = 6  # 缺口圆角半径

# 缺口 x 的合法区间：左侧留出滑块起始位，右侧留出小块宽度，避免贴边导致难以命中。
_GAP_X_MIN = SLIDER_WIDTH + 20
_GAP_X_MAX = BG_WIDTH - SLIDER_WIDTH - 20
# 缺口 y 的合法区间：上下留白，避免贴边。
_GAP_Y_MIN = 10
_GAP_Y_MAX = BG_HEIGHT - SLIDER_HEIGHT - 10


def _random_gradient_bg() -> Image.Image:
    """生成一张随机渐变色背景图，尺寸 BG_WIDTH x BG_HEIGHT。

    纯色背景会让缺口位置过于明显（缺口阴影一眼可见），渐变 + 几何色块能增加识别难度，
    同时无需引入外部图片素材。
    """
    # 随机两个 HSL 主色，转 RGB。
    hue_a = random.random()
    hue_b = (hue_a + random.uniform(0.15, 0.45)) % 1.0
    sat = random.uniform(0.45, 0.7)
    lum = random.uniform(0.5, 0.65)

    def hsl_to_rgb(h: float, s: float, l: float) -> tuple[int, int, int]:
        # 标准 HSL → RGB（算法来自 CSS 规范）。
        if s == 0:
            v = int(l * 255)
            return (v, v, v)

        def hue_to_channel(p: float, q: float, t: float) -> float:
            if t < 0:
                t += 1
            if t > 1:
                t -= 1
            if t < 1 / 6:
                return p + (q - p) * 6 * t
            if t < 1 / 2:
                return q
            if t < 2 / 3:
                return p + (q - p) * (2 / 3 - t) * 6
            return p

        q = l * (1 + s) if l < 0.5 else l + s - l * s
        p = 2 * l - q
        r = hue_to_channel(p, q, h + 1 / 3)
        g = hue_to_channel(p, q, h)
        b = hue_to_channel(p, q, h - 1 / 3)
        return (int(r * 255), int(g * 255), int(b * 255))

    color_a = hsl_to_rgb(hue_a, sat, lum)
    color_b = hsl_to_rgb(hue_b, sat, lum)

    # 横向线性渐变。
    bg = Image.new("RGB", (BG_WIDTH, BG_HEIGHT), color_a)
    px = bg.load()
    for x in range(BG_WIDTH):
        ratio = x / (BG_WIDTH - 1)
        r = int(color_a[0] + (color_b[0] - color_a[0]) * ratio)
        g = int(color_a[1] + (color_b[1] - color_a[1]) * ratio)
        b = int(color_a[2] + (color_b[2] - color_a[2]) * ratio)
        for y in range(BG_HEIGHT):
            px[x, y] = (r, g, b)

    # 叠加几个半透明几何色块，进一步打乱缺口阴影的可辨识度。
    overlay = Image.new("RGBA", (BG_WIDTH, BG_HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for _ in range(4):
        bx0 = random.randint(0, BG_WIDTH - 60)
        by0 = random.randint(0, BG_HEIGHT - 60)
        block_color = hsl_to_rgb(random.random(), random.uniform(0.4, 0.7), random.uniform(0.45, 0.7))
        draw.ellipse(
            [bx0, by0, bx0 + random.randint(40, 90), by0 + random.randint(40, 90)],
            fill=(*block_color, random.randint(40, 80)),
        )
    bg = Image.alpha_composite(bg.convert("RGBA"), overlay).convert("RGB")
    return bg


def _puzzle_mask(x: int, y: int) -> tuple[Image.Image, Image.Image]:
    """生成缺口形状的遮罩与小块轮廓。

    返回 (缺口遮罩, 小块遮罩)，均为 SLIDER_WIDTH x SLIDER_HEIGHT 的 L 模式图，
    255 表示该像素属于缺口/小块。两个遮罩形状完全一致，分别用于在背景上挖洞和
    抠出滑块小块。
    """
    mask = Image.new("L", (SLIDER_WIDTH, SLIDER_HEIGHT), 0)
    draw = ImageDraw.Draw(mask)
    # 用圆角矩形作为缺口形状（简单且边缘清晰，便于前端对齐）。
    draw.rounded_rectangle(
        [0, 0, SLIDER_WIDTH - 1, SLIDER_HEIGHT - 1],
        radius=PUZZLE_RADIUS,
        fill=255,
    )
    return mask, mask.copy()


def _carve_gap(bg: Image.Image, gap_x: int, gap_y: int) -> Image.Image:
    """在背景图上挖出缺口（半透明阴影 + 内描边），返回 RGBA。"""
    mask, _ = _puzzle_mask(gap_x, gap_y)
    rgba = bg.convert("RGBA")
    # 用深色半透明覆盖缺口区域，模拟「挖空」的阴影效果。
    shadow = Image.new("RGBA", (BG_WIDTH, BG_HEIGHT), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.bitmap((gap_x, gap_y), mask, fill=(0, 0, 0, 90))
    # 给缺口加一圈浅色描边，提升人眼辨识度（同时不增加机器识别难度）。
    border = Image.new("RGBA", (BG_WIDTH, BG_HEIGHT), (0, 0, 0, 0))
    border_draw = ImageDraw.Draw(border)
    border_draw.bitmap((gap_x, gap_y), mask.filter(ImageFilter.FIND_EDGES), fill=(255, 255, 255, 120))
    return Image.alpha_composite(Image.alpha_composite(rgba, shadow), border)


def _cut_slider_piece(bg: Image.Image, gap_x: int, gap_y: int) -> Image.Image:
    """从背景图上抠出滑块小块（带缺口形状并且高度与背景一致的透明 PNG）。"""
    _, mask = _puzzle_mask(gap_x, gap_y)
    # 裁出小块区域再按遮罩抠形状。
    region = bg.convert("RGBA").crop((gap_x, gap_y, gap_x + SLIDER_WIDTH, gap_y + SLIDER_HEIGHT))
    piece = Image.new("RGBA", (SLIDER_WIDTH, BG_HEIGHT), (0, 0, 0, 0))
    piece.paste(region, (0, gap_y), mask)
    # 给小块加一圈描边，让它在拖动时更醒目。
    edges = mask.filter(ImageFilter.FIND_EDGES)
    overlay = Image.new("RGBA", (SLIDER_WIDTH, BG_HEIGHT), (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)
    overlay_draw.bitmap((0, gap_y), edges, fill=(255, 255, 255, 200))
    piece = Image.alpha_composite(piece, overlay)
    return piece


def _add_noise(draw: ImageDraw.ImageDraw, count: int = 200) -> None:
    """加随机噪点，干扰简单的边缘检测。"""
    for _ in range(count):
        x = random.randint(0, BG_WIDTH - 1)
        y = random.randint(0, BG_HEIGHT - 1)
        gray = random.randint(0, 255)
        draw.point((x, y), fill=(gray, gray, gray, 90))


def _add_interference_lines(draw: ImageDraw.ImageDraw) -> None:
    """加 3-5 条随机干扰线。"""
    for _ in range(random.randint(3, 5)):
        x0 = random.randint(0, BG_WIDTH)
        y0 = random.randint(0, BG_HEIGHT)
        x1 = random.randint(0, BG_WIDTH)
        y1 = random.randint(0, BG_HEIGHT)
        color = (random.randint(0, 255), random.randint(0, 255), random.randint(0, 255), 70)
        draw.line([(x0, y0), (x1, y1)], fill=color, width=1)


def generate_captcha_image() -> tuple[str, int, str, str]:
    """生成一组滑块验证码图像。

    :returns: (challenge_id, target_x, background_data_url, slider_data_url)
        - challenge_id: 本次挑战的 uuid，供日志/调试
        - target_x: 缺口目标 x 坐标（前端对齐用；真正的校验值写入 JWT）
        - background_data_url: 带缺口的背景图，data:image/png;base64,...
        - slider_data_url: 滑块小块图，data:image/png;base64,...
    """
    challenge_id = uuid.uuid4().hex
    gap_x = random.randint(_GAP_X_MIN, _GAP_X_MAX)
    gap_y = random.randint(_GAP_Y_MIN, _GAP_Y_MAX)

    bg = _random_gradient_bg()
    bg_with_gap = _carve_gap(bg, gap_x, gap_y)

    # 在背景上叠加噪点与干扰线。
    noise_layer = Image.new("RGBA", (BG_WIDTH, BG_HEIGHT), (0, 0, 0, 0))
    noise_draw = ImageDraw.Draw(noise_layer)
    _add_noise(noise_draw)
    _add_interference_lines(noise_draw)
    bg_final = Image.alpha_composite(bg_with_gap, noise_layer)

    slider_piece = _cut_slider_piece(bg, gap_x, gap_y)

    background_url = _to_data_url(bg_final)
    slider_url = _to_data_url(slider_piece)
    return challenge_id, gap_x, background_url, slider_url


def _to_data_url(img: Image.Image) -> str:
    """把 PIL 图像编码成 data URL。"""
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"
