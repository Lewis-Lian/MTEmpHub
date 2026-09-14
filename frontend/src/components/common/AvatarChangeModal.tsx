import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { updateAvatar, uploadAvatar, type AuthUser } from "../../api/auth";
import { useNotification } from "../feedback/Notification";
import UserAvatar, { PRESET_AVATARS, renderPresetSvg } from "./UserAvatar";
import "../../styles/components/avatar-modal.css";

interface AvatarChangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: AuthUser;
  onUserUpdate?: (user: AuthUser) => void;
}

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export default function AvatarChangeModal({
  isOpen,
  onClose,
  user,
  onUserUpdate,
}: AvatarChangeModalProps) {
  const notification = useNotification();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const initialPreset = user.avatar?.startsWith("default:") ? user.avatar : "default:1";
  const [activeTab, setActiveTab] = useState<"preset" | "custom">(
    user.avatar && !user.avatar.startsWith("default:") ? "custom" : "preset",
  );
  const [selectedPreset, setSelectedPreset] = useState<string>(initialPreset);
  const [customFile, setCustomFile] = useState<File | null>(null);
  const [customPreviewUrl, setCustomPreviewUrl] = useState<string | null>(
    user.avatar && !user.avatar.startsWith("default:") ? user.avatar : null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // 当弹窗打开时，重置状态
  useEffect(() => {
    if (isOpen) {
      const isCustom = Boolean(user.avatar && !user.avatar.startsWith("default:"));
      setActiveTab(isCustom ? "custom" : "preset");
      setSelectedPreset(user.avatar?.startsWith("default:") ? user.avatar : "default:1");
      setCustomFile(null);
      setCustomPreviewUrl(isCustom ? (user.avatar ?? null) : null);
      setErrorMessage(null);
      setIsSaving(false);
    }
  }, [isOpen, user.avatar]);

  // ESC 键关闭
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isSaving) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isSaving, onClose]);

  // 释放 ObjectURL 内存
  useEffect(() => {
    return () => {
      if (customPreviewUrl && customPreviewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(customPreviewUrl);
      }
    };
  }, [customPreviewUrl]);

  if (!isOpen) {
    return null;
  }

  function handleFileSelected(file: File) {
    setErrorMessage(null);

    if (!ALLOWED_TYPES.includes(file.type)) {
      setErrorMessage("请上传 JPG、PNG、WEBP 或 GIF 格式的图片");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setErrorMessage("图片大小不能超过 2MB，请重新选择");
      return;
    }

    if (customPreviewUrl && customPreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(customPreviewUrl);
    }

    const preview = URL.createObjectURL(file);
    setCustomFile(file);
    setCustomPreviewUrl(preview);
    setActiveTab("custom");
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFileSelected(files[0]);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    setErrorMessage(null);

    try {
      let updatedUser: AuthUser;

      if (activeTab === "preset") {
        const res = await updateAvatar({ avatar: selectedPreset });
        updatedUser = res.user;
      } else {
        if (!customFile) {
          if (customPreviewUrl && customPreviewUrl === user.avatar) {
            // 没有更换新文件且已经是当前头像
            onClose();
            return;
          }
          setErrorMessage("请先选择或拖拽要上传的图片文件");
          setIsSaving(false);
          return;
        }
        const res = await uploadAvatar(customFile);
        updatedUser = res.user;
      }

      onUserUpdate?.(updatedUser);
      notification.success("头像修改成功！");
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "保存失败，请稍后重试");
    } finally {
      setIsSaving(false);
    }
  }

  // 计算当前卡片展示的实时头像预览
  const previewAvatarValue =
    activeTab === "preset"
      ? selectedPreset
      : customPreviewUrl || user.avatar || "default:1";

  return createPortal(
    <div
      aria-labelledby="avatar-modal-title"
      aria-modal="true"
      className="avatar-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) {
          onClose();
        }
      }}
      role="dialog"
    >
      <div className="avatar-modal-card">
        {/* 弹窗头部 */}
        <div className="avatar-modal-header">
          <h2 className="avatar-modal-title" id="avatar-modal-title">
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
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="10" r="3" />
              <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" />
            </svg>
            修改用户头像
          </h2>
          <button
            aria-label="关闭"
            className="avatar-modal-close-btn"
            disabled={isSaving}
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

        {/* 弹窗主体 */}
        <div className="avatar-modal-body">
          {/* 当前头像实时预览 */}
          <div className="avatar-current-preview">
            <div className="avatar-preview-circle-wrap">
              <UserAvatar avatar={previewAvatarValue} name={user.username} size={58} />
            </div>
            <div className="avatar-preview-info">
              <div className="avatar-preview-user">{user.profile_name || user.username}</div>
              <div className="avatar-preview-tip">
                {activeTab === "preset"
                  ? `当前选定：预设头像 · ${PRESET_AVATARS.find((p) => p.id === selectedPreset)?.name || "默认"}`
                  : customFile
                    ? `已选自定义图片：${customFile.name}`
                    : "自定义上传图片"}
              </div>
              <div className="avatar-preview-tag">
                <svg fill="currentColor" height="10" viewBox="0 0 8 8" width="10">
                  <circle cx="4" cy="4" r="3" />
                </svg>
                实时效果预览
              </div>
            </div>
          </div>

          {/* 标签切换栏 */}
          <div className="avatar-tabs">
            <button
              className={`avatar-tab-btn${activeTab === "preset" ? " is-active" : ""}`}
              onClick={() => setActiveTab("preset")}
              type="button"
            >
              <svg
                fill="none"
                height="14"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="14"
              >
                <rect height="7" width="7" x="3" y="3" />
                <rect height="7" width="7" x="14" y="3" />
                <rect height="7" width="7" x="14" y="14" />
                <rect height="7" width="7" x="3" y="14" />
              </svg>
              精选默认头像
            </button>
            <button
              className={`avatar-tab-btn${activeTab === "custom" ? " is-active" : ""}`}
              onClick={() => setActiveTab("custom")}
              type="button"
            >
              <svg
                fill="none"
                height="14"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="14"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" x2="12" y1="3" y2="15" />
              </svg>
              自定义图片上传
            </button>
          </div>

          {/* 错误提示 */}
          {errorMessage ? (
            <div className="avatar-error-alert" role="alert">
              <svg
                fill="none"
                height="14"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="14"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" x2="12" y1="8" y2="12" />
                <line x1="12" x2="12.01" y1="16" y2="16" />
              </svg>
              <span>{errorMessage}</span>
            </div>
          ) : null}

          {/* 预设默认头像列表 */}
          {activeTab === "preset" ? (
            <div className="avatar-preset-grid">
              {PRESET_AVATARS.map((preset) => {
                const isSelected = selectedPreset === preset.id;
                return (
                  <button
                    aria-label={`选择${preset.name}`}
                    className={`avatar-preset-card${isSelected ? " is-selected" : ""}`}
                    key={preset.id}
                    onClick={() => {
                      setSelectedPreset(preset.id);
                      setErrorMessage(null);
                    }}
                    type="button"
                  >
                    <div className="avatar-preset-icon">
                      {renderPresetSvg(preset.id, 48)}
                    </div>
                    <div className="avatar-preset-name">{preset.name}</div>
                    <div className="avatar-preset-desc">{preset.description}</div>
                    {isSelected ? (
                      <span className="avatar-preset-badge">
                        <svg
                          fill="none"
                          height="11"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2.5"
                          viewBox="0 0 24 24"
                          width="11"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            /* 自定义上传 */
            <div className="avatar-upload-area">
              <input
                accept={ALLOWED_TYPES.join(",")}
                className="avatar-file-input"
                onChange={(e) => {
                  const files = e.target.files;
                  if (files && files.length > 0) {
                    handleFileSelected(files[0]);
                  }
                }}
                ref={fileInputRef}
                type="file"
              />

              <div
                className={`avatar-dropzone${isDragging ? " is-dragover" : ""}`}
                onClick={() => fileInputRef.current?.click()}
                onDragLeave={() => setIsDragging(false)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDrop={handleDrop}
              >
                <div className="avatar-dropzone-icon">
                  <svg
                    fill="none"
                    height="24"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    width="24"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" x2="12" y1="3" y2="15" />
                  </svg>
                </div>
                <div className="avatar-dropzone-title">点击或将图片拖拽至此处上传</div>
                <div className="avatar-dropzone-hint">
                  支持 JPG、PNG、WEBP、GIF 格式图片，文件大小建议不超过 2MB
                </div>
              </div>

              {customFile ? (
                <div className="avatar-file-selected">
                  <div className="avatar-file-meta">
                    <svg
                      fill="none"
                      height="18"
                      stroke="#16a34a"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      width="18"
                    >
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                    <div>
                      <span className="avatar-file-name">{customFile.name}</span>
                      <span className="avatar-file-size">
                        {" "}
                        ({(customFile.size / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                  </div>
                  <button
                    className="avatar-file-reselect"
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                  >
                    重新选择
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* 弹窗底部操作 */}
        <div className="avatar-modal-footer">
          <button
            className="avatar-btn avatar-btn-cancel"
            disabled={isSaving}
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          <button
            className="avatar-btn avatar-btn-primary"
            disabled={isSaving}
            onClick={handleSave}
            type="button"
          >
            {isSaving ? <span className="avatar-spinner" /> : null}
            {isSaving ? "正在保存..." : "保存头像"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
