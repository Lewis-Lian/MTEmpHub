import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { changePassword, type AuthUser } from "../../api/auth";
import { ApiError } from "../../api/client";
import SliderCaptcha from "../auth/SliderCaptcha";
import "../../styles/components/change-password-modal.css";

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: AuthUser;
}

export default function ChangePasswordModal({ isOpen, onClose, user }: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  // 滑块 token 失效（如 5 分钟过期后提交收到 403）时递增该 key，强制重挂载滑块重新验证。
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 每次打开时重置表单，避免上一次的输入残留。
  useEffect(() => {
    if (isOpen) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setCaptchaToken("");
      setError("");
      setSuccess("");
      setIsSubmitting(false);
    }
  }, [isOpen]);

  // ESC 键关闭。
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isSubmitting) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) {
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!captchaToken) {
      setError("请先完成滑块验证");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      await changePassword({
        username: user.username,
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
        captcha_token: captchaToken,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setCaptchaToken("");
      setSuccess("密码修改成功，请使用新密码登录。");
    } catch (caughtError) {
      const errMsg = caughtError instanceof ApiError ? caughtError.message : "修改失败，请稍后重试";
      setError(errMsg);
      // 403 = 滑块验证缺失/已过期：自动重置滑块，让用户重新完成验证而不是反复报错。
      if (caughtError instanceof ApiError && caughtError.status === 403) {
        setCaptchaToken("");
        setCaptchaResetKey((key) => key + 1);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return createPortal(
    <div
      aria-labelledby="change-password-modal-title"
      aria-modal="true"
      className="change-password-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
      role="dialog"
    >
      <div className="change-password-modal-card">
        <div className="change-password-modal-header">
          <h2 className="change-password-modal-title" id="change-password-modal-title">
            <svg
              fill="none"
              height="18"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              width="18"
            >
              <rect height="7" rx="1.5" width="14" x="5" y="11" />
              <path d="M7.5 11V7.5a4.5 4.5 0 0 1 9 0V11" />
            </svg>
            修改密码
          </h2>
          <button
            aria-label="关闭"
            className="change-password-modal-close-btn"
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
          >
            <svg
              fill="none"
              height="18"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              width="18"
            >
              <line x1="18" x2="6" y1="6" y2="18" />
              <line x1="6" x2="18" y1="6" y2="18" />
            </svg>
          </button>
        </div>

        <form className="change-password-modal-form" onSubmit={handleSubmit}>
          <div className="change-password-modal-body">
            <div className="change-password-modal-field">
              <label className="change-password-modal-label" htmlFor="change-password-username">
                账号
              </label>
              <input
                className="login-input"
                id="change-password-username"
                readOnly
                type="text"
                value={user.username}
              />
            </div>
            <div className="change-password-modal-field">
              <label className="change-password-modal-label" htmlFor="change-password-current">
                原密码
              </label>
              <input
                autoComplete="current-password"
                className="login-input"
                id="change-password-current"
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
                type="password"
                value={currentPassword}
              />
            </div>
            <div className="change-password-modal-field">
              <label className="change-password-modal-label" htmlFor="change-password-new">
                新密码
              </label>
              <input
                autoComplete="new-password"
                className="login-input"
                id="change-password-new"
                onChange={(event) => setNewPassword(event.target.value)}
                required
                type="password"
                value={newPassword}
              />
            </div>
            <div className="change-password-modal-field">
              <label className="change-password-modal-label" htmlFor="change-password-confirm">
                确认新密码
              </label>
              <input
                autoComplete="new-password"
                className="login-input"
                id="change-password-confirm"
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                type="password"
                value={confirmPassword}
              />
            </div>
            <div className="change-password-modal-field">
              <SliderCaptcha
                key={captchaResetKey}
                onReset={() => setCaptchaToken("")}
                onVerified={setCaptchaToken}
              />
            </div>
            {success ? (
              <p className="change-password-modal-success" role="status">
                {success}
              </p>
            ) : null}
            {error ? (
              <p className="login-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <div className="change-password-modal-footer">
            <button
              className="change-password-modal-btn change-password-modal-btn--cancel"
              disabled={isSubmitting}
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button
              className="change-password-modal-btn change-password-modal-btn--primary"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? "提交中..." : "确认修改"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
