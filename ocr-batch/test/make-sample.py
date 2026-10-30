"""生成一张带中文的测试文档图，用来验证 OCR 效果。
用法: python test/make-sample.py
"""
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from PIL import Image, ImageDraw, ImageFont

W, H = 1240, 1754  # A4 @150dpi
img = Image.new("RGB", (W, H), "white")
d = ImageDraw.Draw(img)

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhl.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\simsun.ttc",
]


def pick_font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


title = pick_font(52)
body = pick_font(30)
small = pick_font(24)

d.text((90, 90), "房屋租赁合同", font=title, fill="black")
d.line((90, 175, W - 90, 175), fill="black", width=2)

lines = [
    "出租方（甲方）：张建国",
    "承租方（乙方）：李晓雯",
    "第一条 房屋基本情况",
    "甲方将位于本市和平区南京路 128 号 3 栋 502 室的房屋出租给乙方使用，建筑面积约 89 平方米。",
    "第二条 租赁期限",
    "租赁期为一年，自 2026 年 3 月 1 日起至 2027 年 2 月 28 日止。",
    "第三条 租金与支付方式",
    "月租金为人民币 4800 元整，押金为一个月租金。乙方应于每月 5 日前支付。",
    "第四条 双方责任",
    "甲方负责房屋主体结构与原有设施的正常维修；乙方应爱护房屋及附属设备，不得擅自改建。",
    "第五条 其他约定",
    "本合同一式两份，甲乙双方各执一份，自双方签字之日起生效。",
]

y = 230
for line in lines:
    d.text((90, y), line, font=body, fill="black")
    y += 62

d.text((90, H - 220), "甲方签字：____________", font=body, fill="black")
d.text((640, H - 220), "乙方签字：____________", font=body, fill="black")
d.text((90, H - 140), "签订日期：2026 年 2 月 20 日", font=body, fill="black")
d.text((90, H - 70), "Contract No. HT-2026-0312  (English test line)", font=small, fill="black")

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sample-doc.png")
img.save(out)
print("已生成", out)

# 顺手做一个对应的 PDF（模拟 App 导出的扫描件）
try:
    import pymupdf

    pdf_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sample.pdf")
    doc = pymupdf.open()
    page = doc.new_page(width=595.28, height=841.89)
    page.insert_image(page.rect, filename=out)
    doc.save(pdf_path, deflate=True, garbage=3)
    doc.close()
    print("已生成", pdf_path)
except Exception as exc:
    print("（没生成 PDF：%s）" % exc)
