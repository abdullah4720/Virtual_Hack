# يبني نسخة "ملف واحد" لكل صفحة: CSS و JS مدمجة داخل الصفحة، فتُفتح مباشرة دون مجلدات
import pathlib, sys
src = pathlib.Path(__file__).resolve().parent.parent / "public"
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "standalone"); out.mkdir(parents=True, exist_ok=True)
read = lambda n: (src / n).read_text(encoding="utf-8").replace("</script", "<\\/script")
css, app, demo, qr, ico = read("hack.css"), read("app.js"), read("demo-api.js"), read("qrcode.min.js"), read("icons.js")
for f in sorted(src.glob("*.html")):
    s = f.read_text(encoding="utf-8")
    s = s.replace('<link rel="stylesheet" href="hack.css">', f"<style>\n{css}\n</style>")
    s = s.replace('<script src="qrcode.min.js"></script>', f"<script>{qr}</script>")
    s = s.replace('<script src="icons.js"></script>', f"<script>{ico}</script>")
    s = s.replace('<script src="app.js"></script>', f"<script>{demo}</script>\n<script>{app}</script>")
    assert 'src="app.js"' not in s and 'href="hack.css"' not in s and 'src="icons.js"' not in s, f.name
    (out / f.name).write_text(s, encoding="utf-8")
    print(f.name, len(s) // 1024, "KB")
