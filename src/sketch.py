"""简笔画渲染器：用 JSON 描述线条/圆/矩形/文字，输出 PNG。

为什么要自己撸一个：机器人需要"随手画个东西"的能力，而模型没法直接产图。
给它一个极简绘图 DSL，它就能拼出火柴人、简笔猫、示意图这类东西。

设计取舍：
  · 只支持 5 种图元（line / circle / rect / arc / text）+ polyline，够用且好写；
  · 手绘感靠"抖动"：每个顶点加一点随机偏移，线用圆头，粗细随机微扰；
  · 坐标系就是像素，左上角原点，模型算起来不吃力。

用法:
  python sketch.py --spec draw.json --out a.png [--width 640 --height 480 --wobble 1.2 --seed 7]

spec 示例:
  {"bg": "#ffffff", "stroke": "#222222", "width": 3, "shapes": [
     {"t": "circle", "c": [320, 160], "r": 80},
     {"t": "line", "p": [[240, 260], [200, 400]]},
     {"t": "text", "p": [260, 430], "s": "喵", "size": 32},
     {"t": "polyline", "p": [[100, 100], [180, 120], [220, 200]]}
  ]}
"""
import argparse
import json
import math
import os
import random

from PIL import Image, ImageDraw, ImageFont


def load_font(size):
    """找一个能显示中文的系统字体；找不到就用默认（只影响文字）。"""
    for path in (
        r'C:\Windows\Fonts\msyh.ttc',
        r'C:\Windows\Fonts\msyhbd.ttc',
        r'C:\Windows\Fonts\simhei.ttf',
        r'C:\Windows\Fonts\simsun.ttc',
    ):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def jitter(points, amount, rng):
    if amount <= 0:
        return [tuple(p) for p in points]
    out = []
    for p in points:
        x, y = float(p[0]), float(p[1])
        out.append((x + rng.uniform(-amount, amount), y + rng.uniform(-amount, amount)))
    return out


def draw(draw_ctx, shapes, opts, rng):
    stroke = opts.get('stroke', '#222222')
    base_w = int(opts.get('strokeWidth', 3))
    wobble = float(opts.get('wobble', 1.2))
    width_jitter = float(opts.get('widthJitter', 0.35))

    def w():
        return max(1, int(round(base_w * (1 + rng.uniform(-width_jitter, width_jitter)))))

    for shape in shapes:
        t = shape.get('t')
        color = shape.get('stroke', stroke)
        lw = int(shape.get('width', base_w))
        if t == 'line':
            pts = jitter(shape['p'], wobble, rng)
            draw_ctx.line([pts[0], pts[1]], fill=color, width=lw, joint='curve')
            for p in pts:
                r = lw / 2
                draw_ctx.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=color)
        elif t == 'polyline':
            pts = jitter(shape['p'], wobble, rng)
            draw_ctx.line(pts, fill=color, width=lw, joint='curve')
            if shape.get('closed'):
                draw_ctx.line([pts[-1], pts[0]], fill=color, width=lw, joint='curve')
        elif t == 'circle':
            cx, cy = shape['c']
            r = shape['r']
            cx, cy = jitter([[cx, cy]], wobble, rng)[0]
            draw_ctx.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=w())
        elif t == 'dot':
            cx, cy = shape['c']
            r = shape.get('r', max(2, lw))
            draw_ctx.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
        elif t == 'rect':
            (x0, y0), (x1, y1) = shape['p']
            pts = jitter([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], wobble, rng)
            draw_ctx.line(pts + [pts[0]], fill=color, width=w(), joint='curve')
        elif t == 'arc':
            cx, cy = shape['c']
            r = shape['r']
            a0 = float(shape.get('a0', 0))
            a1 = float(shape.get('a1', 180))
            draw_ctx.arc([cx - r, cy - r, cx + r, cy + r], start=a0, end=a1, fill=color, width=w())
        elif t == 'text':
            x, y = shape['p']
            size = int(shape.get('size', 28))
            font = load_font(size)
            draw_ctx.text((x, y), str(shape.get('s', '')), fill=shape.get('stroke', stroke), font=font)
        else:
            continue


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--spec', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--width', type=int, default=640)
    ap.add_argument('--height', type=int, default=480)
    ap.add_argument('--wobble', type=float, default=1.2)
    ap.add_argument('--seed', type=int, default=0)
    args = ap.parse_args()

    with open(args.spec, encoding='utf-8-sig') as f:
        spec = json.load(f)

    width = int(spec.get('width', args.width))
    height = int(spec.get('height', args.height))
    seed = int(spec.get('seed', args.seed))
    rng = random.Random(seed)

    bg = spec.get('bg', '#ffffff')
    img = Image.new('RGB', (width, height), bg)
    ctx = ImageDraw.Draw(img)

    opts = {
        'stroke': spec.get('stroke', '#222222'),
        'strokeWidth': spec.get('strokeWidth', 3),
        'wobble': spec.get('wobble', args.wobble),
        'widthJitter': spec.get('widthJitter', 0.35),
    }
    draw(ctx, spec.get('shapes', []), opts, rng)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    img.save(args.out, 'PNG')
    print(f'OK {args.out} {os.path.getsize(args.out)} 字节 {width}x{height} 图元 {len(spec.get("shapes", []))} 个')


if __name__ == '__main__':
    main()
