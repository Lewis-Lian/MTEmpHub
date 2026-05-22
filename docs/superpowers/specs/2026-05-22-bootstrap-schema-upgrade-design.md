# 启动期 Schema 升级收敛设计

## 背景

当前应用在 `create_app()` 期间会直接执行 `initialize_database()`，而 `initialize_database()` 又会触发 `db.create_all()` 和 `ensure_schema_compatibility()`。这意味着 Web 进程启动时会隐式建表和修改旧库结构。

这个行为在开发阶段方便，但在生产和运维上有两个明显问题：

1. 应用启动与数据库结构升级耦合，启动过程会偷偷改表。
2. 旧库兼容升级没有显式入口，后续迁移到正式 migration 流程时边界不清晰。

## 目标

把“应用启动”和“数据库结构初始化/旧库兼容升级”拆开：

- `create_app()` 只负责应用初始化，不再隐式建表或改表。
- `init-db` 继续作为显式初始化入口，负责建表并执行兼容升级。
- 增加一个单独的 CLI 命令，专门面向已有旧库的兼容升级。

## 非目标

- 这次不把 `ensure_schema_compatibility()` 改写成 Alembic migration。
- 不修改兼容升级的具体表结构逻辑。
- 不调整业务路由、模型或导入逻辑。

## 方案

### 1. 启动路径收敛

从 `app.py` 的 `create_app()` 中移除 `initialize_database()` 调用。应用启动后只完成：

- 加载配置
- 初始化 `db`
- 注册 migrate
- 注册 routes
- 暴露 `/health`

这样应用启动不再依赖数据库写操作。

### 2. 保留显式初始化入口

保留 `manage.py` 中的 `init-db` 命令，并继续调用 `initialize_database()`。这样新环境初始化流程不变，仍然可以通过一个命令完成：

- `db.create_all()`
- `ensure_schema_compatibility()`

### 3. 增加旧库升级命令

新增 `upgrade-legacy-schema` CLI 命令，只执行 `ensure_schema_compatibility()`，用于对已有数据库显式补齐历史字段/表。

预期使用场景：

- 应用升级后，旧数据库需要补字段但不希望在启动时自动执行。
- 运维脚本需要单独控制升级步骤。

### 4. 测试策略

新增或调整以下验证：

- `create_app()` 不再隐式调用 `db.create_all()`。
- `init-db` 仍然会调用 `initialize_database()`。
- `upgrade-legacy-schema` 会调用 `ensure_schema_compatibility()`。
- 既有 schema compatibility 幂等测试继续保留。

## 取舍

### 选择该方案的原因

- 改动最小，不会影响现有兼容升级逻辑。
- 旧库升级入口更明确。
- 为后续迁移到正式 migration 铺路。

### 暂不采用的方案

#### 彻底删除兼容升级逻辑

当前仓库没有现成 migration 版本脚本，且存在多个现有 `.db` 文件，直接删除会切断旧库升级路径，风险过高。

#### 继续保留启动期自动升级

虽然省事，但启动职责仍然过重，且生产行为不可控，不符合这次收敛目标。
