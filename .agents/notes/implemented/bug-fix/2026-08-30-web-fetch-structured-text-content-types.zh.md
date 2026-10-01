# Agent Note: HTTP fetch provider 将结构化文本 application 类型按文本解码

Status: implemented

[English](2026-08-30-web-fetch-structured-text-content-types.md) | 中文

## 问题

`web-fetch-http` provider 的 `classifyContentType` 原先只接受 `text/*`、`application/json`、`application/xml` 以及 `+json`/`+xml` 后缀；其余一切 `Content-Type` 都以 `WEB_UNSUPPORTED_CONTENT_TYPE` 拒绝。服务器经常把 shell 脚本、JavaScript、YAML、TOML、CSV 标注为 `application/x-sh`、`application/javascript`、`application/yaml`、`application/toml` 或 `application/csv`，模型因此完全无法读取这些资源。该故障在生产部署上暴露：抓取一个 `.sh` URL 返回 `unsupported content type "application/x-sh"`，任务停滞。

## 决策

`classifyContentType` 识别 `TEXT_APPLICATION_TYPES` 集合的成员——`application/json`、`application/xml`、`application/javascript`、`application/x-javascript`、`application/x-sh`、`application/x-shellscript`、`application/x-python`、`application/yaml`、`application/x-yaml`、`application/toml`、`application/sql`、`application/csv`——外加 `text/*` 与 `+json`/`+xml` 后缀，并把它们全部归类为 `text`。该集合列举承载人类可读文本的 MIME 标签：结构化配置、源代码与数据交换格式。抓取这类 body 会解码为内容；执行它仍走 shell capability 的已批准路径，本 provider 不触碰。二进制标签（包括 `application/octet-stream`）仍返回 `undefined` 并响亮失败。

## Alternatives considered

**接受所有 `application/*` 标签为文本。** 否决：二进制 body（`application/octet-stream`、PDF、压缩包）会被解码成替换字符乱码并当作内容呈给模型；精确的成员资格让拒绝保持有意义。

**增加请求参数让模型覆盖分类。** 否决：缺陷在 provider 的策略里，不在请求词汇表里；强制参数会扩大工具面，并迫使每个调用方绕过策略而不是修好它。

**只加 `application/x-sh`。** 否决：同样的误分类会在 JavaScript、YAML、TOML、Python、SQL、CSV 标签上重演；部署属主要求的是常见结构化文本类可用，不是单个 MIME 标签。

## Consequences

shell 脚本、JavaScript、YAML、TOML、SQL、CSV、Python 资源的抓取解码为文本并到达模型。五条新单元用例把 `application/x-sh`、`application/x-shellscript`、`application/javascript`、`application/yaml`、`application/toml` 钉在 `text` 上。新增结构化文本标签只需向 `TEXT_APPLICATION_TYPES` 加一行；被遗漏的标签继续响亮失败而不是解码成乱码。
