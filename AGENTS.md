# 轻墨（siyuan-qingmo）

思源笔记插件：以思源原生块保存 flomo 式速记。

开工前按需读这几份，它们是唯一依据：

- 产品行为：[docs/轻墨-PRD.md](docs/轻墨-PRD.md)
- 当前交付顺序与状态：[docs/plans/2026-10-12-phase-two.md](docs/plans/2026-10-12-phase-two.md)
- 三轮交互细节对齐：[docs/plans/2026-10-16-interaction-polish.md](docs/plans/2026-10-16-interaction-polish.md)
- 界面尺寸与交互：[docs/design/轻墨-design.md](docs/design/轻墨-design.md)
- 界面代码写法：[docs/前端约定.md](docs/前端约定.md)

几条容易做错的：

- 不复制笔记库，不批量迁移，不修改个人笔记；验证只用隔离工作空间和合成数据。
- 截图与合成数据证据放 `docs/design/acceptance/`，临时探针放 `.scratch/`；个人笔记、录音和腾讯云密钥不入库。
- 不推送、不发布、不部署，除非用户明确要求。
