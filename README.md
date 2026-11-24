# dsh-ocean-background

在整个 DSH 窗口后方铺一层日间海面动态背景。画面里的船对应正在运行的工作：主 Agent 是一艘持续航行的海盗大船，每个子 Agent 各代表一艘小艇，帆态表示是否在工作，海浪随 token 吞吐起伏。

![海盗模式下的海洋背景预览：主 Agent 的大船在海面航行，右下角显示航行里程](preview.png)

## 画面

- **大船**：代表当前主会话的主 Agent，持续向右航行，镜头水平跟随。工作时满帆，待命或等待输入时收一部分帆。
- **小艇**：每个子 Agent 一艘，含孙级及更深层。工作开始时从左侧驶入伴航，完成、失败或取消后向右驶出。小艇用桨的轻摆表示工作，不套用大船的帆态。
- **海浪**：由 token 吞吐驱动，含输入、输出与缓存四类增量，每秒采样、指数平滑后映射浪高。费用不参与；空闲时仍有宽缓起伏，高吞吐时出现白沫。
- **海风与景观**：至多两条横跨屏幕的风线；沿途有沙洲、绿岛、岩岸岛、礁石与偶尔掠过的海鸟，景物随距离加雾，不遮挡航线。
- **日夜**：默认正午海景。开启时间跟随后按本机时钟在 24 小时调色板之间插值，也可以钉在清晨、正午、黄昏、深夜四个预设。
- **天气**：晴、雨、雪三档。雨天有斜落的雨丝，雪天有飘散的雪片，海面颜色与雾感一起变。晴雨雪可以手动选择，也可以按经纬度跟随现实天气。
- **灯笼**：入夜后主船挂起灯笼，光亮随夜色加深而变强。
- **旗帜**：主船帆位可以换成上传的图片，删掉就回到默认帆布。

## 安装与启用

作为依赖安装：

```bash
npm install dsh-ocean-background
```

在 DSH bundle 的 `cordis.patch.yml` 中加一条插件行：

```yaml
insert:
  - id: ocean-background
    name: 'dsh-ocean-background'
```

客户端以 web 平台、`immediately` 方式加载，并注入 `@deepseek-ai/dsh-api-session-controller` 以获取会话状态；宿主端注入 `webServer` 与 `sessionController`，在 `/ocean-background` 挂载画面资源与快照接口。

## 设置

右下角的设置按钮打开面板，调整后立即生效并自动保存，暂停时也可调整：

| 设置 | 键 | 默认值 | 范围 |
| --- | --- | --- | --- |
| 显示海面 | `enabled` | `true` | 开 / 关 |
| 背景强度 | `strength` | `0.72` | 0.35–0.95 |
| 播放 | `running` | `true` | 播放 / 暂停 |
| 画质 | `quality` | `balanced` | `balanced` 约 30 帧 / `high` 约 60 帧 |
| 摄像机距离 | `cameraDistance` | `44` | 20–100 |
| 摄像机高度 | `cameraHeight` | `4.8` | 2–40 |
| 镜头左右偏移 | `cameraXOffset` | `0` | -8–8，负左正右 |
| 摄像机俯仰角 | `cameraPitch` | `2.7` | -30°–60°，负上正下 |
| 时间跟随现实 | `followTime` | `false` | 开 / 关 |
| 时段预设 | `timePreset` | `day` | `dawn` / `day` / `dusk` / `night` |
| 天气跟随现实 | `followWeather` | `false` | 开 / 关 |
| 天气 | `weatherPreset` | `clear` | `clear` / `rain` / `snow` |
| 纬度 | `weatherLat` | 空 | -90–90，保留两位小数 |
| 经度 | `weatherLon` | 空 | -180–180，保留两位小数 |

距离、高度与偏移只改变取景，不计入航行里程。窗口隐藏或最小化时渲染暂停，Agent 运行不受影响。

**背景强度**控制的是宿主界面表面的半透明度，让海面透出来；海面本身的颜色与浪高不由它改变。

切换画质不会重建画面：只调整像素比、目标帧率与海面网格密度，镜头和船队状态保持不变。

## 时间与天气

时间跟随时用本机时钟的小时数，关闭时用 `timePreset` 对应的小时：`dawn` 6 点、`day` 12 点、`dusk` 18 点、`night` 0 点。24 小时按关键帧插值，天色、太阳方向、海水深浅与雾色一起过渡，不会在整点跳变。灯笼亮度跟着夜色浓度走。

天气选 `rain` 或 `snow` 时直接生效：雨是斜向线段，雪是柔和点精灵，`balanced` 画质下的数量约为 `high` 的一半。海面颜色和天空雾感同步调整。

开启天气跟随后，插件每 15 分钟用 `weatherLat` / `weatherLon` 取一次 `GET /ocean-background/weather?lat=&lon=` 的实况，映射成晴、雨、雪三档；一小时拿不到数据就回到晴天，不会停在上一次的结果里。坐标留空时不发请求。面板上的“使用当前位置”按钮请求 `GET /ocean-background/geo`，按出口 IP 粗定位，把经纬度截断到两位小数后填进两个坐标框。

外部请求只有两条：定位用 `ipwho.is`，失败回退 `geojs.io`；天气用 Open-Meteo 的 forecast 接口。这两个服务会看到本机的出口 IP 与坐标，请求只在你点定位或开启天气跟随时发出。

## 旗帜与摇晃

旗帜通过宿主接口管理，文件存在 DSH 数据目录的 `ocean-background` 下，文件名是 `main-flag.png`、`.jpg` 或 `.webp`：

| 请求 | 作用 |
|---|---|
| `POST /ocean-background/flag` | 上传图片，请求体是文件字节，接受 PNG、JPEG、WebP，上限 2 MiB |
| `GET /ocean-background/flag` | 查询是否已上传与版本号 |
| `GET /ocean-background/flag/image` | 取当前图片 |
| `DELETE /ocean-background/flag` | 删除，回到默认帆布 |

格式按文件头判断，不看扩展名；超过 2 MiB 返回 413，认不出的格式返回 400。上传后其他视图可以派发 `dsh:ocean-flag-changed` 事件让画面马上换旗，`detail` 里带 `hasCustom` 与 `version`，不带就重新查询一次。

摇晃响应 `dsh:window-shake` 事件，`detail.durationMs` 默认 4000，`detail.intensity` 默认 1。系统声明减少动态效果时整段跳过。

## 航行里程

设置按钮旁有一行只读里程，与大船的实际前进距离挂钩：

- 空白新会话页显示**今日已航行 X 海里**，为本机当天所有船队新增距离之和。
- 第一条用户消息被接受并记录后，切换为**目前已航行 X 海里**，即当前船队大船的累计值；查看子 Agent 时沿用所属主船队。
- 暂停、窗口隐藏、系统减少动态效果导致船停止前进时不计里程；关闭背景时读数隐藏。
- 1 海里 = 1852 米，保留两位小数。分叉船队从创建当下的原船队里程接续，继承值不计入今日总数。
- 记录保存在本机 DSH 数据目录，不随 Git 同步，也不跨电脑合并。

## 关闭与卸载

- 临时关闭：URL 加 `?ocean=off`。
- 记住关闭：设置 `localStorage['ocean-background:disabled'] = '1'`。
- 卸载插件即停止渲染与计程，读数随之消失。

## 语言

界面文案跟随 DSH 当前语言，支持简体中文、英文、日文、西班牙文、法文、德文、俄文、葡萄牙文，缺失时回退到英文。文案放在 `locale/*.json`，新增语言只需放一个文件。

## 调试与回归

直接打开 `http://127.0.0.1:9840/ocean-background/?debug=1` 可以在独立窗口中查看渲染结果，此时渲染器自己轮询 `/ocean-background/snapshot`。

- `?seed=7` 固定随机种子，景物与船位抖动可复现。
- `?freeze=1&t=4` 只渲染一帧，海浪时间固定在第 4 秒，便于截图对比。
- `window.__ocean` 暴露 `advance`、`applySettings`、`dispose` 与场景对象，供手工排查。

## 内部结构

宿主页面与渲染器分成两个运行域，用一个共享契约通信：

```
宿主 Node                     宿主页面                     iframe
host/routes.js      ───GET /snapshot───>  client.js  ──postMessage──>  runtime/app.js
host/snapshot.js                          deck 只轮询一次          只渲染，回传里程
```

- `host/`：路由、快照聚合、会话事件折叠、里程账本与 fork 钩子，外加旗帜存储和定位/天气代理。
- `runtime/protocol.js`：协议版本、消息类型与设置 schema 的唯一来源，deck 动态导入，渲染器相对导入。
- `runtime/app.js`：组合根，负责启动、设置、快照、旗帜、摇晃、生命周期与逆序销毁。
- `runtime/env/`：24 小时调色板与天气氛围的纯插值模型，不依赖 three.js。
- `runtime/sim/`：纯模型，海况、泊位、帧时钟、行程积分、航程上报，可在 Node 中直接测试。
- `runtime/world/`：three.js 场景装配，水面、天空、船、船队、景物、风线、灯笼与雨雪。
- `client.js`：宿主页面的 deck，负责设置面板、皮肤、iframe 托管、语言与里程显示。

宿主每秒只计算一次快照，包含会话、船队、token 计数器与里程；渲染器不再自己发请求。计数器带代次标识，船队组成变化时重新取基线，不会把子 Agent 退出误判成空闲。

## 开发

```bash
npm run check   # 语法、JSON、相对导入检查
npm test        # node:test 纯模型与路由测试
npm run sync    # 把工作区同步到 desktop profile 的 node_modules
```

`npm run sync` 默认写入 `~/.dsh/profiles/desktop/node_modules/dsh-ocean-background`，可用 `DSH_OCEAN_TARGET` 指定其他插件目录。同步后重载 Harness 窗口即可看到改动。

## 素材与许可

- **主船** Stylized Pirate Ship：Maksim Batyrev，CC BY 4.0。已移除原水面、替换帆材质为米白帆布、关闭帆面自发光，并为每面帆烘焙收帆形态。[来源](https://sketchfab.com/3d-models/stylized-pirate-ship-1c62191534174bf7a67470fb02b97db1)
- **小艇** Row Boat：Sk1tle，CC BY 4.0。按船队尺寸缩放、对齐水线、材质未改动；工作时桨轻微摆动。[来源](https://sketchfab.com/3d-models/row-boat-1152ce68ca0e4e78bbd93a10c47056e5)
- **椰子树** Coconut palm：3D Assets，CC0 1.0。[来源](https://3dassets.dev/assets/tropical-island-ecology-coconut-palm-tall-7b181376)
- **礁石** Cliff C、Rock Formation D、TallRock 2：由用户提供的免费礁石素材，已转为 GLB 并把贴图压到 1K，只用于岩岛与礁石群；来源与处理说明见 `runtime/assets/rocks/SOURCE.txt`。
- **three.js**：three.js authors，MIT，随包附带于 `runtime/vendor`，全文见其中的 `THREE-LICENSE.txt`。

## License

MIT
