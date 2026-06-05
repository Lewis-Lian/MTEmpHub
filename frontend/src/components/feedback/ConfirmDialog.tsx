import React, { createContext, useContext, useState, useCallback } from "react";

// 定义确认框可配置参数
export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: "danger" | "warning" | "info";
}

// 定义 Context 的 Hook 类型
type ConfirmContextType = (options: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmContextType | undefined>(undefined);

interface DialogState extends ConfirmOptions {
  isOpen: boolean;
  resolve: (value: boolean) => void;
}

const initialDialogState: DialogState = {
  isOpen: false,
  title: "确认提示",
  message: "",
  confirmText: "确定",
  cancelText: "取消",
  type: "warning",
  resolve: () => {},
};

/**
 * ConfirmProvider 提供者，维护弹窗状态并将其注入 React 树
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DialogState>(initialDialogState);

  // 核心的 Promise 确认框触发逻辑
  const confirm = useCallback((options: ConfirmOptions | string) => {
    return new Promise<boolean>((resolve) => {
      const opts = typeof options === "string" ? { message: options } : options;
      setState({
        isOpen: true,
        title: opts.title ?? (opts.type === "danger" ? "危险操作确认" : "操作确认"),
        message: opts.message,
        confirmText: opts.confirmText ?? "确定",
        cancelText: opts.cancelText ?? "取消",
        type: opts.type ?? "warning",
        resolve,
      });
    });
  }, []);

  const handleConfirm = () => {
    state.resolve(true);
    setState((prev) => ({ ...prev, isOpen: false }));
  };

  const handleCancel = () => {
    state.resolve(false);
    setState((prev) => ({ ...prev, isOpen: false }));
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialogComponent state={state} onCancel={handleCancel} onConfirm={handleConfirm} />
    </ConfirmContext.Provider>
  );
}

/**
 * useConfirm Hook，用于各个组件中
 */
export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error("useConfirm 必须在 ConfirmProvider 内部使用");
  }
  return context;
}

/**
 * 确认对话框图标渲染
 */
function ConfirmIcon({ type }: { type?: "danger" | "warning" | "info" }) {
  switch (type) {
    case "danger":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case "info":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      );
    case "warning":
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
  }
}

/**
 * 确认对话框底层 UI 组件
 */
function ConfirmDialogComponent({
  state,
  onConfirm,
  onCancel,
}: {
  state: DialogState;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  return (
    <div
      className={`confirm-backdrop${state.isOpen ? " is-open" : ""}`}
      onClick={handleBackdropClick}
    >
      <div className={`confirm-card confirm-theme-${state.type ?? "warning"}`}>
        <div className="confirm-header">
          <div className="confirm-icon-wrapper">
            <ConfirmIcon type={state.type} />
          </div>
          <h3 className="confirm-title">{state.title}</h3>
        </div>
        <div className="confirm-body">
          <p className="confirm-message">{state.message}</p>
        </div>
        <div className="confirm-footer">
          <button className="confirm-btn confirm-btn-cancel" onClick={onCancel}>
            {state.cancelText}
          </button>
          <button className="confirm-btn confirm-btn-confirm" onClick={onConfirm}>
            {state.confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
