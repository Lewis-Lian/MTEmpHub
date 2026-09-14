import { apiRequest } from "./client";

export interface MessageItem {
  id: number;
  title: string;
  content: string;
  sender: string;
  created_at: string;
  unread: boolean;
}

export interface MessageListResponse {
  messages: MessageItem[];
  unread_count: number;
}

export interface MessageRecipient {
  id: number;
  account_ids: number[];
  emp_no: string;
  name: string;
  dept_id: number | null;
  dept_name: string;
  is_manager: boolean;
}

export function fetchMessages(): Promise<MessageListResponse> {
  return apiRequest<MessageListResponse>("/api/query/messages");
}

export function fetchMessage(id: number): Promise<MessageItem> {
  return apiRequest<{ message: MessageItem }>(`/api/query/messages/${id}`).then((payload) => payload.message);
}

export function markMessageRead(id: number): Promise<{ message: MessageItem }> {
  return apiRequest<{ message: MessageItem }>(`/api/query/messages/${id}/read`, { method: "POST" });
}

export function fetchMessageRecipients(): Promise<MessageRecipient[]> {
  return apiRequest<MessageRecipient[]>("/api/admin/message-recipients");
}

export type MessageRecipientScope = "all" | "managers" | "employees";

export type SendMessagePayload =
  | { recipient_ids: number[]; title: string; content: string }
  | { recipient_scope: MessageRecipientScope; title: string; content: string };

export function sendMessage(payload: SendMessagePayload): Promise<{ message: MessageItem; created_count: number }> {
  return apiRequest<{ message: MessageItem; created_count: number }>("/api/admin/messages", { method: "POST", body: payload });
}
