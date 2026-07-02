import { MaterialCommunityIcons } from "@expo/vector-icons";

// Ключ услуги — строка, а не фиксированный union: набор услуг приходит
// с сервера и может расширяться без правок в приложении.
export type ServiceKey = string;
export type OrderStatus = "open" | "matched" | "finished" | "done";
export type Role = "client" | "driver";
export type ViewMode = "orders" | "jobs" | "map" | "account" | "admin";

export type City = {
  id: string;
  regionId: string;
  name: string;
  region: string;
  center: [number, number];
  zoom: number;
  services: ServiceKey[];
};

export type Region = {
  id: string;
  name: string;
  cities: City[];
};

export type Service = {
  key: ServiceKey;
  title: string;
  subtitle: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  accent: string;
  category?: string;
};

// Категория группирует услуги в интерфейсе (вкладки/разделы).
export type Category = {
  key: string;
  title: string;
};

// Полный справочник, который отдаёт сервер на старте приложения.
export type Catalog = {
  regions: Region[];
  cities: City[];
  services: Service[];
  categories?: Category[];
};

export type Account = {
  id?: string;
  email: string;
  name: string;
  role: Role;
  cityId: string;
  contact?: string;
  phone?: string;
  telegram?: string;
  rating?: number;
  ratingCount?: number;
  balance?: number;
  radiusKm?: number;
  available?: boolean;
  verified?: boolean;
  verifyStatus?: "none" | "pending" | "verified" | "rejected";
  isAdmin?: boolean;
  services?: ServiceKey[];
  bio?: string;
  banned?: boolean;
  verificationBadges?: VerificationBadge[];
};

// Подтверждённая квалификация исполнителя по услуге (напр. сварщик → НАКС).
export type VerificationBadge = {
  serviceKey: ServiceKey;
  docType: string;
};

export type VerificationRequest = {
  id: string;
  accountId: string;
  serviceKey: ServiceKey;
  docType: string;
  photo: string;
  status: "pending" | "verified" | "rejected";
  createdAt: number;
  decidedAt?: number;
};

// Заявка на модерации (для админа): с данными исполнителя и фото документа.
export type PendingVerificationRequest = {
  id: string;
  accountId: string;
  accountName: string;
  accountEmail: string;
  accountPhone: string;
  serviceKey: ServiceKey;
  docType: string;
  photo: string;
  status: "pending";
  createdAt: number;
};

// Строка сетки цен (город × услуга) для админ-грида.
export type PricingCell = {
  cityId: string;
  cityName: string;
  serviceKey: ServiceKey;
  serviceName: string;
  coinCost: number;
  enabled: boolean;
};

export type PortfolioItem = {
  id: string;
  title: string;
  description: string;
  photoUrl: string;
  createdAt: number;
};

export type ExecutorReview = {
  id: string;
  rating: number;
  text: string;
  createdAt: number;
  author: string;
};

// Публичный профиль исполнителя (для заказчика при выборе).
export type ExecutorProfile = Account & {
  bio: string;
  portfolio: PortfolioItem[];
  reviews: ExecutorReview[];
  jobsCompleted: number;
};

export type Transaction = {
  id: string;
  type: "topup" | "charge" | "bonus" | "withdraw" | "refund";
  amount: number;
  balanceAfter: number;
  note: string;
  createdAt: number;
};

export type Wallet = {
  balance: number;
  transactions: Transaction[];
};

export type Contact = {
  id: string;
  name: string;
  phone: string;
  telegram: string;
  verified?: boolean;
};

export type Schedule = {
  id: string;
  cityId: string;
  service: ServiceKey;
  from: string;
  details: string;
  price: number;
  coordinates: [number, number];
  intervalDays: number;
  nextRun: number;
  active: boolean;
};

export type SavedPlace = {
  id: string;
  label: string;
  fromText: string;
  lng: number;
  lat: number;
  createdAt: number;
};

export type Message = {
  id: string;
  orderId: string;
  fromId: string;
  text: string;
  createdAt: number;
};

export type Notification = {
  id: string;
  type: string;
  text: string;
  orderId: string;
  read: boolean;
  createdAt: number;
};

export type Notifications = {
  items: Notification[];
  unread: number;
};

export type AuthResponse = {
  token: string;
  account: Account;
};

export type RegisterPayload = {
  email: string;
  password: string;
  name: string;
  role: Role;
  cityId: string;
};

export type LoginPayload = {
  email: string;
  password: string;
};

export type Bid = {
  id: string;
  driverId?: string;
  driver: string;
  price: number;
  eta: string;
  rating: number;
  ratingCount?: number;
  jobsCompleted?: number;
  verified?: boolean;
  // профессия подтверждена документом для услуги этого заказа
  verifiedService?: boolean;
};

export type Order = {
  id: string;
  cityId: string;
  customerId?: string;
  executorId?: string;
  service: ServiceKey;
  from: string;
  details: string;
  price: number;
  distance: string;
  status: OrderStatus;
  reviewed?: boolean;
  coordinates: [number, number];
  customerName: string;
  customer?: Contact | null;
  executor?: Contact | null;
  bids: Bid[];
  reach?: number;
};
