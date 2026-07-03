import Constants from "expo-constants";
import {
  Account,
  AuthResponse,
  Bid,
  Catalog,
  Complaint,
  ExecutorProfile,
  LoginPayload,
  Message,
  Notifications,
  Order,
  PendingVerificationRequest,
  PricingCell,
  RegisterPayload,
  Role,
  SavedPlace,
  Schedule,
  ServiceKey,
  VerificationRequest,
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

export async function verifyOtp(phone: string, code: string, referralCode?: string) {
  return request<AuthResponse>("/api/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({ phone, code, ...(referralCode ? { referralCode } : {}) })
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

export async function fetchUsers(params?: { q?: string; limit?: number; offset?: number }) {
  const p = new URLSearchParams();
  if (params?.q) p.append("q", params.q);
  p.append("limit", String(params?.limit ?? 20));
  p.append("offset", String(params?.offset ?? 0));
  return request<Account[]>(`/api/admin/users?${p.toString()}`);
}

export type AnalyticsTotals = {
  orders: number;
  gmv: number;
  doneOrders: number;
  doneGmv: number;
  activeClients: number;
  activeDrivers: number;
  newClients: number;
  newDrivers: number;
  clientLogins: number;
  driverLogins: number;
  coinRevenue: number;
  repeatRate: number;
};

export type AnalyticsCell = {
  cityId: string;
  cityName: string;
  serviceKey: string;
  serviceName: string;
  count: number;
  gmv: number;
  fillRate: number;
  avgBids: number;
  supply: number;
};

export type DemandAnalytics = {
  days: number;
  cityId: string | null;
  totals: AnalyticsTotals;
  byCategory: { key: string; title: string; count: number; gmv: number }[];
  byService: { key: string; title: string; category: string; count: number; gmv: number; avgPrice: number }[];
  byCity: { key: string; title: string; count: number; gmv: number }[];
  matrix: AnalyticsCell[];
};

export async function fetchAnalytics(days: number, cityId?: string | null) {
  const q = cityId ? `?days=${days}&cityId=${encodeURIComponent(cityId)}` : `?days=${days}`;
  return request<DemandAnalytics>(`/api/admin/analytics${q}`);
}

// --- Массовые цены ---
export async function updatePricingBulk(
  rules: { cityId: string; serviceKey: ServiceKey; coinCost: number; enabled: boolean }[]
) {
  return request<{ ok: boolean; count: number }>("/api/admin/pricing/bulk", {
    method: "POST",
    body: JSON.stringify({ rules })
  });
}

// --- Модерация пользователей ---
export async function adminAdjustBalance(accountId: string, amount: number, note: string) {
  return request<{ ok: boolean; balance: number }>(`/api/admin/users/${accountId}/balance`, {
    method: "POST",
    body: JSON.stringify({ amount, note })
  });
}

export async function adminSetBanned(accountId: string, banned: boolean) {
  return request<{ ok: boolean; banned: boolean }>(`/api/admin/users/${accountId}/ban`, {
    method: "POST",
    body: JSON.stringify({ banned })
  });
}

// --- Ленты для админа ---
export type AdminOrder = {
  id: string;
  cityId: string;
  service: ServiceKey;
  price: number;
  status: string;
  customerName: string;
  bids: number;
  createdAt: number;
};

export type AdminTransaction = {
  id: string;
  accountId: string;
  accountName: string;
  type: string;
  amount: number;
  balanceAfter: number;
  note: string;
  createdAt: number;
};

export async function fetchAdminOrders(params?: {
  cityId?: string | null;
  status?: string | null;
  limit?: number;
  offset?: number;
}) {
  const q = new URLSearchParams();
  if (params?.cityId) q.append("cityId", params.cityId);
  if (params?.status) q.append("status", params.status);
  q.append("limit", String(params?.limit ?? 20));
  q.append("offset", String(params?.offset ?? 0));
  return request<AdminOrder[]>(`/api/admin/orders?${q.toString()}`);
}

export async function fetchAdminTransactions(limit = 20, offset = 0) {
  return request<{ transactions: AdminTransaction[] }>(
    `/api/admin/transactions?limit=${limit}&offset=${offset}`
  );
}

// --- Управление каталогом ---
export async function adminAddCity(payload: {
  id: string;
  regionId: string;
  name: string;
  centerLng: number;
  centerLat: number;
  zoom?: number;
}) {
  return request<{ ok: boolean; id: string }>("/api/admin/cities", {
    method: "POST",
    body: JSON.stringify(payload satisfies ApiPayload)
  });
}

export async function adminAddService(payload: {
  key: string;
  title: string;
  subtitle: string;
  icon: string;
  accent: string;
  category: string;
}) {
  return request<{ ok: boolean; key: string }>("/api/admin/services", {
    method: "POST",
    body: JSON.stringify(payload satisfies ApiPayload)
  });
}

export async function adminSetCityService(cityId: string, serviceKey: string, enabled: boolean) {
  return request<{ ok: boolean }>("/api/admin/city-services", {
    method: "POST",
    body: JSON.stringify({ cityId, serviceKey, enabled })
  });
}

// Публичный профиль исполнителя (портфолио, отзывы) — для заказчика.
export async function fetchExecutorProfile(executorId: string) {
  return request<ExecutorProfile>(`/api/executors/${executorId}`);
}

// Обновление собственного портфолио исполнителя.
export async function updatePortfolio(payload: {
  bio?: string;
  addItem?: { title: string; description: string; photoUrl: string };
  deleteItemId?: string;
}) {
  return request<ExecutorProfile>("/api/account/portfolio", {
    method: "PATCH",
    body: JSON.stringify(payload satisfies ApiPayload)
  });
}

// --- Верификация по документу ---

export async function createVerificationRequest(payload: {
  serviceKey: ServiceKey;
  docType: string;
  photo: string;
}) {
  return request<VerificationRequest>("/api/account/verification-request", {
    method: "POST",
    body: JSON.stringify(payload satisfies ApiPayload)
  });
}

export async function fetchMyVerifications() {
  try {
    return await request<VerificationRequest[]>("/api/account/verification-requests");
  } catch {
    return [];
  }
}

export async function fetchPendingVerificationRequests() {
  return request<PendingVerificationRequest[]>("/api/admin/verification-requests");
}

export async function decideVerificationRequest(id: string, approve: boolean) {
  return request<VerificationRequest>(`/api/admin/verification-requests/${id}`, {
    method: "POST",
    body: JSON.stringify({ approve })
  });
}

// --- Монеты: цены по нишам (админ) ---

export async function fetchPricingGrid() {
  return request<{ grid: PricingCell[] }>("/api/admin/pricing");
}

export async function setPricingRule(payload: {
  cityId: string;
  serviceKey: ServiceKey;
  coinCost: number;
  enabled: boolean;
}) {
  return request<{ ok: boolean }>("/api/admin/pricing", {
    method: "POST",
    body: JSON.stringify(payload satisfies ApiPayload)
  });
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

export type PriceHint = { count: number; min?: number; median?: number; max?: number };

// Подсказка цены по (город × услуга) для формы заявки.
export async function fetchPriceHint(cityId: string, service: string) {
  try {
    return await request<PriceHint>(
      `/api/price-hint?cityId=${encodeURIComponent(cityId)}&service=${encodeURIComponent(service)}`
    );
  } catch {
    return { count: 0 };
  }
}

// Сколько исполнителей поблизости видят открытый заказ.
export async function fetchReach(orderId: string) {
  try {
    return await request<{ reach: number }>(`/api/orders/${orderId}/reach`);
  } catch {
    return { reach: 0 };
  }
}

// --- Сохранённые адреса заказчика ---

export async function fetchPlaces() {
  try {
    return await request<SavedPlace[]>("/api/places");
  } catch {
    return [];
  }
}

export async function createPlace(payload: { label: string; fromText: string; lng: number; lat: number }) {
  return request<SavedPlace>("/api/places", {
    method: "POST",
    body: JSON.stringify(payload satisfies ApiPayload)
  });
}

export async function deletePlace(id: string) {
  return request<{ ok: boolean }>(`/api/places/${id}`, { method: "DELETE" });
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

export type PricingRuleCompact = { c: string; s: string; p: number };
export type AppConfig = {
  bidFee: number;
  bidPercent: number;
  pricingRules?: PricingRuleCompact[];
};

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

// amount — монеты. Возвращает Wallet (dev) ЛИБО { confirmationUrl } (ЮKassa).
export async function topUpWallet(amount: number) {
  return request<Wallet & { confirmationUrl?: string }>("/api/wallet/topup", {
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

export async function cancelOrder(orderId: string, reason: string) {
  return request<Order>(`/api/orders/${orderId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}

export async function setOrderEnroute(orderId: string) {
  return request<Order>(`/api/orders/${orderId}/enroute`, { method: "POST", body: "{}" });
}

export async function sendExecutorLocation(orderId: string, lng: number, lat: number) {
  return request<{ ok: boolean }>(`/api/orders/${orderId}/location`, {
    method: "POST",
    body: JSON.stringify({ lng, lat })
  });
}

export async function reviewCustomer(orderId: string, rating: number, text: string) {
  return request<Order>(`/api/orders/${orderId}/review-customer`, {
    method: "POST",
    body: JSON.stringify({ rating, text })
  });
}

export async function createComplaint(orderId: string, type: string, text: string) {
  return request<{ id: string }>("/api/complaints", {
    method: "POST",
    body: JSON.stringify({ orderId, type, text })
  });
}

export async function fetchReferralCode() {
  try {
    return await request<{ code: string; count: number }>("/api/referral-code");
  } catch {
    return { code: "", count: 0 };
  }
}

export async function quickOrderFavorite(
  executorId: string,
  payload: { cityId: string; service: ServiceKey; from: string; details: string; price: number; coordinates?: [number, number] }
) {
  return request<Order>(`/api/favorites/${executorId}/quick-order`, {
    method: "POST",
    body: JSON.stringify(payload satisfies ApiPayload)
  });
}

export async function fetchAdminComplaints(status?: string | null) {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  return request<Complaint[]>(`/api/admin/complaints${q}`);
}

export async function decideComplaint(id: string, resolution: string) {
  return request<{ ok: boolean }>(`/api/admin/complaints/${id}`, {
    method: "POST",
    body: JSON.stringify({ resolution })
  });
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
