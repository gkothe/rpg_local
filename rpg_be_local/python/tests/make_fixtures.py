"""Create maintained non-private PDF fixtures for local Node/browser smoke tests."""
from pathlib import Path
import sys
from test_extract import ExtractionTests

if __name__ == "__main__":
    work = Path(sys.argv[1])
    work.mkdir(parents=True, exist_ok=True)
    fixture = ExtractionTests()
    for name, pages in (("native.pdf", ["native"]), ("mixed.pdf", ["native", "scan"]),
                        ("portuguese.pdf", ["portuguese"]), ("blank.pdf", ["blank"])):
        fixture.file = str(work / name)
        fixture.document(pages)
