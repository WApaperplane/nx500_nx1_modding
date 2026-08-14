# -*- coding: utf-8 -*-
"""生成测试 JPEG 图片,模拟三星 NX 相机照片(2000x1333)"""
import os
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sdcard', 'DCIM')
dirs = ['100PHOTO', '101PHOTO', '102PHOTO']
colors = [
    (198, 64, 64), (64, 140, 198), (80, 180, 90), (220, 180, 60),
    (150, 90, 200), (60, 190, 190), (230, 120, 60), (90, 90, 210),
]

idx = 0
for d in dirs:
    dpath = os.path.join(BASE, d)
    os.makedirs(dpath, exist_ok=True)
    for i in range(1, 9):
        c = colors[(idx + i) % len(colors)]
        img = Image.new('RGB', (2000, 1333), c)
        draw = ImageDraw.Draw(img)
        draw.ellipse([(i * 137) % 1200, (i * 211) % 800,
                      (i * 137) % 1200 + 500, (i * 211) % 800 + 400],
                     fill=(min(255, c[0] + 60), min(255, c[1] + 60), min(255, c[2] + 60)))
        draw.rectangle([0, 0, 2000, 130], fill=(40, 40, 40))
        draw.text((40, 30), f"{d}  IMG_{i:04d}", fill=(255, 255, 255))
        out = os.path.join(dpath, f"IMG_{i:04d}.JPG")
        img.save(out, 'JPEG', quality=85)
    idx += 1

# 视频占位文件
with open(os.path.join(BASE, '100PHOTO', 'MOV_0001.MP4'), 'w') as f:
    f.write('placeholder video file for listing test')
print('generated:', sum(len(os.listdir(os.path.join(BASE, d))) for d in dirs), 'files')
