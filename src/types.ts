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
};

// Полный справочник, который отдаёт сервер на старте приложения.
export type Catalog = {
  regions: Region[];
  cities: City[];
  services: Service[];
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
  verified?: boolean;
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
};
