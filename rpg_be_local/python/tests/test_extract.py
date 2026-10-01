"""Real local conversion tests: raster fixtures contain no hidden PDF text."""
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest

from PIL import Image, ImageDraw, ImageFont, ImageFilter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from extract import extract


class ExtractionTests(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory(prefix="rpg-document-test-")
        self.file = str(Path(self.work.name) / "fixture.pdf")

    def tearDown(self):
        self.work.cleanup()

    def document(self, kinds):
        pdf = canvas.Canvas(self.file, pagesize=(612, 792))
        for kind in kinds:
            if kind == "native":
                pdf.setFont("Helvetica", 16)
                pdf.drawString(50, 700, "Ranger Mira carries 12 silver coins and a healing potion.")
                pdf.drawString(50, 665, "A successful recovery restores 2 health points.")
            elif kind in ("scan", "portuguese"):
                image = Image.new("RGB", (1700, 2200), "white")
                font_path = Path("C:/Windows/Fonts/arial.ttf")
                font = ImageFont.truetype(str(font_path), 40) if font_path.exists() else ImageFont.load_default(size=40)
                text = ("Exploradora Mira: saúde 12\nAção: beber uma poção de cura.\nInventário: espada e 12 moedas." if kind == "portuguese" else "Ranger Mira has 12 health points.\nInventory: sword and healing potion.\nRecovery restores 2 health points.")
                ImageDraw.Draw(image).multiline_text((140, 220), text, fill="black", font=font, spacing=25)
                image = image.filter(ImageFilter.GaussianBlur(0.35))
                pdf.drawImage(ImageReader(image), 0, 0, width=612, height=792)
            pdf.showPage()
        pdf.save()

    def test_native_page_keeps_text_and_provenance(self):
        self.document(["native"])
        result = extract(self.file, "eng")
        self.assertIn("12 silver coins", result["text"])
        self.assertEqual(result["pages"][0]["method"], "markitdown")
        self.assertEqual(len(result["pages"][0]["sourceHash"]), 64)

    def test_scanned_page_really_uses_ocr_and_keeps_line_boundaries(self):
        self.document(["scan"])
        result = extract(self.file, "eng")
        page = result["pages"][0]
        self.assertEqual(page["method"], "tesseract")
        self.assertIn("12 health", page["text"])
        self.assertIn("\nInventory:", page["text"])
        self.assertTrue(page["words"])
        self.assertGreater(page["words"][0]["width"], 0)
        self.assertTrue(result["warnings"])

    def test_mixed_pages_keep_physical_page_numbers(self):
        self.document(["native", "scan"])
        result = extract(self.file, "eng")
        self.assertEqual([p["page"] for p in result["pages"]], [1, 2])
        self.assertEqual([p["method"] for p in result["pages"]], ["markitdown", "tesseract"])

    def test_portuguese_ocr_retains_utf8(self):
        self.document(["portuguese"])
        result = extract(self.file, "por")
        self.assertIn("saúde 12", result["text"])
        self.assertIn("poção", result["text"])

    def test_blank_separator_preserves_page_number_and_warns(self):
        self.document(["native", "blank", "native"])
        result = extract(self.file, "eng")
        self.assertEqual([p["page"] for p in result["pages"]], [1, 2, 3])
        self.assertEqual(result["pages"][1]["text"], "")
        self.assertTrue(any("Page 2" in warning for warning in result["warnings"]))

    def test_wholly_empty_extraction_is_rejected(self):
        self.document(["blank"])
        with self.assertRaises(ValueError):
            extract(self.file, "eng")

    def test_invalid_language_and_page_limit_are_rejected(self):
        self.document(["native"])
        with self.assertRaises(ValueError):
            extract(self.file, "invalid")
        self.document(["blank"] * 301)
        with self.assertRaises(ValueError):
            extract(self.file, "eng")

    def test_corrupt_document_does_not_produce_success(self):
        Path(self.file).write_bytes(b"%PDF-broken")
        with self.assertRaises(Exception):
            extract(self.file, "eng")


if __name__ == "__main__":
    unittest.main()
