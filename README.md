# Strudel WAV Exporter

把 Strudel 代码直接导出为 `.wav` 音频文件。包含：

- 网页版：输入代码、时长、CPM，点击导出 WAV。
- 命令行版：一条命令把 `.js` 代码文件导出为 WAV。

> 注意：Strudel pattern 通常是无限循环的，所以导出时必须指定 `duration`。

## 安装

```bash
cd /workspace/strudel-wav-exporter
npm install
```

## 网页版

```bash
cd /workspace/strudel-wav-exporter
npm run web
```

然后打开终端里显示的本地地址，例如：

```text
http://localhost:5173/
```

使用方式：

1. 粘贴 Strudel 代码
2. 设置导出时长，例如 `16` 秒
3. 设置速度 CPM，默认 `30`
4. 点击 `导出 WAV`

## 命令行版

```bash
cd /workspace/strudel-wav-exporter
node cli/strudel-export.mjs examples-demo.js --duration 16 --cpm 30 --out output.wav
```

参数：

- `input`：Strudel 代码文件
- `--duration` / `-d`：导出时长，单位秒
- `--cpm`：速度，cycles per minute，默认 `30`，与 Strudel 官方默认速度一致
- `--out` / `-o`：输出 WAV 路径
- `--headed`：显示浏览器窗口，方便调试

例如：

```bash
node cli/strudel-export.mjs beat.js -d 30 --cpm 30 -o beat.wav
```

## 示例代码

`examples-demo.js`：

```javascript
samples('github:tidalcycles/dirt-samples')

stack(
  s("bd:0 ~ bd:0 ~ sn:0 ~ bd:0 ~").gain(0.9),
  s("~ hh:0 ~ hh:0 ~ hh:0 ~ hh:0").gain(0.25),

  note("c2 ~ eb2 ~ f2 ~ g2 ~")
    .s("sawtooth")
    .slow(2)
    .gain(0.45),

  note("c4 eb4 g4 bb4")
    .s("superpiano")
    .slow(4)
    .gain(0.3)
)
```

## 说明

这个工具使用 Strudel 的 WebAudio 离线渲染能力生成 WAV，不是录屏/录标签页，因此没有手动播放和切换页面导致的时差。

如果代码中使用外部 samples，需要联网加载样本。
