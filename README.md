# APEX · MotorcycleHMI

浏览器 3D 摩托骑行与实时 HMI 实验台。从赛道车辆状态，经模拟 CAN 报文、信号解码与仪表状态机，驱动同一块虚拟 TFT。

**[在线试玩](https://stdwang.github.io/MotorcycleHMI/)**

![骑行画面](assets/riding.png)

## 体验

- 自动演示、八车两圈比赛、自由练习、HMI 实验台四种模式。
- 追尾、座舱、仪表特写、电影四种视角；晴天、黄昏、雨夜三种环境。
- 新手、标准、专业辅助；分段计时、排名、抢跑处罚与摔车复位。
- CAN Trace、信号质量、DTC、13 类故障注入与诊断 JSON 导出。
- 仪表支持中英文、公英制、自动光感与日夜主题。
- 场景、车辆和声音由程序生成，支持键盘、触屏与手柄。

## 操作

| 操作 | 按键 |
| --- | --- |
| 油门 / 刹车 | W / S 或上下方向键 |
| 转向 | A / D 或左右方向键 |
| 切换视角 | C |
| 暂停 / 重来 | P / R |
| 左右转向灯 / 远光灯 | Q / E / L |
| 确认告警 / 仪表信息页 | Enter / Tab |

进入页面会自动演示，按驾驶键或触摸场景接管；也可以从底部选择比赛、练习或实验台。新手辅助会在弯前制动，按住油门即可练习完整一圈。点击声音按钮开启音效。

手机使用屏幕方向与踏板按钮，推荐横屏。手柄使用左摇杆转向、RT 油门、LT 刹车、A 确认、Y 切换相机、Start 暂停。

实验台滑块只在 HMI 实验台模式生效，故障注入可在任意模式使用。通过“工程台”查看报文、信号和诊断码。

## 本地运行与验证

需要 Node.js 22 或更新版本。

```sh
npm ci
npm run serve
```

打开 `http://127.0.0.1:4176/`。

```sh
npm test
npm run build
```

浏览器检查使用本仓库的 Playwright。首次使用安装 Chromium，随后执行浏览器与跑圈检查：

```sh
npx playwright install chromium
npm run test:browser
npm run test:lap
```

也可以设置环境变量 `HMI_CHROMIUM` 指向本机已有的兼容 Chromium 浏览器可执行文件。

## 构建与部署

`npm run build` 清理并生成 `dist/`，其中的文件可以直接托管到静态服务器，支持仓库子路径。当前在线版本使用本仓库 `gh-pages` 分支根目录，通过 GitHub Pages 发布。

## 结构

```text
Track / Bike / Race → ECU → CAN / DBC → SignalStore → ClusterModel → TFT
         ↓                                                   ↓
    Three.js 场景                                  工程台 / 告警 / 诊断
```

`Session` 统一驱动骑行、实验台与自动化验收的模拟时钟。全部车辆数据均为模拟数据。

使用 [Three.js](https://threejs.org/) 渲染，许可证见 [THREE-LICENSE.txt](web/vendor/THREE-LICENSE.txt)。参考 [Starter-Kit-Racing](https://github.com/mrdoob/Starter-Kit-Racing) 的赛车组织思路。
