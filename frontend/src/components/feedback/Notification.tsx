import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";

// 定义支持的提示框类型
export type NotificationType = "success" | "error" | "warning" | "info";

// 定义提示框单项的数据结构
export interface NotificationItem {
  id: string;
  message: string;
  type: NotificationType;
  duration?: number; // 持续时间，毫秒，默认 10000ms (10秒)
}

// 定义 Context 所需的属性
interface NotificationContextType {
  show: (message: string, type?: NotificationType, duration?: number) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

// 创建 Context
const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

// 辅助自定义事件类型，支持外部 JS 触发通知
export const SHOW_NOTIFICATION_EVENT = "show-notification";

interface ShowNotificationEventDetail {
  message: string;
  type?: NotificationType;
  duration?: number;
}

/**
 * 全局提示函数，支持在非 React 组件环境中调用（如 api/client.ts）
 */
export function triggerNotification(message: string, type: NotificationType = "info", duration = 10000) {
  const event = new CustomEvent<ShowNotificationEventDetail>(SHOW_NOTIFICATION_EVENT, {
    detail: { message, type, duration },
  });
  window.dispatchEvent(event);
}

/**
 * NotificationProvider 组件，全局的状态管理器
 */
export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  // 添加新通知
  const show = useCallback((message: string, type: NotificationType = "info", duration = 10000) => {
    const id = Math.random().toString(36).substring(2, 9);
    setNotifications((prev) => [...prev, { id, message, type, duration }]);
  }, []);

  const success = useCallback((message: string, duration?: number) => show(message, "success", duration), [show]);
  const error = useCallback((message: string, duration?: number) => show(message, "error", duration), [show]);
  const warning = useCallback((message: string, duration?: number) => show(message, "warning", duration), [show]);
  const info = useCallback((message: string, duration?: number) => show(message, "info", duration), [show]);

  // 移除通知
  const remove = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((item) => item.id !== id));
  }, []);

  // 监听全局事件，用于非 React 模块的触发
  useEffect(() => {
    const handleGlobalNotification = (event: Event) => {
      const customEvent = event as CustomEvent<ShowNotificationEventDetail>;
      if (customEvent.detail) {
        const { message, type, duration } = customEvent.detail;
        show(message, type, duration);
      }
    };

    window.addEventListener(SHOW_NOTIFICATION_EVENT, handleGlobalNotification);
    return () => {
      window.removeEventListener(SHOW_NOTIFICATION_EVENT, handleGlobalNotification);
    };
  }, [show]);

  return (
    <NotificationContext.Provider value={{ show, success, error, warning, info }}>
      {children}
      <NotificationContainer notifications={notifications} onClose={remove} />
    </NotificationContext.Provider>
  );
}

/**
 * useNotification Hook，方便组件内使用
 */
export function useNotification() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotification 必须在 NotificationProvider 内部使用");
  }
  return context;
}

/**
 * 提示框展示容器，固定在屏幕右上角
 */
function NotificationContainer({
  notifications,
  onClose,
}: {
  notifications: NotificationItem[];
  onClose: (id: string) => void;
}) {
  return (
    <div className="notification-container">
      {notifications.map((item) => (
        <NotificationItemComponent key={item.id} item={item} onClose={onClose} />
      ))}
    </div>
  );
}

/**
 * 精美 SVG 图标组件，对应 success, error, warning, info
 */
function NotificationIcon({ type }: { type: NotificationType }) {
  switch (type) {
    case "success":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      );
    case "error":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      );
    case "warning":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case "info":
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      );
  }
}

/**
 * 单个提示条目组件，负责定时销毁和 hover 暂停计时
 */
function NotificationItemComponent({
  item,
  onClose,
}: {
  item: NotificationItem;
  onClose: (id: string) => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const duration = item.duration ?? 10000;

  // 退出淡出函数：先播放 200ms 的 CSS 动画，然后销毁
  const handleClose = useCallback(() => {
    setIsLeaving(true);
    setTimeout(() => {
      onClose(item.id);
    }, 200); // 与 CSS 的渐隐过渡时间保持一致
  }, [item.id, onClose]);

  // 控制自动关闭定时器：
  // 当鼠标悬停时清除定时器；鼠标移出后重新开始计时
  useEffect(() => {
    if (isHovered) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    } else {
      timerRef.current = setTimeout(() => {
        handleClose();
      }, duration);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [isHovered, duration, handleClose]);

  return (
    <div
      className={`notification-item notification-${item.type}${isLeaving ? " is-leaving" : ""}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="notification-icon">
        <NotificationIcon type={item.type} />
      </div>
      <div className="notification-content">{item.message}</div>
      <button className="notification-close-btn" onClick={handleClose} aria-label="关闭">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* 倒计时进度条：鼠标悬停时保持在 100%，移出后伴随定时器重新执行动画 */}
      {!isHovered && !isLeaving ? (
        <div
          className="notification-progress-bar"
          style={{ animationDuration: `${duration}ms` }}
        />
      ) : !isLeaving ? (
        <div
          className="notification-progress-bar"
          style={{ transform: "scaleX(1)", animation: "none" }}
        />
      ) : null}
    </div>
  );
}
