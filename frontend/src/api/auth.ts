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
}

export interface ChangePasswordPayload {
  username: string;
  current_password: string;
  new_password: string;
  confirm_password: string;
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

export async function logout(): Promise<void> {
  await apiRequest<{ ok: boolean }>("/api/auth/logout", {
    method: "POST",
  });
}

export function fetchMe(): Promise<AuthUser> {
  return apiRequest<AuthUser>("/api/auth/me");
}
