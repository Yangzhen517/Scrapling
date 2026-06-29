# 淘宝类目分析 MVP

这个示例包含一个 Chrome 插件和一个 FastAPI 后端，用于采集淘宝搜索结果第一页可见商品，并生成类目市场概览。

## 运行后端

```bash
cd examples/taobao_category_analysis
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

如需启用通义千问大模型摘要，先设置环境变量：

```bash
export DASHSCOPE_API_KEY="你的 DashScope API Key"
export DASHSCOPE_MODEL="qwen3.6-plus"
export DASHSCOPE_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
```

也可以在 `examples/taobao_category_analysis/.env` 写入同名配置；该文件已被 `.gitignore` 忽略。如果不设置 `DASHSCOPE_API_KEY`，后端会自动使用本地确定性摘要，接口仍可正常返回。

页面地址：

```text
http://127.0.0.1:8000/
```

如果 `8000` 端口已被占用，可以改用其他本地端口，例如：

```bash
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8001
```

然后打开同端口页面：

```text
http://127.0.0.1:8001/
```

接口地址：

```text
POST http://127.0.0.1:8000/api/category-analysis
```

## 安装插件

1. 打开 Chrome 的 `chrome://extensions/`。
2. 开启开发者模式。
3. 点击“加载已解压的扩展程序”。
4. 选择 `examples/taobao_category_analysis/extension`。
5. 打开 `http://127.0.0.1:8000/`，输入类目名称并点击“开始分析”。

如果修改过插件代码或切换到了 `8001` 等其他本地端口，请在 `chrome://extensions/` 点击该扩展的刷新按钮，再刷新类目分析页面。

插件 popup 仍保留手动采集能力：打开淘宝搜索结果页后，可点击插件里的“采集并分析当前页”。

## 数据边界

- 只采集用户当前浏览器第一页可见商品。
- 不自动翻页，不自动滚动。
- 不读取或上传 Cookie、账号信息、完整 HTML。
- 分析结果只代表当前页样本，不代表全站完整类目。
