# 地图素材

美术按类型分文件夹放，并在 `manifest.json` 里登记。**没有 manifest 时游戏会退回矢量画法**，不会报错、不会白屏，所以可以分批替换。

## 目录结构

```
public/tiles/
├── manifest.json
├── ground/   地面方块顶面
├── side/     台阶侧面
├── prop/     场景装饰物
├── ore/      矿脉图标
└── actor/    角色
```

## manifest.json

键 = 素材 id，值 = **相对路径**：

```json
{
  "ground_meadow": "ground/meadow.png",
  "ground_meadow_2": "ground/meadow_2.png",
  "side_meadow": "side/meadow.png",
  "prop_tree": "prop/tree.png",
  "ore_copper": "ore/copper.png",
  "actor_player": "actor/player.png"
}
```

## id 规则

`<种类>_<名称>`，可加 `_2` / `_3` 后缀表示随机变体（同名的多个变体会被随机挑选，让地面不重复）。

| 种类 | 说明 | 名称取值 | 建议尺寸 |
|---|---|---|---|
| `ground` | 地面方块顶面 | `meadow` `forest` `sand` `snow` `swamp` `ruins` `coast` `water` `highland` | 32×32，无缝平铺 |
| `side` | 台阶侧面（一级） | 同上 9 个 | 32×12 |
| `prop` | 装饰物 | `tree` `pine` `cactus` `mushroom` `pillar` `rock` `oreRock` `bush` | 透明 PNG，宽 32~96 |
| `ore` | 矿脉图标 | `copper` `iron` `gold` `crystal` | 16~32 |
| `actor` | 角色 | `player` `pet` `stalker` `brute` `caster` `boss` | 见下表 |

当前 `actor/` 下的占位图由 `scripts/gen-cute-actors.mjs` 生成：原创 Q 版像素风、透明背景、面向右侧。玩家为紫发/和服/薙刀的雷电系少女占位，宠物是闪电小狐狸，Boss 是放大版暗紫将军风格。画风可爱，但和任何现有游戏角色都不相同。

### actor 标准高度

角色贴图会**等比缩放**到固定高度，所以尺寸随意，比例对了就行：

| 名称 | 高度 | 说明 |
|---|---|---|
| `player` | 52 | 玩家 |
| `pet` | 30 | 灵狐 |
| `stalker` | 44 | 追猎者 |
| `brute` | 54 | 壮汉 |
| `caster` | 48 | 术士 |
| `boss` | 88 | 首领 |

角色按**朝右**绘制，游戏会根据移动方向自动水平翻转。碰撞体固定在脚部（高度的 72% 处），所以脚要画在贴图底部。

## 无缝平铺

地面贴图会被紧密拼接，**不要画边缘描边或暗线**，那会直接变成可见的网格缝。质感用内部的斑块和颗粒表现。

加载时会自动给右边和下边各补 1px 出血（复制边缘像素）来消除亚像素缝隙，所以最右一列和最下一行会被覆盖，重要内容放在中间。

## 版权

请使用你自己有权利的素材（原创、已授权、或明确可商用的素材）。**不要从其他游戏里提取美术资源**，那会侵犯版权。

当前目录下的占位素材是本项目原创的程序化生成图形，仅用于验证渲染链路，可随意替换。如果你想把玩家换成自己绘制的雷电将军形象，只要覆盖 `actor/player.png`（保持透明 PNG、面向右侧即可，高度会自动适配到 52px）。

## 还没接的

攻击特效、掉落物光效目前仍是代码绘制的几何图形，等场景和角色跑通后再接。
