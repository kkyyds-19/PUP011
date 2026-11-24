# Playable Variant Kit（Cocos Creator 3.8）

这套组件把“同一份游戏构建导出 6 种跳转行为”的运行时与打包逻辑放在一个可复制扩展中。

## 迁移到新项目

1. 新项目需先安装并可正常使用 `extensions/super-html`。
2. 把整个 `extensions/playable-variant-kit` 复制到新项目的 `extensions` 目录，然后重启 Cocos Creator。
3. 点击 **扩展 > Playable Variant Kit > 安装或更新场景组件**。
4. 编辑项目根目录的 `playable-variant-kit.config.json`：至少修改 `outputBuildPrefix`、`androidUrl`、`iosUrl`。
5. 把 `assets/PlayableVariantKit/PlayableVariantKit.prefab` 拖进**启动场景**，并保持节点和组件启用。运行时会自动创建常驻会话，切换场景后继续生效。

Prefab 不依赖原项目的 `MessageCenter`、`adMgr`、本地化或游戏控制器。

## 场景接入

- 首个启用的组件默认自动发送 `game_ready`、`game_start`，并从此刻开始计算全屏点击。后续场景不会重复发送或清零。
- CTA 的 `Button.ClickEvent` 可把目标设为 `PlayableVariantKit` 节点，组件选 `PlayableVariantKit`，方法选 `DownloadFun`。
- 游戏结束时任选一种方式通知组件：

```ts
// 有组件引用时
playableVariantKit.gameEnd();

// 不导入组件，浏览器构建中也可使用全局入口
(window as any).PlayableVariantKit?.gameEnd();

// 或派发通用事件
window.dispatchEvent(new Event('playable:game-end'));
```

如果游戏不是进入场景后立刻开始，请在 Inspector 关闭“进入场景自动开始计数”，并在真正开始时调用 `gameStart()` 或派发 `playable:game-start`。

## 多场景接入

- **连续切换场景：**只需在启动场景放一个 Prefab。运行时创建独立的 `PlayableVariantKitRuntime` 常驻节点，跨场景保留点击次数、跳转模式、商店链接及开始/结束状态。例如 `3Click` 在场景 A 点击两次后切到 B，B 中再点击一次就会跳转；切换场景本身不会结束游戏。
- **每个场景都放也可以：**场景内 Prefab 作为调用入口共享同一会话，不会重复监听点击或重复上报生命周期。各场景原有 CTA 到 `DownloadFun` 的 Inspector 绑定仍然有效，包括返回或重新加载同一场景。
- **单独预览或分别作为启动场景：**每个可能独立启动的场景都放一个 Prefab。只预览没有 Prefab 的场景时，不会凭空创建会话。
- **参数以首次创建会话的组件为准：**后续 Prefab 的链接、调试模式及自动开始选项不会覆盖当前会话。建议商店链接统一通过项目配置注入，场景 Prefab 使用一致设置。
- **后续场景没有 Prefab：**脚本可调用 `PlayableVariantKit.instance?.DownloadFun()`，或浏览器全局入口 `(window as any).PlayableVariantKit?.download()`；结束时调用 `gameEnd()`。Inspector 需要绑定本场景节点时，直接再放一个 Prefab。
- **重新开始一局：**切换或重载场景会继续当前会话；需要从零计数时显式调用 `resetSession()`。关闭自动开始时，重置后仍需调用 `gameStart()`。
- 在 Cocos 的 Web Mobile 构建任务中勾选所有需要切换的场景，并设置正确的启动场景；扩展沿用该列表，不会自动添加场景，也不会逐场景分别出包。

## 一键导出

1. 在 Cocos Creator 的“构建发布”中配置并保存 **Web Mobile** 任务，输出目录应与 `webBuildRoot` 一致（默认 `build/web-mobile`）。已有该任务可直接使用。
2. 点击 **扩展 > Playable Variant Kit > 一键导出全部版本**。
3. 默认结果位于 `build/playable-variants`。

菜单会保存当前有改动的场景并刷新资源，然后检查脚本、场景、Prefab、图片等资源、项目设置、构建模板、扩展代码和所选构建任务配置的内容指纹。首次使用、内容发生变化或 Web Mobile 产物缺失/被改写时，先自动构建，成功后再刷新渠道产物并导出全部版本；没有变化时直接复用构建。构建失败、取消或构建期间仍有文件变化时停止导出，不会继续打包旧产物。重复点击不会启动第二次导出。

指纹记录在 `temp/playable-variant-kit/web-build-state.json`，无需提交。首次升级到此流程会保守地重建一次。修改本扩展代码后，请在扩展管理器中重新加载 `playable-variant-kit`，或重启当前项目编辑器。

也可在命令行执行（命令行只负责打包现有构建，自动检查/构建由编辑器菜单执行；命令行使用前仍需完成最新的 Web Mobile 构建）：

```bash
node extensions/playable-variant-kit/cli.js --project .
```

固定生成以下 9 个版本：

- `Full`：仅 CTA 跳转。
- `1Click`：从第 1 次点击结束开始，每次点击都跳转。
- `2Click`：从第 2 次点击结束开始，每次点击都跳转。
- `3Click`：从第 3 次点击结束开始，每次点击都跳转。
- `4Click`：从第 4 次点击结束开始，每次点击都跳转。
- `5Click`：从第 5 次点击结束开始，每次点击都跳转。
- `30s`：`gameStart` 后 30 秒强制打开商店并上报 `game_end`（只触发一次，玩家已点过 CTA 则不重复打开）。
- `120s`：`gameStart` 后 120 秒强制打开商店并上报 `game_end`（规则同上）。
- `InstantRedirect`：收到 `gameEnd()` 后立刻跳转。

每个版本包含 15 个渠道文件：Adikteev、Applovin、Facebook、Google 横版/竖版/自适应、InMobi、IronSource、Liftoff、Mintegral、Moloco、Remerge、TikTok、Unity、Vungle。脚本会校验 9 × 15 共 135 个 HTML/ZIP 后才报告成功。

## 配置

`playable-variant-kit.config.json`：

| 字段 | 含义 |
| --- | --- |
| `webBuildRoot` | Cocos Web Mobile 构建目录 |
| `sourceRoot` | super-html 的渠道产物目录 |
| `outputRoot` | 全部版本的输出目录；导出时只重建此目录 |
| `outputBuildPrefix` | 各版本文件夹和文件名的共同前缀 |
| `creatorVersion` | 调用 super-html 时使用的 Creator 版本 |
| `refreshSuperHtml` | 命令行导出前是否刷新渠道产物；编辑器菜单始终刷新，保证使用检查后的 Web Mobile 构建 |
| `androidUrl` / `iosUrl` | 打包时注入所有 HTML/ZIP 的商店链接 |

`outputBuildPrefix` 末尾不需要手动写下划线。打包器会先移除末尾已有的下划线，再统一补一个分隔符。例如 `MNFPLY0008_ControltheBall_PLY_V1` 会生成 `MNFPLY0008_ControltheBall_PLY_V1_1Click`；即使配置末尾已经有 `_`，也不会输出双下划线。

调试时可在浏览器 URL 添加 `?redirectMode=click-2`、`5click`、`time-30s`、`time-120s`，也可在 Prefab Inspector 的“调试模式覆盖”中填写模式。正式交付时应留空，由打包结果自动注入。

## 兼容性说明

- 运行时只依赖 Cocos `cc` 模块。
- 打包端依赖 `super-html`，并使用其自带的 `jszip`；如果项目单独安装了 `jszip` 也可以使用。
- 脚本只删除并重建配置中的 `outputRoot`，不会删除 Web Mobile 或 super-html 原始构建。
