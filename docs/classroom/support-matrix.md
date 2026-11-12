# 瀏覽器與 VR 裝置支援矩陣

> 「已測試」只代表在下表註明的環境實際跑過。其餘都是依官方文件推定，**上課前請用學校的實際裝置測一次**。

## 一般 360° 模式（Photo Sphere Viewer）

| 裝置 / 瀏覽器 | 狀態 | 備註 |
| --- | --- | --- |
| Linux Chromium（Playwright headless，桌面 1280×860 與手機 390×844 尺寸） | ✅ 已自動化測試（mock 模式） | 不是真手機，觸控與陀螺儀沒有測到 |
| Windows / macOS Chrome、Edge | ⚠️ 未實測 | 預期可用 |
| iPhone / iPad Safari（iOS 16+） | ⚠️ 未實測 | 陀螺儀需使用者點按鈕授權；需 HTTPS |
| Android Chrome | ⚠️ 未實測 | 陀螺儀需 HTTPS |
| 學校 Chromebook | ⚠️ 未實測 | |

## VR 沉浸模式（Three.js + WebXR `immersive-vr`）

| 頭盔 | 瀏覽器 | 狀態 | 替代方案 |
| --- | --- | --- | --- |
| Meta Quest 2 / 3 / 3S / Pro | Meta Quest Browser | ⚠️ 未實測（官方支援 WebXR，需 HTTPS、需使用者按按鈕） | 一般 360° 模式 |
| HTC VIVE Focus 3 / XR Elite（獨立式） | VIVE Browser | ⚠️ 未實測；WebXR 支援依韌體版本而定 | 一般 360° 模式 |
| HTC VIVE / VIVE Pro / Cosmos（接 PC） | PC 上的 Chrome / Edge + SteamVR（OpenXR） | ⚠️ 未實測；需 PC 端瀏覽器啟用 WebXR 並正確設定 OpenXR runtime | 一般 360° 模式（PC 螢幕） |
| HTC VIVE Flow | — | ⚠️ 未實測；不確定是否支援 `immersive-vr` | 一般 360° 模式 |
| Pico 4 | Pico Browser | ⚠️ 未實測 | 一般 360° 模式 |
| 手機 Cardboard 類眼鏡 | Android Chrome | ⚠️ 未實測；部分 Android 支援 WebXR | 一般 360° 模式 + 陀螺儀 |
| iPhone | Safari | ❌ iOS Safari 不支援 `immersive-vr`，不會顯示 VR 按鈕 | 一般 360° 模式 + 陀螺儀 |

行為：只有在 HTTPS 且 `navigator.xr.isSessionSupported("immersive-vr")` 回傳 true 時才顯示「進入 VR」；
否則顯示原因並使用一般模式（自動化測試已確認不支援時沒有假按鈕）。進入 VR 一定要學生自己按。

VR 模式目前**沒有**：控制器射線點選熱點、VR 內的解說卡文字面板、VR 內換場景選單（場景仍由老師同步切換）。
