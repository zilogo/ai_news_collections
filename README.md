# AI News Collections

该项目用于每天聚合 [smol.ai](https://news.smol.ai/rss.xml) 的 AI 新闻，使用大模型进行中文翻译总结，并通过一个简单的前端页面展示结果。

## 功能概览

- `backend/collector.py`：从 RSS 源抓取新闻，调用 OpenAI 大模型翻译并生成中文摘要，存储到 SQLite 数据库中。
- `backend/api.py`：FastAPI 服务，提供 REST API 和网页视图来浏览已存储的新闻。
- 前端模板（`templates/index.html` + `static/styles.css`）展示每日新闻列表，优先显示中文摘要。

## 环境准备

1. 安装依赖：

   ```bash
   pip install -r requirements.txt
   ```

2. 配置 OpenAI API Key：

   ```bash
   export OPENAI_API_KEY="sk-..."
   ```

## 使用方式

### 采集每日新闻

可以通过以下命令手动或配合定时任务（如 cron）执行：

```bash
python -m backend.collector
```

常用参数：

- `--skip-llm`：跳过翻译，只保存原始摘要。
- `--dry-run`：测试运行，不写入数据库。
- `--limit`：限制本次处理的新闻数量。

默认数据会写入 `data/articles.db`。

### 启动展示服务

```bash
uvicorn backend.api:app --reload
```

访问 `http://127.0.0.1:8000/` 即可查看每日 AI 新闻摘要。

也可以访问 `http://127.0.0.1:8000/api/articles` 以 JSON 格式获取数据，方便后续集成。

## 项目结构

```
ai_news_collections/
├── backend/
│   ├── __init__.py
│   ├── api.py             # FastAPI 应用
│   ├── collector.py       # RSS 抓取与翻译逻辑
│   ├── db.py              # SQLite 数据库工具
│   └── llm.py             # OpenAI LLM 调用封装
├── data/
│   └── articles.db        # 运行后生成的数据库（初始为空）
├── requirements.txt
├── static/
│   └── styles.css         # 页面样式
├── templates/
│   └── index.html         # 列表展示页面
└── README.md
```

## 后续扩展建议

- 接入更多 AI 新闻来源或支持自定义 RSS 列表。
- 为文章添加标签、搜索和分页功能。
- 将翻译摘要缓存为 Markdown，支持前端富文本渲染。
