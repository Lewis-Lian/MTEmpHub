import React, { useState } from "react";

export interface PresetAvatar {
  id: string;
  name: string;
  description: string;
  bgColor: string;
}

export const PRESET_AVATARS: PresetAvatar[] = [
  {
    id: "default:1",
    name: "经典蓝调",
    description: "稳健商务 · 经典沉稳",
    bgColor: "#e2e8f0",
  },
  {
    id: "default:2",
    name: "活力朝阳",
    description: "朝气热情 · 温暖开朗",
    bgColor: "#ffedd5",
  },
  {
    id: "default:3",
    name: "清新薄荷",
    description: "自然清爽 · 敏锐高效",
    bgColor: "#ccfbf1",
  },
  {
    id: "default:4",
    name: "极光紫霞",
    description: "优雅从容 · 独立知性",
    bgColor: "#ede9fe",
  },
  {
    id: "default:5",
    name: "极客智蓝",
    description: "科技探索 · 敏思笃行",
    bgColor: "#cffafe",
  },
  {
    id: "default:6",
    name: "热忱珊瑚",
    description: "亲和友善 · 协作共赢",
    bgColor: "#ffe4e6",
  },
];

export function renderPresetSvg(id: string, size = 32, className = ""): React.ReactNode {
  const commonProps = {
    viewBox: "0 0 32 32",
    fill: "none",
    width: size,
    height: size,
    className: className || undefined,
    style: { display: "block", borderRadius: "50%", flexShrink: 0 },
  };

  switch (id) {
    case "default:2":
      // 活力朝阳：暖橙黄渐变背景，暖棕微卷发型，活力橙领
      return (
        <svg key="default:2" {...commonProps}>
          <circle cx="16" cy="16" r="16" fill="#fed7aa" />
          <path d="M7 11c0-4 4-6 9-6s9 2 9 6l3 1-3 2H7z" fill="#9a3412" />
          <circle cx="16" cy="16.5" r="5.2" fill="#fef08a" />
          <circle cx="13.8" cy="16.5" r="0.9" fill="#78350f" />
          <circle cx="18.2" cy="16.5" r="0.9" fill="#78350f" />
          <path d="M14.5 19c.7.6 2.3.6 3 0" stroke="#b45309" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M4 32c0-5.5 5.5-9 12-9s12 3.5 12 9" fill="#ea580c" />
          <path d="M13 23l3 4 3-4" fill="#ffedd5" />
        </svg>
      );

    case "default:3":
      // 清新薄荷：青绿背景，深墨绿短发，薄荷绿衣
      return (
        <svg key="default:3" {...commonProps}>
          <circle cx="16" cy="16" r="16" fill="#99f6e4" />
          <path d="M9 11c0-3.8 3.2-5.5 7-5.5s7 1.7 7 5.5l2.5 1-2.5 1.5H9z" fill="#134e4a" />
          <circle cx="16" cy="17" r="5.2" fill="#fed7aa" />
          <circle cx="14" cy="17" r="0.8" fill="#1e293b" />
          <circle cx="18" cy="17" r="0.8" fill="#1e293b" />
          <path d="M14.8 19.3c.6.4 1.8.4 2.4 0" stroke="#b45309" strokeWidth="1.1" strokeLinecap="round" />
          <path d="M5 32c0-5 5-8.5 11-8.5s11 3.5 11 8.5" fill="#0d9488" />
          <path d="M12.5 23.5l3.5 4 3.5-4" fill="#f0fdfa" />
        </svg>
      );

    case "default:4":
      // 极光紫霞：雅致薰衣草紫，深紫波浪发，雅致紫衣
      return (
        <svg key="default:4" {...commonProps}>
          <circle cx="16" cy="16" r="16" fill="#ddd6fe" />
          <path d="M8 12c0-4 3.5-6.5 8-6.5s8 2.5 8 6.5l3.5 1.5-3.5 2H8z" fill="#4c1d95" />
          <circle cx="16" cy="17" r="5.2" fill="#fed7aa" />
          <path d="M8 14c0 4.5 1.8 7.5 1.8 7.5M24 14c0 4.5-1.8 7.5-1.8 7.5" stroke="#4c1d95" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="14" cy="17" r="0.8" fill="#312e81" />
          <circle cx="18" cy="17" r="0.8" fill="#312e81" />
          <path d="M14.8 19.2c.6.5 1.8.5 2.4 0" stroke="#b45309" strokeWidth="1.1" strokeLinecap="round" />
          <path d="M5 32c0-5 5-8.5 11-8.5s11 3.5 11 8.5" fill="#7c3aed" />
          <path d="M12 23.5l4 4.5 4-4.5" fill="#faf5ff" />
        </svg>
      );

    case "default:5":
      // 极客智蓝：天青色背景，深蓝短发，佩戴精巧极客眼镜
      return (
        <svg key="default:5" {...commonProps}>
          <circle cx="16" cy="16" r="16" fill="#bae6fd" />
          <path d="M8 11.5c0-3.5 3.5-5.5 8-5.5s8 2 8 5.5l3 1-3 1.5H8z" fill="#0f172a" />
          <circle cx="16" cy="17" r="5.2" fill="#fed7aa" />
          {/* 极客眼镜 */}
          <rect x="12" y="15.2" width="3.5" height="2.8" rx="0.8" stroke="#0284c7" strokeWidth="1.1" fill="rgba(224, 242, 254, 0.4)" />
          <rect x="16.5" y="15.2" width="3.5" height="2.8" rx="0.8" stroke="#0284c7" strokeWidth="1.1" fill="rgba(224, 242, 254, 0.4)" />
          <line x1="15.5" y1="16.5" x2="16.5" y2="16.5" stroke="#0284c7" strokeWidth="1.1" />
          <path d="M14.8 19.5c.6.4 1.8.4 2.4 0" stroke="#b45309" strokeWidth="1.1" strokeLinecap="round" />
          <path d="M5 32c0-5 5-8.5 11-8.5s11 3.5 11 8.5" fill="#0284c7" />
          <path d="M13 23.5l3 3.5 3-3.5" fill="#f0f9ff" />
        </svg>
      );

    case "default:6":
      // 热忱珊瑚：柔和浅粉珊瑚背景，暖红短发，珊瑚红衣
      return (
        <svg key="default:6" {...commonProps}>
          <circle cx="16" cy="16" r="16" fill="#fecdd3" />
          <path d="M8 11.5c0-3.8 3.5-5.8 8-5.8s8 2 8 5.8l3 1.2-3 1.8H8z" fill="#881337" />
          <circle cx="16" cy="17" r="5.2" fill="#fed7aa" />
          <circle cx="13.8" cy="17" r="0.8" fill="#4c0519" />
          <circle cx="18.2" cy="17" r="0.8" fill="#4c0519" />
          <path d="M14.5 19.3c.7.5 2.3.5 3 0" stroke="#e11d48" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M5 32c0-5 5-8.5 11-8.5s11 3.5 11 8.5" fill="#e11d48" />
          <path d="M13 23.5l3 4 3-4" fill="#fff1f2" />
        </svg>
      );

    case "default:1":
    default:
      // 经典蓝调：经典藏蓝深灰，沉稳干练
      return (
        <svg key="default:1" {...commonProps}>
          <circle cx="16" cy="16" r="16" fill="#cbd5e1" />
          <path d="M8 12c0-3.5 3.5-5.5 8-5.5s8 2 8 5.5l3.5 1-3.5 1.5H8z" fill="#1e293b" />
          <circle cx="16" cy="17" r="5.5" fill="#fed7aa" />
          <path d="M10 16c0 3.5 1.5 6 1.5 6M22 16c0 3.5-1.5 6-1.5 6" stroke="#b45309" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M5 32c0-5 5-8.5 11-8.5s11 3.5 11 8.5" fill="#475569" />
        </svg>
      );
  }
}

export interface UserAvatarProps {
  avatar?: string | null;
  name?: string;
  size?: number;
  className?: string;
}

export default function UserAvatar({
  avatar,
  name = "用户",
  size = 32,
  className = "",
}: UserAvatarProps) {
  const [imageError, setImageError] = useState(false);

  const cleanAvatar = (avatar || "").trim();

  // 1. 如果没有配置头像，或以 default: 开头，渲染预设矢量图
  if (!cleanAvatar || cleanAvatar.startsWith("default:")) {
    const presetId = cleanAvatar || "default:1";
    return renderPresetSvg(presetId, size, className);
  }

  // 2. 如果之前加载失败，降级为默认第一款头像
  if (imageError) {
    return renderPresetSvg("default:1", size, className);
  }

  // 3. 渲染自定义头像图片
  return (
    <img
      alt={`${name}的头像`}
      className={`user-avatar-img ${className}`.trim()}
      height={size}
      onError={() => setImageError(true)}
      src={cleanAvatar}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        objectFit: "cover",
        display: "block",
        flexShrink: 0,
      }}
      width={size}
    />
  );
}
