import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import {
  fetchSliderCaptcha,
  verifySliderCaptcha,
  type SliderChallenge,
  type SliderTracePoint,
} from "../../api/auth";

import "../../styles/components/slider-captcha.css";

type SliderStatus = "loading" | "idle" | "dragging" | "verifying" | "success" | "error";

interface SliderCaptchaProps {
  /** 验证通过时回调，传出 verified_token。 */
  onVerified: (token: string) => void;
  /** 验证状态被重置（用户重新拖动）时回调，通知父组件清空已保存的 token。 */
  onReset?: () => void;
  className?: string;
}

// 采样节流间隔（ms）：拖动时每 16ms 采样一个轨迹点，约 60fps。
const TRACE_SAMPLE_INTERVAL_MS = 16;
// 误触判定阈值（px，按 320 设计宽度）：释放时拖动距离小于该值视为误触，
// 直接回到待拖动状态，不发起校验（避免白白消费一次挑战导致图片莫名刷新）。
const MIN_EFFECTIVE_DRAG_PX = 10;

export default function SliderCaptcha({ onVerified, onReset, className }: SliderCaptchaProps) {
  const [challenge, setChallenge] = useState<SliderChallenge | null>(null);
  const [status, setStatus] = useState<SliderStatus>("loading");
  const [isExpanded, setIsExpanded] = useState(false);
  const [offset, setOffset] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [loadError, setLoadError] = useState("");

  // 拖动期间的 ref（不触发重渲染）。
  const draggingRef = useRef(false);
  const startClientXRef = useRef(0);
  const startOffsetRef = useRef(0);
  // 实时偏移：pointermove 是连续事件，React 可能批量延迟渲染，
  // pointerUp 时 state 里的 offset 可能落后于真实位置，故用 ref 记录。
  const liveOffsetRef = useRef(0);
  const traceRef = useRef<SliderTracePoint[]>([]);
  const lastSampleTimeRef = useRef(0);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const currentScaleRef = useRef(1);

  const loadChallenge = useCallback(async () => {
    setStatus("loading");
    setLoadError("");
    setOffset(0);
    try {
      const data = await fetchSliderCaptcha();
      setChallenge(data);
      setStatus("idle");
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : "验证码加载失败，请刷新重试");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadChallenge();
  }, [loadChallenge]);

  const maxX = challenge ? 320 - challenge.slider_width : 0;

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (status !== "idle" || !challenge) return;
      event.preventDefault();
      draggingRef.current = true;
      startClientXRef.current = event.clientX;
      startOffsetRef.current = 0;
      liveOffsetRef.current = 0;
      traceRef.current = [{ x: 0, t: Date.now() }];
      lastSampleTimeRef.current = Date.now();
      
      const trackWidth = trackRef.current?.clientWidth || 320;
      currentScaleRef.current = trackWidth / 320;
      
      setStatus("dragging");
      onReset?.();
      // setPointerCapture 让 pointer 在移出元素后仍持续触发 move/up；
      // jsdom 未实现该方法，做防御性检查兼容测试环境。
      const target = event.target as HTMLButtonElement;
      if (typeof target.setPointerCapture === "function") {
        target.setPointerCapture(event.pointerId);
      }
    },
    [status, challenge, onReset],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!draggingRef.current) return;
      const deltaX = event.clientX - startClientXRef.current;
      const delta = deltaX / currentScaleRef.current;
      const next = Math.max(0, Math.min(maxX, startOffsetRef.current + delta));
      liveOffsetRef.current = next;
      setOffset(next);

      // 节流采样轨迹点。
      const now = Date.now();
      if (now - lastSampleTimeRef.current >= TRACE_SAMPLE_INTERVAL_MS) {
        traceRef.current.push({ x: next, t: now });
        lastSampleTimeRef.current = now;
      }
    },
    [maxX],
  );

  const handlePointerUp = useCallback(
    async (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!draggingRef.current || !challenge) return;
      draggingRef.current = false;
      const target = event.target as HTMLButtonElement;
      if (typeof target.releasePointerCapture === "function") {
        target.releasePointerCapture(event.pointerId);
      }

      // 误触保护：几乎没拖动就释放，不发起校验，回到待拖动状态。
      if (liveOffsetRef.current < MIN_EFFECTIVE_DRAG_PX) {
        setOffset(0);
        setStatus("idle");
        return;
      }

      // 补录最后一个点（保证终点被采样）。
      const finalOffset = liveOffsetRef.current;
      const finalNow = Date.now();
      traceRef.current.push({ x: finalOffset, t: finalNow });

      setStatus("verifying");
      try {
        const result = await verifySliderCaptcha(challenge.token, finalOffset, traceRef.current);
        setStatus("success");
        setIsExpanded(false);
        onVerified(result.verified_token);
      } catch (error) {
        const msg = error instanceof ApiError ? error.message : "验证未通过，请重试";
        setErrorMsg(msg);
        setStatus("error");
        // 自动刷新图片重来。
        await loadChallenge();
      }
    },
    [challenge, onVerified, loadChallenge],
  );

  const handleRefresh = useCallback(() => {
    setErrorMsg("");
    onReset?.();
    void loadChallenge();
  }, [loadChallenge, onReset]);

  if (status === "loading") {
    return (
      <div className={`slider-captcha ${className ?? ""}`}>
        <div className="slider-captcha-loading">正在加载验证码...</div>
      </div>
    );
  }

  if (loadError && !challenge) {
    return (
      <div className={`slider-captcha ${className ?? ""}`}>
        <div className="slider-captcha-error">{loadError}</div>
        <button className="slider-captcha-refresh-btn" onClick={handleRefresh} type="button">
          重新加载
        </button>
      </div>
    );
  }

  return (
    <div className={`slider-captcha ${className ?? ""}`}>
      {isExpanded ? (
        <div className="slider-captcha-popover">
          <div className="slider-captcha-image-wrap">
            {challenge ? (
              <>
                <img alt="验证码背景" className="slider-captcha-bg" src={challenge.background} />
                <img
                  alt="滑块"
                  className="slider-captcha-piece"
                  src={challenge.slider}
                  style={{ left: `${(offset / 320) * 100}%` }}
                />
              </>
            ) : null}
          </div>
          <button className="slider-captcha-refresh-btn" onClick={handleRefresh} type="button">
            换一张
          </button>
        </div>
      ) : null}

      {!isExpanded && status !== "success" ? (
        <button
          className="slider-captcha-trigger-btn"
          onClick={() => setIsExpanded(true)}
          type="button"
        >
          <span className="slider-captcha-trigger-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </span>
          点击进行安全验证
        </button>
      ) : (
        <div className="slider-captcha-track" ref={trackRef}>
          {status === "success" ? (
            <span className="slider-captcha-hint slider-captcha-hint--success">验证通过</span>
          ) : status === "error" && errorMsg ? (
            <span className="slider-captcha-hint slider-captcha-hint--error">{errorMsg}</span>
          ) : (
            <span className="slider-captcha-hint">向右拖动滑块完成验证</span>
          )}
          <button
            aria-label="拖动滑块"
            className={`slider-captcha-handle slider-captcha-handle--${status}`}
            disabled={status === "verifying" || status === "success"}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{ left: `${(offset / 320) * 100}%` }}
            type="button"
          >
            {status === "verifying" ? "⋯" : status === "success" ? "✓" : "→"}
          </button>
        </div>
      )}
    </div>
  );
}
