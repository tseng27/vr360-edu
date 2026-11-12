# 產生「208 沉浸式探索教室」的三張測試用 2:1 全景圖（純程式繪製，無第三方影像、無 EXIF）。
# 用法：python3 scripts/generate-classroom-panoramas.py public/classroom/scenes
# Procedurally generated equirectangular test panoramas (no third-party imagery, no EXIF).
import math, random, sys
from PIL import Image, ImageDraw, ImageFont
W, H = 4096, 2048
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
out = sys.argv[1]
scenes = {
  "a-field":   dict(letter="A", label="FIELD",   sky=((70,140,220),(190,225,255)), ground=((60,140,70),(30,90,40)), accent=(255,255,255)),
  "b-library": dict(letter="B", label="LIBRARY", sky=((90,60,40),(200,160,110)),  ground=((120,80,50),(70,45,30)), accent=(255,230,170)),
  "c-studio":  dict(letter="C", label="STUDIO",  sky=((230,200,235),(255,245,230)), ground=((200,190,180),(140,130,125)), accent=(120,40,140)),
}
def lerp(a,b,t): return tuple(int(a[i]+(b[i]-a[i])*t) for i in range(3))
for key,s in scenes.items():
    random.seed(key)
    im = Image.new("RGB",(W,H)); d = ImageDraw.Draw(im)
    for y in range(H):
        if y < H//2: c = lerp(s["sky"][0], s["sky"][1], y/(H/2))
        else: c = lerp(s["ground"][0], s["ground"][1], (y-H/2)/(H/2))
        d.line([(0,y),(W,y)], fill=c)
    if key=="b-library":
        for x in range(0,W,64):
            h = random.randint(120,260); col=(random.randint(80,200),random.randint(40,120),random.randint(30,90))
            d.rectangle([x+4,H//2-h,x+56,H//2], fill=col)
    if key=="c-studio":
        for _ in range(40):
            x=random.randint(0,W); y=random.randint(H//2-300,H//2-60); r=random.randint(30,80)
            d.rectangle([x,y,x+r*2,y+r], fill=(random.randint(0,255),random.randint(0,255),random.randint(0,255)))
    if key=="a-field":
        for x in range(0,W,256): d.line([(x,H//2),(x,H)], fill=(240,240,240), width=4)
    # horizon + yaw grid
    d.line([(0,H//2),(W,H//2)], fill=s["accent"], width=3)
    small = ImageFont.truetype(FONT, 56); big = ImageFont.truetype(FONT, 420); mid = ImageFont.truetype(FONT, 110)
    for deg in range(0,360,30):
        x = int(W*deg/360)  # yaw 0 at left? PSV: yaw 0 = image center
        x = (x + W//2) % W
        d.line([(x,H//2-30),(x,H//2+30)], fill=s["accent"], width=4)
        d.text((x, H//2+70), f"{deg}°", font=small, fill=s["accent"], anchor="mm")
    for deg,name in [(0,"N"),(90,"E"),(180,"S"),(270,"W")]:
        x=(int(W*deg/360)+W//2)%W
        d.text((x, H//2+170), name, font=mid, fill=s["accent"], anchor="mm")
        d.text((x, H//2-330), s["letter"], font=big, fill=s["accent"], anchor="mm", stroke_width=8, stroke_fill=(0,0,0))
    d.text((W//2, H//2-640), f"SCENE {s['letter']} - {s['label']}", font=mid, fill=s["accent"], anchor="mm", stroke_width=4, stroke_fill=(0,0,0))
    # look-here target: a star at yaw 120, pitch 10
    x=(int(W*120/360)+W//2)%W; y=int(H/2 - H*10/180)
    d.ellipse([x-60,y-60,x+60,y+60], outline=(255,40,40), width=14)
    d.text((x, y+110), "TARGET", font=small, fill=(255,40,40), anchor="mm")
    im.save(f"{out}/{key}.jpg", quality=82, optimize=True)
    im.resize((512,256)).save(f"{out}/{key}.thumb.jpg", quality=75)
print("ok")
