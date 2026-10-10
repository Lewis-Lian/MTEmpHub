# 多月份备份隔离验收复跑

阶段 10 的实际结果见 [计划执行记录](../design/2026-10-09-monthly-backup-plan.md)。这里的脚本只使用合成数据，不构成生产升级或部署指令。不读取项目 `.env`；不要改成生产连接。前端 HTTP 模拟测试、浏览器测试、SQLite 和 MySQL 的证据分别记录。

## 规模与文件上限

仓库根目录运行：

```bash
PYTHON_DOTENV_DISABLED=1 PYTHONPATH=. .venv-mac/bin/python -m pytest docs/testing/monthly_backup_scale.py -q -s
```

使用既有 `backup_app` 临时 SQLite fixture。测试 24 个月、100 名人员、67,200 条日报与月度快照，选择十二月恢复 2,800 条并核对其余月份；另生成 90 MiB 随机内容文件，验证导出、读取、恢复后 SHA256，以及 100 MiB + 1 字节拒绝。打印时间和进程峰值内存，不设凭空推定的生产性能阈值。不是浏览器大列表、网络上传或真实业务数据负载测试。

## 真实 MySQL

`monthly_backup_mysql.py` 是单独调用的验收文件，普通 `pytest tests/` 不会自动连接 MySQL。连接写死为 `/private/tmp/mtemphub-stage10-mysql/server.sock`，先检查 `@@datadir` 必须指向同目录下的 `data`，随后每项创建随机 `mtemphub_stage10_<uuid>` schema 并仅清理自己创建的 schema。禁止通过修改连接复用已有业务实例。

本次使用 [MySQL 官方 macOS ARM 归档](https://dev.mysql.com/downloads/mysql/8.0.26.html)中的 `mysql-8.0.46-macos15-arm64.tar.gz`，下载文件 MD5 校验为 `aefb850c25a2c703a63554283fb94cae`。压缩包和独立数据目录都在 `/private/tmp`，没有 Homebrew 安装、全局服务、默认 MySQL 配置或开机启动。只需在这个全新测试目录初始化一次；目录已有数据时禁止重复初始化。

本次启动使用以下参数（仅为该临时实例的复跑说明）：

```bash
/private/tmp/mtemphub-stage10-mysql/mysql-8.0.46-macos15-arm64/bin/mysqld --no-defaults \
  --initialize-insecure \
  --basedir=/private/tmp/mtemphub-stage10-mysql/mysql-8.0.46-macos15-arm64 \
  --datadir=/private/tmp/mtemphub-stage10-mysql/data \
  --log-error=/private/tmp/mtemphub-stage10-mysql/init.log

/private/tmp/mtemphub-stage10-mysql/mysql-8.0.46-macos15-arm64/bin/mysqld --no-defaults \
  --basedir=/private/tmp/mtemphub-stage10-mysql/mysql-8.0.46-macos15-arm64 \
  --datadir=/private/tmp/mtemphub-stage10-mysql/data \
  --socket=/private/tmp/mtemphub-stage10-mysql/server.sock \
  --skip-networking --mysqlx=OFF \
  --pid-file=/private/tmp/mtemphub-stage10-mysql/server.pid \
  --log-error=/private/tmp/mtemphub-stage10-mysql/server.log
```

初始化产生本地无密码测试 root，只允许该临时 socket，测试后停止实例。本次 `.venv-mac` 缺 PyMySQL，项目已声明的 `pymysql==1.1.1` 经 PyPI SHA256 校验后仅安装在 `/private/tmp/mtemphub-stage10-python`，因此实际命令为：

```bash
PYTHON_DOTENV_DISABLED=1 PYTHONPATH=.:/private/tmp/mtemphub-stage10-python \
  .venv-mac/bin/python -m pytest docs/testing/monthly_backup_mysql.py -q -s
```

依赖已经存在于 Python 环境时，`PYTHONPATH=.` 即可。默认沙箱可能禁止系统调用或 Unix socket，需为这些明确指向临时实例的命令授予执行权限，不改变数据库连接来绕过限制。

迁移验收在测试 schema 中从当前模型构建数据库，再删除本次两项迁移新增结构以重建 `20261009_meal_rules` 状态，保留业务/审计行，stamp 到这个已构建的测试版本，然后 upgrade 到 head 并再次 upgrade 验证幂等。不是全历史迁移链或未知生产 schema 验证。

并发验收使用独立数据库连接/会话：恢复持锁时普通写入进入 `performance_schema.data_lock_waits`；普通写入先持锁并提交后恢复拒绝旧指纹；同主机两项恢复由文件锁串行执行，后一项必须重比。不是分布式多主机、故障注入或高并发压力测试。规模与文件测试同样在独立 MySQL schema 执行。

## 浏览器布局回归

在 cua_repl 中读取 `monthly-backup-browser-layout.js` 的函数，给它已连接隔离前后端的 tab，上传包含跨月/年度条目的 ZIP 后调用：

```javascript
await assertMonthlyBackupListVisible(tab)
```

必须有非零记录和非零滚动区域高度。该断言验证实际浏览器 flex 布局，不能用 jsdom 尺寸替代。实际逐条选择、409、回滚保留选择、成功 warnings 和重新登录证据见计划续验记录。
