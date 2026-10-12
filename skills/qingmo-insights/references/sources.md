# 公开 Skill 来源与改编

调研日期：2026-10-11。先查找 GitHub 上的相关 Skill，再阅读入口和对应方法文件。下面固定到实际读取的 commit；公开可读不等于已经证明分析效果。

## flomo 官方产品参考

[AI 洞察帮助](https://help.flomoapp.com/ai/insight.html) 用于补充体验要求：单条记录也能得到回应，多条记录可连接主题，判断附来源，并允许按时间和标签聚焦材料。轻墨据此明确单条与跨记录解读的区别、同日笔记的独立引用，以及重新解读时仍须忠于材料。

这份帮助介绍的是产品行为，没有公开内部提示词。以下公开 Skill 仍是方法改编的来源；没有把官网介绍当作 flomo 原始提示词，也没有移植其会员额度、全部视角或关联检索服务。

## 默认洞察与 CBT

来源：[jasonge27/guided-journaling-skill](https://github.com/jasonge27/guided-journaling-skill/tree/57d79d58b70e8d6c7bde602ce0783b106b0f619a)，MIT，Copyright (c) 2026 Jason Ge。

- [SKILL.md](https://github.com/jasonge27/guided-journaling-skill/blob/57d79d58b70e8d6c7bde602ce0783b106b0f619a/skills/guided-journaling/SKILL.md)：跨记录联系、变化、不同回顾方式。
- [reflective.md](https://github.com/jasonge27/guided-journaling-skill/blob/57d79d58b70e8d6c7bde602ce0783b106b0f619a/skills/guided-journaling/modes/reflective.md)：先理解体验与意义，不急着安排解决方案。
- [cbt.md](https://github.com/jasonge27/guided-journaling-skill/blob/57d79d58b70e8d6c7bde602ce0783b106b0f619a/skills/guided-journaling/modes/cbt.md)：事件、自动想法、感受、双向证据、平衡解释和小行动。

轻墨改成基于选定速记的一次性解读，不读取全部会话目录、不自动保存对话，也不虚构情绪分数或练习后感受。默认洞察允许以理解或问题结束。

## 价值澄清

来源：[SkillMedev/skills — life-coach](https://github.com/SkillMedev/skills/blob/6b3044d569595b481a3677da8f68af7aa239dc09/skills/life-coach/SKILL.md)，MIT，Copyright (c) 2026 Alexander Ouellet。

取用 values clarification 和 GROW 的方法：从真实体验辨认价值，再放回目标、现实、选项和可行选择中理解。改成从笔记取材，不要求作者配合完整教练访谈；不移植信心打分、强制承诺、截止日期和每周追踪。

## 逆向思考与二阶思考

来源：[ponomr/thinking-toolkit](https://github.com/ponomr/thinking-toolkit/tree/e7ae7711f472ce53080fd7a49e0a3cf151120611)，MIT，Copyright (c) 2026 Aleksei Ponomar。

- [SKILL.md](https://github.com/ponomr/thinking-toolkit/blob/e7ae7711f472ce53080fd7a49e0a3cf151120611/SKILL.md)：选定方法后读取对应卡片，保留事实、假设与建议的区别。
- [inversion.md](https://github.com/ponomr/thinking-toolkit/blob/e7ae7711f472ce53080fd7a49e0a3cf151120611/references/inversion.md)：失败条件、机制、可控性、早期信号、反向预防，以及预防措施自身的成本。
- [abstraction-laddering.md](https://github.com/ponomr/thinking-toolkit/blob/e7ae7711f472ce53080fd7a49e0a3cf151120611/references/abstraction-laddering.md)：从手段向目的上移，再回到具体可行的不同路径。
- [second-order-thinking.md](https://github.com/ponomr/thinking-toolkit/blob/e7ae7711f472ce53080fd7a49e0a3cf151120611/references/second-order-thinking.md)：与维持现状比较，追踪后续反应、收益和成本，在推演失去依据时停止。

截图里的“二阶思考”强调“问题之上的问题”，因此用 Abstraction Laddering 处理问题表述，再按需要看后续影响。没有把它缩成一张长期利弊表；企业风险表和固定数量的方案不移植到个人笔记回顾。

## MBTI 分析

来源：[ChangyuanYU/mbti-expert-skill](https://github.com/ChangyuanYU/mbti-expert-skill/tree/8a5837a2e98d837533a5575a6ebcff0b2057ba91)，MIT，Copyright (c) 2026 ChangyuanYU。

- [SKILL.md](https://github.com/ChangyuanYU/mbti-expert-skill/blob/8a5837a2e98d837533a5575a6ebcff0b2057ba91/mbti-expert/SKILL.md)：先区分输入与证据，再形成解释。
- [evidence_extractor.md](https://github.com/ChangyuanYU/mbti-expert-skill/blob/8a5837a2e98d837533a5575a6ebcff0b2057ba91/mbti-expert/prompts/evidence_extractor.md)：把行为与原始来源、维度、相反线索和限制联系起来。
- [typing-rules.md](https://github.com/ChangyuanYU/mbti-expert-skill/blob/8a5837a2e98d837533a5575a6ebcff0b2057ba91/mbti-expert/references/foundations/typing-rules.md)：避免将四组偏好简化为话多、害羞、冷漠或整洁。

轻墨保留证据优先、维度分别判断和不确定性；去掉按回复速度直接判型、未经校准的百分比分数、多轮自动追问、聊天与照片导入、模拟人物生成。资料充分时可提出暂定类型假设，资料不足则保留未知维度。关于作者自行确认偏好，另参考 [Myers & Briggs 的 best-fit 说明](https://www.myersbriggs.org/unique-features-of-myers-briggs/best-fit-type/)。

## 结构对照与未移植内容

[Undertone0809/flomo-skills 的 flomo-insight](https://github.com/Undertone0809/flomo-skills/blob/17e697589482960c9662a645519f01efe409cf8e/.agents/skills/flomo-insight/SKILL.md) 与本需求最接近：统一入口负责解释任务，各视角通过 Reference 按需读取。已读其入口用于结构对照；该 commit 的目录树未发现许可证文件，GitHub 许可元数据为空，因此没有复制其正文，也没有移植 flomo-local-api、固定时间窗口或其其他视角。

[leilei926524-tech/mbti-coach](https://github.com/leilei926524-tech/mbti-coach/blob/071290464be86b702e7c672c210a0c09fb92feb3/SKILL.md) 也已查阅，但它以目标人格、认知功能加分和日程训练为中心，与本次笔记解读不匹配，未采用。

本 Skill 的本地补充包括：思源块引用、作者与摘录归属、选定范围与截取说明、笔记指令作为数据处理，以及当前危险的优先回应。这些用于适配轻墨的数据与场景，不声称来自截图或原项目。

改编部分的版权与许可见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。未安装任何外部 Skill 或执行其脚本。
