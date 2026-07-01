import Constants from "expo-constants";
import {
  Account,
  AuthResponse,
  Bid,
  Catalog,
  LoginPayload,
  Message,
  Notifications,
  Order,
  RegisterPayload,
  Role,
  Schedule,
  ServiceKey,
  Wallet
} from "./types";
import { fallbackCatalog } from "./catalog";

type ApiPayload = Record<string, unknown>;

const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL;

function getExpoHostUrl() {
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.manifest2?.extra?.expoClient?.hostUri;
  const host = typeof hostUri === "string" ? hostUri.split(":")[0] : "";
  return host ? `http://${host}:4000` : "";
}

export const apiBaseUrl = configuredApiUrl || getExpoHostUrl() || "http://localhost:4000";

// Текущий токен сессии. Устанавливается из App после загрузки/входа.
let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options?: RequestInit) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options?.headers ?? {})
    }
  });

  if (!response.ok) {
    let message = `API ${response.status}`;
    try {
      const body = await response.json();
      if (body?.message) {
        message = body.message;
      }
    } catch {
      // тело не JSON — оставляем дефолтное сообщение
    }
    throw new ApiError(response.status, message);
  }

  return (await response.json()) as T;
}

// --- Авторизация ------------------------------------------------------------

export async function register(payload: RegisterPayload) {
  return request<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload satisfies ApiPayload)
  });
}

export async function login(payload: LoginPayload) {
  return request<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload satisfies ApiPayload)
  });
}

export async function requestOtp(phone: string) {
  return request<{ sent: boolean; devCode?: string }>("/api/auth/request-otp", {
    method: "POST",
    body: JSON.stringify({ phone })
  });
}

export async function verifyOtp(phone: string, code: string) {
  return request<AuthResponse>("/api/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({ phone, code })
  });
}

export async function fetchMe() {
  return request<Account>("/api/auth/me");
}

export async function logout() {
  return request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
}

export async function updateProfile(payload: {
  name: string;
  role: Role;
  cityId: string;
  phone?: string;
  telegram?: string;
  services?: ServiceKey[];
  radiusKm?: number;
  available?: boolean;
}) {
  return request<Account>("/api/account", {
    method: "PATCH",
    body: JSON.stringify(payload satisfies ApiPayload)
  });
}

export async function fetchMessages(orderId: string) {
  return request<Message[]>(`/api/orders/${orderId}/messages`);
}

export async function sendMessage(orderId: string, text: string) {
  return request<Message>(`/api/orders/${orderId}/messages`, {
    method: "POST",
    body: JSON.stringify({ text })
  });
}

export async function verifyAccount() {
  return request<Account>("/api/account/verify", { method: "POST", body: "{}" });
}

export async function fetchPendingVerifications() {
  return request<Account[]>("/api/admin/verifications");
}

export async function decideVerification(id: string, approve: boolean) {
  return request<Account>(`/api/admin/verifications/${id}`, {
    method: "POST",
    body: JSON.stringify({ approve })
  });
}

export async function fetchUsers() {
  return request<Account[]>("/api/admin/users");
}

export async function registerPushToken(token: string) {
  return request<{ ok: boolean }>("/api/push/token", {
    method: "POST",
    body: JSON.stringify({ token })
  });
}

export async function fetchSchedules() {
  try {
    return await request<Schedule[]>("/api/schedules");
  } catch {
    return [];
  }
}

export async function createSchedule(payload: {
  cityId: string;
  service: ServiceKey;
  from: string;
  details: string;
  price: number;
  coordinates?: [number, number];
  intervalDays: number;
}) {
  return request<Schedule>("/api/schedules", {
    method: "POST",
    body: JSON.stringify(payload satisfies ApiPayload)
  });
}

export async function deleteSchedule(id: string) {
  return request<{ ok: boolean }>(`/api/schedules/${id}`, { method: "DELETE" });
}

export async function fetchStats() {
  try {
    return await request<{ jobs: number; earned: number }>("/api/stats");
  } catch {
    return { jobs: 0, earned: 0 };
  }
}

export async function fetchFavorites() {
  try {
    return await request<string[]>("/api/favorites");
  } catch {
    return [];
  }
}

export async function toggleFavorite(executorId: string) {
  return request<{ favorite: boolean }>(`/api/favorites/${executorId}`, { method: "POST" });
}

export async function withdrawWallet(amount: number) {
  return request<Wallet>("/api/wallet/withdraw", {
    method: "POST",
    body: JSON.stringify({ amount })
  });
}

// --- Справочник и заказы ----------------------------------------------------

export type GeocodeResult = { lat: number; lng: number; displayName: string };

// Адрес → координаты (для предпросмотра точки перед публикацией заявки).
export async function geocode(query: string, cityId: string) {
  return request<GeocodeResult>(
    `/api/geocode?q=${encodeURIComponent(query)}&cityId=${encodeURIComponent(cityId)}`
  );
}

// Подсказки адреса по мере ввода.
export async function suggestAddress(query: string, cityId: string) {
  try {
    return await request<GeocodeResult[]>(
      `/api/geocode/suggest?q=${encodeURIComponent(query)}&cityId=${encodeURIComponent(cityId)}`
    );
  } catch {
    return [];
  }
}

// Координаты → адрес (после выбора точки на карте / по геолокации).
export async function reverseGeocode(lat: number, lng: number) {
  try {
    return await request<{ displayName: string; lat: number; lng: number }>(
      `/api/geocode/reverse?lat=${lat}&lng=${lng}`
    );
  } catch {
    return null;
  }
}

export async function fetchCatalog() {
  try {
    return await request<Catalog>("/api/catalog");
  } catch {
    return fallbackCatalog;
  }
}

// Лента заказчика — его заявки.
export async function fetchMyOrders() {
  return request<Order[]>("/api/orders/mine");
}

// Биржа исполнителя — открытые заказы его города по его специализациям.
export async function fetchBourse() {
  return request<Order[]>("/api/orders/bourse");
}

// Заказы, которые исполнитель выиграл.
export async function fetchJobs() {
  return request<Order[]>("/api/orders/jobs");
}

export type AppConfig = { bidFee: number; bidPercent: number };

export async function fetchConfig() {
  try {
    return await request<AppConfig>("/api/config");
  } catch {
    return { bidFee: 0, bidPercent: 0 };
  }
}

export async function setConfig(payload: { bidFee?: number; bidPercent?: number }) {
  return request<AppConfig>("/api/config", {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function rejectBid(orderId: string, bidId: string) {
  return request<Order>(`/api/orders/${orderId}/bids/${bidId}`, { method: "DELETE" });
}

export async function fetchWallet() {
  return request<Wallet>("/api/wallet");
}

export async function topUpWallet(amount: number) {
  return request<Wallet>("/api/wallet/topup", {
    method: "POST",
    body: JSON.stringify({ amount })
  });
}

export async function deleteOrder(orderId: string) {
  return request<{ ok: boolean }>(`/api/orders/${orderId}`, { method: "DELETE" });
}

export async function finishOrder(orderId: string) {
  return request<Order>(`/api/orders/${orderId}/finish`, { method: "POST", body: "{}" });
}

export async function confirmOrder(orderId: string) {
  return request<Order>(`/api/orders/${orderId}/confirm`, { method: "POST", body: "{}" });
}

export async function fetchNotifications() {
  try {
    return await request<Notifications>("/api/notifications");
  } catch {
    return { items: [], unread: 0 };
  }
}

export async function markNotificationsRead() {
  return request<Notifications>("/api/notifications/read", { method: "POST", body: "{}" });
}

export async function reviewOrder(orderId: string, rating: number, text: string) {
  return request<Order>(`/api/orders/${orderId}/review`, {
    method: "POST",
    body: JSON.stringify({ rating, text })
  });
}

export async function createOrder(payload: {
  cityId: string;
  service: ServiceKey;
  from: string;
  details: string;
  price: number;
  coordinates?: [number, number];
}) {
  return request<Order>("/api/orders", {
    method: "POST",
    body: JSON.stringify(payload satisfies ApiPayload)
  });
}

export async function createBid(
  orderId: string,
  payload: { price: number; eta: string }
) {
  return request<Bid>(`/api/orders/${orderId}/bids`, {
    method: "POST",
    body: JSON.stringify(payload satisfies ApiPayload)
  });
}

export async function acceptBid(orderId: string, bidId: string) {
  return request<Order>(`/api/orders/${orderId}/accept`, {
    method: "POST",
    body: JSON.stringify({ bidId })
  });
}
