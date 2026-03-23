import io
import numpy as np
from PIL import Image

try:
    import easyocr
    reader = easyocr.Reader(["en"], gpu=False)
except Exception as e:
    print("EasyOCR init failed:", e)

try:
    img = Image.new("RGB", (100, 100), color="white")
    arr = __import__("numpy").array(img)
    print("Readtext...")
    result = reader.readtext(arr)
    print("Result:", result)
    text = " ".join([item[1] for item in result if len(item) > 1]).strip()
    print("Text length:", len(text), "Text:", text)
except Exception as e:
    print("Readtext failed:", e)
