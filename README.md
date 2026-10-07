# 全球摄像头 · Webcam Radar

一个 Mac 桌面小程序：实时观看世界各地的公开直播摄像头，**每 2 分钟自动切换一个画面**。

基于 Electron + hls.js + Leaflet，数据源为 [SkylineWebcams](https://www.skylinewebcams.com)。

## 功能

- **全球实时直播**：真 HLS 视频流（非静态图），来自全球 71 个国家 / 2000+ 个公开摄像头。
- **自动轮播**：默认每 2 分钟切换（可选 1 / 2 / 5 / 10 分钟），随机或顺序播放。
- **世界地图定位**：右侧 Leaflet 地图标出当前摄像头所在国，显示国旗、国家/城市、简介与当地时间；下方预览"下一个"。
- **手动控制**：上一个 / 下一个、暂停轮播、按国家筛选、全屏、↗ 用浏览器打开原页面。键盘 ← → 切换、空格暂停。
- **桌面小挂件**：420×292 透明无边框小窗，可拖动、置顶/沉底，独立自轮播，点画面打开主窗口。
- **开机自启**：登录自动启动（主窗口 + 挂件）。
- 连不上 / 超时 / 无可用直播流的摄像头会自动跳过，不会卡死。

## 安装

1. 下载 `dist/全球摄像头-1.0.0-arm64.dmg` 或 `.zip`，把 App 拖到「应用程序」。
2. 未签名应用，首次打开需 **右键 → 打开**（或到「系统设置 → 隐私与安全性」允许）。

## 开发 / 打包

```bash
npm install                 # 首次
npm start                   # 开发运行
npm run build               # 打包（需设置镜像，见下）
```

国内网络打包需要镜像配置 `.npmrc`：

```
registry=https://registry.npmmirror.com
electron_mirror=https://npmmirror.com/mirrors/electron/
electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/
```

打包命令：`CSC_IDENTITY_AUTO_DISCOVERY=false npm run build`

### 调试

```bash
CAM_SCREENSHOT=30000 ./node_modules/.bin/electron .        # 定时截主窗到 /tmp/cam_shot.png
WIDGET_ONLY=1 WIDGET_SCREENSHOT=26000 ./node_modules/.bin/electron .   # 只开挂件并截图
```

## 项目结构

```
main.js              主进程：窗口 / 挂件 / IPC / 配置
preload.js           预加载：暴露 window.cam API
catalog.json         摄像头目录（2000+，含名称/国家/城市/页面URL/缩略图）
renderer/
  index.html/app.js/style.css     主窗口
  widget.html/js/css              桌面挂件
  countries.js                    slug → 中文名 / ISO / 坐标
  vendor/hls.min.js               HLS 播放
  vendor/leaflet/                 地图
tools/
  build_catalog.py   重新抓取摄像头目录的脚本
  countries.json     国家 slug 列表
```

## 数据源与取流

- 摄像头页面来自 `www.skylinewebcams.com`，页面内 `Clappr` 播放器的 `source:'livee.m3u8?a=TOKEN'`，
  实际流地址为 `https://hd-auth.skylinewebcams.com/live.m3u8?a=TOKEN`（`livee.` → `live.`）。
- 少数摄像头为 YouTube 源，无法直接取流，程序会自动跳过。

## 从源码更新目录

```bash
python3 tools/build_catalog.py   # 抓取国家页生成 catalog.json
```

## 技术栈

Electron · hls.js · Leaflet · 高德瓦片

## License

MIT
