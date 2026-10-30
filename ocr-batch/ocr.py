"""批量 OCR：把扫描件（PDF / 图片）转成 可搜索 PDF + Word + TXT。

用法:
    python ocr.py 文件.pdf
    python ocr.py 扫描件目录
    python ocr.py a.pdf b.png -o 输出目录
    python ocr.py 扫描件目录 --no-docx          # 只要可搜索 PDF
    python ocr.py 扫描件目录 --dpi 300          # 处理质量更高的原件

输出（默认放在输入同目录的 ocr_out/ 下）:
    xxx_ocr.pdf   图片原样保留，上面盖一层看不见的文字 -> 能搜索、能复制
    xxx.docx      识别出的文字，可编辑
    xxx.txt       纯文本

依赖: rapidocr_onnxruntime, pymupdf, python-docx, pillow
"""

from __future__ import annotations

import argparse
import io
import os
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import pymupdf
from docx import Document
from docx.oxml.ns import qn
from docx.shared import Pt
from PIL import Image

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}
PDF_EXTS = {".pdf"}

# 内置 CJK 字体名，用于给 PDF 塞不可见文字
CJK_FONT = "china-s"


# ---------------------------------------------------------------- OCR 引擎
_engine = None


def get_engine():
    global _engine
    if _engine is None:
        from rapidocr_onnxruntime import RapidOCR

        print("  加载 OCR 模型…", end="", flush=True)
        t0 = time.time()
        _engine = RapidOCR()
        print(f" 完成 ({time.time() - t0:.1f}s)")
    return _engine


def run_ocr(image_bytes: bytes):
    """返回 [(bbox(x0,y0,x1,y1), text, score)]，坐标为图片像素。"""
    engine = get_engine()
    result, _ = engine(image_bytes)
    items = []
    for box, text, score in result or []:
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        items.append(((min(xs), min(ys), max(xs), max(ys)), text, float(score)))
    return items


# ---------------------------------------------------------------- 取图
def page_image(doc, page, dpi):
    """拿到这一页的位图：优先直接用 PDF 里嵌的原图（无损），否则按 dpi 渲染。"""
    images = page.get_images(full=True)
    if len(images) == 1:
        xref = images[0][0]
        try:
            info = doc.extract_image(xref)
            rects = page.get_image_rects(xref)
            if info and rects and info.get("image"):
                return {
                    "bytes": info["image"],
                    "ext": info.get("ext", "png"),
                    "width": info["width"],
                    "height": info["height"],
                    "rect": rects[0],
                }
        except Exception:
            pass

    zoom = dpi / 72.0
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
    return {
        "bytes": pix.tobytes("png"),
        "ext": "png",
        "width": pix.width,
        "height": pix.height,
        "rect": page.rect,
    }


def image_file_page(path: Path):
    with Image.open(path) as im:
        im = im.convert("RGB")
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        w, h = im.size
    return {"bytes": buf.getvalue(), "ext": "png", "width": w, "height": h, "rect": None}


# ---------------------------------------------------------------- 生成可搜索 PDF
def build_searchable_pdf(jobs, out_path: Path):
    """jobs: [(page_image_dict, ocr_items, page_size_or_None)]"""
    out = pymupdf.open()
    for img, items, page_size in jobs:
        rect = page_size or pymupdf.Rect(0, 0, 595.28, 841.89)
        page = out.new_page(width=rect.width, height=rect.height)
        target = img["rect"] if img["rect"] is not None else page.rect
        try:
            page.insert_image(target, stream=img["bytes"])
        except Exception:
            page.insert_image(page.rect, stream=img["bytes"])
            target = page.rect

        sx = target.width / img["width"]
        sy = target.height / img["height"]

        for (x0, y0, x1, y1), text, _score in items:
            if not text.strip():
                continue
            bx0 = target.x0 + x0 * sx
            by0 = target.y0 + y0 * sy
            bx1 = target.x0 + x1 * sx
            by1 = target.y0 + y1 * sy
            box_h = max(by1 - by0, 1.0)
            box_w = max(bx1 - bx0, 1.0)

            fontsize = box_h * 0.75
            # 让文字宽度贴合识别框，选中时高亮才准确
            try:
                width_at = pymupdf.get_text_length(text, fontname=CJK_FONT, fontsize=fontsize)
                if width_at > 0:
                    fontsize *= min(1.0, box_w / width_at)
            except Exception:
                pass
            fontsize = max(fontsize, 1.0)

            baseline = by1 - box_h * 0.15
            try:
                page.insert_text(
                    (bx0, baseline),
                    text,
                    fontsize=fontsize,
                    fontname=CJK_FONT,
                    render_mode=3,  # 3 = 不可见
                    color=(0, 0, 0),
                )
            except Exception as exc:  # 个别字符编码不了就跳过，不影响其它
                print(f"    ! 写入文字失败: {text[:12]}… ({exc})")

    out.save(str(out_path), garbage=3, deflate=True)
    out.close()


# ---------------------------------------------------------------- 生成 docx / txt
def group_lines(items):
    """把识别框按行归并，返回 [(文字, 该行的高度px)]。"""
    if not items:
        return []
    rows = sorted(items, key=lambda it: (it[0][1] + it[0][3]) / 2)
    heights = [it[0][3] - it[0][1] for it in rows]
    heights.sort()
    median_h = heights[len(heights) // 2] or 12

    lines = []
    current = []
    current_y = None
    for (x0, y0, x1, y1), text, _score in rows:
        cy = (y0 + y1) / 2
        if current_y is None or abs(cy - current_y) <= median_h * 0.6:
            current.append(((x0, y0, x1, y1), text))
            current_y = cy if current_y is None else (current_y + cy) / 2
        else:
            lines.append(current)
            current = [((x0, y0, x1, y1), text)]
            current_y = cy
    if current:
        lines.append(current)

    out = []
    for line in lines:
        line.sort(key=lambda p: p[0][0])
        text = ""
        boxes = []
        prev_x1 = None
        for box, t in line:
            box_h = max(box[3] - box[1], 1)
            if prev_x1 is not None:
                gap = box[0] - prev_x1
                if gap > box_h * 1.2:
                    text += "    "  # 同一行但隔得很远：当成两栏/两处文字，留个明显间隔
                elif text and _needs_space(text[-1], t[0]):
                    text += " "
            text += t
            boxes.append(box)
            prev_x1 = box[2]
        line_h = sorted(b[3] - b[1] for b in boxes)[len(boxes) // 2]
        out.append((text, line_h))
    return out


def _needs_space(prev: str, nxt: str) -> bool:
    return prev.isascii() and nxt.isascii() and (prev.isalnum() or prev in ",.;:") and nxt.isalnum()


def write_docx(pages, out_path: Path):
    """pages: [( [(文字, 行高px)], 页面高度px )]，按页分页符隔开，字号按行高换算。"""
    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = "Times New Roman"
    style.font.size = Pt(10.5)
    style.element.rPr.rFonts.set(qn("w:eastAsia"), "宋体")

    for idx, (lines, page_h) in enumerate(pages):
        if idx:
            doc.add_page_break()

        # 先定这一页的"正文基准字号"，避免行高抖动让字号忽大忽小
        heights = sorted(h for t, h in lines if t.strip())
        median_h = heights[len(heights) // 2] if heights else 0
        body_pt = (median_h / max(page_h, 1)) * 841.89 * 0.78 if median_h else 10.5
        body_pt = max(7.0, min(40.0, round(body_pt * 2) / 2))

        for text, line_h in lines:
            if not text.strip():
                continue
            if median_h and 0.85 <= line_h / median_h <= 1.2:
                pt = body_pt
            else:
                # 行高明显偏离正文：多半是标题或脚注，按实际比例换算
                pt = (line_h / max(page_h, 1)) * 841.89 * 0.78
                pt = max(7.0, min(40.0, round(pt * 2) / 2))
            para = doc.add_paragraph()
            run = para.add_run(text)
            run.font.size = Pt(pt)
            run.font.name = "Times New Roman"
            run._element.rPr.rFonts.set(qn("w:eastAsia"), "宋体")
            para.paragraph_format.space_after = Pt(1)
            para.paragraph_format.space_before = Pt(0)
            para.paragraph_format.line_spacing = 1.15
    doc.save(str(out_path))


def write_txt(pages, out_path: Path):
    lines = []
    for page_lines, _page_h in pages:
        lines.extend(t for t, _h in page_lines)
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- 主流程
def collect_inputs(targets):
    files = []
    for t in targets:
        p = Path(t)
        if p.is_dir():
            for f in sorted(p.iterdir()):
                if f.suffix.lower() in PDF_EXTS | IMAGE_EXTS:
                    files.append(f)
        elif p.is_file():
            files.append(p)
        else:
            print(f"跳过（不存在）: {p}")
    return files


def process_file(path: Path, outdir: Path, dpi: int, want_docx: bool, want_txt: bool):
    print(f"\n▶ {path.name}")
    jobs = []
    docx_pages = []
    t0 = time.time()

    if path.suffix.lower() in PDF_EXTS:
        doc = pymupdf.open(str(path))
        total = doc.page_count
        for i, page in enumerate(doc, start=1):
            img = page_image(doc, page, dpi)
            items = run_ocr(img["bytes"])
            print(f"  第 {i}/{total} 页：识别 {len(items)} 行", flush=True)
            docx_pages.append((group_lines(items), img["height"]))
            jobs.append((img, items, pymupdf.Rect(page.rect)))
        doc.close()
    else:
        img = image_file_page(path)
        items = run_ocr(img["bytes"])
        print(f"  识别 {len(items)} 行", flush=True)
        docx_pages.append((group_lines(items), img["height"]))
        jobs.append((img, items, None))

    stem = path.stem
    out_pdf = outdir / f"{stem}_ocr.pdf"
    build_searchable_pdf(jobs, out_pdf)
    print(f"  ✓ {out_pdf.name}")

    if want_docx:
        out_docx = outdir / f"{stem}.docx"
        write_docx(docx_pages, out_docx)
        print(f"  ✓ {out_docx.name}")

    if want_txt:
        out_txt = outdir / f"{stem}.txt"
        write_txt(docx_pages, out_txt)
        print(f"  ✓ {out_txt.name}")

    print(f"  耗时 {time.time() - t0:.1f}s")
    return sum(len(lines) for lines, _h in docx_pages)


def main():
    ap = argparse.ArgumentParser(description="批量 OCR：扫描件 → 可搜索 PDF + Word + TXT")
    ap.add_argument("inputs", nargs="+", help="PDF / 图片 / 目录，可以给多个")
    ap.add_argument("-o", "--outdir", help="输出目录（默认：输入同级的 ocr_out/）")
    ap.add_argument("--dpi", type=int, default=200, help="PDF 没有原图时按多少 dpi 渲染（默认 200）")
    ap.add_argument("--no-docx", action="store_true", help="不生成 docx")
    ap.add_argument("--no-txt", action="store_true", help="不生成 txt")
    args = ap.parse_args()

    files = collect_inputs(args.inputs)
    if not files:
        print("没找到可处理的 PDF 或图片")
        return 1

    outdir = Path(args.outdir) if args.outdir else files[0].parent / "ocr_out"
    outdir.mkdir(parents=True, exist_ok=True)
    print(f"共 {len(files)} 个文件，输出到 {outdir}")

    start = time.time()
    total_lines = 0
    for f in files:
        try:
            total_lines += process_file(f, outdir, args.dpi, not args.no_docx, not args.no_txt)
        except Exception as exc:
            print(f"  ✗ 处理失败：{type(exc).__name__}: {exc}")

    print(f"\n全部完成：{len(files)} 个文件，{total_lines} 行文字，用时 {time.time() - start:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
