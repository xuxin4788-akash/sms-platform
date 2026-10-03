# DATA_SPEC.md — 数据口径规范（供 AI / 管理者核算、对账、审计使用）

本文件是平台所有可统计数据的**计算口径唯一权威定义**。任何 AI、报表、对账、计费核算都必须依照本规范运行，避免因口径不一致产生矛盾数字。所有口径均与实际代码（app.py）核对一致。

> 使用约定：读本规范时若某接口返回字段与本文冲突，以**实际代码为准**并更新本文。

---

## 0. 权限作用域（所有统计的"看得到多少"前提）

所有数据列表与统计接口都按当前登录用户 `role` 裁剪可见范围，三类角色：

| 角色 | 可见范围 | SQL 形态 |
|------|---------|---------|
| `admin`（系统管理员） | 全系统所有行 | 无额外过滤 |
| `team_admin`（团队管理员） | 自己 + 自己 `team_creator_id` 下的所有成员 | `created_by IN (SELECT id FROM users WHERE id=? OR team_creator_id=?)` |
| `team_member`（团队成员） | 仅自己的行 | `created_by = ?` |
| 自定义角色 | 等同 member，除非勾选了团队级菜单权限（由 `role_permissions` 驱动） | 同上 |

> 角色解析唯一入口：`get_me` 读 `role_permissions`。`team` 过滤（按 team_admin）与 `sender` 过滤（按单账号）都会通过 `_resolve_team_scope_filter` 收敛到当前角色可见范围——超出即被钳制。

---

## 1. SMS（短信）

### 1.1 核心对账口径（`/api/sms/statistics` + "Conciliacion con operador"）
对账视图**只统计真实到达运营商的记录**，用 `api_msg` 排除模拟发送（`NOT LIKE '%simulado%'`）。

| 指标 | 口径（逐行判定） |
|------|-----------------|
| `submitted`（已提交/受理） | `api_code = 0`（运营商受理） |
| `delivered`（已送达） | `status = 'delivered'`（最终状态 DR=1） |
| `in_flight`（发送中） | `status = 'sent'`（已受理，DR 未回执） |
| `rejected`（被拒） | `api_code <> 0`（提交时被拒） |
| `failed`（失败） | `status = 'failed'` |
| `simulated`（模拟） | `api_msg` 含 `simulado` |
| `total` | 该范围内所有真实记录（排除 simulate） |
| `delivery_rate`（送达率） | `delivered / submitted`，即**累计已送达 / 累计已受理**（不含 in_flight，因为尚未回执） |
| `billing_parts` | `SUM(billed_segments)`，按发送时存储的分片数 |

### 1.2 时间口径（对账日分界 `report_tz`）
- `carrier`（默认）：**UTC+8（北京时区）**，与运营商 Rileci 日报严格一致。
- `local`：业务本地时区（America/Mexico_City）。
- `utc`：UTC。
- 日期字段统一归一化为 `YYYY-MM-DD`；`date_from`/`date_to` 相互包含；日期反转自动纠正。

### 1.3 顶部 KPI 与"今日发送"
- 有日期/账号过滤 → 直接取对账块数字。
- 无过滤 → `Enviados Hoy` = 所选 report_tz 下**当日被受理（api_code=0）**的条数。
- 顶层 KPI 与对账面板**使用同一组数字**（历史曾出现"成功率口径不一"问题，现已统一）。

### 1.4 计费口径（分 national x billed_segments）
- **单价解析优先级** `get_sms_unit_price_for(uid)`：国家价（`sms_billing_prices`，按账号生效国家）→ 否则 `sms_api_configs.unit_price` → 否则全局默认 `sms_unit_price`。
- **计费量** = `SUM(billed_segments)`（每条记录存储片数，不再请求时重算，保证大表性能与一致性）。
- **可计费状态**：`sent` / `delivered`（已发出才计）。
- 语言分片规则 `sms_billing_class` + `sms_billing_segments`：
  - `latin`（英文/印尼/纯 ASCII 西语，无重音）：单条 ≤160，拼接 153。
  - `cjk`（含 CJK）/ `spanish`（含重音西语字符）：单条 ≤70，拼接 67。
- **语言类与长度均取"实际下发文本"**（`sms_billing_segments_short(sent_msg, ...)`）：计费按 GSM 归一化、支付短链缩短后真正下发的 `sent_msg` 来定档和算长度。
  - 员工输入带重音（如 `María`）但归一化后变纯 ASCII（`Maria`）→ 实际下发为 latin → 走 **160/153** 档，**不因"原文有重音"而按 70 收费**。
  - 仅当非 ASCII 字符在归一化后**仍然保留**（如真·CJK）时，才走 70/67 档。
  - 历史记录可用 `/api/sms/recompute-billing` 按此规则重算（`sms_records.content` 本就是归一化文本）。

### 1.5 短信内容字符数口径（char_count）
- **计数单位**：Python `len(text)`，即 **Unicode 码点数（1 个汉字 / 1 个西语字母都算 1 个字符）**，不是字节数，也不是 GSM 编码位数。
- **区分两种字符数**（二者可能不同）：
  | 口径 | 取值 | 用途 |
|------|------|------|
| 原始字符数 | `len(原始内容)`（用户输入/模板，含重音） | 仅展示用；**不再**决定计费（见 §1.4，语言类改由下发文本定） |
| 下发字符数 `char_count` | `len(normalize_sms_text(内容))`（GSM 归一化、支付短链缩短后的实际下发文本） | 同时用于**定语言类**与算**分片数/计费长度** |
- **归一化影响**：`normalize_sms_text` 把重音西语字符转写为 ASCII（á→a、ñ→n、¿¡去除等），无法映射的非 ASCII 字符丢弃，因此**下发字符数可能小于原始字符数**（丢弃字符）或相等（纯 ASCII 时一致）；不会变大（当前映射均为单字符替换）。
- **与分片关系**：`char_count` 对照语言类阈值（latin 160/拼接 153；spanish/cjk 70/拼接 67）算出 `billed_segments`，公式 `ceil(n / 阈值)`。
- **数据来源**：`POST /api/sms/check-charset` 返回 `char_count`（=下发字符数）；历史记录 `sms_records.content` 存储的就是实际下发文本，字符数可对其 `len(content)` **实时计算，无需额外存储列**。
- **注意**：`char_count` 统计的是码点，不等同运营商按 GSM 7bit/UCS-2 的**编码单元**计费（如 GSM 扩展字符 `^{}\[~]|€` 各占 2 个码元）；本平台当前归一化后下发内容基本落在 GSM 基本字符集，故以码点数近似编码长度，如后续允许扩展字符需按 GSM 码元另行折算。

### 1.6 状态流转
`sent`（受理）→ `delivered`（送达）｜ `rejected`｜ `failed`｜ `simulated`。`billed_segments` 在发送时就地计算并存储，后台 `/sms/state` 轮询回执更新状态。

---

## 2. 电话（`/api/voice/records` + `/api/voice/statistics`）

| 指标 | 口径 |
|------|------|
| `today_calls` | `date(initiated_at)=今天` 的记录数 |
| `total` | 范围内总数 |
| `completed` | `status='completed'` |
| `failed` | `status IN ('failed','no-answer','busy','canceled')` |
| `pending` | `status IN ('pending','initiated','ringing','answered')` |
| `total_duration` | `SUM(duration)` **仅 completed**（秒） |
| `answer_rate` | `completed / total * 100`（1 位小数） |
| `configured` | 账号国家是否有启用的真实供应商配置 |
| `provider` | `infin8linx`（真实）/ `simulation` |
| `can_call` | 未配置或 simulation 时 true；infin8linx 时必须有固定分机 `extnumber` |

**作用域**：admin 全量；team_admin 自己+团队成员；member 仅自己。

---

## 3. 网页电话 Webphone（SIP 软电话）

| 指标 | 口径 |
|------|------|
| `account_total` / 各渠道计数 | 来自 `webphone_records` 生命周期事件（answered/terminated/failed/rejected/no-answer/busy/canceled/unknown） |
| `answered` 分钟 | 每次呼叫时长按 **ceil(秒/60)** 向上取整（≥1 分钟），仅 duration>0 计入 |
| `total_cost` | `price/分钟 × 分钟`，按账号国家（`webphone_billing_prices`）取单价 |
| 日聚合 | `webphone_daily_stats` 每账号每天一行，由工作日线程重算 upsert |

**作用域**：与 SMS/voice 相同（member 自己 / team 团队 / admin 全系统）。

---

## 4. 邮件（`/api/email/records` + `/api/email/statistics`）

### 4.1 状态统计口径
| 指标 | 口径 |
|------|------|
| `total` | 范围内总数 |
| `sent` | `status IN ('sent','simulated')` |
| `failed` | `status='failed'` |
| `pending` | `status='pending'` |
| `suppressed` | `status='suppressed'` |
| `success_rate` | `sent / total * 100`（1 位小数） |
| `configured` | 是否已配置 SMTP |

### 4.2 计费口径（facturacion **全局**，非按国家）
- **单价**：`email_config.unit_price`（单一全局值，`get_email_unit_price()`）。
- **计费量**：**1 封 = 1 计费单位**（不同于 SMS 分片）。
- **可计费状态**：仅 `status='sent'`（**simulated/pending/failed/suppressed 不计费**，避免测试发送虚增）。
- **`cost`** = `unit_price × COUNT(status='sent')`。

### 4.3 范围与过滤
- `scope`=own（仅当前账号）/ team（管理作用域）/ auto（按角色规则，默认）。
- 支持 `team`（team_admin 单元）/ `sender`（单账号）过滤，均钳制到可见范围。
- `#/email-records` 请求 own；`#/email-records-team` 请求 team。

---

## 5. 管理员用量（`/api/admin/user-usage`）

| 字段 | 口径 |
|------|------|
| `total_users` | 可见用户总数 |
| `total_sent` | `status IN ('sent','delivered')` 的短信记录数 |
| `total_failed` | `status='failed'` 的记录数 |
| `total_all` | 所有短信记录数 |
| 团队汇总 | admin 看全部团队（按 team_admin 聚合，member_count = 成员数+自己，sent/failed/total，rate=sent/total）；team_admin 只看自己团队 |
| 时间过滤 | `date_from`/`date_to` 作用于 `sms_records.created_at` |

---

## 6. 联系人维度活动统计（`list_contacts` + `contact_card` + `email_reply_contact_panel`）

**匹配键**：联系人手机号**尾 10 位**（`_phone_digits_tail`）与记录手机号尾 10 位精确匹配；邮件按**小写 email 与 `recipient_email` 匹配**。

**统计窗口**：**180 天**（`-180 days`，PG / SQLite 均一致）。

| 字段 | 口径 |
|------|------|
| `sms_count` | 180 天内该联系人的短信记录数 |
| `call_count` | 180 天内该联系人的语音呼叫数 |
| `talk_time` | 180 天内 completed 通话总时长（秒） |
| `email_count` | 180 天内发往该联系人邮箱的邮件记录数（按 email 匹配） |

来源：`contacts` 列表通过 SQL 子查询 LEFT JOIN `sms_records`（尾 10 位 LIKE 粗滤 + 精确匹配）、`voice_records`、`email_records`（按 LOWER(email)）聚合；`_contact_stats_map` 供面板/批量查询用。

> **联系人隔离**：`_contact_scope_for_group` 不再因联系人被加入团队共享群组而扩大范围，始终按角色账户作用域隔离（群组仅作普通过滤；群组本身仍团队可见/可用）。

---

## 7. 计费/结算汇总口（跨渠道）

| 渠道 | 单价来源 | 计费单位 | 计费状态 |
|------|---------|---------|---------|
| SMS | 国家价 > 国家 api 配置 > 全局默认 | `SUM(billed_segments)` | `sent`/`delivered` |
| 邮件 | `email_config.unit_price`（全局） | 1 封 = 1 单位 | 仅 `sent` |
| 电话 / Webphone | 账号国家 `webphone_billing_prices`（/分钟） | ceil(秒/60) 分钟 | 已接通且 duration>0 |

- 短信/电话按**国家**分开配置与计价；邮件按**全局单值**计价（`#/email-pricing` 为统一计费页）。
- 所有只读统计必须用列名（PG RealDictCursor），禁止整数索引。

---

## 8. 工作质检 / 流程质检（`/api/admin/work-quality`，admin）

用途：检查员工是否跟进到位、承诺的下次跟进是否按时兑现（非内容合规质检）。

- **承诺字段（contacts 表）**：
  - `next_follow_up_at`：员工承诺的下次跟进时间（datetime；空值 = 无承诺/清除承诺）。
  - `follow_up_note`：承诺备注（≤500 字符）。
  - 两字段由联系人 create/update 读写，card/list 返回；前端编辑弹窗有"Promesa de proximo seguimiento"入口。
- **实际最近触达 `last_touch`（按联系人）**：
  - 取以下四类记录的最大时间：`sms_records` / `voice_records` / `webphone_records`（均按电话**尾 10 位**匹配）+ `email_records`（按**小写邮箱**匹配）。
  - 全部限制在 **180 天**窗口内（与第 6 节一致），无任何记录则视为未触达。
- **承诺分桶**（只看承诺时间与 `last_touch`，与活动窗口无关）：
  | 分桶 | 条件 |
  |------|------|
  | `promised_done` 已兑现 | 承诺时间 ≤ 现在 且 last_touch ≥ 承诺时间 |
  | `overdue` 已逾期 | 承诺时间 < 现在 且 last_touch < 承诺时间（或无触达） |
  | `upcoming` 待到期 | 承诺时间在未来 |
  | `no_promise` 无承诺 | `next_follow_up_at` 为空 |
  - `promised = promised_done + overdue + upcoming`；`overdue_rate = overdue / promised`。
- **活动窗口（只影响动作计数与"是否 inactivo"）**：`date_from`/`date_to`，默认**最近 60 天**。窗口内四类动作之和为 0 → `inactive=true`。
- **联系人停滞 `stale`**：在 `stale_days`（默认 7，可配）内无任何触达的联系人数；`stale_rate = stale / total_contacts`。
- **风险定级（账户）**：
  - 红：窗口内 `inactive`，或 `overdue_rate ≥ 0.30`，或 `stale_rate ≥ 0.50`。
  - 黄：存在 overdue 或 stale，或有联系人但无任何 upcoming 承诺。
  - 绿：其余（承诺按期 + 近期有触达）。
  - 团队风险：成员中任一为红即红，任一为黄即黄，否则绿。
- **返回**：`{teams, accounts, summary, date_from, date_to, stale_days}`；accounts 含至多 50 条 `overdue_list`（contact_id/name/phone/promised_at/overdue_days/note）；支持 `team=<team_admin_id>` 过滤。
- 口径注意：承诺及时性是**时点判断**（用查询当下时间），活动量是**区间统计**，两者时间口径不同，汇报时需区分。

---

## 9. 发送限额强制（SMS / 邮件）

- **三层日限额**，取最严格（最小正值），`0` = 无限制：
  | 层级 | SMS | 邮件 |
  |------|-----|------|
  | 团队限额 | `team_config.daily_sms_limit` | `team_config.daily_email_limit` |
  | 全局限额 | `team_config.global_daily_sms_limit` | `team_config.global_daily_email_limit` |
  | 用户限额 | `users.daily_limit` | （同 users.daily_limit 语义，邮件仅取团队/全局） |
- **适用角色**：
  - SMS：`role == 'team_member'`（自定义角色目前不在 SMS 拦截内）。
  - 邮件：`role not in ('admin','team_admin')`（team_member + 自定义角色）。
  - 成员须有有效 `team_creator_id`，否则团队限额不匹配 = 实际无限制（属配置问题）。
- **计数口径（当天已用）**：按**本地日**（SQLite `date(created_at)=date('now','localtime')`；PG `date(created_at)=CURRENT_DATE`）。
  - SMS 计 `status IN ('sent','pending')`（含 simulated，因其也写 sent）；
  - 邮件计 `status IN ('sent','simulated','pending')`，退订/投诉名单地址不占额度。
- **判定**：`used + 本批数量 > limit` → HTTP **429**，整批拒绝（不会部分发送）。单批另有限制：SMS ≤ 500 号码/次。
- **并发安全（防 TOCTOU）**：多 Gunicorn worker 下，先 `SELECT id FROM users WHERE id=? FOR UPDATE` 取该账户行锁（提交时释放），再读计数，使同一账户的并发发送串行，避免两个请求同时看到"未满额"而合计超限。SQLite 无需锁（单 writer）。
- **前端预检（体验层，不可信）**：发送页加载时调 `GET /api/my/send-quota` 取今日已用 + 有效限额，实时显示「今日 X/Limit」，并在"已用 + 当前选中数 > limit"时置灰提交按钮、给出剩余/超出数量。该层仅为即时反馈，可被绕过，**不替代**服务端行锁强制。发送成功后刷新该接口。
- 另有单批上限：SMS 500 号码/请求；超限直接拒绝。

---

## 10. 明细级对账口径（每一通 / 每一条 / 每一封）

> 本节定义"可逐条对账的明细流水"——每一条都由一张业务表的一行承载，无法再细分。
> 全部分组 / 汇总 / 结算都应以这些明细为唯一事实来源（`settlement`、`work-quality`、`statistics` 均由它们聚合而来）。
> **时间口径统一用"实际发生时点"**：电话取 `initiated_at`、短信/邮件取 `sent_at`；两者为空时回退 `created_at`（入队/受理时点）。**账户名一律 `JOIN users` 取 `full_name`（空则 `username`）**。

### 10.1 电话（每通一个 `voice_records` 行）

| 你要的字段 | 来源列 | 说明 |
|-----------|--------|------|
| 发起账户 | `created_by → users.username` | 谁发起的外呼 |
| 拨打对象 | `phone`（+ `contact_name` 快照） | 目标号码/对象 |
| 拨打日期及时间 | `initiated_at` | 发起时刻（空则 `created_at`） |
| 是否拨通 | `status` | `completed/answered` = 接通；`failed/no-answer/busy/canceled` = 未通 |
| 通话时长 | `duration`（秒） | 仅接通后 > 0；按分钟向上取整用于计费 |

**可补充（已存，非必需）**：`answer_at` 接通时刻、`finished_at` 结束时刻、`record_file` 是否留存录音（可作通话真实性的证据链）、`price`（供应商计费）、`extnumber` 用哪个分机呼出、`country` 归属国家。

**注意**：`initiated_at`/`finished_at` 是"本平台发起"，个别供应商模式下 `status`（尤其 completed）以 `POST /api/voice/cdr` 回调为准回填 `duration`。

### 10.2 短信（每一条一个 `sms_records` 行）

| 你要的字段 | 来源列 | 说明 |
|-----------|--------|------|
| 发起账户 | `created_by → users.username` | 谁发送 |
| 发送对象 | `phone`（+ `contact_name`） | 目标号码 |
| 发送日期及时间 | `sent_at` | 实际发送时刻（空则 `created_at`） |
| （可选）是否送达 | `status` | `delivered`=已送达；`sent`=已受理待回执；`failed`=失败 |
| （可选）发送内容 | `content` | 正文（实际下发文本，归一化+短链缩短后） |
| （可选）内容字符数 | `len(content)` | 下发字符数（Unicode 码点），口径见 §1.5；实时计算无需存储 |

**可补充（已存）**：`billed_segments`（计费分片数）、`dr_state`/`dr_checked_at`（回执轮询状态）、`msgid`（运营商回执 ID）、`delivered_at`。

### 10.3 邮件（每封一个 `email_records` 行）

| 你要的字段 | 来源列 | 说明 |
|-----------|--------|------|
| 发起账户 | `created_by → users.username` | 谁发送 |
| 发送对象 | `recipient_email`（+ `contact_name`） | 收件邮箱 |
| 发送日期及时间 | `sent_at` | 实际发送时刻（空则 `created_at`） |
| 是否有回复 | `email_replies` 关联 | `LEFT JOIN(email_replies ON original_record_id=email_records.id)`；存在行即有回复，`is_read` 标记是否已读（见下） |

**回复口径（重要）**：
- "有回复"= 该封邮件的 `email_records.id` 能在 `email_replies.original_record_id` 找到对应行。
- 回复的**关联规则**：按自动回信关联（SNS 回调经 From/To 匹配原始外发记录）或人工在回复详情页把回复挂到某封外发记录（`POST /api/email/replies/<id>/contact` 与 `original_record_id`）。未配置 SES 收发规则时，回复不会自动进入系统 → "是否有回复"为空是**接收链路未配置**而非无回复。
- 一封信可对应多条回复；若要"是否至少一条"用 `EXISTS`。

### 10.4 端到端对账单（建议的审计视角）

| 维度 | 电话 | 短信 | 邮件 |
|------|------|------|------|
| 发起账户（员工） | ✅ | ✅ | ✅ |
| 发起账户所属团队 | employees.team_creator_id（admin 全量） | 同左 | 同左 |
| 对象 | phone | phone | recipient_email |
| 时点 | initiated_at | sent_at | sent_at |
| 结果 | status + duration | status | status + 有回复？ |
| 成本 | price(completed) | billed_segments×单价 | 1 封×单价(sent) |

### 10.5 统一活动流水（可用的现成实现）

平台已提供 `GET /api/activity` 与前端 `#/activity`（Actividad Consolidado），把电话/短信/邮件**混排成明细流**，每行即 10.1–10.3 的一条行为，并额外注入：

- `kind`：`phone` | `sms` | `email`
- `at`：统一时点（各自 `initiated_at`/`sent_at`，空则 `created_at`）
- `account` + `team_name`：发起账户姓名 + 所属团队（`users.team_creator_id` → 团队负责人名；无团队显示 "Sin equipo"）
- 电话：`answered`（1=completed/answered 即拨通）+ `duration_sec` + `country`
- 邮件：`reply_count`（该邮件收到的回复条数，0=无回复，`null`=该类无此维度字段）

筛选支持：`kind`、`date_from/date_to`、`team`（按团队单元=负责人+成员）、`account`（单个账户）、`search`（目标/联系人/内容/状态）、分页；`?export=1` 输出 UTF-8-BOM CSV（Tipo, Fecha y hora, Cuenta, Equipo, Destino, Contacto, Resultado, Duracion(s), Con respuesta），导出上限 `ACTIVITY_EXPORT_MAX_ROWS`。

**作用域**：与 SMS/邮件一致（admin 全量 / team_admin 自己+成员 / member 仅自己）。前端页面当前仅 admin 可见菜单；接口本身按登录角色收敛，后续如需开放给团队管理员可放开菜单即可。

| 列 | 来源 | 说明 |
|----|------|------|
| Tipo | `kind` | phone/sms/email |
| Fecha y hora | `at` | 三渠道统一时点 |
| Cuenta | `users.full_name`(=username) | from `created_by` |
| Equipo | `team_name` | 团队负责人名（`team_creator_id`） |
| Destino | `phone` / `recipient_email` | 拨打对象/收件邮箱 |
| Contacto | `contact_name` | 名称快照 |
| Resultado | `status` + `answered`/`reply_count` | 是否拨通、邮件是否有回复 |
| Duracion(s) | `duration` | 电话通话秒数 |

### 10.6 基于明细数据的员工工作监控（建议方向）

明细流水是员工监控的**数据底座**（可逐条追查"谁、何时、对谁做了什么"）。围绕 10.1–10.5，建议的监控口径：

1. **工作量**：按账户对 `kind` 计数（电话/短信/邮件各自多少条）——直接复用 `/api/activity` 的 `count(kind)`，配合 `at` 做时间窗口/按时段。
2. **质量**：
   - 电话拨通率 = `answered=1` / 电话总数；
   - 电话平均通话时长 = `AVG(duration_sec)`（空话/秒挂 = 低质量信号）；
   - 邮件回复率 = `reply_count>0` / 已发送邮件数；
   - 短信送达率 = `status=delivered`（需已接运营商回执）。
3. **时效/承诺**：与已实现的 `/api/admin/work-quality`（Calidad del Trabajo）配套——它聚合各联系人"最近触达"并与承诺跟进时间对比，判断员工是否按承诺及时跟进、是否有停滞/逾期。明细流为它提供"最近触达"的逐条证据来源。
4. **空转/低效**：单一账户在窗口内有大量 `initiated_at`/`sent_at` 但 `status` 多为 failed/未拨通 时，提示进运营商或号码质量问题而非员工效率问题——建议先排除客观失败再定性；这是判定"偷懒"前的**排除口径**。

**约束**：① 判定"偷懒/怠工"需以客观动作（明细行）+ 承诺对比（work-quality）双证据，避免单一指标误伤；② 数据可信度依赖回调/回执链路接通（电话 CDR、短信回执、SES 收发）——监控上线前应先确认这三条链路在目标部署已接通（见 10.3 回复口径提示）。

---

## 11. 使用这份规范（给 AI 的约定）

1. **少用分组、多用明细**：任何"按账户/按团队发了多少"的结论，最终都要能反向落到 10.1–10.3 的具体行为上（可追查、可对账）。
2. 回答任何"发了多少/成本多少/送达率多少"前，**先明确角色作用域**（这是可见范围前提）。
3. SMS 对账/送达率口径 = **送达/受理**（排除 in_flight 与 simulado）；不要混淆"发送总数"与"送达数"。
4. 计费**只算实际成功**；SMS 分片、邮件逐封、电话按分钟向上取整。
5. 需要"和运营商日报一致"时，务必用默认 `report_tz=carrier`（UTC+8）。
6. 联系人维度统计一律 180 天窗口 + 尾10位/小写邮箱匹配。
7. 数据出现矛盾时：以本文件定义核对代码，更新文档而非猜测数字。