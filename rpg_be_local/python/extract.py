"""Local page-aware PDF extraction. No network or model/API client."""
import csv
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
from contextlib import closing

MAX_PAGES = 300
MAX_TEXT_BYTES = 10 * 1024 * 1024
MAX_RENDER_PIXELS = 30_000_000
OCR_SCALE = 300 / 72
OCR_LANGUAGE_CODES = ("eng", "por", "eng+por")


def ocr_page(page, language):
    """Preserve OCR line/paragraph boundaries as well as word provenance."""
    if page.get_width() * page.get_height() * OCR_SCALE ** 2 > MAX_RENDER_PIXELS:
        raise ValueError("PDF page is too large to render safely")
    with tempfile.TemporaryDirectory(prefix="rpg-ocr-") as work:
        image_file = os.path.join(work, "page.png")
        with closing(page.render(scale=OCR_SCALE)) as bitmap:
            bitmap.to_pil().save(image_file)
        completed = subprocess.run(
            [os.environ.get("RPG_TESSERACT_BIN", "tesseract"), image_file,
             "stdout", "-l", language, "tsv"],
            capture_output=True, text=True, encoding="utf-8", check=True,
            timeout=100, creationflags=0x08000000 if os.name == "nt" else 0,
        )
    words, lines = [], {}
    for row in csv.DictReader(io.StringIO(completed.stdout), delimiter="\t"):
        if not row.get("text", "").strip():
            continue
        word = {
            "text": row["text"], "confidence": float(row["conf"]),
            "left": int(row["left"]), "top": int(row["top"]),
            "width": int(row["width"]), "height": int(row["height"]),
            "line": row["line_num"], "block": row["block_num"],
            "paragraph": row["par_num"],
        }
        words.append(word)
        key = (word["block"], word["paragraph"], word["line"])
        lines.setdefault(key, []).append(word["text"])
    return "\n".join(" ".join(line) for line in lines.values()), words


def extract_page(pdf, number, language, digest):
    import pypdfium2 as pdfium
    warnings = []
    with closing(pdf[number]) as page:
        with closing(page.get_textpage()) as textpage:
            text = textpage.get_text_range().strip()
        words, method = [], "native"
        if len(text) >= 40:
            from markitdown import MarkItDown
            with tempfile.TemporaryDirectory(prefix="rpg-native-") as work:
                native_file = os.path.join(work, "page.pdf")
                with closing(pdfium.PdfDocument.new()) as single:
                    single.import_pages(pdf, [number])
                    single.save(native_file)
                converted = MarkItDown(enable_plugins=False).convert(native_file).text_content.strip()
                if converted:
                    text, method = converted, "markitdown"
        if len(text) < 40:
            text, words = ocr_page(page, language)
            method = "tesseract"
            warnings.append(f"Page {number + 1}: OCR text needs review; tables and reading order may be imperfect")
            if words and sum(w["confidence"] for w in words) / len(words) < 60:
                warnings.append(f"Page {number + 1}: low OCR confidence; correct the extracted text")
        if not text:
            warnings.append(f"Page {number + 1}: no text found; inspect this blank or unreadable page")
    return {"page": number + 1, "text": text, "method": method,
            "sourceHash": digest, "words": words}, warnings


def extract(filename, language):
    import pypdfium2 as pdfium
    if language not in OCR_LANGUAGE_CODES:
        raise ValueError("Unsupported OCR language")
    with open(filename, "rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    pages, warnings, total_bytes = [], [], 0
    with closing(pdfium.PdfDocument(filename)) as pdf:
        if len(pdf) > MAX_PAGES:
            raise ValueError("PDF exceeds 300 pages")
        for number in range(len(pdf)):
            page, page_warnings = extract_page(pdf, number, language, digest)
            pages.append(page)
            warnings.extend(page_warnings)
            total_bytes += len(page["text"].encode("utf-8"))
            if total_bytes > MAX_TEXT_BYTES:
                raise ValueError("Extracted text exceeds 10MiB")
    if not any(page["text"].strip() for page in pages):
        raise ValueError("Document contains no extractable text; inspect the document")
    text = "\n\n".join(f'## Page {p["page"]}\n{p["text"]}' for p in pages)
    if len(text.encode("utf-8")) > MAX_TEXT_BYTES:
        raise ValueError("Extracted text exceeds 10MiB")
    return {"text": text, "pages": pages, "warnings": warnings}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    try:
        print(json.dumps(extract(sys.argv[1], sys.argv[2]), ensure_ascii=False))
    except Exception:
        print("Local PDF/OCR failed; check Python dependencies, Tesseract language data, PDF integrity, and page limit", file=sys.stderr)
        sys.exit(1)
