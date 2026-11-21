# dsh-ocean-background

在整个 DSH窗口后方铺一层日间海面动态背景。画面里的船对应正在运行的工作：主 Agent 是一艘持续航行的海盗大船，每个子 Agent 各代表一艘小艇，帆态表示是否在工作，海浪随 token 吞吐起伏。

![海盗模式下的海洋背景预览：主 Agent 的大船在海面航行，右下角显示航行里程](preview.png)

## 画面

- **大船**：代表当前主会话的主 Agent，持续向右航行，镜头水平跟随。工作时满帆，待命或等待输入时收一部分帆。
- **小艇**：每个子 Agent 一艘（含孙级及更深层），工作开始时从左侧驶入伴航，完成、失败或取消后向右驶出。小艇用桨的轻摆表示工作，不套用大船的帆态。
- **海浪**：由 token 吞吐驱动（含输入、输出与缓存四类增量，每秒采样、指数平滑后映射浪高）。费用不参与；空闲时仍有宽缓起伏，高吞吐时出现白沫。
- **海风与景观**：至多两条横跨屏幕的风线；沿途有沙洲、绿岛、岩岸岛、礁石与偶尔掠过的海鸟，景物随距离加雾，不遮挡航线。
- **日夜**：固定柔和日间海景，不随现实时间改变天色。

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

客户端以 web 平台、`immediately` 方式加载，并注入 `@deepseek-ai/dsh-api-session-controller` 以获取会话状态；宿主端注入 `webServer` 与 `sessionController`，在 `/ocean-background` 挂载画面资源和状态接口。

## 设置

右下角的设置按钮打开面板，调整后立即生效并自动保存，暂停时也可调整：

| 设置 | 键 | 默认值 | 范围 |
| --- | --- | --- | --- |
| 显示海面 | `enabled` | `true` | 开 / 关 |
| 背景强度 | `strength` | `0.72` | — |
| 播放 | `running` | `true` | 播放 / 暂停 |
| 画质 | `quality` | `balanced` | `balanced`（约 30 帧）/ `high`（约 60 帧） |
| 摄像机距离 | `cameraDistance` | `44` | 20–100 |
| 摄像机高度 | `cameraHeight` | `4.8` | 2–40 |
| 镜头左右偏移 | `cameraXOffset` | `0` | -8–8（负左正右） |
| 摄像机俯仰角 | `cameraPitch` | `2.7` | -30°–60°（负上正下） |

距离、高度与偏移只改变取景，不计入航行里程。窗口隐藏或最小化时渲染暂停，Agent 运行不受影响。

## 航行里程

设置按钮旁有一行只读里程，与大船的实际前进距离挂钩：

- 空白新会话页显示**今日已航行 X 海里**——本机当天所有船队新增距离之和。
- 第一条用户消息被接受并记录后，切换为**目前已航行 X 海里**——当前船队大船的累计值；查看子 Agent 时沿用所属主船队。
- 暂停、窗口隐藏、系统减少动态效果导致船停止前进时不计里程；关闭背景时读数隐藏。
- 1 海里 = 1852 米，保留两位小数。分叉船队从创建当下的原船队里程接续，继承值不计入今日总数。
- 记录保存在本机 DSH 数据目录，不随 Git 同步，也不跨电脑合并。

## 关闭与卸载

- 临时关闭：URL 加 `?ocean=off`。
- 记住关闭：设置 `localStorage['ocean-background:disabled'] = '1'`。
- 卸载插件即停止渲染与计程，读数随之消失。

## 语言

界面文案内置简体中文与英文，跟随 DSH 当前语言，缺失时回退到英文。

## 素材与许可

- **主船** Stylized Pirate Ship：Maksim Batyrev，CC BY 4.0。已移除原水面、替换帆材质为米白帆布、关闭帆面自发光，并为每面帆烘焙收帆形态。[来源](https://sketchfab.com/3d-models/stylized-pirate-ship-1c62191534174bf7a67470fb02b97db1)
- **小艇** Row Boat：Sk1tle，CC BY 4.0。按船队尺寸缩放、对齐水线、材质未改动；工作时桨轻微摆动。[来源](https://sketchfab.com/3d-models/row-boat-1152ce68ca0e4e78bbd93a10c47056e5)
- **椰子树** Coconut palm：3D Assets，CC0 1.0。[来源](https://3dassets.dev/assets/tropical-island-ecology-coconut-palm-tall-7b181376)
- **three.js**：three.js authors，MIT，随包附带于 `runtime/vendor`，全文见其中的 `THREE-LICENSE.txt`。

## License

MIT
