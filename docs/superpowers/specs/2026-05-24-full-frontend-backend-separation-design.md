# 彻底前后端分离设计

## 背景

当前仓库虽然已经引入了 `frontend/` React + Vite 独立前端，并新增了 `/api/auth/*`、`/api/query/*`、`/api/admin/*` 三组接口，但后端仍然同时暴露以下历史入口：

- 页面型路由：`/`、`/login`、`/logout`、`/change-password`、`/employee/*`、`/admin/*`、`/module/*`
- 历史业务接口：`/employee/api/*`、`/admin/*` 中直接返回 JSON 或文件下载的接口
- 旧鉴权接口：`/api/me`

这导致系统实际上仍是“新前端 + 旧页面/旧接口并存”的混合状态，带来以下问题：

- 前端正式契约不唯一，部署与联调时难以判断哪些路径仍可依赖
- 后端仍承担浏览器入口职责，不符合纯 API 服务边界
- CORS、Cookie、登录态校验逻辑被新旧入口分散，增加独立部署风险
- 测试大量覆盖历史入口，无法证明系统已经真正完成前后端分离

用户本次明确要求：**不保留兼容入口，彻底分离。**

## 目标

- Flask 后端只保留纯 API 与健康检查职责
- React 前端成为唯一浏览器业务入口
- 所有前端使用的正式接口只保留以下路径空间：
  - `/api/auth/*`
  - `/api/query/*`
  - `/api/admin/*`
  - `/health`
- 删除或停止注册所有历史页面路由与旧接口入口，不提供兼容跳转或兼容别名
- 测试与文档同步改造，验证旧入口已经下线

## 非目标

- 不在本次改造中重写现有业务计算逻辑
- 不在本次改造中替换 Flask、React、Vite 或鉴权机制
- 不新增新的管理能力或页面功能
- 不保留任何历史浏览器入口作为过渡方案

## 现状问题归类

### 1. 路由边界混乱

当前 `register_routes()` 同时注册：

- `api_auth_bp`
- `api_query_bp`
- `api_admin_bp`
- `auth_bp`
- `employee_bp`
- `admin_bp`
- `module_bp`

其中后三个蓝图和 `auth_bp` 都仍对外暴露历史入口，导致后端同时承担 API 与页面网关两种职责。

### 2. 新旧接口双轨并存

当前 React 前端使用的是新接口：

- `/api/auth/login`
- `/api/auth/logout`
- `/api/auth/me`
- `/api/query/*`
- `/api/admin/*`

但仓库同时保留大量旧接口：

- `/employee/api/account-sets`
- `/employee/api/departments`
- `/employee/api/final-data`
- `/employee/api/manager-attendance`
- `/admin/account-sets`
- `/admin/employees`
- `/admin/departments`
- `/admin/shifts`

这些旧接口仍可被直接访问，破坏“单一正式契约”。

### 3. 旧页面入口仍存活

后端仍对外处理：

- `/`
- `/login`
- `/logout`
- `/change-password`
- `/employee/home`
- `/employee/dashboard`
- `/admin/dashboard`
- `/module/<slug>`

其中不少路径只是重定向到前端，但只要它们仍由 Flask 提供，就说明前端入口没有彻底独立。

### 4. 测试目标仍然偏向旧架构

现有测试中有大量断言仍依赖：

- 旧页面重定向
- `/employee/api/*`
- `/admin/*`
- `/api/me`

这会让测试继续把“混合架构”视为正确行为，阻碍彻底分离。

## 目标架构

### 后端职责

Flask 后端只负责：

- API 鉴权
- API 权限校验
- 查询类 JSON 接口
- 管理类 JSON 接口
- 文件导出接口
- 健康检查

### 前端职责

React 前端负责：

- 登录页
- 所有业务页面路由
- 页面权限后的客户端导航
- API 调用与错误展示

### 唯一正式接口边界

后端对外只允许以下入口：

- `GET /health`
- `/api/auth/login`
- `/api/auth/logout`
- `/api/auth/me`
- `/api/query/*`
- `/api/admin/*`

除以上路径外，不再保留任何浏览器可访问业务入口。

## 设计方案

### 1. 停止注册历史页面蓝图

在后端路由注册层移除以下蓝图的对外注册：

- `auth_bp`
- `employee_bp`
- `admin_bp`
- `module_bp`

这样可以一次性切断：

- 历史页面入口
- 历史业务接口入口
- 历史重定向逻辑

注意：新 API 蓝图目前依赖旧蓝图文件中的函数级业务实现。因此要区分“函数复用”和“路由暴露”：

- 允许 `api_query_bp`、`api_admin_bp` 继续导入旧模块中的纯业务函数
- 但旧模块自身不再通过蓝图注册对外暴露 URL

### 2. 将新 API 对旧 `auth` 辅助函数的依赖收口

当前 `/api/auth/*` 与部分 API 权限装饰器仍依赖 `routes/auth.py` 中的：

- `login_required`
- `admin_required`
- `page_permission_required`
- `_generate_token`
- `_session_cookie_kwargs`

为避免“API 仍依赖页面蓝图模块”造成概念耦合，需要将这些纯鉴权辅助逻辑提取到独立的 API/认证支持模块，例如：

- `routes/auth_helpers.py`

该模块只保留：

- Token 生成与解析
- Cookie 参数
- 当前用户提取
- 登录校验
- 管理员校验
- 页面权限校验

页面相关函数如 `frontend_url`、`frontend_redirect`、`_landing_url_for_user` 以及页面路由本身应随旧入口一起移除。

### 3. 删除历史页面与兼容鉴权入口

以下入口要直接下线，不做兼容：

- `/`
- `/login`
- `/logout`
- `/change-password`
- `/api/me`
- `/employee/*`
- `/admin/*`
- `/module/*`

预期效果：

- 这些路径应返回 `404 Not Found`
- 不再有后端重定向到前端的逻辑
- 任何旧书签或旧集成调用都视为失效，这是本次改造的有意结果

### 4. 保留并强化新 API 契约

现有 React 前端已经主要使用新契约：

- `frontend/src/api/auth.ts`
- `frontend/src/api/query.ts`
- `frontend/src/api/admin.ts`

本次改造重点不是更改前端调用方式，而是确保这些调用成为唯一正式入口。

需要验证：

- `/api/auth/me` 仍能在未登录时返回 `401`
- `/api/auth/login` 与 `/api/auth/logout` 的 Cookie 语义不变
- `/api/query/*`、`/api/admin/*` 的权限校验仍然生效
- 文件导出接口仍可通过新路径完成

### 5. CORS 范围保持只覆盖正式 API

`configure_api_cors()` 当前仅对 `/api/*` 开启跨域支持，这与目标架构一致，应继续保持。

改造完成后，这个配置会更合理，因为系统将不存在任何需要跨域访问的旧非 `/api/*` 业务入口。

### 6. 测试策略

本次必须先把测试目标改成“纯 API 后端”。

新增或改造测试应覆盖：

- 新 API 基本功能仍然正常
- 历史页面入口全部不存在
- 历史旧接口全部不存在
- 旧 `/api/me` 不存在
- 前端仍可完成构建

建议拆成两类测试：

- 保留并更新新 API 契约测试
- 新增“旧入口已下线”测试

对于仍依赖旧入口的历史测试：

- 直接删除不再成立的断言
- 或改写为断言相同能力已经通过 `/api/*` 提供

## 实施步骤

1. 先补失败测试，明确旧入口必须下线
2. 提取鉴权辅助逻辑到独立模块，解除 `api_*` 蓝图对页面蓝图模块的概念依赖
3. 停止注册 `auth_bp`、`employee_bp`、`admin_bp`、`module_bp`
4. 删除或废弃仅服务历史页面入口的辅助逻辑
5. 更新受影响测试
6. 运行后端测试与前端构建验证
7. 更新 README 中的前后端分离说明，明确后端不再提供任何页面入口

## 风险与处理

### 风险 1：新 API 仍隐式依赖旧页面模块

处理：

- 先提取纯鉴权辅助函数
- 对 `api_query_bp`、`api_admin_bp` 的函数导入逐项验证，只保留业务函数复用

### 风险 2：测试覆盖面大量失效

处理：

- 优先保留验证真实目标的测试
- 明确删除那些只验证“重定向到前端”的旧断言

### 风险 3：前端某些能力仍间接依赖旧接口

处理：

- 全量搜索 `frontend/src/`，确认只使用 `/api/*`
- 构建前端并运行相关后端测试，及时发现遗漏

## 验证标准

完成后应满足：

- 后端注册的公开业务入口只剩 `/api/auth/*`、`/api/query/*`、`/api/admin/*`、`/health`
- 访问 `/login`、`/logout`、`/employee/home`、`/admin/dashboard`、`/module/home`、`/employee/api/*`、`/admin/*` 旧业务接口时返回 `404`
- `/api/auth/*`、`/api/query/*`、`/api/admin/*` 相关测试通过
- `frontend` 可以成功构建
- README 明确描述为“前端独立部署 + Flask 纯 API 后端”

## 结论

本次改造采用“**彻底切断历史入口，只保留纯 API 后端**”方案。后端不再承担任何页面入口或兼容跳转职责，React 前端成为唯一浏览器入口，Flask 只保留鉴权、业务 API、导出和健康检查能力。
