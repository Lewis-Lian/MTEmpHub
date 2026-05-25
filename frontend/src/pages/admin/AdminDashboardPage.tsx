import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { fetchAdminBootstrap } from "../../api/admin";
import ErrorState from "../../components/feedback/ErrorState";
import LoadingState from "../../components/feedback/LoadingState";

export default function AdminDashboardPage() {
  const [departmentCount, setDepartmentCount] = useState(0);
  const [shiftCount, setShiftCount] = useState(0);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadBootstrap() {
      try {
        const payload = await fetchAdminBootstrap();
        if (!mounted) {
          return;
        }
        setDepartmentCount(payload.departments.length);
        setShiftCount(payload.shifts.length);
        setError("");
      } catch (caughtError) {
        if (!mounted) {
          return;
        }
        setError(caughtError instanceof ApiError ? caughtError.message : "后台首页初始化失败");
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadBootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  if (isLoading) {
    return <LoadingState message="正在加载后台首页..." />;
  }

  if (error) {
    return <ErrorState description={error} title="后台首页加载失败" />;
  }

  return (
    <section className="legacy-page-section">
      <header className="legacy-page-header">
        <div className="legacy-page-heading">
          <p className="legacy-page-kicker">后台管理</p>
          <h2 className="legacy-page-title">账套与主数据入口</h2>
          <p className="legacy-page-description">统一进入账套、主数据和后台资源维护入口，按当前菜单继续处理月度结算、基础数据和账号权限配置。</p>
        </div>
        <dl className="legacy-page-side-info">
          <div className="legacy-page-side-item">
            <dt>当前状态</dt>
            <dd>后台入口已就绪</dd>
          </div>
          <div className="legacy-page-side-item">
            <dt>资源概况</dt>
            <dd>{departmentCount + shiftCount} 项基础资源</dd>
          </div>
        </dl>
      </header>
      <section className="admin-dashboard-grid">
        <section className="legacy-surface admin-dashboard-panel">
          <div className="admin-dashboard-panel-head">
            <div>
              <p className="admin-dashboard-panel-kicker">资源概况</p>
              <h3 className="admin-dashboard-panel-title">当前基础数据</h3>
            </div>
          </div>
          <div className="admin-dashboard-stat-list">
            <article className="admin-dashboard-stat-item">
              <span className="admin-dashboard-stat-label">部门数量</span>
              <strong className="admin-dashboard-stat-value">{departmentCount}</strong>
              <p className="admin-dashboard-stat-note">用于员工归属、查询维度和月度汇总组织结构。</p>
            </article>
            <article className="admin-dashboard-stat-item">
              <span className="admin-dashboard-stat-label">班次数量</span>
              <strong className="admin-dashboard-stat-value">{shiftCount}</strong>
              <p className="admin-dashboard-stat-note">用于排班、考勤计算和月度结算规则维护。</p>
            </article>
          </div>
        </section>
        <section className="legacy-surface admin-dashboard-panel">
          <div className="admin-dashboard-panel-head">
            <div>
              <p className="admin-dashboard-panel-kicker">管理入口</p>
              <h3 className="admin-dashboard-panel-title">后台工作区说明</h3>
            </div>
          </div>
          <div className="admin-dashboard-entry-list">
            <article className="admin-dashboard-entry-item">
              <strong>账套与月度结算</strong>
              <p>从左侧菜单进入账套、管理人员加班和年假入口，继续处理当前月度参数和结算数据。</p>
            </article>
            <article className="admin-dashboard-entry-item">
              <strong>基础数据维护</strong>
              <p>进入部门、班次、员工和账号页面，维护后台主数据与权限配置。</p>
            </article>
            <article className="admin-dashboard-entry-item">
              <strong>修正与审核</strong>
              <p>在对应后台资源页里查看覆盖记录、导入结果和异常修正情况。</p>
            </article>
          </div>
        </section>
      </section>
    </section>
  );
}
