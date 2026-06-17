import { apiRequest } from "./client";

export interface AuthUser {
  id: number;
  username: string;
  role: string;
  page_permissions?: Record<string, boolean>;
}

interface LoginResponse {
  user: AuthUser;
}

export interface LoginPayload {
  username: string;
  password: string;
  remember_me: boolean;
  captcha_token: string;
}

export interface ChangePasswordPayload {
  username: string;
  current_password: string;
  new_password: string;
  confirm_password: string;
  captcha_token: string;
}

// 滑块验证码相关类型
export interface SliderChallenge {
  challenge_id: string;
  token: string;
  background: string;
  slider: string;
  slider_width: number;
}

export interface SliderTracePoint {
  x: number;
  t: number;
}

export async function login(payload: LoginPayload): Promise<AuthUser> {
  const response = await apiRequest<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: payload,
  });

  return response.user;
}

export async function changePassword(payload: ChangePasswordPayload): Promise<void> {
  await apiRequest<{ ok: boolean }>("/api/auth/change-password", {
    method: "POST",
    body: payload,
  });
}

// 获取一组滑块验证码图像（背景图 + 滑块小块）+ 挑战 token。
export function fetchSliderCaptcha(): Promise<SliderChallenge> {
  return apiRequest<SliderChallenge>("/api/auth/captcha/slider");
}

// 提交滑块拖动轨迹进行校验，通过后返回 verified_token。
export function verifySliderCaptcha(
  token: string,
  xOffset: number,
  trace: SliderTracePoint[],
): Promise<{ verified_token: string }> {
  return apiRequest<{ verified_token: string }>("/api/auth/captcha/slider/verify", {
    method: "POST",
    body: { token, x_offset: xOffset, trace },
  });
}

export async function logout(): Promise<void> {
  await apiRequest<{ ok: boolean }>("/api/auth/logout", {
    method: "POST",
  });
}

export function fetchMe(): Promise<AuthUser> {
  return apiRequest<AuthUser>("/api/auth/me");
}
