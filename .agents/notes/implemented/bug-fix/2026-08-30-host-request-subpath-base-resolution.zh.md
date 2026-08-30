# Agent Note: 浏览器对 Host 的请求经 document.baseURI 加入子路径挂载

Status: implemented

[English](2026-08-30-host-request-subpath-base-resolution.md) | 中文

## 问题

反向代理把 Web 客户端挂在子路径（`/deepseek-harness/`）之下时，Session 日志导出对话框始终报 HTTP 404。Host 往 index.html 注入 `<base href="/deepseek-harness/">` 正是为这种部署准备的，但导出控制器用根绝对路径构造请求 URL：`new URL('/api/session.export', base)` 会丢弃 base 的 pathname，落到挂载前缀之外。同样的根绝对路径写法也存在于连接 RPC 解析器和网关流客户端中，而且 base 兜底链（`document.baseURI` → 页面 origin → `http://dsh.internal` 哨兵）在三个包里各复制了一份。

## 决策

浏览器对 Host 的每一次请求都通过 `@deepseek-ai/dsh-client-connection/client/host-base` 的 `resolveHostBase()` 解析 base，并拼接不带前导斜杠的路径，使 URL 拼接保留 `<base href>` 的 pathname。存在 document 时该助手返回 `document.baseURI`；否则在页面 origin 不是 `null` 时返回 origin；否则返回 `http://dsh.internal` 哨兵，使 fixture 的 URL 在不可达的前提下保持结构有效。三个消费方共享它：连接 RPC 客户端、Session 日志导出控制器，以及网关远程流 URL 构造器——后者把解析结果转换为 `ws` 协议。

这个叶子模块作为独立子路径导出发布，接通三个平面。connection 的 `exports` 映射和一条 tsdown lib 条目供给已发布的客户端 bundle。客户端 bundle 纯度门禁的 INLINE_SAFE 集合放行这个纯值模块的跨插件内联。源码平面经 tsconfig.base.json 的手写别名解析该子路径，并由 `dsh-session-log-export` 与 `dsh-api-gateway` 的 client face 显式 project reference 指向 connection 的 client 项目，使 `tsc -b` 把导入重定向到被引用项目的声明输出，而不是把源文件拉过 rootDir。

## Alternatives considered

**只修导出控制器的 URL。** 否决：重复的 base 兜底链和 RPC、流客户端里同样的潜在逃逸仍然存在；下一个浏览器侧消费方会再复制一份私有 base 解析器，重新引入这类 bug。

**从 connection 的 `./client` 入口导出该助手。** 否决：该入口会把 `ConnectionController` 和 fixture 传输拉进每个导入方的客户端 bundle，为一个纯函数膨胀构建产物。

**把模块列入各消费方的 `dsh.client.external` 表。** 否决：external 表的行名是入口 bundle 的导出面，不是叶子子路径；而 external 化会保住一个 INLINE_SAFE 内联本已删除的运行时模块切分。

## Consequences

浏览器客户端代码不再出现根绝对 fetch 路径。消费方若拼接根绝对路径仍会逃出挂载点，因此回归测试在遮蔽的 `document.baseURI` 下把导出对话框钉在 `/deepseek-harness/api/session.export`。base 解析现在只有一个属主，哨兵、origin、baseURI 三个分支的覆盖随代码迁入 connection 与 session-log-export 的客户端测试。新增跨包客户端子路径仍需三平面接线（exports 映射、INLINE_SAFE 条目、源码别名加 client face 引用）；既有通配别名覆盖不了它，因为 TS project reference 没有通配形式。
