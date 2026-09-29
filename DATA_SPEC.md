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
- **语言类取原始文本**（未归一化前，含重音算 spanish），**计费长度取实际下发文本**（短链已缩短、GSM 归一化后）——见 `sms_billing_segments_short`。

### 1.5 状态流转
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

## 9. 使用这份规范（给 AI 的约定）

1. 回答任何"发了多少/成本多少/送达率多少"前，**先明确角色作用域**（这是可见范围前提）。
2. SMS 对账/送达率口径 = **送达/受理**（排除 in_flight 与 simulado）；不要混淆"发送总数"与"送达数"。
3. 计费**只算实际成功**；SMS 分片、邮件逐封、电话按分钟向上取整。
4. 需要"和运营商日报一致"时，务必用默认 `report_tz=carrier`（UTC+8）。
5. 联系人维度统计一律 180 天窗口 + 尾10位/小写邮箱匹配。
6. 数据出现矛盾时：以本文件定义核对代码，更新文档而非猜测数字。