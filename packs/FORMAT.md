# .inkellepack 格式（formatVersion 1）

依据 Inkelle 的 `Services/Packs/PackService.swift`。

## 容器

- 扩展名 `.inkellepack`，本质是 **store-only zip**（不压缩，`ZIP_STORED`）。
- 根目录必须有 `pack.json`；payload 放在 `templates/`、`stickers/`（封面可放 `covers/`，当前客户端只校验、不安装）。
- App 端会先逐条校验每个 payload 的图片头（ImageIO 能解码），不合格则整个包以 `malformed` 拒绝。

## pack.json

| 字段 | 类型 | 约束 |
|---|---|---|
| `formatVersion` | int | 必须 `1`（`>1` 报 unsupportedVersion，`<1` 报 malformed） |
| `id` | string | 仅 `[A-Za-z0-9-]`，非空，**≤ 64 字符**；同 id 重装 = upsert（模板 id 由 `id + file` 稳定派生） |
| `name` | string | 包显示名 |
| `author` | string? | 可选 |
| `items` | array | **≤ 500 条** |

`items[]`：

| 字段 | 类型 | 约束 |
|---|---|---|
| `type` | string | `template` / `sticker` / `cover` |
| `file` | string | zip 内相对路径，见下 |
| `category` | string? | 模板分类；首尾空白会被裁掉，空串视为未分类 |
| `name` | string? | 模板显示名 |

## 路径规则（`file`）

- 非空；不能以 `/` 开头；不能含 `\`；
- 以 `/` 分段后不得有 `..` 段，也不得有空段（即不能有 `//` 或结尾 `/`）。
- 贴纸扩展名必须是 `png` / `jpg` / `jpeg`（大小写不敏感）。
- 图片单边 ≤ 16384 px，总像素 ≤ 64,000,000。
- 每个 `file` 必须真实存在于 zip 中，否则 missingFile。

## 最小示例

```json
{
  "formatVersion": 1,
  "id": "demo-pack",
  "name": "示例包",
  "author": "Inkelle",
  "items": [
    { "type": "template", "file": "templates/lined.png", "category": "学习", "name": "横线页" },
    { "type": "sticker", "file": "stickers/star.png", "category": "几何" }
  ]
}
```

## 构建

```
python3 packs/build_pack.py packs/src/<id>     # 校验并输出 packs/<id>.inkellepack
python3 packs/build_pack.py --index            # 扫描所有 .inkellepack 重新生成 index.json
```
