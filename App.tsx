import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  acceptBid as acceptBidOnServer,
  ApiError,
  confirmOrder as confirmOrderOnServer,
  createBid,
  createOrder as createOrderOnServer,
  createSchedule as createScheduleOnServer,
  adminAddCity,
  adminAddService,
  adminAdjustBalance,
  adminSetBanned,
  adminSetCityService,
  cancelOrder as cancelOrderOnServer,
  createComplaint,
  createVerificationRequest,
  decideComplaint,
  decideVerification,
  decideVerificationRequest,
  fetchAdminComplaints,
  fetchAdminOrders,
  fetchAdminTransactions,
  fetchReferralCode,
  quickOrderFavorite,
  reviewCustomer,
  sendExecutorLocation,
  setOrderEnroute,
  updatePricingBulk,
  deleteOrder as deleteOrderOnServer,
  deleteSchedule as deleteScheduleOnServer,
  fetchAnalytics,
  fetchBourse,
  fetchCatalog,
  fetchConfig,
  fetchExecutorProfile,
  fetchMyVerifications,
  fetchPendingVerificationRequests,
  fetchPlaces,
  fetchPriceHint,
  fetchPricingGrid,
  fetchReach,
  createPlace,
  deletePlace,
  setPricingRule as setPricingRuleOnServer,
  fetchJobs,
  fetchFavorites,
  fetchMe,
  fetchMessages,
  fetchMyOrders,
  fetchNotifications,
  fetchPendingVerifications,
  fetchSchedules,
  fetchStats,
  fetchUsers,
  fetchWallet,
  finishOrder as finishOrderOnServer,
  geocode,
  logout as logoutOnServer,
  markNotificationsRead,
  registerPushToken,
  rejectBid as rejectBidOnServer,
  reverseGeocode,
  reviewOrder,
  setAuthToken,
  sendMessage,
  setConfig,
  suggestAddress,
  toggleFavorite as toggleFavoriteOnServer,
  topUpWallet,
  updatePortfolio,
  listEquipment,
  addEquipment,
  updateEquipment,
  deleteEquipment,
  verifyEquipmentSts,
  fetchOffers,
  contactOffer,
  requestOffer,
  complainOffer,
  fetchEquipmentVerifications,
  decideEquipmentVerification,
  updateProfile,
  verifyAccount,
  withdrawWallet
} from "./src/api";
import type { AdminOrder, AdminTransaction, DemandAnalytics, GeocodeResult } from "./src/api";
import { AuthScreen } from "./src/AuthScreen";
import { fallbackCatalog, serviceByKey, setServiceRegistry } from "./src/catalog";
import { formatKm, getCurrentPosition, haversineKm } from "./src/geo";
import { MapView } from "./src/MapView";
import { getPushToken, onNotificationTap } from "./src/push";
import { clearToken, loadToken, saveToken } from "./src/storage";
import { colors, radius, ui } from "./src/theme";
import {
  Account,
  AuthResponse,
  Catalog,
  Category,
  City,
  Complaint,
  Equipment,
  EquipmentVerification,
  Offer,
  ExecutorProfile,
  Order,
  OrderStatus,
  PendingVerificationRequest,
  PortfolioItem,
  PricingCell,
  Role,
  Message,
  Notification,
  SavedPlace,
  Schedule,
  Service,
  ServiceKey,
  Transaction,
  VerificationRequest,
  ViewMode,
  Wallet
} from "./src/types";
import { pickImageAsBase64 } from "./src/imageUpload";
import { OnboardingModal } from "./src/OnboardingModal";
import { LegalScreen } from "./src/LegalScreen";
import { equipmentSchema, hasEquipmentSchema, summarizeSpecs } from "./src/equipmentSpecs";

// Форматирование без Intl (на Hermes/Android Intl ограничен и может падать).
const rub = {
  format(value: number) {
    return Math.round(value)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }
};

// Курс монеты: 1 монета = 10 ₽.
const COIN_RATE = 10;
const coinsToRub = (coins: number) => coins * COIN_RATE;

// Фирменная монетка Кубера — золотой кружок с «К».
function CoinIcon({ size = 18 }: { size?: number }) {
  return (
    <View
      style={[
        styles.coin,
        { width: size, height: size, borderRadius: size / 2, borderWidth: Math.max(1, size / 12) }
      ]}
    >
      <Text style={[styles.coinText, { fontSize: size * 0.62 }]}>К</Text>
    </View>
  );
}

export default function App() {
  const [bootReady, setBootReady] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);

  const [catalog, setCatalog] = useState<Catalog>(fallbackCatalog);
  const [role, setRole] = useState<Role>("client");
  const [devMode, setDevMode] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("orders");
  const [cityId, setCityId] = useState(fallbackCatalog.cities[0]?.id ?? "yakutsk");
  const [selectedService, setSelectedService] = useState<ServiceKey>("water");

  const [orders, setOrders] = useState<Order[]>([]);
  // Активный заказ «в пути» — трек координат не должен зависеть от вкладки
  // (список orders меняется между биржей/заказами/картой).
  const [activeEnrouteId, setActiveEnrouteId] = useState("");
  const [detailId, setDetailId] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [serverState, setServerState] = useState<"sync" | "offline">("sync");

  const [from, setFrom] = useState("");
  const [details, setDetails] = useState("");
  const [price, setPrice] = useState("");

  const [pickCoords, setPickCoords] = useState<[number, number] | null>(null);
  const [pickLabel, setPickLabel] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCenter, setPickerCenter] = useState<[number, number] | null>(null);
  const [tempPick, setTempPick] = useState<[number, number] | null>(null);
  const [geoError, setGeoError] = useState("");
  const [locating, setLocating] = useState(false);

  const [userPos, setUserPos] = useState<[number, number] | null>(null);
  const tabFade = useRef(new Animated.Value(1)).current;
  const tabShift = useRef(new Animated.Value(0)).current;
  // Защита от повторного запуска операций (двойные нажатия → дубли/списания).
  const opBusy = useRef<Record<string, boolean>>({});
  const [bidFee, setBidFee] = useState(0);
  const [bidPercent, setBidPercent] = useState(0);
  // Нишевые цены отклика: "cityId|serviceKey" → стоимость в монетах.
  const [pricingRules, setPricingRules] = useState<Map<string, number>>(new Map());

  // Стоимость отклика на заказ в монетах: нишевая цена, иначе глобальный тариф.
  const orderBidCost = useCallback(
    (order: Order) => {
      const niche = pricingRules.get(`${order.cityId}|${order.service}`);
      if (niche !== undefined) {
        return niche;
      }
      return bidFee + Math.round((order.price * bidPercent) / 100);
    },
    [pricingRules, bidFee, bidPercent]
  );
  const [bidError, setBidError] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [savePlaceOpen, setSavePlaceOpen] = useState(false);
  const [savePlaceLabel, setSavePlaceLabel] = useState("");
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; onYes: () => void } | null>(null);
  const askConfirm = useCallback((title: string, message: string, onYes: () => void) => {
    setConfirmState({ title, message, onYes });
  }, []);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [execProfile, setExecProfile] = useState<ExecutorProfile | null>(null);
  const [execLoading, setExecLoading] = useState(false);

  // Открыть публичный профиль исполнителя (портфолио, отзывы) — для заказчика.
  async function openExecutor(executorId: string) {
    if (!executorId) {
      return;
    }
    setExecLoading(true);
    setExecProfile(null);
    try {
      setExecProfile(await fetchExecutorProfile(executorId));
    } catch {
      setExecProfile(null);
    } finally {
      setExecLoading(false);
    }
  }

  const currentCity = catalog.cities.find((city) => city.id === cityId) ?? catalog.cities[0];
  const cityServices = useMemo(
    () => catalog.services.filter((service) => currentCity?.services.includes(service.key)),
    [catalog.services, currentCity]
  );
  const selectedServiceData = serviceByKey(selectedService);
  const detailOrder = orders.find((order) => order.id === detailId);
  // Для «Заказать снова»: последний выполненный заказ, иначе последний вообще.
  const lastRepeatOrder = useMemo(() => {
    if (role !== "client" || orders.length === 0) {
      return null;
    }
    return orders.find((o) => o.status === "done") ?? orders.find((o) => o.status !== "cancelled") ?? null;
  }, [orders, role]);

  // Избранные исполнители с именами (из истории заказов) — для быстрого вызова.
  const favoriteExecutors = useMemo(() => {
    const names = new Map<string, string>();
    for (const o of orders) {
      if (o.executor?.id && favorites.includes(o.executor.id) && !names.has(o.executor.id)) {
        names.set(o.executor.id, o.executor.name);
      }
    }
    return favorites.map((id) => ({ id, name: names.get(id) || "Исполнитель" }));
  }, [orders, favorites]);

  // Сезонная подсказка (Якутск): зима — вода/прогрев, лето — полив/септик.
  const seasonalHint = useMemo(() => {
    const m = new Date().getMonth();
    if (m >= 10 || m <= 2) {
      return { icon: "snowflake" as const, title: "Зимний сезон", text: "Подвоз воды и прогрев — заказывайте заранее, спрос высокий." };
    }
    if (m >= 5 && m <= 7) {
      return { icon: "water" as const, title: "Летний сезон", text: "Полив, подвоз воды и откачка септика — самое время." };
    }
    return null;
  }, []);

  // Исполнителю на бирже: фильтр по рабочему радиусу + сортировка по близости.
  const displayOrders = useMemo(() => {
    if (role === "driver" && viewMode === "orders" && userPos) {
      const radius = account?.radiusKm ?? 0;
      const within =
        radius > 0
          ? orders.filter((o) => haversineKm(userPos, o.coordinates) <= radius)
          : orders;
      return [...within].sort(
        (a, b) => haversineKm(userPos, a.coordinates) - haversineKm(userPos, b.coordinates)
      );
    }
    return orders;
  }, [orders, role, viewMode, userPos, account]);

  const pickerCity: City | undefined = currentCity
    ? { ...currentCity, center: pickerCenter ?? currentCity.center, zoom: 16 }
    : undefined;

  function distanceText(order: Order) {
    return userPos ? formatKm(haversineKm(userPos, order.coordinates)) : order.distance;
  }

  function applyAccount(next: Account) {
    setAccount(next);
    setRole(next.role);
    setCityId(next.cityId);
  }

  // Старт: токен + справочник, при наличии токена — профиль и геопозиция.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [token, nextCatalog, config] = await Promise.all([
        loadToken(),
        fetchCatalog(),
        fetchConfig()
      ]);
      if (cancelled) {
        return;
      }
      setCatalog(nextCatalog);
      setServiceRegistry(nextCatalog.services);
      setBidFee(config.bidFee);
      setBidPercent(config.bidPercent);
      setPricingRules(new Map((config.pricingRules ?? []).map((r) => [`${r.c}|${r.s}`, r.p])));
      setCityId((current) =>
        nextCatalog.cities.some((city) => city.id === current)
          ? current
          : nextCatalog.cities[0]?.id ?? ""
      );

      if (token) {
        setAuthToken(token);
        try {
          const me = await fetchMe();
          if (!cancelled) {
            applyAccount(me);
          }
        } catch {
          setAuthToken(null);
          await clearToken();
        }
      }
      if (!cancelled) {
        setBootReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Геопозиция (для дистанции и автоадреса). Тихо, без блокировок.
  useEffect(() => {
    if (!account) {
      return;
    }
    void getCurrentPosition().then((pos) => {
      if (pos) {
        setUserPos(pos);
      }
    });
    // Регистрируем push-токен (на устройстве; на web — no-op).
    void getPushToken().then((token) => {
      if (token) {
        void registerPushToken(token).catch(() => {});
      }
    });
  }, [account]);

  // Тап по push-уведомлению → открываем нужный заказ.
  useEffect(() => {
    if (!account) {
      return;
    }
    let unsub = () => {};
    void onNotificationTap((orderId) => {
      setViewMode(role === "driver" ? "jobs" : "orders");
      setDetailId(orderId);
    }).then((fn) => {
      unsub = fn;
    });
    return () => unsub();
  }, [account, role]);

  // Избранные исполнители (для заказчика).
  useEffect(() => {
    if (account?.role === "client") {
      void fetchFavorites().then(setFavorites).catch(() => {});
    } else {
      setFavorites([]);
    }
  }, [account]);

  // Сохранённые адреса (для заказчика).
  useEffect(() => {
    if (account?.role === "client") {
      void fetchPlaces().then(setSavedPlaces).catch(() => {});
    } else {
      setSavedPlaces([]);
    }
  }, [account]);

  // Исполнитель «в пути» — периодически шлём координаты (раз в 20с).
  // Берём заказ из выделенного состояния (не зависит от вкладки), а если его нет —
  // из текущего списка (напр. после холодного старта на вкладке «Заказы»).
  const myEnrouteId = useMemo(() => {
    if (role !== "driver" || !account) {
      return "";
    }
    if (activeEnrouteId) {
      return activeEnrouteId;
    }
    return orders.find((o) => o.status === "enroute" && o.executorId === account.id)?.id ?? "";
  }, [role, account, orders, activeEnrouteId]);
  useEffect(() => {
    if (!myEnrouteId) {
      return;
    }
    let cancelled = false;
    const tick = async () => {
      const pos = await getCurrentPosition();
      if (pos && !cancelled) {
        try {
          await sendExecutorLocation(myEnrouteId, pos[0], pos[1]);
        } catch {
          // не критично
        }
      }
    };
    void tick();
    const timer = setInterval(tick, 20000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [myEnrouteId]);

  async function toggleFavorite(executorId: string) {
    if (!executorId) {
      return;
    }
    try {
      const { favorite } = await toggleFavoriteOnServer(executorId);
      setFavorites((cur) => (favorite ? [...cur, executorId] : cur.filter((id) => id !== executorId)));
    } catch {
      // тихо
    }
  }

  // Уведомления (колокольчик): загрузка + поллинг.
  const loadNotifications = useCallback(async () => {
    try {
      const n = await fetchNotifications();
      setNotifications(n.items);
      setUnread(n.unread);
    } catch {
      // тихо
    }
  }, []);

  useEffect(() => {
    if (!account) {
      return;
    }
    void loadNotifications();
    const timer = setInterval(loadNotifications, 12000);
    return () => clearInterval(timer);
  }, [account, loadNotifications]);

  async function openNotifications() {
    setNotifOpen(true);
    if (unread > 0) {
      try {
        const n = await markNotificationsRead();
        setNotifications(n.items);
        setUnread(n.unread);
      } catch {
        // тихо
      }
    }
  }

  const loadOrders = useCallback(
    async (spinner = true) => {
      if (spinner) {
        setRefreshing(true);
      }
      try {
        let next: Order[];
        if (role === "driver") {
          next = viewMode === "jobs" ? await fetchJobs() : await fetchBourse();
        } else {
          next = await fetchMyOrders();
        }
        setOrders(next);
        setServerState("sync");
      } catch {
        setServerState("offline");
      } finally {
        if (spinner) {
          setRefreshing(false);
        }
      }
    },
    [role, viewMode]
  );

  useEffect(() => {
    if (account) {
      void loadOrders();
    }
  }, [account, loadOrders]);

  // Тихое автообновление ленты.
  useEffect(() => {
    if (!account || viewMode === "account") {
      return;
    }
    const timer = setInterval(() => void loadOrders(false), 12000);
    return () => clearInterval(timer);
  }, [account, viewMode, loadOrders]);

  useEffect(() => {
    if (cityServices.length && !cityServices.some((service) => service.key === selectedService)) {
      setSelectedService(cityServices[0].key);
    }
  }, [cityServices, selectedService]);

  // Плавный переход при смене вкладки (затухание + лёгкий сдвиг).
  useEffect(() => {
    tabFade.setValue(0);
    tabShift.setValue(10);
    Animated.parallel([
      Animated.timing(tabFade, { toValue: 1, duration: 220, useNativeDriver: Platform.OS !== "web" }),
      Animated.timing(tabShift, { toValue: 0, duration: 220, useNativeDriver: Platform.OS !== "web" })
    ]).start();
  }, [viewMode, tabFade, tabShift]);

  async function onAuthenticated(result: AuthResponse) {
    setAuthToken(result.token);
    await saveToken(result.token);
    applyAccount(result.account);
    setViewMode("orders");
  }

  async function handleLogout() {
    try {
      await logoutOnServer();
    } catch {
      // выходим локально даже без сети
    }
    setAuthToken(null);
    await clearToken();
    setAccount(null);
    setOrders([]);
    setActiveEnrouteId("");
    setDevMode(false);
    setViewMode("orders");
  }

  async function changeRole(next: Role) {
    setRole(next);
    setViewMode("orders");
    setDetailId("");
    setOrders([]);
    if (account) {
      try {
        const updated = await updateProfile({
          name: account.name,
          role: next,
          cityId: account.cityId,
          phone: account.phone ?? "",
          telegram: account.telegram ?? "",
          services: account.services ?? []
        });
        setAccount(updated);
      } catch {
        setServerState("offline");
      }
    }
  }

  function updateOrderInList(updated: Order) {
    setOrders((current) => current.map((order) => (order.id === updated.id ? updated : order)));
  }

  async function openPicker() {
    setGeoError("");
    setPickerOpen(true);
    const address = from.trim();
    if (address) {
      try {
        const found = await geocode(address, cityId);
        const point: [number, number] = [found.lng, found.lat];
        setPickerCenter(point);
        setTempPick(point);
        setPickLabel(found.displayName);
      } catch {
        setPickerCenter(pickCoords ?? userPos ?? currentCity?.center ?? null);
        setTempPick(pickCoords ?? userPos);
        setGeoError("Адрес не найден — поставьте точку вручную.");
      }
    } else {
      setPickerCenter(pickCoords ?? userPos ?? currentCity?.center ?? null);
      setTempPick(pickCoords ?? userPos);
    }
  }

  async function confirmPick() {
    const point = tempPick;
    setPickerOpen(false);
    if (!point) {
      return;
    }
    setPickCoords(point);
    const reversed = await reverseGeocode(point[1], point[0]);
    const label = reversed?.displayName || `Точка ${point[1].toFixed(5)}, ${point[0].toFixed(5)}`;
    setPickLabel(label);
    // Выбрали новую точку — подставляем её адрес в поле (иначе адрес и точка расходятся).
    setFrom(label);
  }

  function resetLocation() {
    setPickCoords(null);
    setPickLabel("");
    setTempPick(null);
    setPickerCenter(null);
  }

  // Выбрать сохранённое место — подставить адрес и точку.
  function pickSavedPlace(place: SavedPlace) {
    setFrom(place.fromText);
    setPickCoords([place.lng, place.lat]);
    setPickLabel(place.fromText);
    setGeoError("");
  }

  async function confirmSavePlace() {
    if (!pickCoords || !savePlaceLabel.trim() || !from.trim()) {
      return;
    }
    try {
      const created = await createPlace({
        label: savePlaceLabel.trim(),
        fromText: from.trim(),
        lng: pickCoords[0],
        lat: pickCoords[1]
      });
      setSavedPlaces((cur) => [created, ...cur]);
      setSavePlaceLabel("");
      setSavePlaceOpen(false);
    } catch {
      setServerState("offline");
    }
  }

  async function removeSavedPlace(id: string) {
    try {
      await deletePlace(id);
      setSavedPlaces((cur) => cur.filter((p) => p.id !== id));
    } catch {
      setServerState("offline");
    }
  }

  function selectSuggestion(item: GeocodeResult) {
    setFrom(item.displayName);
    setPickCoords([item.lng, item.lat]);
    setPickLabel(item.displayName);
  }

  // Заказчик: подставить ближайший адрес по геолокации (в радиусе 500 м — адрес, иначе координаты).
  async function useMyLocation() {
    setGeoError("");
    setLocating(true);
    try {
      const pos = await getCurrentPosition();
      if (!pos) {
        setGeoError("Не удалось получить геопозицию (нет доступа).");
        return;
      }
      setUserPos(pos);
      setPickCoords(pos);
      const rev = await reverseGeocode(pos[1], pos[0]);
      if (rev && haversineKm(pos, [rev.lng, rev.lat]) <= 0.1) {
        setFrom(rev.displayName);
        setPickLabel(rev.displayName);
      } else {
        const coordLabel = `Координаты ${pos[1].toFixed(5)}, ${pos[0].toFixed(5)}`;
        setFrom(coordLabel);
        setPickLabel(coordLabel);
      }
    } finally {
      setLocating(false);
    }
  }

  async function createOrder(repeatDays = 0): Promise<boolean> {
    setGeoError("");
    const numericPrice = Number(price.replace(/\D/g, ""));
    if (!from.trim() || !details.trim() || !currentCity || numericPrice < 1 || numericPrice > 1000000) {
      return false;
    }
    if (opBusy.current.createOrder) {
      return false;
    }
    opBusy.current.createOrder = true;
    const payload = {
      cityId,
      service: selectedService,
      from: from.trim(),
      details: details.trim(),
      price: numericPrice,
      ...(pickCoords ? { coordinates: pickCoords } : {})
    };
    try {
      const nextOrder = await createOrderOnServer(payload);
      setOrders((current) => [nextOrder, ...current]);
      setDetailId(nextOrder.id);
      // Регулярная доставка: заводим расписание с теми же параметрами.
      if (repeatDays > 0) {
        try {
          await createScheduleOnServer({ ...payload, intervalDays: repeatDays });
        } catch {
          // не критично — заказ уже создан
        }
      }
      setFrom("");
      setDetails("");
      setPrice("");
      resetLocation();
      setServerState("sync");
      return true;
    } catch (e) {
      // Сервер не смог определить адрес — просим уточнить точку (не «уходим в офлайн»).
      if (e instanceof ApiError && e.status === 400) {
        setGeoError(e.message);
      } else {
        setServerState("offline");
      }
      return false;
    } finally {
      opBusy.current.createOrder = false;
    }
  }

  async function verify() {
    try {
      applyAccount(await verifyAccount());
      setServerState("sync");
    } catch {
      setServerState("offline");
    }
  }

  async function sendBid(orderId: string, bidPrice: number, eta: string): Promise<boolean> {
    if (opBusy.current[`bid_${orderId}`]) {
      return false;
    }
    opBusy.current[`bid_${orderId}`] = true;
    setBidError("");
    try {
      const target = orders.find((o) => o.id === orderId);
      const fee = target ? orderBidCost(target) : 0;
      const bid = await createBid(orderId, { price: bidPrice, eta });
      setOrders((current) =>
        current.map((order) =>
          order.id === orderId ? { ...order, bids: [bid, ...order.bids] } : order
        )
      );
      // если была плата за отклик — обновим баланс в профиле (монеты)
      if (fee > 0 && account) {
        setAccount((current) => (current ? { ...current, balance: (current.balance ?? 0) - fee } : current));
      }
      setServerState("sync");
      return true;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 402 || e.status === 409)) {
        setBidError(e.message);
      } else {
        setServerState("offline");
      }
      return false;
    } finally {
      opBusy.current[`bid_${orderId}`] = false;
    }
  }

  useEffect(() => {
    setBidError("");
  }, [detailId]);

  async function rejectBid(orderId: string, bidId: string) {
    try {
      updateOrderInList(await rejectBidOnServer(orderId, bidId));
      setServerState("sync");
    } catch {
      setServerState("offline");
    }
  }

  // Повторить заказ — заполнить форму данными прошлой заявки (актуально для воды).
  function repeatOrder(order: Order) {
    setSelectedService(order.service);
    setFrom(order.from);
    setDetails(order.details);
    setPrice(String(order.price));
    setPickCoords(order.coordinates);
    setPickLabel(order.from);
    setDetailId("");
    setViewMode("orders");
  }

  async function chooseBid(orderId: string, bidId: string) {
    try {
      updateOrderInList(await acceptBidOnServer(orderId, bidId));
      setServerState("sync");
    } catch {
      setServerState("offline");
    }
  }

  async function removeOrder(orderId: string) {
    try {
      await deleteOrderOnServer(orderId);
      setOrders((current) => current.filter((order) => order.id !== orderId));
      setDetailId("");
      setServerState("sync");
    } catch {
      setServerState("offline");
    }
  }

  async function executorFinish(orderId: string) {
    try {
      updateOrderInList(await finishOrderOnServer(orderId));
      if (activeEnrouteId === orderId) {
        setActiveEnrouteId(""); // доехал — прекращаем трек
      }
      setServerState("sync");
    } catch {
      setServerState("offline");
    }
  }

  async function clientConfirm(orderId: string) {
    try {
      updateOrderInList(await confirmOrderOnServer(orderId));
      setServerState("sync");
    } catch {
      setServerState("offline");
    }
  }

  async function submitReview(orderId: string, rating: number, text: string) {
    try {
      updateOrderInList(await reviewOrder(orderId, rating, text));
      setServerState("sync");
    } catch {
      setServerState("offline");
    }
  }

  async function submitCustomerReview(orderId: string, rating: number, text: string) {
    try {
      updateOrderInList(await reviewCustomer(orderId, rating, text));
      setServerState("sync");
    } catch {
      setServerState("offline");
    }
  }

  async function cancelOrder(orderId: string, reason: string) {
    try {
      updateOrderInList(await cancelOrderOnServer(orderId, reason));
      if (activeEnrouteId === orderId) {
        setActiveEnrouteId("");
      }
      setServerState("sync");
    } catch {
      setServerState("offline");
    }
  }

  async function markEnroute(orderId: string) {
    try {
      updateOrderInList(await setOrderEnroute(orderId));
      setActiveEnrouteId(orderId); // трекаем координаты независимо от вкладки
      setServerState("sync");
    } catch {
      setServerState("offline");
    }
  }

  async function submitComplaint(orderId: string, type: string, text: string) {
    try {
      await createComplaint(orderId, type, text);
      setServerState("sync");
    } catch {
      setServerState("offline");
    }
  }

  // Быстрый повторный вызов избранного исполнителя из последнего заказа.
  async function quickCall(executorId: string) {
    const last = orders.find((o) => o.status === "done") ?? orders.find((o) => o.status !== "cancelled");
    if (!last || !currentCity || opBusy.current[`quick_${executorId}`]) {
      return;
    }
    opBusy.current[`quick_${executorId}`] = true;
    try {
      const created = await quickOrderFavorite(executorId, {
        cityId: last.cityId,
        service: last.service,
        from: last.from,
        details: last.details,
        price: last.price,
        coordinates: last.coordinates
      });
      setOrders((cur) => [created, ...cur]);
      setDetailId(created.id);
      setServerState("sync");
    } catch {
      setServerState("offline");
    } finally {
      opBusy.current[`quick_${executorId}`] = false;
    }
  }

  async function saveConfig(fee: number, percent: number) {
    try {
      const cfg = await setConfig({ bidFee: fee, bidPercent: percent });
      setBidFee(cfg.bidFee);
      setBidPercent(cfg.bidPercent);
      setServerState("sync");
    } catch {
      setServerState("offline");
    }
  }

  async function saveProfile(
    next: {
      name: string;
      role: Role;
      cityId: string;
      phone: string;
      telegram: string;
      services: ServiceKey[];
      radiusKm: number;
      available: boolean;
      busy: boolean;
      avatar: string;
    },
    onError?: (message: string) => void
  ) {
    if (!account) {
      return;
    }
    try {
      const updated = await updateProfile(next);
      applyAccount(updated);
      setServerState("sync");
      setViewMode("orders");
    } catch (e) {
      setServerState("offline");
      const message =
        e instanceof ApiError ? e.message : "Не удалось сохранить. Проверьте соединение с интернетом.";
      onError?.(message);
    }
  }

  if (!bootReady) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={[ui.screen, styles.center]}>
          <ActivityIndicator color={colors.ink} />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (!account) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <AuthScreen catalog={catalog} onAuthenticated={onAuthenticated} />
      </SafeAreaProvider>
    );
  }

  const tabs: { id: ViewMode; label: string }[] =
    role === "driver"
      ? [
          { id: "orders", label: "Биржа" },
          { id: "jobs", label: "Заказы" },
          { id: "map", label: "Карта" },
          { id: "account", label: "Профиль" }
        ]
      : [
          { id: "orders", label: "Заказать" },
          { id: "market", label: "Витрина" },
          { id: "account", label: "Профиль" }
        ];
  if (account.isAdmin) {
    tabs.push({ id: "admin", label: "Админ" });
  }

  const emptyText =
    role === "driver"
      ? viewMode === "jobs"
        ? "У вас пока нет принятых заказов."
        : "Открытых заказов по вашим услугам в этом городе нет."
      : "У вас пока нет заявок — создайте первую выше.";

  return (
    <SafeAreaProvider>
      <SafeAreaView style={ui.screen}>
        <StatusBar style="dark" />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.flex}
        >
          <View style={styles.header}>
            <View style={styles.flexShrink}>
              <Text style={styles.kicker} numberOfLines={1}>
                {currentCity?.region} · {currentCity?.name}
              </Text>
              <Text style={styles.title}>Кубер</Text>
            </View>
            <View style={styles.headerActions}>
              <Pressable style={styles.bellBtn} onPress={openNotifications}>
                <MaterialCommunityIcons name="bell-outline" size={22} color={colors.ink} />
                {unread > 0 ? (
                  <View style={styles.bellBadge}>
                    <Text style={styles.bellBadgeText}>{unread > 9 ? "9+" : unread}</Text>
                  </View>
                ) : null}
              </Pressable>
              <Pressable style={styles.accountChip} onPress={() => setViewMode("account")}>
                <MaterialCommunityIcons name="account-circle-outline" size={20} color={colors.ink} />
                <Text style={styles.accountChipText} numberOfLines={1}>
                  {account.name}
                </Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.topControls}>
            {devMode ? (
              <Segmented
                options={[
                  { id: "client", label: "Заказчик" },
                  { id: "driver", label: "Исполнитель" }
                ]}
                value={role}
                onChange={(next) => changeRole(next as Role)}
              />
            ) : null}
            <Segmented
              options={tabs.map((tab) => ({ id: tab.id, label: tab.label }))}
              value={viewMode}
              onChange={(next) => setViewMode(next as ViewMode)}
            />
          </View>

          <Animated.View
            style={[styles.flex, { opacity: tabFade, transform: [{ translateY: tabShift }] }]}
          >
          {viewMode === "map" ? (
            <View style={styles.mapScreen}>
              <MapView
                city={currentCity}
                orders={orders}
                activeOrderId={detailId}
                onSelectOrder={(orderId) => setDetailId(orderId)}
              />
            </View>
          ) : viewMode === "admin" ? (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.content}
            >
              <AdminScreen
                catalog={catalog}
                onCatalogChanged={() => {
                  void fetchCatalog().then((next) => {
                    setCatalog(next);
                    setServiceRegistry(next.services);
                  });
                }}
              />
            </ScrollView>
          ) : viewMode === "market" ? (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
              <MarketScreen cityId={cityId} cityName={currentCity?.name ?? ""} catalog={catalog} />
            </ScrollView>
          ) : viewMode === "account" ? (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
            >
              <ProfilePanel
                account={account}
                catalog={catalog}
                serverState={serverState}
                devMode={devMode}
                bidFee={bidFee}
                bidPercent={bidPercent}
                onToggleDev={setDevMode}
                onSave={saveProfile}
                onSaveConfig={saveConfig}
                onVerify={verify}
                onLogout={() => askConfirm("Выйти из аккаунта?", "Нужно будет войти заново.", handleLogout)}
                savedPlaces={savedPlaces}
                onDeletePlace={(id) => askConfirm("Удалить место?", "", () => removeSavedPlace(id))}
                onBalanceChange={(balance) =>
                  setAccount((current) => (current ? { ...current, balance } : current))
                }
              />
            </ScrollView>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadOrders} />}
            >
              {role === "client" && seasonalHint ? (
                <View style={styles.seasonCard}>
                  <MaterialCommunityIcons name={seasonalHint.icon} size={22} color={colors.ink} />
                  <View style={styles.flex}>
                    <Text style={styles.repeatKicker}>{seasonalHint.title}</Text>
                    <Text style={styles.panelSubtitle}>{seasonalHint.text}</Text>
                  </View>
                </View>
              ) : null}
              {role === "client" && favoriteExecutors.length > 0 ? (
                <View style={ui.card}>
                  <Text style={ui.label}>Ваши исполнители</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.placeRow}>
                    {favoriteExecutors.map((f) => (
                      <View key={f.id} style={styles.favExecChip}>
                        <MaterialCommunityIcons name="account-heart-outline" size={16} color={colors.ink} />
                        <Text style={styles.placeChipText} numberOfLines={1}>{f.name}</Text>
                        <Pressable onPress={() => quickCall(f.id)} hitSlop={6}>
                          <Text style={styles.favCallText}>Позвать снова</Text>
                        </Pressable>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
              {role === "client" && lastRepeatOrder ? (
                <RepeatOrderCard order={lastRepeatOrder} onPress={() => repeatOrder(lastRepeatOrder)} />
              ) : null}
              {role === "client" ? (
                <CreateOrderPanel
                  services={cityServices}
                  categories={catalog.categories ?? []}
                  selectedService={selectedService}
                  onSelectService={setSelectedService}
                  savedPlaces={savedPlaces}
                  onPickPlace={pickSavedPlace}
                  onSavePlace={() => {
                    if (!pickCoords) {
                      setGeoError("Сначала укажите точку (карта или «Я здесь»).");
                      return;
                    }
                    setSavePlaceLabel("");
                    setSavePlaceOpen(true);
                  }}
                  service={selectedServiceData}
                  cityName={currentCity?.name ?? ""}
                  cityId={cityId}
                  from={from}
                  details={details}
                  price={price}
                  onChangeFrom={(value) => {
                    setFrom(value);
                    if (pickCoords) {
                      setPickCoords(null);
                      setPickLabel("");
                    }
                  }}
                  onSelectSuggestion={selectSuggestion}
                  onChangeDetails={setDetails}
                  onChangePrice={setPrice}
                  onSubmit={createOrder}
                  hasLocation={Boolean(pickCoords)}
                  locationLabel={pickLabel}
                  onPickLocation={openPicker}
                  onClearLocation={resetLocation}
                  onUseMyLocation={useMyLocation}
                  locating={locating}
                  geoError={geoError}
                />
              ) : viewMode === "jobs" ? (
                <InfoCard
                  icon="clipboard-check-outline"
                  title="Мои заказы"
                  subtitle="Заказы, которые вы взяли. Свяжитесь с заказчиком по контактам внутри."
                />
              ) : (
                <InfoCard
                  icon="storefront-outline"
                  title="Биржа заказов"
                  subtitle={`Открытые заказы по вашим услугам в городе ${currentCity?.name ?? ""}. Откройте и отправьте отклик.`}
                />
              )}

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>
                  {role === "client" ? "Мои заявки" : viewMode === "jobs" ? "В работе" : "Доступные"}
                </Text>
                <Text style={styles.sectionMeta}>{displayOrders.length}</Text>
              </View>

              {displayOrders.length === 0 ? (
                <Text style={styles.empty}>{emptyText}</Text>
              ) : (
                <FlatList
                  data={displayOrders}
                  keyExtractor={(item) => item.id}
                  scrollEnabled={false}
                  ItemSeparatorComponent={() => <View style={styles.separator} />}
                  renderItem={({ item }) => (
                    <OrderCard
                      order={item}
                      role={role}
                      accountId={account.id ?? ""}
                      distance={distanceText(item)}
                      onPress={() => setDetailId(item.id)}
                    />
                  )}
                />
              )}
            </ScrollView>
          )}
          </Animated.View>

          <Modal
            visible={Boolean(detailOrder)}
            animationType="slide"
            transparent
            onRequestClose={() => setDetailId("")}
          >
            <View style={styles.modalBackdrop}>
              <View style={styles.modalSheet}>
                <View style={styles.modalHandleRow}>
                  <View style={styles.modalHandle} />
                </View>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>{role === "client" ? "Моя заявка" : "Заказ"}</Text>
                  <Pressable style={styles.modalClose} onPress={() => setDetailId("")}>
                    <MaterialCommunityIcons name="close" size={20} color={colors.ink} />
                  </Pressable>
                </View>
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.modalContent}
                  keyboardShouldPersistTaps="handled"
                >
                  {detailOrder ? (
                    <OrderDetails
                      order={detailOrder}
                      role={role}
                      accountId={account.id ?? ""}
                      distance={distanceText(detailOrder)}
                      bidFee={orderBidCost(detailOrder)}
                      bidError={bidError}
                      favorites={favorites}
                      onToggleFavorite={toggleFavorite}
                      onAcceptBid={(bidId) => chooseBid(detailOrder.id, bidId)}
                      onRejectBid={(bidId) => rejectBid(detailOrder.id, bidId)}
                      onSendBid={(p, eta) => sendBid(detailOrder.id, p, eta)}
                      onDelete={() =>
                        askConfirm(
                          detailOrder.status === "open" ? "Удалить заявку?" : "Удалить из истории?",
                          detailOrder.status === "open"
                            ? "Откликнувшиеся исполнители получат возврат монет."
                            : "Заказ исчезнет из вашей истории.",
                          () => removeOrder(detailOrder.id)
                        )
                      }
                      onFinish={() => executorFinish(detailOrder.id)}
                      onConfirm={() => clientConfirm(detailOrder.id)}
                      onReview={(rating, text) => submitReview(detailOrder.id, rating, text)}
                      onRepeat={() => repeatOrder(detailOrder)}
                      onOpenExecutor={openExecutor}
                      onCancel={(reason) => cancelOrder(detailOrder.id, reason)}
                      onEnroute={() => markEnroute(detailOrder.id)}
                      onComplaint={(type, text) => submitComplaint(detailOrder.id, type, text)}
                      onReviewCustomer={(rating, text) => submitCustomerReview(detailOrder.id, rating, text)}
                    />
                  ) : null}
                </ScrollView>
              </View>
            </View>
          </Modal>

          <ExecutorProfileModal
            visible={execLoading || Boolean(execProfile)}
            loading={execLoading}
            profile={execProfile}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            onClose={() => {
              setExecProfile(null);
              setExecLoading(false);
            }}
          />

          <OnboardingModal
            visible={
              role === "client" &&
              !onboardingDone &&
              (!account.name || account.name.startsWith("+")) &&
              savedPlaces.length === 0
            }
            account={account}
            onComplete={() => {
              setOnboardingDone(true);
              void fetchMe().then(applyAccount).catch(() => {});
              void fetchPlaces().then(setSavedPlaces).catch(() => {});
            }}
          />

          <Modal
            visible={Boolean(confirmState)}
            transparent
            animationType="fade"
            onRequestClose={() => setConfirmState(null)}
          >
            <View style={styles.centerModalBackdrop}>
              <View style={styles.centerModalCard}>
                <Text style={styles.panelTitle}>{confirmState?.title}</Text>
                {confirmState?.message ? (
                  <Text style={styles.panelSubtitle}>{confirmState.message}</Text>
                ) : null}
                <View style={styles.rowGap}>
                  <Pressable style={[ui.ghostButton, styles.flex]} onPress={() => setConfirmState(null)}>
                    <Text style={ui.ghostButtonText}>Отмена</Text>
                  </Pressable>
                  <Pressable
                    style={[ui.primaryButton, styles.flex]}
                    onPress={() => {
                      confirmState?.onYes();
                      setConfirmState(null);
                    }}
                  >
                    <Text style={ui.primaryButtonText}>Подтвердить</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>

          <Modal
            visible={savePlaceOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setSavePlaceOpen(false)}
          >
            <View style={styles.centerModalBackdrop}>
              <View style={styles.centerModalCard}>
                <Text style={styles.panelTitle}>Сохранить место</Text>
                <Text style={styles.panelSubtitle} numberOfLines={2}>
                  {from || "Текущая точка"}
                </Text>
                <TextInput
                  value={savePlaceLabel}
                  onChangeText={setSavePlaceLabel}
                  placeholder="Название: Дом, Дача, Работа…"
                  placeholderTextColor={colors.inkFaint}
                  autoFocus
                  maxLength={60}
                  style={ui.input}
                />
                <View style={styles.rowGap}>
                  <Pressable style={[ui.ghostButton, styles.flex]} onPress={() => setSavePlaceOpen(false)}>
                    <Text style={ui.ghostButtonText}>Отмена</Text>
                  </Pressable>
                  <Pressable
                    style={[ui.primaryButton, styles.flex, !savePlaceLabel.trim() && { opacity: 0.5 }]}
                    onPress={confirmSavePlace}
                    disabled={!savePlaceLabel.trim()}
                  >
                    <MaterialCommunityIcons name="content-save-outline" size={18} color={colors.accentText} />
                    <Text style={ui.primaryButtonText}>Сохранить</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>

          <Modal
            visible={pickerOpen}
            animationType="slide"
            transparent
            onRequestClose={() => setPickerOpen(false)}
          >
            <View style={styles.modalBackdrop}>
              <View style={styles.pickerSheet}>
                <View style={styles.modalHandleRow}>
                  <View style={styles.modalHandle} />
                </View>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Точка на карте</Text>
                  <Pressable style={styles.modalClose} onPress={() => setPickerOpen(false)}>
                    <MaterialCommunityIcons name="close" size={20} color={colors.ink} />
                  </Pressable>
                </View>
                <Text style={styles.pickerHint}>
                  {geoError || "Нажмите на карту, чтобы поставить точку заявки."}
                </Text>
                <View style={styles.pickerMap}>
                  {pickerCity ? (
                    <MapView
                      city={pickerCity}
                      orders={[]}
                      pickable
                      pickPoint={tempPick ?? undefined}
                      onPick={(coords) => setTempPick(coords)}
                    />
                  ) : null}
                </View>
                <View style={styles.pickerFooter}>
                  <Text style={styles.pickerCoords} numberOfLines={1}>
                    {tempPick ? `📍 ${tempPick[1].toFixed(5)}, ${tempPick[0].toFixed(5)}` : "Точка не выбрана"}
                  </Text>
                  <Pressable
                    style={[ui.primaryButton, styles.pickerConfirm, !tempPick && styles.disabledBtn]}
                    onPress={confirmPick}
                    disabled={!tempPick}
                  >
                    <Text style={ui.primaryButtonText}>Готово</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>

          <Modal
            visible={notifOpen}
            animationType="slide"
            transparent
            onRequestClose={() => setNotifOpen(false)}
          >
            <View style={styles.modalBackdrop}>
              <View style={styles.modalSheet}>
                <View style={styles.modalHandleRow}>
                  <View style={styles.modalHandle} />
                </View>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Уведомления</Text>
                  <Pressable style={styles.modalClose} onPress={() => setNotifOpen(false)}>
                    <MaterialCommunityIcons name="close" size={20} color={colors.ink} />
                  </Pressable>
                </View>
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.modalContent}
                >
                  {notifications.length === 0 ? (
                    <Text style={styles.empty}>Пока нет уведомлений</Text>
                  ) : (
                    notifications.map((n) => (
                      <Pressable
                        key={n.id}
                        style={styles.notifRow}
                        onPress={() => {
                          setNotifOpen(false);
                          if (!n.orderId) {
                            return;
                          }
                          // Отменённый заказ скрыт из лент, а по отклонённому отклику
                          // у исполнителя нет доступа к заказу — открывать нечего.
                          if (n.type === "cancelled" || (role === "driver" && n.type === "rejected")) {
                            return;
                          }
                          // Переходим на вкладку, где живёт этот заказ, и открываем его.
                          // Исполнителю: принятые/рабочие — в «Заказах»; открытый запрос
                          // техники (quick) живёт на бирже (вкладка «Биржа»/orders).
                          if (role === "driver" && n.type !== "bid" && n.type !== "quick") {
                            setViewMode("jobs");
                          } else {
                            setViewMode("orders");
                          }
                          setDetailId(n.orderId);
                        }}
                      >
                        <MaterialCommunityIcons
                          name={notifIcon(n.type)}
                          size={20}
                          color={colors.inkSoft}
                        />
                        <Text style={styles.notifText}>{n.text}</Text>
                      </Pressable>
                    ))
                  )}
                </ScrollView>
              </View>
            </View>
          </Modal>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

// Карточка быстрого повтора последнего заказа (удержание заказчика).
function RepeatOrderCard({ order, onPress }: { order: Order; onPress: () => void }) {
  const service = serviceByKey(order.service);
  return (
    <Pressable style={styles.repeatCard} onPress={onPress}>
      <View style={[styles.repeatIcon, { backgroundColor: tint(service.accent) }]}>
        <MaterialCommunityIcons name="repeat-variant" size={20} color={service.accent} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.repeatKicker}>Заказать снова</Text>
        <Text style={styles.repeatSubtitle} numberOfLines={1}>
          {service.title} · {order.from}
        </Text>
      </View>
      <Text style={styles.repeatPrice}>{rub.format(order.price)} ₽</Text>
    </Pressable>
  );
}

function CreateOrderPanel({
  services,
  categories,
  selectedService,
  onSelectService,
  service,
  cityName,
  cityId,
  from,
  details,
  price,
  savedPlaces,
  onPickPlace,
  onSavePlace,
  onChangeFrom,
  onSelectSuggestion,
  onChangeDetails,
  onChangePrice,
  onSubmit,
  hasLocation,
  locationLabel,
  onPickLocation,
  onClearLocation,
  onUseMyLocation,
  locating,
  geoError
}: {
  services: Service[];
  categories: Category[];
  selectedService: ServiceKey;
  onSelectService: (key: ServiceKey) => void;
  service: Service;
  cityName: string;
  cityId: string;
  from: string;
  details: string;
  price: string;
  savedPlaces: SavedPlace[];
  onPickPlace: (place: SavedPlace) => void;
  onSavePlace: () => void;
  onChangeFrom: (value: string) => void;
  onSelectSuggestion: (item: GeocodeResult) => void;
  onChangeDetails: (value: string) => void;
  onChangePrice: (value: string) => void;
  onSubmit: (repeatDays: number) => void | Promise<boolean>;
  hasLocation: boolean;
  locationLabel: string;
  onPickLocation: () => void;
  onClearLocation: () => void;
  onUseMyLocation: () => void;
  locating: boolean;
  geoError: string;
}) {
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [repeatDays, setRepeatDays] = useState(0);
  const [repeatOn, setRepeatOn] = useState(false);
  const [priceHint, setPriceHint] = useState<{ count: number; min?: number; max?: number } | null>(null);
  const skipNextRef = useRef(false);

  // Подсказка цены по (город × услуга) — обновляется при смене услуги/города.
  useEffect(() => {
    let cancelled = false;
    void fetchPriceHint(cityId, selectedService).then((hint) => {
      if (!cancelled) {
        setPriceHint(hint.count >= 3 ? hint : null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [cityId, selectedService]);

  // Группируем услуги по категориям. Показываем вкладки категорий, только если
  // их больше одной — иначе просто ленту услуг.
  const catList = useMemo(() => {
    const present = new Set(services.map((s) => s.category || "other"));
    const known = categories.filter((c) => present.has(c.key));
    const extras = [...present].filter((k) => !categories.some((c) => c.key === k));
    return [...known, ...extras.map((k) => ({ key: k, title: "Прочее" }))];
  }, [services, categories]);

  const [activeCat, setActiveCat] = useState<string>(
    () => service.category || catList[0]?.key || "other"
  );
  // Если выбранная услуга сменила категорию (напр. через «повторить заказ») —
  // подтягиваем активную вкладку под неё.
  useEffect(() => {
    if (service.category && service.category !== activeCat) {
      setActiveCat(service.category);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service.category]);

  const showTabs = catList.length > 1;
  // Если активная категория отсутствует в этом городе — берём первую доступную.
  const effectiveCat = catList.some((c) => c.key === activeCat) ? activeCat : catList[0]?.key ?? "other";
  const effectiveCatTitle = catList.find((c) => c.key === effectiveCat)?.title ?? "Категория";
  const visibleServices = showTabs
    ? services.filter((s) => (s.category || "other") === effectiveCat)
    : services;

  const repeatOptions = [
    { days: 0, label: "Разово" },
    { days: 7, label: "Каждую неделю" },
    { days: 14, label: "Раз в 2 недели" },
    { days: 30, label: "Раз в месяц" }
  ];

  useEffect(() => {
    if (skipNextRef.current) {
      skipNextRef.current = false;
      return;
    }
    const query = from.trim();
    if (query.length < 3 || hasLocation) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const results = await suggestAddress(query, cityId);
      if (!cancelled) {
        setSuggestions(results);
        setSuggestOpen(true);
      }
    }, 550);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [from, cityId, hasLocation]);

  function pickSuggestion(item: GeocodeResult) {
    skipNextRef.current = true;
    onSelectSuggestion(item);
    setSuggestions([]);
    setSuggestOpen(false);
  }

  return (
    <View style={ui.card}>
      <View>
        <Text style={styles.panelTitle}>Новая заявка</Text>
        <Text style={styles.panelSubtitle}>
          {service.title} · {cityName}
        </Text>
      </View>

      {showTabs ? (
        <View>
          <Text style={ui.label}>Категория</Text>
          <Pressable style={styles.megaSelect} onPress={() => setCatOpen((v) => !v)}>
            <Text style={styles.megaSelectText}>{effectiveCatTitle}</Text>
            <MaterialCommunityIcons
              name={catOpen ? "chevron-up" : "chevron-down"}
              size={22}
              color={colors.inkSoft}
            />
          </Pressable>
          {catOpen ? (
            <View style={styles.megaMenu}>
              {catList.map((cat, index) => {
                const active = cat.key === effectiveCat;
                return (
                  <Pressable
                    key={cat.key}
                    onPress={() => {
                      setActiveCat(cat.key);
                      setCatOpen(false);
                    }}
                    style={[styles.megaOption, index > 0 && styles.megaOptionDivider]}
                  >
                    <Text style={[styles.megaOptionText, active && styles.megaOptionTextActive]}>
                      {cat.title}
                    </Text>
                    {active ? (
                      <MaterialCommunityIcons name="check" size={18} color={colors.ink} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.svcList}>
        {visibleServices.map((item) => {
          const active = item.key === selectedService;
          return (
            <Pressable
              key={item.key}
              onPress={() => onSelectService(item.key)}
              style={[styles.svcRow, active && { borderColor: item.accent, backgroundColor: tint(item.accent) }]}
            >
              <View
                style={[
                  styles.svcIcon,
                  { backgroundColor: active ? item.accent : tint(item.accent) }
                ]}
              >
                <MaterialCommunityIcons
                  name={item.icon}
                  size={22}
                  color={active ? colors.accentText : item.accent}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.svcTitle}>{item.title}</Text>
                {item.subtitle ? (
                  <Text style={styles.svcSub} numberOfLines={1}>
                    {item.subtitle}
                  </Text>
                ) : null}
              </View>
              <MaterialCommunityIcons
                name={active ? "check-circle" : "chevron-right"}
                size={22}
                color={active ? item.accent : colors.inkFaint}
              />
            </Pressable>
          );
        })}
      </View>

      <View style={ui.inputGroup}>
        <Text style={ui.label}>Адрес</Text>
        {savedPlaces.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.placeRow}>
            {savedPlaces.map((place) => (
              <Pressable key={place.id} style={styles.placeChip} onPress={() => onPickPlace(place)}>
                <MaterialCommunityIcons name="map-marker-outline" size={15} color={colors.ink} />
                <Text style={styles.placeChipText} numberOfLines={1}>
                  {place.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <TextInput
          value={from}
          onChangeText={onChangeFrom}
          onFocus={() => setSuggestOpen(true)}
          placeholder={`${cityName}, улица, дом`}
          placeholderTextColor={colors.inkFaint}
          style={ui.input}
        />
        {suggestOpen && suggestions.length > 0 ? (
          <View style={styles.suggestBox}>
            {suggestions.slice(0, 8).map((item, index) => (
              <Pressable
                key={`${item.lat},${item.lng}`}
                style={[styles.suggestRow, index > 0 && styles.suggestDivider]}
                onPress={() => pickSuggestion(item)}
              >
                <MaterialCommunityIcons name="map-marker-outline" size={16} color={colors.inkSoft} />
                <Text style={styles.suggestText} numberOfLines={2}>
                  {item.displayName}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={styles.locationRow}>
          <Pressable style={[styles.locationBtn, styles.flex]} onPress={onPickLocation}>
            <MaterialCommunityIcons
              name={hasLocation ? "map-marker-check" : "map-marker-plus-outline"}
              size={18}
              color={hasLocation ? colors.positive : colors.ink}
            />
            <Text style={styles.locationBtnText} numberOfLines={1}>
              {hasLocation ? locationLabel || "Точка указана" : "На карте"}
            </Text>
          </Pressable>
          <Pressable style={styles.locationBtn} onPress={onUseMyLocation} disabled={locating}>
            <MaterialCommunityIcons name="crosshairs-gps" size={18} color={colors.ink} />
            <Text style={styles.locationBtnText}>{locating ? "…" : "Я здесь"}</Text>
          </Pressable>
        </View>
        {hasLocation ? (
          <View style={styles.rowBetween}>
            <Pressable onPress={onClearLocation}>
              <Text style={styles.locationNote}>Сбросить точку</Text>
            </Pressable>
            <Pressable onPress={onSavePlace} style={styles.savePlaceLink}>
              <MaterialCommunityIcons name="content-save-outline" size={14} color={colors.ink} />
              <Text style={styles.savePlaceText}>Сохранить место</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={styles.locationNote}>Не укажете — определим по адресу автоматически.</Text>
        )}
        {geoError ? <Text style={ui.errorText}>{geoError}</Text> : null}
      </View>

      <View style={ui.inputGroup}>
        <Text style={ui.label}>Задача</Text>
        <TextInput
          value={details}
          onChangeText={onChangeDetails}
          placeholder="Что нужно сделать"
          placeholderTextColor={colors.inkFaint}
          multiline
          style={[ui.input, ui.textArea]}
        />
      </View>
      <View style={ui.inputGroup}>
        <Text style={ui.label}>Ваша цена, ₽</Text>
        <TextInput
          value={price}
          onChangeText={onChangePrice}
          placeholder="например, 4200"
          placeholderTextColor={colors.inkFaint}
          keyboardType="number-pad"
          style={ui.input}
        />
        {priceHint && priceHint.min && priceHint.max ? (
          <Text style={styles.locationNote}>
            Обычно платят {rub.format(priceHint.min)}–{rub.format(priceHint.max)} ₽
          </Text>
        ) : null}
      </View>

      <View style={ui.inputGroup}>
        <View style={styles.rowBetween}>
          <Text style={ui.label}>Повторять регулярно</Text>
          <Switch
            value={repeatOn}
            onValueChange={(v) => {
              setRepeatOn(v);
              setRepeatDays(v ? repeatDays || 7 : 0);
            }}
            trackColor={{ true: colors.ink, false: colors.line }}
            thumbColor={colors.surface}
          />
        </View>
        {repeatOn ? (
          <>
            <View style={styles.pillWrap}>
              {repeatOptions
                .filter((opt) => opt.days > 0)
                .map((opt) => (
                  <Pressable
                    key={opt.days}
                    onPress={() => setRepeatDays(opt.days)}
                    style={[ui.pill, repeatDays === opt.days && ui.pillActive]}
                  >
                    <Text style={[ui.pillText, repeatDays === opt.days && ui.pillTextActive]}>{opt.label}</Text>
                  </Pressable>
                ))}
            </View>
            <Text style={styles.locationNote}>Заявка будет повторяться автоматически. Управлять — в профиле.</Text>
          </>
        ) : null}
      </View>

      <Pressable
        style={ui.primaryButton}
        onPress={async () => {
          const ok = await onSubmit(repeatDays);
          // Сбрасываем повтор только при успешной публикации — иначе следующий
          // одноразовый заказ втихую заведёт вторую подписку.
          if (ok) {
            setRepeatDays(0);
            setRepeatOn(false);
          }
        }}
      >
        <MaterialCommunityIcons name="arrow-up-circle" size={20} color={colors.accentText} />
        <Text style={ui.primaryButtonText}>
          {repeatDays > 0 ? "Опубликовать и подписаться" : "Опубликовать"}
        </Text>
      </Pressable>
    </View>
  );
}

function InfoCard({
  icon,
  title,
  subtitle
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  subtitle: string;
}) {
  return (
    <View style={[ui.card, styles.driverIntro]}>
      <View style={styles.driverIcon}>
        <MaterialCommunityIcons name={icon} size={22} color={colors.ink} />
      </View>
      <View style={styles.flexShrink}>
        <Text style={styles.panelTitle}>{title}</Text>
        <Text style={styles.panelSubtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

function Segmented({
  options,
  value,
  onChange
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const PAD = 4;
  const [width, setWidth] = useState(0);
  const count = options.length;
  const segW = count > 0 && width > 0 ? (width - PAD * 2) / count : 0;
  const index = Math.max(0, options.findIndex((o) => o.id === value));
  const tx = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (segW > 0) {
      Animated.spring(tx, {
        toValue: PAD + index * segW,
        useNativeDriver: Platform.OS !== "web",
        speed: 18,
        bounciness: 8
      }).start();
    }
  }, [index, segW, tx]);

  return (
    <View
      style={styles.segmented}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {segW > 0 ? (
        <Animated.View style={[styles.segPill, { width: segW, transform: [{ translateX: tx }] }]} />
      ) : null}
      {options.map((option) => {
        const active = option.id === value;
        return (
          <Pressable key={option.id} onPress={() => onChange(option.id)} style={styles.segmentButton}>
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function OrderCard({
  order,
  role,
  accountId,
  distance,
  onPress
}: {
  order: Order;
  role: Role;
  accountId: string;
  distance: string;
  onPress: () => void;
}) {
  const service = serviceByKey(order.service);
  const bids = order.bids.length;
  const needsChoice = role === "client" && order.status === "open" && bids > 0;
  const youResponded =
    role === "driver" && order.status === "open" && order.bids.some((b) => b.driverId === accountId);
  const working = order.status !== "open" && order.executor ? order.executor.name : null;

  return (
    <Pressable style={styles.orderCard} onPress={onPress}>
      <View style={[styles.dot, { backgroundColor: service.accent }]} />
      <View style={styles.flex}>
        <View style={styles.rowBetween}>
          <Text style={styles.orderTitle}>{service.title}</Text>
          <Text style={styles.orderPrice}>{rub.format(order.price)} ₽</Text>
        </View>
        <Text style={styles.orderAddress} numberOfLines={1}>
          {order.from}
        </Text>

        {/* Заказчик сразу видит, кто работает над заказом */}
        {role === "client" && working ? (
          <View style={styles.workingRow}>
            <MaterialCommunityIcons name="account-wrench-outline" size={14} color={colors.positive} />
            <Text style={styles.workingText} numberOfLines={1}>
              Исполнитель: {working}
            </Text>
          </View>
        ) : null}

        <View style={styles.orderFooter}>
          <Text style={styles.orderMeta}>{distance}</Text>
          {youResponded ? (
            <View style={[styles.badge, styles.badgeMatched]}>
              <Text style={[styles.badgeText, styles.badgeTextMatched]}>вы откликнулись</Text>
            </View>
          ) : needsChoice ? (
            <View style={styles.alertBadge}>
              <MaterialCommunityIcons name="bell-ring-outline" size={13} color={colors.accentText} />
              <Text style={styles.alertText}>
                {bids} {plural(bids, "отклик", "отклика", "откликов")} — выбрать
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.orderMeta}>
                · {bids} {plural(bids, "отклик", "отклика", "откликов")}
              </Text>
              <View style={[styles.badge, order.status !== "open" && styles.badgeMatched]}>
                <Text style={[styles.badgeText, order.status !== "open" && styles.badgeTextMatched]}>
                  {statusLabel(order.status)}
                </Text>
              </View>
            </>
          )}
        </View>
      </View>
    </Pressable>
  );
}

// Публичный профиль исполнителя для заказчика: рейтинг, портфолио, отзывы.
function ExecutorProfileModal({
  visible,
  loading,
  profile,
  favorites,
  onToggleFavorite,
  onClose
}: {
  visible: boolean;
  loading: boolean;
  profile: ExecutorProfile | null;
  favorites: string[];
  onToggleFavorite: (executorId: string) => void;
  onClose: () => void;
}) {
  const rating = profile?.rating ?? 0;
  const isFav = Boolean(profile?.id && favorites.includes(profile.id));
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandleRow}>
            <View style={styles.modalHandle} />
          </View>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Исполнитель</Text>
            <Pressable style={styles.modalClose} onPress={onClose}>
              <MaterialCommunityIcons name="close" size={20} color={colors.ink} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalContent}>
            {loading || !profile ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.ink} />
              </View>
            ) : (
              <View style={{ gap: 14 }}>
                <View style={styles.rowCenter}>
                  {profile.avatar ? (
                    <Image source={{ uri: profile.avatar }} style={styles.avatarImg} resizeMode="cover" />
                  ) : (
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{profile.name.slice(0, 1).toUpperCase()}</Text>
                    </View>
                  )}
                  <View style={styles.flex}>
                    <View style={styles.bidNameRow}>
                      <Text style={styles.panelTitle}>{profile.name}</Text>
                      {profile.verified ? (
                        <MaterialCommunityIcons name="check-decagram" size={16} color={colors.verified} />
                      ) : null}
                    </View>
                    <View style={styles.ratingPill}>
                      <MaterialCommunityIcons name="star" size={15} color={colors.star} />
                      <Text style={styles.ratingText}>
                        {rating > 0
                          ? `${rating.toFixed(1)} · ${profile.ratingCount} ${plural(profile.ratingCount ?? 0, "отзыв", "отзыва", "отзывов")}`
                          : "пока нет отзывов"}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.offerStatusText,
                        { color: profile.available === false ? colors.inkFaint : colors.positive, marginTop: 4 }
                      ]}
                    >
                      {profile.available === false ? "● Не на линии" : "● На линии"}
                    </Text>
                  </View>
                  {profile.id ? (
                    <Pressable hitSlop={8} onPress={() => onToggleFavorite(profile.id as string)}>
                      <MaterialCommunityIcons
                        name={isFav ? "heart" : "heart-outline"}
                        size={22}
                        color={isFav ? colors.favorite : colors.inkFaint}
                      />
                    </Pressable>
                  ) : null}
                </View>

                <View style={styles.statsRow}>
                  <Stat icon="briefcase-check-outline" value={String(profile.jobsCompleted ?? 0)} label="выполнено" />
                  <Stat
                    icon="star-outline"
                    value={rating > 0 ? rating.toFixed(1) : "—"}
                    label="рейтинг"
                  />
                </View>

                {profile.services && profile.services.length > 0 ? (
                  <View style={ui.inputGroup}>
                    <Text style={ui.label}>Услуги</Text>
                    <View style={styles.pillWrap}>
                      {profile.services.map((key) => {
                        const svc = serviceByKey(key);
                        return (
                          <View
                            key={key}
                            style={[styles.specChip, { borderColor: svc.accent, backgroundColor: tint(svc.accent) }]}
                          >
                            <MaterialCommunityIcons name={svc.icon} size={14} color={svc.accent} />
                            <Text style={styles.specChipText}>{svc.title}</Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                ) : null}

                {profile.verificationBadges && profile.verificationBadges.length > 0 ? (
                  <View style={ui.inputGroup}>
                    <Text style={ui.label}>Подтверждённые квалификации</Text>
                    <View style={styles.pillWrap}>
                      {profile.verificationBadges.map((badge) => {
                        const svc = serviceByKey(badge.serviceKey);
                        return (
                          <View key={`${badge.serviceKey}-${badge.docType}`} style={styles.verifiedBadge}>
                            <MaterialCommunityIcons name="check-decagram" size={14} color={colors.positive} />
                            <Text style={styles.verifiedBadgeText}>
                              {svc.title} · {badge.docType}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                ) : null}

                {profile.bio ? (
                  <View style={ui.inputGroup}>
                    <Text style={ui.label}>О себе</Text>
                    <Text style={styles.details}>{profile.bio}</Text>
                  </View>
                ) : null}

                {profile.equipment && profile.equipment.length > 0 ? (
                  <View style={ui.inputGroup}>
                    <Text style={ui.label}>Техника</Text>
                    {profile.equipment.map((eq) => {
                      const svc = serviceByKey(eq.serviceKey);
                      const spec = summarizeSpecs(eq.serviceKey, eq.specs);
                      return (
                        <View key={eq.id} style={styles.portfolioItem}>
                          <MaterialCommunityIcons name={svc.icon} size={18} color={svc.accent} style={styles.equipIcon} />
                          <View style={styles.flex}>
                            <Text style={styles.portfolioTitle}>{eq.title || svc.title}</Text>
                            <Text style={styles.panelSubtitle}>
                              {svc.title}
                              {spec ? ` · ${spec}` : ""}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ) : null}

                {profile.portfolio && profile.portfolio.length > 0 ? (
                  <View style={ui.inputGroup}>
                    <Text style={ui.label}>Примеры работ</Text>
                    {profile.portfolio.map((item) => (
                      <View key={item.id} style={styles.portfolioItem}>
                        <View style={styles.flex}>
                          <Text style={styles.portfolioTitle}>{item.title}</Text>
                          {item.description ? (
                            <Text style={styles.panelSubtitle}>{item.description}</Text>
                          ) : null}
                          {item.photoUrl ? (
                            item.photoUrl.startsWith("data:") ? (
                              <Image source={{ uri: item.photoUrl }} style={styles.portfolioPhoto} resizeMode="cover" />
                            ) : (
                              <Text style={styles.portfolioLink} numberOfLines={1}>
                                {item.photoUrl}
                              </Text>
                            )
                          ) : null}
                        </View>
                      </View>
                    ))}
                  </View>
                ) : null}

                {profile.reviews && profile.reviews.length > 0 ? (
                  <View style={ui.inputGroup}>
                    <Text style={ui.label}>Отзывы</Text>
                    {profile.reviews.map((rev) => (
                      <View key={rev.id} style={styles.portfolioItem}>
                        <View style={styles.flex}>
                          <View style={styles.rowBetween}>
                            <Text style={styles.portfolioTitle}>{rev.author}</Text>
                            <Text style={styles.ratingText}>★ {rev.rating}</Text>
                          </View>
                          {rev.text ? <Text style={styles.panelSubtitle}>{rev.text}</Text> : null}
                        </View>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function OrderDetails({
  order,
  role,
  accountId,
  distance,
  bidFee,
  bidError,
  favorites,
  onToggleFavorite,
  onAcceptBid,
  onRejectBid,
  onSendBid,
  onDelete,
  onFinish,
  onConfirm,
  onReview,
  onRepeat,
  onOpenExecutor,
  onCancel,
  onEnroute,
  onComplaint,
  onReviewCustomer
}: {
  order: Order;
  role: Role;
  accountId: string;
  distance: string;
  bidFee: number;
  bidError: string;
  favorites: string[];
  onToggleFavorite: (executorId: string) => void;
  onAcceptBid: (bidId: string) => void;
  onRejectBid: (bidId: string) => void;
  onSendBid: (price: number, eta: string) => void | Promise<boolean>;
  onDelete: () => void;
  onFinish: () => void;
  onConfirm: () => void;
  onReview: (rating: number, text: string) => void;
  onRepeat: () => void;
  onOpenExecutor: (executorId: string) => void;
  onCancel: (reason: string) => void;
  onEnroute: () => void;
  onComplaint: (type: string, text: string) => void;
  onReviewCustomer: (rating: number, text: string) => void;
}) {
  const service = serviceByKey(order.service);
  // По умолчанию подставляем цену заказчика — исполнитель может изменить.
  const [bidPrice, setBidPrice] = useState(String(order.price));
  const [bidEta, setBidEta] = useState("40 мин");
  const [stars, setStars] = useState(5);
  const [reviewText, setReviewText] = useState("");
  const [reach, setReach] = useState<number | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [complaintOpen, setComplaintOpen] = useState(false);
  const [complaintText, setComplaintText] = useState("");
  const [custStars, setCustStars] = useState(5);
  const [custReviewText, setCustReviewText] = useState("");

  // Охват: сколько исполнителей поблизости видят открытый заказ (для заказчика).
  useEffect(() => {
    if (role !== "client" || order.status !== "open") {
      return;
    }
    let cancelled = false;
    void fetchReach(order.id).then((r) => {
      if (!cancelled) setReach(r.reach);
    });
    return () => {
      cancelled = true;
    };
  }, [order.id, order.status, role]);

  const alreadyBid = order.bids.some((bid) => bid.driverId === accountId);
  const canBid = role === "driver" && order.status === "open" && !alreadyBid;

  // Ранжируем отклики «кто лучше»: подтверждённая профессия → рейтинг →
  // число выполненных → цена. Лучший помечается бейджем.
  const rankedBids = useMemo(() => {
    return [...order.bids].sort((a, b) => {
      const av = a.verifiedService ? 1 : 0;
      const bv = b.verifiedService ? 1 : 0;
      if (bv !== av) return bv - av;
      if ((b.rating || 0) !== (a.rating || 0)) return (b.rating || 0) - (a.rating || 0);
      if ((b.jobsCompleted || 0) !== (a.jobsCompleted || 0)) return (b.jobsCompleted || 0) - (a.jobsCompleted || 0);
      return (a.price || 0) - (b.price || 0);
    });
  }, [order.bids]);
  const bestBidId = order.bids.length >= 2 ? rankedBids[0]?.id ?? null : null;

  async function submitBid() {
    const numeric = Number(bidPrice.replace(/\D/g, ""));
    if (!numeric) {
      return;
    }
    // Чистим поле только при успешной отправке — иначе на ошибке (мало монет и т.п.)
    // исполнитель теряет набранную цену.
    const ok = await onSendBid(numeric, bidEta.trim() || "40 мин");
    if (ok) {
      setBidPrice("");
    }
  }

  return (
    <View style={ui.card}>
      <View style={styles.rowCenter}>
        <View style={[styles.dot, { backgroundColor: service.accent }]} />
        <View style={styles.flex}>
          <Text style={styles.panelTitle}>{service.title}</Text>
          <Text style={styles.panelSubtitle}>{order.from}</Text>
        </View>
        <Text style={styles.orderPrice}>{rub.format(order.price)} ₽</Text>
      </View>

      <Text style={styles.details}>{order.details}</Text>

      <View style={styles.statsRow}>
        <Stat icon="map-marker-distance" value={distance} label="дистанция" />
        <Stat icon="account-hard-hat" value={String(order.bids.length)} label="откликов" />
        <Stat icon="circle-slice-8" value={statusLabel(order.status)} label="статус" />
      </View>

      {/* Контакты второй стороны после подтверждения */}
      {order.status !== "open" && role === "client" && order.executor ? (
        <Pressable onPress={() => onOpenExecutor(order.executor?.id ?? "")}>
          <ContactCard title="Исполнитель" person={order.executor} />
          <Text style={styles.locationNote}>Нажмите, чтобы открыть профиль и портфолио</Text>
        </Pressable>
      ) : null}
      {order.status !== "open" && role === "driver" && order.customer ? (
        <View>
          <ContactCard title="Заказчик" person={order.customer} />
          {order.customerRatingCount ? (
            <Text style={styles.locationNote}>
              Рейтинг заказчика: ★ {(order.customerRating ?? 0).toFixed(1)} ({order.customerRatingCount})
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Чат доступен участникам после выбора исполнителя */}
      {order.status !== "open" && (order.executor || order.customer) ? (
        <ChatSection orderId={order.id} accountId={accountId} />
      ) : null}

      {/* Исполнитель: форма отклика */}
      {canBid ? (
        <View style={styles.divBlock}>
          <Text style={ui.label}>Ваш отклик</Text>
          <View style={styles.bidRow}>
            <TextInput
              value={bidPrice}
              onChangeText={setBidPrice}
              placeholder="цена, ₽"
              placeholderTextColor={colors.inkFaint}
              keyboardType="number-pad"
              style={[ui.input, styles.flex]}
            />
            <TextInput
              value={bidEta}
              onChangeText={setBidEta}
              placeholder="срок"
              placeholderTextColor={colors.inkFaint}
              style={[ui.input, styles.etaInput]}
            />
          </View>
          {bidFee > 0 ? (
            <View style={styles.bidFeeRow}>
              <CoinIcon size={15} />
              <Text style={styles.locationNote}>
                Платный отклик: спишется {bidFee} мон. (≈ {coinsToRub(bidFee)} ₽) с баланса.
              </Text>
            </View>
          ) : null}
          {bidError ? <Text style={ui.errorText}>{bidError}</Text> : null}
          <Pressable style={ui.primaryButton} onPress={submitBid}>
            <MaterialCommunityIcons name="send-outline" size={18} color={colors.accentText} />
            <Text style={ui.primaryButtonText}>Отправить отклик</Text>
          </Pressable>
        </View>
      ) : null}

      {role === "driver" && order.status === "open" && alreadyBid ? (
        <View style={styles.doneBanner}>
          <MaterialCommunityIcons name="check-circle-outline" size={18} color={colors.positive} />
          <Text style={styles.doneText}>Вы уже откликнулись на этот заказ.</Text>
        </View>
      ) : null}

      {/* Заказчик: живой статус ожидания откликов */}
      {role === "client" && order.status === "open" ? (
        <View style={styles.reachBanner}>
          <MaterialCommunityIcons name="account-search-outline" size={18} color={colors.inkSoft} />
          <Text style={styles.reachText}>
            {reach === null
              ? "Ищем исполнителей поблизости…"
              : reach === 0
              ? "Ищем подходящих исполнителей в вашем городе"
              : `Ваш заказ видят ${reach} ${plural(reach, "исполнитель", "исполнителя", "исполнителей")} поблизости`}
            {order.bids.length > 0 ? ` · уже ${order.bids.length} ${plural(order.bids.length, "отклик", "отклика", "откликов")}` : ""}
          </Text>
        </View>
      ) : null}

      {/* Заказчик: отклики и выбор */}
      {role === "client" && order.status === "open" ? (
        <View style={styles.bidsList}>
          <Text style={ui.label}>Отклики исполнителей</Text>
          {order.bids.length === 0 ? (
            <Text style={styles.empty}>Пока нет откликов</Text>
          ) : (
            rankedBids.map((bid) => {
              const isBest = bid.id === bestBidId;
              const jobs = bid.jobsCompleted ?? 0;
              return (
                <View key={bid.id} style={[styles.bidCard, isBest && styles.bidCardBest]}>
                  <Pressable hitSlop={6} onPress={() => onToggleFavorite(bid.driverId ?? "")}>
                    <MaterialCommunityIcons
                      name={bid.driverId && favorites.includes(bid.driverId) ? "heart" : "heart-outline"}
                      size={20}
                      color={bid.driverId && favorites.includes(bid.driverId) ? colors.favorite : colors.inkFaint}
                    />
                  </Pressable>
                  <Pressable style={styles.flex} onPress={() => onOpenExecutor(bid.driverId ?? "")}>
                    <View style={styles.bidNameRow}>
                      {isBest ? (
                        <View style={styles.bestBadge}>
                          <MaterialCommunityIcons name="trophy-variant" size={11} color={colors.accentText} />
                          <Text style={styles.bestBadgeText}>лучший</Text>
                        </View>
                      ) : null}
                      <Text style={[styles.bidDriver, styles.bidDriverLink]}>{bid.driver}</Text>
                      {bid.verifiedService ? (
                        <MaterialCommunityIcons name="check-decagram" size={15} color={colors.positive} />
                      ) : null}
                      <MaterialCommunityIcons name="chevron-right" size={16} color={colors.inkFaint} />
                    </View>
                    <View style={styles.bidStatsRow}>
                      <View style={styles.bidStat}>
                        <MaterialCommunityIcons name="star" size={13} color={colors.star} />
                        <Text style={styles.bidStatText}>
                          {bid.rating ? bid.rating.toFixed(1) : "—"}
                          {bid.ratingCount ? ` (${bid.ratingCount})` : ""}
                        </Text>
                      </View>
                      <View style={styles.bidStat}>
                        <MaterialCommunityIcons name="briefcase-check-outline" size={13} color={colors.inkSoft} />
                        <Text style={styles.bidStatText}>{jobs}</Text>
                      </View>
                      {bid.verifiedService ? (
                        <Text style={styles.bidVerifText}>профессия ✓</Text>
                      ) : null}
                    </View>
                    <Text style={styles.bidMeta}>{bid.eta} · открыть профиль</Text>
                  </Pressable>
                  <View style={styles.bidSide}>
                    <Text style={styles.bidPrice}>{rub.format(bid.price)} ₽</Text>
                    <View style={styles.bidActions}>
                      <Pressable style={styles.rejectButton} onPress={() => onRejectBid(bid.id)}>
                        <Text style={styles.rejectButtonText}>Отклонить</Text>
                      </Pressable>
                      <Pressable style={styles.acceptButton} onPress={() => onAcceptBid(bid.id)}>
                        <Text style={styles.acceptButtonText}>Выбрать</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </View>
      ) : null}

      {/* Заказчик: действия по статусу */}
      {role === "client" && order.status === "open" ? (
        <Pressable style={ui.ghostButton} onPress={onDelete}>
          <MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.warning} />
          <Text style={[ui.ghostButtonText, { color: colors.warning }]}>Удалить заявку</Text>
        </Pressable>
      ) : null}

      {role === "driver" && order.status === "matched" ? (
        <Pressable style={ui.ghostButton} onPress={onEnroute}>
          <MaterialCommunityIcons name="car-arrow-right" size={18} color={colors.ink} />
          <Text style={ui.ghostButtonText}>Выехал к заказчику</Text>
        </Pressable>
      ) : null}

      {role === "driver" && (order.status === "matched" || order.status === "enroute") ? (
        <Pressable style={ui.primaryButton} onPress={onFinish}>
          <MaterialCommunityIcons name="flag-checkered" size={18} color={colors.accentText} />
          <Text style={ui.primaryButtonText}>Отметить выполненным</Text>
        </Pressable>
      ) : null}

      {role === "driver" && order.status === "finished" ? (
        <View style={styles.doneBanner}>
          <MaterialCommunityIcons name="progress-check" size={18} color={colors.positive} />
          <Text style={styles.doneText}>Ждём подтверждения заказчика.</Text>
        </View>
      ) : null}

      {role === "client" && order.status === "matched" ? (
        <View style={styles.doneBanner}>
          <MaterialCommunityIcons name="progress-clock" size={18} color={colors.inkSoft} />
          <Text style={styles.doneText}>Исполнитель принял заказ. Скоро выедет к вам.</Text>
        </View>
      ) : null}

      {role === "client" && order.status === "enroute" ? (
        <View style={[styles.doneBanner, styles.enrouteBanner]}>
          <MaterialCommunityIcons name="car-arrow-right" size={18} color={colors.positive} />
          <Text style={styles.doneText}>
            Исполнитель в пути
            {order.execPos
              ? ` · ≈ ${formatKm(haversineKm([order.execPos.lng, order.execPos.lat], order.coordinates))} до вас`
              : ""}
          </Text>
        </View>
      ) : null}

      {/* Живая карта: где сейчас исполнитель и куда едет (заказчику, пока в пути) */}
      {role === "client" && order.status === "enroute" ? (
        <View style={styles.enrouteMap}>
          <MapView
            city={{
              id: order.cityId,
              regionId: "",
              name: "",
              region: "",
              center: order.execPos ? [order.execPos.lng, order.execPos.lat] : order.coordinates,
              zoom: 14,
              services: []
            }}
            orders={[order]}
          />
          {!order.execPos ? (
            <Text style={styles.enrouteMapHint}>Ждём координаты исполнителя…</Text>
          ) : null}
        </View>
      ) : null}

      {role === "client" && order.status === "finished" ? (
        <Pressable style={ui.primaryButton} onPress={onConfirm}>
          <MaterialCommunityIcons name="check-circle-outline" size={18} color={colors.accentText} />
          <Text style={ui.primaryButtonText}>Подтвердить выполнение</Text>
        </Pressable>
      ) : null}

      {role === "client" && order.status === "done" && !order.reviewed ? (
        <View style={styles.divBlock}>
          <Text style={ui.label}>Оцените исполнителя</Text>
          <StarPicker value={stars} onChange={setStars} />
          <TextInput
            value={reviewText}
            onChangeText={setReviewText}
            placeholder="Комментарий (необязательно)"
            placeholderTextColor={colors.inkFaint}
            multiline
            style={[ui.input, ui.textArea]}
          />
          <Pressable style={ui.primaryButton} onPress={() => onReview(stars, reviewText)}>
            <MaterialCommunityIcons name="star-outline" size={18} color={colors.accentText} />
            <Text style={ui.primaryButtonText}>Оставить отзыв</Text>
          </Pressable>
        </View>
      ) : null}

      {role === "client" && order.status === "done" && order.reviewed ? (
        <View style={styles.doneBanner}>
          <MaterialCommunityIcons name="check-decagram" size={18} color={colors.positive} />
          <Text style={styles.doneText}>Заказ завершён, спасибо за отзыв!</Text>
        </View>
      ) : null}

      {role === "driver" && order.status === "done" ? (
        <View style={styles.doneBanner}>
          <MaterialCommunityIcons name="check-decagram" size={18} color={colors.positive} />
          <Text style={styles.doneText}>Заказ завершён.</Text>
        </View>
      ) : null}

      {role === "client" ? (
        <Pressable style={ui.ghostButton} onPress={onRepeat}>
          <MaterialCommunityIcons name="repeat-variant" size={18} color={colors.ink} />
          <Text style={ui.ghostButtonText}>Повторить заказ</Text>
        </Pressable>
      ) : null}

      {role === "client" && order.status === "done" ? (
        <Pressable onPress={onDelete}>
          <Text style={styles.removeLink}>Удалить из истории</Text>
        </Pressable>
      ) : null}

      {order.status === "cancelled" ? (
        <View style={styles.doneBanner}>
          <MaterialCommunityIcons name="close-circle-outline" size={18} color={colors.warning} />
          <Text style={styles.doneText}>Заказ отменён{order.cancelReason ? `: ${order.cancelReason}` : ""}.</Text>
        </View>
      ) : null}

      {role === "driver" && order.status === "done" && !order.reviewedCustomer ? (
        <View style={styles.divBlock}>
          <Text style={ui.label}>Оцените заказчика</Text>
          <StarPicker value={custStars} onChange={setCustStars} />
          <TextInput
            value={custReviewText}
            onChangeText={setCustReviewText}
            placeholder="Комментарий (необязательно)"
            placeholderTextColor={colors.inkFaint}
            multiline
            style={[ui.input, ui.textArea]}
          />
          <Pressable style={ui.primaryButton} onPress={() => onReviewCustomer(custStars, custReviewText)}>
            <MaterialCommunityIcons name="star-outline" size={18} color={colors.accentText} />
            <Text style={ui.primaryButtonText}>Оценить заказчика</Text>
          </Pressable>
        </View>
      ) : null}

      {role === "client" && ["open", "matched", "enroute"].includes(order.status) ? (
        <Pressable style={ui.ghostButton} onPress={() => { setCancelReason(""); setCancelOpen(true); }}>
          <MaterialCommunityIcons name="close-circle-outline" size={18} color={colors.warning} />
          <Text style={[ui.ghostButtonText, { color: colors.warning }]}>Отменить заказ</Text>
        </Pressable>
      ) : null}

      {role === "driver" && ["matched", "enroute"].includes(order.status) ? (
        <Pressable style={ui.ghostButton} onPress={() => { setCancelReason(""); setCancelOpen(true); }}>
          <MaterialCommunityIcons name="close-circle-outline" size={18} color={colors.warning} />
          <Text style={[ui.ghostButtonText, { color: colors.warning }]}>Отказаться от заказа</Text>
        </Pressable>
      ) : null}

      {["matched", "enroute", "finished", "done"].includes(order.status) ? (
        <Pressable onPress={() => { setComplaintText(""); setComplaintOpen(true); }}>
          <Text style={styles.removeLink}>Пожаловаться</Text>
        </Pressable>
      ) : null}

      <Modal visible={cancelOpen} transparent animationType="fade" onRequestClose={() => setCancelOpen(false)}>
        <View style={styles.centerModalBackdrop}>
          <View style={styles.centerModalCard}>
            <Text style={styles.panelTitle}>Причина отмены</Text>
            <TextInput
              value={cancelReason}
              onChangeText={setCancelReason}
              placeholder="Коротко опишите причину"
              placeholderTextColor={colors.inkFaint}
              multiline
              style={[ui.input, ui.textArea]}
            />
            <View style={styles.rowGap}>
              <Pressable style={[ui.ghostButton, styles.flex]} onPress={() => setCancelOpen(false)}>
                <Text style={ui.ghostButtonText}>Назад</Text>
              </Pressable>
              <Pressable
                style={[ui.primaryButton, styles.flex]}
                onPress={() => {
                  onCancel(cancelReason.trim());
                  setCancelOpen(false);
                }}
              >
                <Text style={ui.primaryButtonText}>Подтвердить</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={complaintOpen} transparent animationType="fade" onRequestClose={() => setComplaintOpen(false)}>
        <View style={styles.centerModalBackdrop}>
          <View style={styles.centerModalCard}>
            <Text style={styles.panelTitle}>Жалоба</Text>
            <TextInput
              value={complaintText}
              onChangeText={setComplaintText}
              placeholder="Опишите проблему — админ рассмотрит"
              placeholderTextColor={colors.inkFaint}
              multiline
              style={[ui.input, ui.textArea]}
            />
            <View style={styles.rowGap}>
              <Pressable style={[ui.ghostButton, styles.flex]} onPress={() => setComplaintOpen(false)}>
                <Text style={ui.ghostButtonText}>Назад</Text>
              </Pressable>
              <Pressable
                style={[ui.primaryButton, styles.flex, !complaintText.trim() && { opacity: 0.5 }]}
                disabled={!complaintText.trim()}
                onPress={() => {
                  onComplaint("other", complaintText.trim());
                  setComplaintOpen(false);
                }}
              >
                <Text style={ui.primaryButtonText}>Отправить</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ContactCard({
  title,
  person
}: {
  title: string;
  person: { name: string; phone: string; telegram: string; verified?: boolean };
}) {
  const hasContact = person.phone || person.telegram;
  return (
    <View style={styles.contactCard}>
      <Text style={ui.label}>{title}</Text>
      <View style={styles.rowCenter}>
        <Text style={styles.contactName}>{person.name}</Text>
        {person.verified ? (
          <MaterialCommunityIcons name="check-decagram" size={16} color={colors.verified} />
        ) : null}
      </View>
      {person.phone ? (
        <View style={styles.contactRow}>
          <MaterialCommunityIcons name="phone-outline" size={15} color={colors.inkSoft} />
          <Text style={styles.contactLine}>{person.phone}</Text>
        </View>
      ) : null}
      {person.telegram ? (
        <View style={styles.contactRow}>
          <MaterialCommunityIcons name="send-circle-outline" size={15} color={colors.inkSoft} />
          <Text style={styles.contactLine}>{person.telegram}</Text>
        </View>
      ) : null}
      {!hasContact ? <Text style={styles.contactLine}>контакты не указаны</Text> : null}
    </View>
  );
}

function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <View style={styles.starRow}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} onPress={() => onChange(n)} hitSlop={6}>
          <MaterialCommunityIcons
            name={n <= value ? "star" : "star-outline"}
            size={30}
            color={n <= value ? colors.star : colors.inkFaint}
          />
        </Pressable>
      ))}
    </View>
  );
}

// Кнопка выбора фото из галереи → base64 data-URL (для портфолио и верификации).
function PhotoPicker({
  value,
  onChange,
  label
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  label: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function pick() {
    setBusy(true);
    setErr("");
    const result = await pickImageAsBase64();
    setBusy(false);
    if (result.ok) {
      onChange(result.dataUrl);
    } else if (result.error) {
      setErr(result.error);
    }
  }

  return (
    <View style={ui.inputGroup}>
      <Text style={ui.label}>{label}</Text>
      {value ? (
        <View style={{ gap: 8 }}>
          <Image source={{ uri: value }} style={styles.photoPreview} resizeMode="cover" />
          <Pressable onPress={() => onChange(null)}>
            <Text style={styles.locationNote}>Убрать фото</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={ui.ghostButton} onPress={pick} disabled={busy}>
          <MaterialCommunityIcons name="camera-plus-outline" size={18} color={colors.ink} />
          <Text style={ui.ghostButtonText}>{busy ? "Загрузка…" : "Прикрепить фото"}</Text>
        </Pressable>
      )}
      {err ? <Text style={ui.errorText}>{err}</Text> : null}
    </View>
  );
}

// Редактор портфолио исполнителя: описание (био) + примеры работ.
function PortfolioEditor({ account }: { account: Account }) {
  const [bio, setBio] = useState(account.bio ?? "");
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Подгружаем текущее портфолио с сервера.
  useEffect(() => {
    let cancelled = false;
    if (!account.id) {
      return;
    }
    (async () => {
      try {
        const profile = await fetchExecutorProfile(account.id as string);
        if (!cancelled) {
          setBio(profile.bio ?? "");
          setItems(profile.portfolio ?? []);
        }
      } catch {
        // офлайн — оставляем пусто
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account.id]);

  async function saveBio() {
    setError("");
    setBusy(true);
    try {
      const profile = await updatePortfolio({ bio });
      setItems(profile.portfolio ?? []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось сохранить. Проверьте связь.");
    } finally {
      setBusy(false);
    }
  }

  async function addItem() {
    if (!title.trim()) {
      return;
    }
    setError("");
    setBusy(true);
    try {
      const profile = await updatePortfolio({
        addItem: { title: title.trim(), description: desc.trim(), photoUrl: photo ?? "" }
      });
      setItems(profile.portfolio ?? []);
      setTitle("");
      setDesc("");
      setPhoto(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось добавить работу.");
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(id: string) {
    setBusy(true);
    try {
      const profile = await updatePortfolio({ deleteItemId: id });
      setItems(profile.portfolio ?? []);
    } catch {
      // молча — можно повторить
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={ui.card}>
      <Text style={styles.panelTitle}>Портфолио</Text>
      <Text style={styles.panelSubtitle}>Заказчики видят его при выборе исполнителя.</Text>

      <View style={ui.inputGroup}>
        <Text style={ui.label}>О себе</Text>
        <TextInput
          value={bio}
          onChangeText={setBio}
          placeholder="Опыт, техника, район работы…"
          placeholderTextColor={colors.inkFaint}
          multiline
          maxLength={600}
          style={[ui.input, ui.textArea]}
        />
        <Pressable style={ui.ghostButton} onPress={saveBio} disabled={busy}>
          <MaterialCommunityIcons name="content-save-outline" size={18} color={colors.ink} />
          <Text style={ui.ghostButtonText}>Сохранить описание</Text>
        </Pressable>
      </View>

      <View style={ui.inputGroup}>
        <Text style={ui.label}>Примеры работ ({items.length})</Text>
        {items.length === 0 ? (
          <Text style={styles.locationNote}>Пока нет работ. Добавьте первую ниже.</Text>
        ) : (
          items.map((item) => (
            <View key={item.id} style={styles.portfolioItem}>
              <View style={styles.flex}>
                <Text style={styles.portfolioTitle}>{item.title}</Text>
                {item.description ? (
                  <Text style={styles.panelSubtitle}>{item.description}</Text>
                ) : null}
                {item.photoUrl ? (
                  item.photoUrl.startsWith("data:") ? (
                    <Image source={{ uri: item.photoUrl }} style={styles.portfolioPhoto} resizeMode="cover" />
                  ) : (
                    <Text style={styles.portfolioLink} numberOfLines={1}>
                      {item.photoUrl}
                    </Text>
                  )
                ) : null}
              </View>
              <Pressable hitSlop={8} onPress={() => removeItem(item.id)}>
                <MaterialCommunityIcons name="close-circle-outline" size={22} color={colors.warning} />
              </Pressable>
            </View>
          ))
        )}
      </View>

      <View style={ui.inputGroup}>
        <Text style={ui.label}>Добавить работу</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Название (напр. «Монтаж насоса»)"
          placeholderTextColor={colors.inkFaint}
          maxLength={120}
          style={ui.input}
        />
        <TextInput
          value={desc}
          onChangeText={setDesc}
          placeholder="Короткое описание"
          placeholderTextColor={colors.inkFaint}
          multiline
          maxLength={600}
          style={[ui.input, ui.textArea]}
        />
        <PhotoPicker label="Фото работы (необязательно)" value={photo} onChange={setPhoto} />
        {error ? <Text style={ui.errorText}>{error}</Text> : null}
        <Pressable style={ui.primaryButton} onPress={addItem} disabled={busy}>
          <MaterialCommunityIcons name="plus" size={18} color={colors.accentText} />
          <Text style={ui.primaryButtonText}>Добавить работу</Text>
        </Pressable>
      </View>
    </View>
  );
}

// Витрина «Техника в наличии»: заказчик листает предложения исполнителей по городу.
function MarketScreen({ cityId, cityName, catalog }: { cityId: string; cityName: string; catalog: Catalog }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ServiceKey | null>(null);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  // Профиль исполнителя (модалка), запрос техники, жалоба.
  const [profile, setProfile] = useState<ExecutorProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [reqOffer, setReqOffer] = useState<Offer | null>(null);
  const [reqFrom, setReqFrom] = useState("");
  const [reqDetails, setReqDetails] = useState("");
  const [reqPrice, setReqPrice] = useState("");
  const [reqBusy, setReqBusy] = useState(false);
  const [reqErr, setReqErr] = useState("");
  const [reqDone, setReqDone] = useState(false);
  const [cmpOffer, setCmpOffer] = useState<Offer | null>(null);
  const [cmpText, setCmpText] = useState("");
  const [cmpBusy, setCmpBusy] = useState(false);
  const [cmpDone, setCmpDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!cityId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchOffers(cityId, null)
      .then((list) => {
        if (!cancelled) setOffers(list);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cityId]);

  const presentKeys = Array.from(new Set(offers.map((o) => o.serviceKey)));
  const filterServices = catalog.services.filter((s) => presentKeys.includes(s.key));
  const hasVerified = offers.some((o) => o.stsVerified);
  const shown = offers.filter(
    (o) => (!filter || o.serviceKey === filter) && (!verifiedOnly || o.stsVerified)
  );

  // Контакт по тапу: раскрываем номер через сервер (логируется + пуш исполнителю).
  async function contact(o: Offer, channel: "phone" | "telegram") {
    try {
      const c = await contactOffer(o.id, channel);
      if (channel === "phone" && c.phone) {
        void Linking.openURL(`tel:+${c.phone.replace(/\D/g, "")}`).catch(() => {});
      } else if (channel === "telegram" && c.telegram) {
        void Linking.openURL(`https://t.me/${c.telegram.replace(/^@/, "").trim()}`).catch(() => {});
      }
    } catch {
      // тихо
    }
  }

  async function openProfile(id: string) {
    setProfileOpen(true);
    setProfileLoading(true);
    setProfile(null);
    try {
      setProfile(await fetchExecutorProfile(id));
    } catch {
      // не удалось загрузить — закрываем, чтобы не висел вечный спиннер
      setProfileOpen(false);
    } finally {
      setProfileLoading(false);
    }
  }

  function openRequest(o: Offer) {
    setReqOffer(o);
    setReqFrom("");
    setReqDetails("");
    setReqPrice(o.price ? String(o.price) : "");
    setReqErr("");
    setReqDone(false);
  }

  async function submitRequest() {
    if (!reqOffer) {
      return;
    }
    if (!reqFrom.trim() || !reqDetails.trim()) {
      setReqErr("Укажите адрес и что нужно");
      return;
    }
    setReqBusy(true);
    setReqErr("");
    try {
      await requestOffer(reqOffer.id, {
        cityId,
        from: reqFrom.trim(),
        details: reqDetails.trim(),
        price: Number(reqPrice) || undefined
      });
      setReqDone(true);
    } catch (e) {
      setReqErr(e instanceof ApiError ? e.message : "Не удалось отправить запрос");
    } finally {
      setReqBusy(false);
    }
  }

  async function submitComplaint() {
    if (!cmpOffer || !cmpText.trim()) {
      return;
    }
    setCmpBusy(true);
    try {
      await complainOffer(cmpOffer.id, cmpText.trim());
      setCmpDone(true);
    } catch {
      // тихо
    } finally {
      setCmpBusy(false);
    }
  }

  return (
    <>
      <View style={ui.card}>
        <Text style={styles.panelTitle}>Витрина исполнителей</Text>
        <Text style={styles.panelSubtitle}>
          Предложения исполнителей{cityName ? ` в городе ${cityName}` : ""}. Запросите технику или свяжитесь напрямую.
        </Text>

        {filterServices.length > 0 ? (
          <View style={styles.pillWrap}>
            <Pressable onPress={() => setFilter(null)} style={[ui.pill, !filter && ui.pillActive]}>
              <Text style={[ui.pillText, !filter && ui.pillTextActive]}>Все</Text>
            </Pressable>
            {filterServices.map((s) => {
              const on = filter === s.key;
              return (
                <Pressable key={s.key} onPress={() => setFilter(s.key)} style={[ui.pill, on && ui.pillActive]}>
                  <Text style={[ui.pillText, on && ui.pillTextActive]}>{s.title}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {hasVerified ? (
          <Pressable
            onPress={() => setVerifiedOnly((v) => !v)}
            style={[ui.pill, verifiedOnly && ui.pillActive, styles.verifiedFilter]}
          >
            <MaterialCommunityIcons
              name="shield-check"
              size={15}
              color={verifiedOnly ? colors.accentText : colors.verified}
            />
            <Text style={[ui.pillText, verifiedOnly && ui.pillTextActive]}>Только проверенные по СТС</Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <Text style={styles.locationNote}>Загрузка…</Text>
      ) : shown.length === 0 ? (
        <View style={ui.card}>
          <Text style={styles.panelSubtitle}>
            {filter || verifiedOnly
              ? "Нет техники по выбранному фильтру. Сбросьте фильтр, чтобы увидеть все предложения."
              : `Пока нет опубликованной техники${cityName ? ` в городе ${cityName}` : ""}. Исполнители появятся здесь, когда разместят предложения.`}
          </Text>
          {filter || verifiedOnly ? (
            <Pressable
              style={ui.ghostButton}
              onPress={() => {
                setFilter(null);
                setVerifiedOnly(false);
              }}
            >
              <Text style={ui.ghostButtonText}>Сбросить фильтр</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        shown.map((o) => {
          const svc = serviceByKey(o.serviceKey);
          const spec = summarizeSpecs(o.serviceKey, o.specs);
          return (
            <View key={o.id} style={ui.card}>
              {o.photo ? <Image source={{ uri: o.photo }} style={styles.offerPhoto} resizeMode="cover" /> : null}
              <Pressable style={styles.offerHead} onPress={() => openProfile(o.executor.id)}>
                <MaterialCommunityIcons name={svc.icon} size={22} color={svc.accent} />
                <View style={styles.flex}>
                  <Text style={styles.portfolioTitle}>
                    {o.title || svc.title}
                    {o.price ? (
                      <Text style={styles.offerPrice}>{`  от ${o.price.toLocaleString("ru-RU")} ₽`}</Text>
                    ) : (
                      <Text style={styles.offerPriceSoft}>{"  цена договорная"}</Text>
                    )}
                  </Text>
                  <Text style={styles.panelSubtitle}>
                    {svc.title}
                    {spec ? ` · ${spec}` : ""}
                  </Text>
                  {o.stsVerified ? (
                    <View style={styles.offerVerifyBadge}>
                      <MaterialCommunityIcons name="shield-check" size={14} color={colors.verified} />
                      <Text style={styles.offerVerifyText}>Техника проверена по СТС</Text>
                    </View>
                  ) : null}
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.inkFaint} />
              </Pressable>

              <Pressable style={styles.offerExecRow} onPress={() => openProfile(o.executor.id)}>
                <MaterialCommunityIcons name="account-circle-outline" size={18} color={colors.inkSoft} />
                <Text style={styles.offerExecName} numberOfLines={1}>
                  {o.executor.name}
                </Text>
                {o.executor.verified ? (
                  <MaterialCommunityIcons name="check-decagram" size={15} color={colors.verified} />
                ) : null}
                {o.executor.ratingCount > 0 ? (
                  <Text style={styles.offerRating}>★ {o.executor.rating.toFixed(1)}</Text>
                ) : null}
              </Pressable>

              <View style={styles.offerStatusRow}>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: !o.executor.available ? colors.inkFaint : o.executor.busy ? colors.star : colors.positive }
                  ]}
                />
                <Text style={styles.offerStatusText}>
                  {!o.executor.available ? "Не на линии" : o.executor.busy ? "Занят на заказе" : "Свободен сейчас"}
                </Text>
              </View>

              {o.note ? <Text style={styles.offerNote}>{o.note}</Text> : null}

              <Pressable style={[ui.primaryButton, styles.offerRequestBtn]} onPress={() => openRequest(o)}>
                <MaterialCommunityIcons name="clipboard-check-outline" size={18} color={colors.accentText} />
                <Text style={ui.primaryButtonText}>Запросить технику</Text>
              </Pressable>

              <View style={styles.offerContactRow}>
                {o.executor.hasPhone ? (
                  <Pressable style={[ui.ghostButton, styles.flex]} onPress={() => contact(o, "phone")}>
                    <MaterialCommunityIcons name="phone" size={16} color={colors.ink} />
                    <Text style={ui.ghostButtonText}>Позвонить</Text>
                  </Pressable>
                ) : null}
                {o.executor.hasTelegram ? (
                  <Pressable style={[ui.ghostButton, styles.flex]} onPress={() => contact(o, "telegram")}>
                    <MaterialCommunityIcons name="send" size={16} color={colors.ink} />
                    <Text style={ui.ghostButtonText}>Telegram</Text>
                  </Pressable>
                ) : null}
              </View>

              <Pressable hitSlop={6} onPress={() => { setCmpOffer(o); setCmpText(""); setCmpDone(false); }}>
                <Text style={styles.offerComplain}>Пожаловаться на объявление</Text>
              </Pressable>
            </View>
          );
        })
      )}

      <ExecutorProfileModal
        visible={profileOpen}
        loading={profileLoading}
        profile={profile}
        favorites={[]}
        onToggleFavorite={() => {}}
        onClose={() => setProfileOpen(false)}
      />

      {/* Запрос техники → заказ этому исполнителю */}
      <Modal visible={Boolean(reqOffer)} transparent animationType="slide" onRequestClose={() => setReqOffer(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Запросить технику</Text>
              <Pressable style={styles.modalClose} onPress={() => setReqOffer(null)}>
                <MaterialCommunityIcons name="close" size={20} color={colors.ink} />
              </Pressable>
            </View>
            {reqDone ? (
              <View style={styles.modalContent}>
                <Text style={styles.panelSubtitle}>Запрос отправлен — исполнитель уведомлён. Заявка появится в разделе «Заявки».</Text>
                <Pressable style={ui.primaryButton} onPress={() => setReqOffer(null)}>
                  <Text style={ui.primaryButtonText}>Готово</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.modalContent}>
                <Text style={styles.panelSubtitle}>
                  {reqOffer?.title || "Техника"} · {reqOffer ? serviceByKey(reqOffer.serviceKey).title : ""}
                </Text>
                <View style={ui.inputGroup}>
                  <Text style={ui.label}>Адрес</Text>
                  <TextInput value={reqFrom} onChangeText={setReqFrom} placeholder="Куда подать технику" placeholderTextColor={colors.inkFaint} style={ui.input} />
                </View>
                <View style={ui.inputGroup}>
                  <Text style={ui.label}>Что нужно</Text>
                  <TextInput value={reqDetails} onChangeText={setReqDetails} placeholder="Опишите задачу" placeholderTextColor={colors.inkFaint} multiline style={[ui.input, ui.textArea]} />
                </View>
                <View style={ui.inputGroup}>
                  <Text style={ui.label}>Ваша цена, ₽</Text>
                  <TextInput value={reqPrice} onChangeText={(t) => setReqPrice(t.replace(/[^0-9]/g, ""))} placeholder="напр. 3000" placeholderTextColor={colors.inkFaint} keyboardType="number-pad" style={ui.input} />
                </View>
                {reqErr ? <Text style={ui.errorText}>{reqErr}</Text> : null}
                <Pressable style={ui.primaryButton} onPress={submitRequest} disabled={reqBusy}>
                  <Text style={ui.primaryButtonText}>{reqBusy ? "Отправка…" : "Отправить запрос"}</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Жалоба на объявление */}
      <Modal visible={Boolean(cmpOffer)} transparent animationType="fade" onRequestClose={() => setCmpOffer(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Пожаловаться</Text>
              <Pressable style={styles.modalClose} onPress={() => setCmpOffer(null)}>
                <MaterialCommunityIcons name="close" size={20} color={colors.ink} />
              </Pressable>
            </View>
            <View style={styles.modalContent}>
              {cmpDone ? (
                <>
                  <Text style={styles.panelSubtitle}>Спасибо, жалоба отправлена на модерацию.</Text>
                  <Pressable style={ui.primaryButton} onPress={() => setCmpOffer(null)}>
                    <Text style={ui.primaryButtonText}>Готово</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <TextInput value={cmpText} onChangeText={setCmpText} placeholder="Что не так с объявлением?" placeholderTextColor={colors.inkFaint} multiline style={[ui.input, ui.textArea]} />
                  <Pressable style={ui.primaryButton} onPress={submitComplaint} disabled={cmpBusy || !cmpText.trim()}>
                    <Text style={ui.primaryButtonText}>{cmpBusy ? "Отправка…" : "Отправить жалобу"}</Text>
                  </Pressable>
                </>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

// Техника исполнителя: ТТХ спецтехники по каждой его категории.
function EquipmentEditor({ account, catalog }: { account: Account; catalog: Catalog }) {
  const [items, setItems] = useState<Equipment[]>([]);
  const [serviceKey, setServiceKey] = useState<ServiceKey | null>(null);
  const [title, setTitle] = useState("");
  const [specs, setSpecs] = useState<Record<string, string | number | boolean>>({});
  const [published, setPublished] = useState(false);
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Категории исполнителя, у которых есть схема ТТХ.
  const myServices = catalog.services.filter(
    (s) => (account.services ?? []).includes(s.key) && hasEquipmentSchema(s.key)
  );

  useEffect(() => {
    let cancelled = false;
    listEquipment()
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Стартовая категория — первая доступная.
  useEffect(() => {
    if (!serviceKey && myServices.length > 0) {
      setServiceKey(myServices[0].key);
    }
  }, [myServices, serviceKey]);

  const schema = serviceKey ? equipmentSchema(serviceKey) : null;

  function resetForm() {
    setEditingId(null);
    setTitle("");
    setSpecs({});
    setPublished(false);
    setPrice("");
    setNote("");
    setPhoto(null);
  }

  function startEdit(item: Equipment) {
    setEditingId(item.id);
    setServiceKey(item.serviceKey);
    setTitle(item.title);
    setSpecs({ ...item.specs });
    setPublished(item.published);
    setPrice(item.price ? String(item.price) : "");
    setNote(item.note ?? "");
    setPhoto(item.photo || null);
    setError("");
  }

  // СТС-верификация: выбрать фото свидетельства → отправить на проверку.
  async function uploadSts(item: Equipment) {
    const result = await pickImageAsBase64();
    if (!result.ok) {
      if (result.error) setError(result.error);
      return;
    }
    setBusy(true);
    try {
      setItems(await verifyEquipmentSts(item.id, result.dataUrl));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось отправить СТС.");
    } finally {
      setBusy(false);
    }
  }

  function setField(key: string, value: string | number | boolean) {
    setSpecs((prev) => ({ ...prev, [key]: value }));
  }

  async function submit() {
    if (!serviceKey) {
      return;
    }
    setError("");
    setBusy(true);
    const fields = {
      title: title.trim(),
      specs,
      published,
      price: Number(price) || 0,
      note: note.trim(),
      photo: photo ?? ""
    };
    try {
      const list = editingId
        ? await updateEquipment(editingId, fields)
        : await addEquipment({ serviceKey, ...fields });
      setItems(list);
      resetForm();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось сохранить.");
    } finally {
      setBusy(false);
    }
  }

  // Быстрая публикация/снятие единицы с витрины.
  async function togglePublish(item: Equipment) {
    setError("");
    setBusy(true);
    try {
      setItems(await updateEquipment(item.id, { published: !item.published }));
    } catch (e) {
      // Напр. сервер требует заполнить обязательные ТТХ для публикации — покажем причину.
      setError(e instanceof ApiError ? e.message : "Не удалось изменить публикацию.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      setItems(await deleteEquipment(id));
      if (editingId === id) {
        resetForm();
      }
    } catch {
      // молча — можно повторить
    } finally {
      setBusy(false);
    }
  }

  if (myServices.length === 0) {
    return (
      <View style={ui.card}>
        <Text style={styles.panelTitle}>Моя техника</Text>
        <Text style={styles.panelSubtitle}>
          Отметьте в услугах выше категории со спецтехникой — тогда сможете указать её ТТХ.
        </Text>
      </View>
    );
  }

  return (
    <View style={ui.card}>
      <Text style={styles.panelTitle}>Моя техника</Text>
      <Text style={styles.panelSubtitle}>ТТХ по каждой категории. Заказчик видит их при выборе исполнителя.</Text>

      {myServices.map((s) => {
        const units = items.filter((it) => it.serviceKey === s.key);
        return (
          <View key={s.key} style={ui.inputGroup}>
            <Text style={ui.label}>
              {s.title} ({units.length})
            </Text>
            {units.length === 0 ? (
              <Text style={styles.locationNote}>Пока нет техники в этой категории.</Text>
            ) : (
              units.map((it) => (
                <View key={it.id} style={styles.portfolioItem}>
                  {it.photo ? (
                    <Image source={{ uri: it.photo }} style={styles.equipThumb} resizeMode="cover" />
                  ) : null}
                  <View style={styles.flex}>
                    <Text style={styles.portfolioTitle}>{it.title || s.title}</Text>
                    <Text style={styles.panelSubtitle}>
                      {summarizeSpecs(it.serviceKey, it.specs) || "без ТТХ"}
                    </Text>
                    {it.published ? (
                      <Text style={styles.equipPublished}>
                        ● в витрине · {it.price ? `от ${it.price.toLocaleString("ru-RU")} ₽` : "цена договорная"}
                      </Text>
                    ) : null}
                    {it.verifyStatus === "verified" ? (
                      <Text style={styles.equipVerified}>✓ проверено по СТС</Text>
                    ) : it.verifyStatus === "pending" ? (
                      <Text style={styles.equipPending}>СТС на проверке…</Text>
                    ) : (
                      <Pressable hitSlop={6} onPress={() => uploadSts(it)} disabled={busy}>
                        <Text style={styles.equipStsLink}>
                          {it.verifyStatus === "rejected" ? "СТС отклонён — приложить заново" : "Проверить по СТС"}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                  <Pressable hitSlop={8} onPress={() => togglePublish(it)} style={styles.equipAction} disabled={busy}>
                    <MaterialCommunityIcons
                      name={it.published ? "eye-check" : "eye-plus-outline"}
                      size={20}
                      color={it.published ? colors.positive : colors.inkSoft}
                    />
                  </Pressable>
                  <Pressable hitSlop={8} onPress={() => startEdit(it)} style={styles.equipAction}>
                    <MaterialCommunityIcons name="pencil-outline" size={20} color={colors.inkSoft} />
                  </Pressable>
                  <Pressable hitSlop={8} onPress={() => remove(it.id)}>
                    <MaterialCommunityIcons name="close-circle-outline" size={22} color={colors.warning} />
                  </Pressable>
                </View>
              ))
            )}
          </View>
        );
      })}

      <View style={ui.inputGroup}>
        <Text style={ui.label}>{editingId ? "Редактирование единицы" : "Добавить технику"}</Text>

        {!editingId ? (
          <View style={styles.pillWrap}>
            {myServices.map((s) => {
              const on = serviceKey === s.key;
              return (
                <Pressable
                  key={s.key}
                  onPress={() => {
                    setServiceKey(s.key);
                    setSpecs({});
                  }}
                  style={[styles.specChip, on && { borderColor: s.accent, backgroundColor: tint(s.accent) }]}
                >
                  <MaterialCommunityIcons name={on ? "check" : s.icon} size={16} color={on ? s.accent : colors.inkSoft} />
                  <Text style={styles.specChipText}>{s.title}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Название (напр. «КамАЗ 65115» или гос. номер)"
          placeholderTextColor={colors.inkFaint}
          maxLength={80}
          style={ui.input}
        />

        <PhotoPicker label="Фото техники (необязательно)" value={photo} onChange={setPhoto} />

        {schema?.fields.map((f) => (
          <View key={f.key} style={styles.equipField}>
            <Text style={ui.label}>
              {f.label}
              {f.unit ? `, ${f.unit}` : ""}
              {f.required ? <Text style={styles.reqMark}> * для витрины</Text> : null}
            </Text>
            {f.type === "number" ? (
              <TextInput
                value={specs[f.key] === undefined ? "" : String(specs[f.key])}
                onChangeText={(t) => setField(f.key, t.replace(/[^0-9.,]/g, "").replace(",", "."))}
                placeholder="0"
                placeholderTextColor={colors.inkFaint}
                keyboardType="decimal-pad"
                style={ui.input}
              />
            ) : f.type === "text" ? (
              <TextInput
                value={specs[f.key] === undefined ? "" : String(specs[f.key])}
                onChangeText={(t) => setField(f.key, t)}
                placeholder="…"
                placeholderTextColor={colors.inkFaint}
                maxLength={200}
                style={ui.input}
              />
            ) : f.type === "bool" ? (
              <Switch
                value={Boolean(specs[f.key])}
                onValueChange={(v) => setField(f.key, v)}
                trackColor={{ true: colors.ink, false: colors.line }}
                thumbColor={colors.surface}
              />
            ) : (
              <View style={styles.pillWrap}>
                {(f.options ?? []).map((opt) => {
                  const on = specs[f.key] === opt;
                  return (
                    <Pressable key={opt} onPress={() => setField(f.key, opt)} style={[ui.pill, on && ui.pillActive]}>
                      <Text style={[ui.pillText, on && ui.pillTextActive]}>{opt}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        ))}

        <View style={styles.equipPublishRow}>
          <View style={styles.flex}>
            <Text style={ui.label}>Разместить в витрине исполнителей</Text>
            <Text style={styles.panelSubtitle}>Заказчики увидят предложение и свяжутся напрямую.</Text>
          </View>
          <Switch
            value={published}
            onValueChange={setPublished}
            trackColor={{ true: colors.ink, false: colors.line }}
            thumbColor={colors.surface}
          />
        </View>

        {published ? (
          <>
            <View style={styles.equipField}>
              <Text style={ui.label}>Цена от, ₽ (необязательно)</Text>
              <TextInput
                value={price}
                onChangeText={(t) => setPrice(t.replace(/[^0-9]/g, ""))}
                placeholder="напр. 3000"
                placeholderTextColor={colors.inkFaint}
                keyboardType="number-pad"
                style={ui.input}
              />
            </View>
            <View style={styles.equipField}>
              <Text style={ui.label}>Комментарий (район, условия)</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="напр. работаю по городу и пригороду, нал/безнал"
                placeholderTextColor={colors.inkFaint}
                maxLength={300}
                multiline
                style={[ui.input, ui.textArea]}
              />
            </View>
          </>
        ) : null}

        {error ? <Text style={ui.errorText}>{error}</Text> : null}
        <View style={styles.equipButtons}>
          <Pressable style={[ui.primaryButton, styles.flex]} onPress={submit} disabled={busy}>
            <MaterialCommunityIcons
              name={editingId ? "content-save-outline" : "plus"}
              size={18}
              color={colors.accentText}
            />
            <Text style={ui.primaryButtonText}>{busy ? "Сохранение…" : editingId ? "Сохранить" : "Добавить"}</Text>
          </Pressable>
          {editingId ? (
            <Pressable style={ui.ghostButton} onPress={resetForm} disabled={busy}>
              <Text style={ui.ghostButtonText}>Отмена</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const DOC_TYPES = [
  "Удостоверение НАКС",
  "Лицензия",
  "Диплом / свидетельство",
  "Сертификат",
  "Удостоверение",
  "Договор ИП / ООО"
];

const verifStatusLabel = (s: string) =>
  s === "verified" ? "подтверждено ✓" : s === "rejected" ? "отклонено" : "на проверке";

// Верификация квалификации по документу (напр. сварщик → НАКС).
function VerificationCard({ account, catalog }: { account: Account; catalog: Catalog }) {
  const [requests, setRequests] = useState<VerificationRequest[]>([]);
  const [service, setService] = useState<ServiceKey | null>(null);
  const [docType, setDocType] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMyVerifications()
      .then((list) => {
        if (!cancelled) setRequests(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const myServices = catalog.services.filter((s) => (account.services ?? []).includes(s.key));
  const choices = myServices.length > 0 ? myServices : catalog.services;

  async function submit() {
    if (!service || !docType || !photo) {
      setError("Выберите услугу, тип документа и приложите фото");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await createVerificationRequest({ serviceKey: service, docType, photo });
      setRequests(await fetchMyVerifications());
      setService(null);
      setDocType("");
      setPhoto(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось отправить заявку");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={ui.card}>
      <Text style={styles.panelTitle}>Верификация квалификации</Text>
      <Text style={styles.panelSubtitle}>
        Подтвердите документом — заказчики увидят значок по услуге (напр. сварщик · НАКС).
      </Text>

      {requests.length > 0 ? (
        <View style={{ gap: 6 }}>
          {requests.map((r) => {
            const svc = serviceByKey(r.serviceKey);
            return (
              <View key={r.id} style={styles.verifRow}>
                <MaterialCommunityIcons
                  name={r.status === "verified" ? "check-decagram" : r.status === "rejected" ? "close-circle-outline" : "progress-clock"}
                  size={16}
                  color={r.status === "verified" ? colors.positive : r.status === "rejected" ? colors.warning : colors.inkSoft}
                />
                <Text style={styles.verifRowText}>
                  {svc.title} · {r.docType} — {verifStatusLabel(r.status)}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={ui.inputGroup}>
        <Text style={ui.label}>Услуга</Text>
        <View style={styles.pillWrap}>
          {choices.map((s) => {
            const on = service === s.key;
            return (
              <Pressable
                key={s.key}
                onPress={() => setService(s.key)}
                style={[styles.specChip, on && { borderColor: s.accent, backgroundColor: tint(s.accent) }]}
              >
                <MaterialCommunityIcons name={on ? "check" : s.icon} size={16} color={on ? s.accent : colors.inkSoft} />
                <Text style={styles.specChipText}>{s.title}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={ui.inputGroup}>
        <Text style={ui.label}>Тип документа</Text>
        <View style={styles.pillWrap}>
          {DOC_TYPES.map((d) => (
            <Pressable
              key={d}
              onPress={() => setDocType(d)}
              style={[ui.pill, docType === d && ui.pillActive]}
            >
              <Text style={[ui.pillText, docType === d && ui.pillTextActive]}>{d}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <PhotoPicker label="Фото документа" value={photo} onChange={setPhoto} />

      {error ? <Text style={ui.errorText}>{error}</Text> : null}
      <Pressable style={ui.primaryButton} onPress={submit} disabled={busy}>
        <MaterialCommunityIcons name="shield-check-outline" size={18} color={colors.accentText} />
        <Text style={ui.primaryButtonText}>{busy ? "Отправка…" : "Отправить на проверку"}</Text>
      </Pressable>
    </View>
  );
}

// Реферальная карточка + ссылки на юрдокументы (в профиле).
function ProfileExtras() {
  const [ref, setRef] = useState<{ code: string; count: number }>({ code: "", count: 0 });
  const [legalOpen, setLegalOpen] = useState<"privacy" | "terms" | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchReferralCode()
      .then((r) => {
        if (!cancelled) setRef(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <View style={ui.card}>
        <Text style={styles.panelTitle}>Приглашайте друзей</Text>
        <Text style={styles.panelSubtitle}>
          Друг вводит ваш код при регистрации — вы получаете бонус, когда он сделает первый заказ.
        </Text>
        <View style={styles.referralCodeBox}>
          <Text style={styles.referralCode}>{ref.code || "…"}</Text>
          <Pressable
            hitSlop={8}
            onPress={() =>
              ref.code &&
              Share.share({ message: `Заказывай спецтехнику и воду в Кубере. Мой код при регистрации: ${ref.code}` })
            }
          >
            <MaterialCommunityIcons name="share-variant" size={20} color={colors.ink} />
          </Pressable>
        </View>
        <Text style={styles.locationNote}>Приглашено: {ref.count}</Text>
      </View>

      <View style={styles.legalLinks}>
        <Pressable onPress={() => setLegalOpen("privacy")}>
          <Text style={styles.legalLink}>Политика конфиденциальности</Text>
        </Pressable>
        <Pressable onPress={() => setLegalOpen("terms")}>
          <Text style={styles.legalLink}>Пользовательское соглашение</Text>
        </Pressable>
      </View>
      {legalOpen ? <LegalScreen type={legalOpen} onClose={() => setLegalOpen(null)} /> : null}
    </>
  );
}

function ProfilePanel({
  account,
  catalog,
  serverState,
  devMode,
  bidFee,
  bidPercent,
  onToggleDev,
  onSave,
  onSaveConfig,
  onVerify,
  onLogout,
  savedPlaces,
  onDeletePlace,
  onBalanceChange
}: {
  account: Account;
  catalog: Catalog;
  serverState: "sync" | "offline";
  devMode: boolean;
  bidFee: number;
  bidPercent: number;
  onToggleDev: (value: boolean) => void;
  onSave: (
    next: {
      name: string;
      role: Role;
      cityId: string;
      phone: string;
      telegram: string;
      services: ServiceKey[];
      radiusKm: number;
      available: boolean;
      busy: boolean;
      avatar: string;
    },
    onError?: (message: string) => void
  ) => void;
  onSaveConfig: (fee: number, percent: number) => void;
  onVerify: () => void;
  onLogout: () => void;
  savedPlaces: SavedPlace[];
  onDeletePlace: (id: string) => void;
  onBalanceChange: (balance: number) => void;
}) {
  const [name, setName] = useState(account.name);
  const [phone, setPhone] = useState(account.phone ?? "");
  const [telegram, setTelegram] = useState(account.telegram ?? "");
  const [role, setRole] = useState<Role>(account.role);
  const [cityId, setCityId] = useState(account.cityId);
  const [services, setServices] = useState<ServiceKey[]>(account.services ?? []);
  const [available, setAvailable] = useState(account.available ?? true);
  const [busy, setBusy] = useState(account.busy ?? false);
  const [avatar, setAvatar] = useState<string | null>(account.avatar || null);
  // Служебная карточка (переключение роли, тариф) скрыта от обычных юзеров —
  // раскрывается долгим нажатием на аватар.
  const [showDev, setShowDev] = useState(devMode);
  const [radiusInput, setRadiusInput] = useState(String(account.radiusKm ?? 0));
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const [feeInput, setFeeInput] = useState(String(bidFee));
  const [percentInput, setPercentInput] = useState(String(bidPercent));
  const [saveError, setSaveError] = useState("");

  const city = catalog.cities.find((c) => c.id === cityId);
  const rating = account.rating ?? 0;

  function toggleService(key: ServiceKey) {
    setServices((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
    );
  }

  // Выбрать фото профиля (сохранится при нажатии «Сохранить»).
  async function pickAvatar() {
    const result = await pickImageAsBase64();
    if (result.ok) {
      setAvatar(result.dataUrl);
      setSaveError("");
    } else if (result.error) {
      setSaveError(result.error);
    }
  }

  // Услуги, сгруппированные по категориям (для выбора специализаций исполнителя).
  const servicesByCategory = useMemo(() => {
    const cats = catalog.categories ?? [];
    const groups = cats
      .map((c) => ({ title: c.title, items: catalog.services.filter((s) => (s.category || "other") === c.key) }))
      .filter((g) => g.items.length > 0);
    const grouped = new Set(groups.flatMap((g) => g.items.map((s) => s.key)));
    const rest = catalog.services.filter((s) => !grouped.has(s.key));
    if (rest.length) {
      groups.push({ title: "Прочее", items: rest });
    }
    return groups;
  }, [catalog.services, catalog.categories]);

  return (
    <View style={styles.profileWrap}>
      <View style={ui.card}>
        <View style={styles.rowCenter}>
          <Pressable onPress={pickAvatar} onLongPress={() => setShowDev(true)} delayLongPress={600}>
            {avatar ? (
              <Image source={{ uri: avatar }} style={styles.avatarImg} resizeMode="cover" />
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{account.name.slice(0, 1).toUpperCase()}</Text>
              </View>
            )}
            <View style={styles.avatarEditBadge}>
              <MaterialCommunityIcons name="camera" size={12} color={colors.accentText} />
            </View>
          </Pressable>
          <View style={styles.flex}>
            <Text style={styles.panelTitle}>{account.name}</Text>
            <Text style={styles.panelSubtitle}>{account.email}</Text>
            <Text style={styles.avatarHint}>Нажмите на фото, чтобы сменить{avatar ? " · " : ""}
              {avatar ? (
                <Text style={styles.avatarRemove} onPress={() => setAvatar(null)}>убрать</Text>
              ) : null}
            </Text>
          </View>
        </View>
        <View style={styles.ratingPill}>
          <MaterialCommunityIcons name="star" size={16} color={colors.star} />
          <Text style={styles.ratingText}>
            {rating > 0 ? `${rating.toFixed(1)} · ${account.ratingCount} ${plural(account.ratingCount ?? 0, "отзыв", "отзыва", "отзывов")}` : "пока нет отзывов"}
          </Text>
        </View>
        {serverState === "offline" ? (
          <View style={[styles.syncBar, styles.syncOffline]}>
            <MaterialCommunityIcons name="cloud-off-outline" size={16} color={colors.warning} />
            <Text style={styles.syncText}>Нет связи с сервером — проверьте интернет</Text>
          </View>
        ) : null}
      </View>

      <View style={ui.card}>
        <Text style={styles.panelTitle}>Настройки</Text>

        <View style={ui.inputGroup}>
          <Text style={ui.label}>Имя</Text>
          <TextInput value={name} onChangeText={setName} style={ui.input} />
        </View>

        <View style={ui.inputGroup}>
          <Text style={ui.label}>Телефон</Text>
          <TextInput
            value={phone}
            onChangeText={(v) => setPhone(formatPhone(v))}
            placeholder="+7 (___) ___-__-__"
            placeholderTextColor={colors.inkFaint}
            keyboardType="phone-pad"
            style={ui.input}
          />
        </View>

        <View style={ui.inputGroup}>
          <Text style={ui.label}>Telegram</Text>
          <TextInput
            value={telegram}
            onChangeText={(v) => setTelegram(formatTelegram(v))}
            placeholder="@username"
            placeholderTextColor={colors.inkFaint}
            autoCapitalize="none"
            style={ui.input}
          />
        </View>

        <View style={ui.inputGroup}>
          <Text style={ui.label}>Роль</Text>
          <View style={styles.pillRow}>
            {(["client", "driver"] as Role[]).map((value) => (
              <Pressable
                key={value}
                onPress={() => setRole(value)}
                style={[ui.pill, role === value && ui.pillActive]}
              >
                <Text style={[ui.pillText, role === value && ui.pillTextActive]}>
                  {value === "client" ? "Заказчик" : "Исполнитель"}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={ui.inputGroup}>
          <Text style={ui.label}>Город</Text>
          <Pressable style={styles.selectButton} onPress={() => setCityPickerOpen(true)}>
            <MaterialCommunityIcons name="map-marker-outline" size={18} color={colors.ink} />
            <Text style={styles.selectButtonText}>
              {city ? `${city.name} · ${city.region}` : "Выбрать город"}
            </Text>
            <MaterialCommunityIcons name="chevron-down" size={18} color={colors.inkFaint} />
          </Pressable>
        </View>

        {role === "driver" ? (
          <View style={ui.inputGroup}>
            <Text style={ui.label}>Мои услуги (что выполняю)</Text>
            {servicesByCategory.map((group) => (
              <View key={group.title} style={{ gap: 6 }}>
                <Text style={styles.specGroupTitle}>{group.title}</Text>
                <View style={styles.pillWrap}>
                  {group.items.map((s) => {
                    const on = services.includes(s.key);
                    return (
                      <Pressable
                        key={s.key}
                        onPress={() => toggleService(s.key)}
                        style={[styles.specChip, on && { borderColor: s.accent, backgroundColor: tint(s.accent) }]}
                      >
                        <MaterialCommunityIcons
                          name={on ? "check" : s.icon}
                          size={16}
                          color={on ? s.accent : colors.inkSoft}
                        />
                        <Text style={styles.specChipText}>{s.title}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
            <Text style={styles.locationNote}>Биржа покажет только заказы по выбранным услугам.</Text>
          </View>
        ) : null}

        {role === "driver" ? (
          <>
            <View style={styles.rowBetween}>
              <View style={styles.flexShrink}>
                <Text style={ui.label}>На линии</Text>
                <Text style={styles.panelSubtitle}>Выключите — заказы на бирже скрыты.</Text>
              </View>
              <Switch
                value={available}
                onValueChange={setAvailable}
                trackColor={{ true: colors.positive, false: colors.line }}
                thumbColor={colors.surface}
              />
            </View>
            <View style={styles.rowBetween}>
              <View style={styles.flexShrink}>
                <Text style={ui.label}>Сейчас занят</Text>
                <Text style={styles.panelSubtitle}>
                  В витрине пометим «занят» и опустим ниже, но объявление останется видно.
                </Text>
              </View>
              <Switch
                value={busy}
                onValueChange={setBusy}
                disabled={!available}
                trackColor={{ true: colors.star, false: colors.line }}
                thumbColor={colors.surface}
              />
            </View>
            <View style={ui.inputGroup}>
              <Text style={ui.label}>Рабочий радиус, км (0 — без ограничения)</Text>
              <TextInput
                value={radiusInput}
                onChangeText={setRadiusInput}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={colors.inkFaint}
                style={ui.input}
              />
            </View>

            {/* Верификация квалификации по документу — в отдельной карточке ниже. */}
          </>
        ) : null}

        {saveError ? <Text style={ui.errorText}>{saveError}</Text> : null}
        <Pressable
          style={ui.primaryButton}
          onPress={() => {
            setSaveError("");
            onSave(
              {
                name,
                role,
                cityId,
                phone,
                telegram,
                services,
                radiusKm: Math.max(0, Math.round(Number(radiusInput) || 0)),
                available,
                busy,
                avatar: avatar ?? ""
              },
              (message) => setSaveError(message)
            );
          }}
        >
          <MaterialCommunityIcons name="check" size={18} color={colors.accentText} />
          <Text style={ui.primaryButtonText}>Сохранить</Text>
        </Pressable>
      </View>

      {role === "client" ? (
        <View style={ui.card}>
          <Text style={styles.panelTitle}>Мои места</Text>
          {savedPlaces.length === 0 ? (
            <Text style={styles.panelSubtitle}>
              Нет сохранённых мест. Укажите точку при создании заявки и нажмите «Сохранить место».
            </Text>
          ) : (
            savedPlaces.map((place) => (
              <View key={place.id} style={styles.placeManageRow}>
                <MaterialCommunityIcons name="map-marker-outline" size={18} color={colors.ink} />
                <View style={styles.flex}>
                  <Text style={styles.portfolioTitle}>{place.label}</Text>
                  <Text style={styles.panelSubtitle} numberOfLines={1}>
                    {place.fromText}
                  </Text>
                </View>
                <Pressable hitSlop={8} onPress={() => onDeletePlace(place.id)}>
                  <MaterialCommunityIcons name="close-circle-outline" size={20} color={colors.warning} />
                </Pressable>
              </View>
            ))
          )}
        </View>
      ) : null}

      {role === "driver" ? <VerificationCard account={account} catalog={catalog} /> : null}

      {role === "driver" ? (
        <PortfolioEditor account={account} />
      ) : null}

      {role === "driver" ? <EquipmentEditor account={account} catalog={catalog} /> : null}

      {role === "driver" ? (
        <WalletCard account={account} bidFee={bidFee} onBalanceChange={onBalanceChange} />
      ) : null}

      {role === "client" ? <SchedulesCard /> : null}

      {showDev ? (
      <View style={ui.card}>
        <View style={styles.rowBetween}>
          <View style={styles.flexShrink}>
            <Text style={styles.panelTitle}>Режим разработчика</Text>
            <Text style={styles.panelSubtitle}>Быстрое переключение роли сверху для тестов.</Text>
          </View>
          <Switch
            value={devMode}
            onValueChange={onToggleDev}
            trackColor={{ true: colors.ink, false: colors.line }}
            thumbColor={colors.surface}
          />
        </View>

        {devMode ? (
          <View style={styles.divBlock}>
            <Text style={ui.label}>Глобальный тариф (fallback)</Text>
            <Text style={styles.locationNote}>
              Применяется, если для ниши не задана своя цена. Точечные цены — в админке.
            </Text>
            <View style={styles.bidRow}>
              <View style={styles.flex}>
                <Text style={styles.locationNote}>Цена отклика, монеты</Text>
                <TextInput
                  value={feeInput}
                  onChangeText={setFeeInput}
                  keyboardType="number-pad"
                  style={ui.input}
                />
              </View>
              <View style={styles.flex}>
                <Text style={styles.locationNote}>% от заказа</Text>
                <TextInput
                  value={percentInput}
                  onChangeText={setPercentInput}
                  keyboardType="number-pad"
                  style={ui.input}
                />
              </View>
            </View>
            <Text style={styles.locationNote}>
              Пример: при заказе 4000 ₽ отклик = {Math.max(0, Math.round(Number(feeInput) || 0)) +
                Math.round((4000 * (Number(percentInput) || 0)) / 100)} монет. 0/0 — бесплатно.
            </Text>
            <Pressable
              style={ui.ghostButton}
              onPress={() =>
                onSaveConfig(
                  Math.max(0, Math.round(Number(feeInput) || 0)),
                  Math.max(0, Number(percentInput) || 0)
                )
              }
            >
              <MaterialCommunityIcons name="cash-sync" size={18} color={colors.ink} />
              <Text style={ui.ghostButtonText}>Применить тариф</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      ) : null}

      <ProfileExtras />

      <Pressable style={ui.ghostButton} onPress={onLogout}>
        <MaterialCommunityIcons name="logout" size={18} color={colors.ink} />
        <Text style={ui.ghostButtonText}>Выйти</Text>
      </Pressable>

      <CityPicker
        visible={cityPickerOpen}
        cities={catalog.cities}
        selectedId={cityId}
        onSelect={(id) => {
          setCityId(id);
          setCityPickerOpen(false);
        }}
        onClose={() => setCityPickerOpen(false)}
      />
    </View>
  );
}

function CityPicker({
  visible,
  cities,
  selectedId,
  onSelect,
  onClose
}: {
  visible: boolean;
  cities: City[];
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return cities;
    }
    return cities.filter(
      (c) => c.name.toLowerCase().includes(q) || c.region.toLowerCase().includes(q)
    );
  }, [cities, query]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.pickerSheet}>
          <View style={styles.modalHandleRow}>
            <View style={styles.modalHandle} />
          </View>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Выбор города</Text>
            <Pressable style={styles.modalClose} onPress={onClose}>
              <MaterialCommunityIcons name="close" size={20} color={colors.ink} />
            </Pressable>
          </View>
          <View style={styles.searchWrap}>
            <MaterialCommunityIcons name="magnify" size={18} color={colors.inkFaint} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Поиск города или региона"
              placeholderTextColor={colors.inkFaint}
              style={styles.searchInput}
              autoFocus
            />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            style={styles.cityList}
            renderItem={({ item }) => (
              <Pressable style={styles.cityOption} onPress={() => onSelect(item.id)}>
                <View style={styles.flex}>
                  <Text style={styles.cityOptionName}>{item.name}</Text>
                  <Text style={styles.cityOptionRegion}>{item.region}</Text>
                </View>
                {item.id === selectedId ? (
                  <MaterialCommunityIcons name="check" size={20} color={colors.ink} />
                ) : null}
              </Pressable>
            )}
            ListEmptyComponent={<Text style={styles.empty}>Ничего не найдено</Text>}
          />
        </View>
      </View>
    </Modal>
  );
}

// Строка сетки цен: локальная стоимость + переключатель платности ниши.
function PricingRow({
  cell,
  onSave
}: {
  cell: PricingCell;
  onSave: (coinCost: number, enabled: boolean) => void;
}) {
  const [cost, setCost] = useState(cell.coinCost ? String(cell.coinCost) : "");
  const [enabled, setEnabled] = useState(cell.enabled);

  function commit(nextEnabled: boolean) {
    const parsed = Math.max(0, Math.round(Number(cost) || 0));
    const finalCost = nextEnabled && parsed === 0 ? 20 : parsed;
    setCost(finalCost ? String(finalCost) : "");
    setEnabled(nextEnabled);
    onSave(finalCost, nextEnabled);
  }

  return (
    <View style={styles.pricingRow}>
      <Text style={styles.pricingService} numberOfLines={1}>
        {cell.serviceName}
      </Text>
      <TextInput
        value={cost}
        onChangeText={setCost}
        onEndEditing={() => commit(enabled)}
        keyboardType="number-pad"
        placeholder="0"
        placeholderTextColor={colors.inkFaint}
        style={styles.pricingInput}
      />
      <Text style={styles.pricingUnit}>мон.</Text>
      <Switch
        value={enabled}
        onValueChange={commit}
        trackColor={{ true: colors.ink, false: colors.line }}
        thumbColor={colors.surface}
      />
    </View>
  );
}

// Админ: включение платных ниш (город × услуга) по монетам.
// KPI-карточка для дашборда (2 в ряд).
function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.metricLabel}>{label}</Text>
      {sub ? <Text style={styles.metricSub} numberOfLines={1}>{sub}</Text> : null}
    </View>
  );
}

// Платные ниши: выбор города → правим только его ниши (масштаб на 20+ городов).
function AdminPricingPanel({ cities }: { cities: City[] }) {
  const [grid, setGrid] = useState<PricingCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [cityId, setCityId] = useState(cities[0]?.id ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [bulkService, setBulkService] = useState<ServiceKey | null>(null);
  const [bulkCost, setBulkCost] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPricingGrid()
      .then((data) => {
        if (!cancelled) setGrid(data.grid);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cityCells = useMemo(() => grid.filter((c) => c.cityId === cityId), [grid, cityId]);
  const enabledCount = useMemo(() => grid.filter((c) => c.enabled).length, [grid]);
  const cityName = cities.find((c) => c.id === cityId)?.name ?? "Выбрать город";
  const allServices = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of grid) if (!seen.has(c.serviceKey)) seen.set(c.serviceKey, c.serviceName);
    return [...seen.entries()].map(([key, name]) => ({ key, name }));
  }, [grid]);

  async function save(cell: PricingCell, coinCost: number, enabled: boolean) {
    setGrid((g) =>
      g.map((c) =>
        c.cityId === cell.cityId && c.serviceKey === cell.serviceKey ? { ...c, coinCost, enabled } : c
      )
    );
    try {
      await setPricingRuleOnServer({ cityId: cell.cityId, serviceKey: cell.serviceKey, coinCost, enabled });
    } catch {
      // тихо — можно повторить
    }
  }

  async function bulkApply(rules: { cityId: string; serviceKey: ServiceKey; coinCost: number; enabled: boolean }[]) {
    if (rules.length === 0) return;
    setBusy(true);
    try {
      await updatePricingBulk(rules);
      const map = new Map(rules.map((r) => [`${r.cityId}|${r.serviceKey}`, r]));
      setGrid((g) =>
        g.map((c) => {
          const r = map.get(`${c.cityId}|${c.serviceKey}`);
          return r ? { ...c, coinCost: r.coinCost, enabled: r.enabled } : c;
        })
      );
    } catch {
      // тихо
    } finally {
      setBusy(false);
    }
  }

  function applyServiceToAll() {
    const cost = Math.max(0, Math.round(Number(bulkCost) || 0));
    if (!bulkService || cost <= 0) return;
    void bulkApply(
      grid
        .filter((c) => c.serviceKey === bulkService)
        .map((c) => ({ cityId: c.cityId, serviceKey: c.serviceKey, coinCost: cost, enabled: true }))
    );
    setBulkService(null);
    setBulkCost("");
  }

  function copyFrom(sourceCityId: string) {
    void bulkApply(
      grid
        .filter((c) => c.cityId === sourceCityId)
        .map((c) => ({ cityId, serviceKey: c.serviceKey, coinCost: c.coinCost, enabled: c.enabled }))
    );
  }

  return (
    <View style={ui.card}>
      <View style={styles.balanceRow}>
        <CoinIcon size={18} />
        <Text style={styles.panelTitle}>Платные ниши</Text>
      </View>
      <Text style={styles.panelSubtitle}>
        Плата за отклик по нишам. Включено ниш: {enabledCount}. 1 монета = {COIN_RATE} ₽.
      </Text>
      <Pressable style={styles.selectButton} onPress={() => setPickerOpen(true)}>
        <MaterialCommunityIcons name="map-marker-outline" size={18} color={colors.ink} />
        <Text style={styles.selectButtonText}>{cityName}</Text>
        <MaterialCommunityIcons name="chevron-down" size={18} color={colors.inkFaint} />
      </Pressable>

      <View style={styles.divBlock}>
        <Text style={ui.label}>Массовые действия</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.placeRow}>
          {allServices.map((s) => (
            <Pressable
              key={s.key}
              onPress={() => setBulkService(bulkService === s.key ? null : s.key)}
              style={[styles.placeChip, bulkService === s.key && { borderColor: colors.ink, backgroundColor: colors.surfaceMuted }]}
            >
              <Text style={styles.placeChipText}>{s.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.rowGap}>
          <TextInput
            value={bulkCost}
            onChangeText={setBulkCost}
            placeholder="цена, мон."
            placeholderTextColor={colors.inkFaint}
            keyboardType="number-pad"
            style={[ui.input, styles.flex]}
          />
          <Pressable
            style={[ui.primaryButton, styles.flex, (!bulkService || !bulkCost.trim() || busy) && { opacity: 0.5 }]}
            onPress={applyServiceToAll}
            disabled={!bulkService || !bulkCost.trim() || busy}
          >
            <Text style={ui.primaryButtonText}>Во все города</Text>
          </Pressable>
        </View>
        <View style={styles.rowGap}>
          <Pressable style={[ui.ghostButton, styles.flex]} onPress={() => setCopyOpen(true)} disabled={busy}>
            <MaterialCommunityIcons name="content-copy" size={16} color={colors.ink} />
            <Text style={ui.ghostButtonText}>Скопировать из города</Text>
          </Pressable>
          <Pressable
            style={ui.ghostButton}
            onPress={() =>
              bulkApply(cityCells.map((c) => ({ cityId: c.cityId, serviceKey: c.serviceKey, coinCost: 0, enabled: false })))
            }
            disabled={busy}
          >
            <Text style={[ui.ghostButtonText, { color: colors.warning }]}>Выключить всё</Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.ink} />
      ) : cityCells.length === 0 ? (
        <Text style={styles.panelSubtitle}>В этом городе нет услуг.</Text>
      ) : (
        cityCells.map((cell) => (
          <PricingRow
            key={`${cell.cityId}|${cell.serviceKey}`}
            cell={cell}
            onSave={(coinCost, enabled) => save(cell, coinCost, enabled)}
          />
        ))
      )}

      <CityPicker
        visible={pickerOpen}
        cities={cities}
        selectedId={cityId}
        onSelect={(id) => {
          setCityId(id);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
      <CityPicker
        visible={copyOpen}
        cities={cities.filter((c) => c.id !== cityId)}
        selectedId=""
        onSelect={(id) => {
          copyFrom(id);
          setCopyOpen(false);
        }}
        onClose={() => setCopyOpen(false)}
      />
    </View>
  );
}

// Пользователи: корректировка баланса (монеты) + бан.
const ADMIN_PAGE = 20;

function AdminUsersPanel() {
  const [q, setQ] = useState("");
  const [list, setList] = useState<Account[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState<Account | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const loadPage = useCallback(async (nextOffset: number, query: string, append: boolean) => {
    setLoading(true);
    try {
      const page = await fetchUsers({ q: query, limit: ADMIN_PAGE, offset: nextOffset });
      setList((cur) => (append ? [...cur, ...page] : page));
      setHasMore(page.length === ADMIN_PAGE);
      setOffset(nextOffset);
    } catch {
      // тихо
    } finally {
      setLoading(false);
    }
  }, []);

  // Поиск с задержкой (debounce), сброс на первую страницу.
  useEffect(() => {
    const t = setTimeout(() => {
      void loadPage(0, q, false);
    }, 350);
    return () => clearTimeout(t);
  }, [q, loadPage]);

  const reload = useCallback(() => {
    void loadPage(0, q, false);
  }, [loadPage, q]);

  async function adjust(sign: number) {
    const val = Math.round(Number(amount) || 0) * sign;
    if (!target?.id || !val) return;
    setBusy(true);
    try {
      await adminAdjustBalance(target.id, val, note.trim());
      setTarget(null);
      setAmount("");
      setNote("");
      reload();
    } catch {
      // тихо
    } finally {
      setBusy(false);
    }
  }

  async function toggleBan() {
    if (!target?.id) return;
    setBusy(true);
    try {
      await adminSetBanned(target.id, !target.banned);
      setTarget(null);
      reload();
    } catch {
      // тихо
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={ui.card}>
      <Text style={styles.panelTitle}>Пользователи</Text>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Поиск по имени, почте, телефону"
        placeholderTextColor={colors.inkFaint}
        autoCapitalize="none"
        style={ui.input}
      />
      {list.length === 0 && !loading ? (
        <Text style={styles.panelSubtitle}>Ничего не найдено.</Text>
      ) : (
        list.map((u) => (
          <Pressable
            key={u.id}
            style={styles.adminUserRow}
            onPress={() => {
              setTarget(u);
              setAmount("");
              setNote("");
            }}
          >
            <Text style={styles.adminUserName} numberOfLines={1}>
              {u.banned ? "⛔ " : u.verified ? "✓ " : ""}
              {u.name}
            </Text>
            <Text style={styles.adminUserMeta} numberOfLines={1}>
              {u.role === "driver" ? "исполнитель" : "заказчик"} · {u.phone || u.email}
              {u.role === "driver" ? ` · ${rub.format(u.balance ?? 0)} мон.` : ""}
            </Text>
          </Pressable>
        ))
      )}
      {hasMore ? (
        <Pressable style={ui.ghostButton} onPress={() => loadPage(offset + ADMIN_PAGE, q, true)} disabled={loading}>
          <Text style={ui.ghostButtonText}>{loading ? "Загрузка…" : "Показать ещё"}</Text>
        </Pressable>
      ) : null}

      <Modal visible={Boolean(target)} transparent animationType="fade" onRequestClose={() => setTarget(null)}>
        <View style={styles.centerModalBackdrop}>
          <View style={styles.centerModalCard}>
            <Text style={styles.panelTitle}>{target?.name}</Text>
            <Text style={styles.panelSubtitle}>Баланс: {rub.format(target?.balance ?? 0)} монет</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="сумма, монет"
              placeholderTextColor={colors.inkFaint}
              keyboardType="number-pad"
              style={ui.input}
            />
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="причина (необязательно)"
              placeholderTextColor={colors.inkFaint}
              style={ui.input}
            />
            <View style={styles.rowGap}>
              <Pressable style={[ui.primaryButton, styles.flex]} onPress={() => adjust(1)} disabled={busy}>
                <Text style={ui.primaryButtonText}>Начислить</Text>
              </Pressable>
              <Pressable style={[ui.ghostButton, styles.flex]} onPress={() => adjust(-1)} disabled={busy}>
                <Text style={ui.ghostButtonText}>Списать</Text>
              </Pressable>
            </View>
            <Pressable style={ui.ghostButton} onPress={toggleBan} disabled={busy}>
              <MaterialCommunityIcons
                name={target?.banned ? "account-check-outline" : "account-cancel-outline"}
                size={18}
                color={colors.warning}
              />
              <Text style={[ui.ghostButtonText, { color: colors.warning }]}>
                {target?.banned ? "Разбанить" : "Забанить"}
              </Text>
            </Pressable>
            <Pressable onPress={() => setTarget(null)}>
              <Text style={styles.locationNote}>Закрыть</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// Лента заказов для модерации (фильтр по статусу).
function AdminOrdersFeed({ cities }: { cities: City[] }) {
  const [status, setStatus] = useState<string | null>(null);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const cityNames = useMemo(() => new Map(cities.map((c) => [c.id, c.name])), [cities]);

  const loadPage = useCallback(async (nextOffset: number, st: string | null, append: boolean) => {
    setLoading(true);
    try {
      const page = await fetchAdminOrders({ status: st, limit: ADMIN_PAGE, offset: nextOffset });
      setOrders((cur) => (append ? [...cur, ...page] : page));
      setHasMore(page.length === ADMIN_PAGE);
      setOffset(nextOffset);
    } catch {
      // тихо
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage(0, status, false);
  }, [status, loadPage]);

  const filters: { key: string | null; label: string }[] = [
    { key: null, label: "Все" },
    { key: "open", label: "Открытые" },
    { key: "matched", label: "В работе" },
    { key: "finished", label: "Завершены" },
    { key: "done", label: "Закрыты" }
  ];

  return (
    <View style={ui.card}>
      <Text style={styles.panelTitle}>Заказы</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.placeRow}>
        {filters.map((f) => (
          <Pressable key={f.label} onPress={() => setStatus(f.key)} style={[ui.pill, status === f.key && ui.pillActive]}>
            <Text style={[ui.pillText, status === f.key && ui.pillTextActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {orders.length === 0 ? (
        <Text style={styles.panelSubtitle}>Нет заказов.</Text>
      ) : (
        orders.map((o) => {
          const svc = serviceByKey(o.service);
          return (
            <View key={o.id} style={styles.adminUserRow}>
              <View style={styles.rowBetween}>
                <Text style={styles.adminUserName} numberOfLines={1}>
                  {svc.title} · {rub.format(o.price)} ₽
                </Text>
                <Text style={styles.bidMeta}>{statusLabel(o.status as OrderStatus)}</Text>
              </View>
              <Text style={styles.adminUserMeta} numberOfLines={1}>
                {cityNames.get(o.cityId) || o.cityId} · {o.customerName} · {o.bids} откл.
              </Text>
            </View>
          );
        })
      )}
      {hasMore ? (
        <Pressable style={ui.ghostButton} onPress={() => loadPage(offset + ADMIN_PAGE, status, true)} disabled={loading}>
          <Text style={ui.ghostButtonText}>{loading ? "Загрузка…" : "Показать ещё"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// Лог последних транзакций платформы.
function AdminTransactionsFeed() {
  const [tx, setTx] = useState<AdminTransaction[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadPage = useCallback(async (nextOffset: number, append: boolean) => {
    setLoading(true);
    try {
      const r = await fetchAdminTransactions(ADMIN_PAGE, nextOffset);
      setTx((cur) => (append ? [...cur, ...r.transactions] : r.transactions));
      setHasMore(r.transactions.length === ADMIN_PAGE);
      setOffset(nextOffset);
    } catch {
      // тихо
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage(0, false);
  }, [loadPage]);

  return (
    <View style={ui.card}>
      <Text style={styles.panelTitle}>Транзакции</Text>
      {tx.length === 0 ? (
        <Text style={styles.panelSubtitle}>Нет движений.</Text>
      ) : (
        tx.map((t) => (
          <View key={t.id} style={styles.adminUserRow}>
            <View style={styles.rowBetween}>
              <Text style={styles.adminUserName} numberOfLines={1}>
                {t.accountName}
              </Text>
              <Text style={[styles.adminUserName, { color: t.amount >= 0 ? colors.positive : colors.warning }]}>
                {t.amount >= 0 ? "+" : ""}
                {rub.format(t.amount)} мон.
              </Text>
            </View>
            <Text style={styles.adminUserMeta} numberOfLines={1}>
              {t.type} · {t.note || "—"}
            </Text>
          </View>
        ))
      )}
      {hasMore ? (
        <Pressable style={ui.ghostButton} onPress={() => loadPage(offset + ADMIN_PAGE, true)} disabled={loading}>
          <Text style={ui.ghostButtonText}>{loading ? "Загрузка…" : "Показать ещё"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const CATALOG_ICONS = [
  "tanker-truck", "dump-truck", "truck", "dolly", "crane", "excavator",
  "truck-cargo-container", "pipe-wrench", "flash", "fire", "ethernet-cable",
  "water-pump", "wrench", "hammer", "shovel", "toolbox", "broom", "snowflake"
];

// Управление каталогом: добавить город, добавить услугу, доступность по городу.
function AdminCatalogPanel({ catalog, onChanged }: { catalog: Catalog; onChanged: () => void }) {
  // Города
  const [cId, setCId] = useState("");
  const [cName, setCName] = useState("");
  const [cRegion, setCRegion] = useState(catalog.regions[0]?.id ?? "");
  const [cLng, setCLng] = useState("");
  const [cLat, setCLat] = useState("");
  const [cMsg, setCMsg] = useState("");

  // Услуги
  const [sKey, setSKey] = useState("");
  const [sTitle, setSTitle] = useState("");
  const [sSub, setSSub] = useState("");
  const [sIcon, setSIcon] = useState(CATALOG_ICONS[0]);
  const [sAccent, setSAccent] = useState("#556B8C");
  const [sCat, setSCat] = useState(catalog.categories?.[0]?.key ?? "transport");
  const [sMsg, setSMsg] = useState("");

  // Доступность
  const [availCity, setAvailCity] = useState(catalog.cities[0]?.id ?? "");
  const [availPickerOpen, setAvailPickerOpen] = useState(false);
  const availCityObj = catalog.cities.find((c) => c.id === availCity);

  async function addCityNow() {
    setCMsg("");
    if (!cId.trim() || !cName.trim() || !cLng.trim() || !cLat.trim()) {
      setCMsg("Заполните все поля");
      return;
    }
    try {
      await adminAddCity({
        id: cId.trim(),
        regionId: cRegion,
        name: cName.trim(),
        centerLng: Number(cLng),
        centerLat: Number(cLat)
      });
      setCId("");
      setCName("");
      setCLng("");
      setCLat("");
      setCMsg("Город добавлен ✓");
      onChanged();
    } catch (e) {
      setCMsg(e instanceof ApiError ? e.message : "Ошибка");
    }
  }

  async function addServiceNow() {
    setSMsg("");
    if (!sKey.trim() || !sTitle.trim() || !sSub.trim()) {
      setSMsg("Заполните key, название, подзаголовок");
      return;
    }
    try {
      await adminAddService({
        key: sKey.trim(),
        title: sTitle.trim(),
        subtitle: sSub.trim(),
        icon: sIcon,
        accent: sAccent.trim(),
        category: sCat
      });
      setSKey("");
      setSTitle("");
      setSSub("");
      setSMsg("Услуга добавлена ✓");
      onChanged();
    } catch (e) {
      setSMsg(e instanceof ApiError ? e.message : "Ошибка");
    }
  }

  async function toggleAvail(serviceKey: string, enabled: boolean) {
    try {
      await adminSetCityService(availCity, serviceKey, enabled);
      onChanged();
    } catch {
      // тихо
    }
  }

  return (
    <View style={ui.card}>
      <Text style={styles.panelTitle}>Каталог</Text>

      <View style={styles.divBlock}>
        <Text style={ui.label}>Добавить город</Text>
        <TextInput value={cId} onChangeText={setCId} placeholder="id (латиница)" placeholderTextColor={colors.inkFaint} autoCapitalize="none" style={ui.input} />
        <TextInput value={cName} onChangeText={setCName} placeholder="название" placeholderTextColor={colors.inkFaint} style={ui.input} />
        <View style={styles.pillWrap}>
          {catalog.regions.map((r) => (
            <Pressable key={r.id} onPress={() => setCRegion(r.id)} style={[ui.pill, cRegion === r.id && ui.pillActive]}>
              <Text style={[ui.pillText, cRegion === r.id && ui.pillTextActive]}>{r.name}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.rowGap}>
          <TextInput value={cLng} onChangeText={setCLng} placeholder="долгота (lng)" placeholderTextColor={colors.inkFaint} keyboardType="numbers-and-punctuation" style={[ui.input, styles.flex]} />
          <TextInput value={cLat} onChangeText={setCLat} placeholder="широта (lat)" placeholderTextColor={colors.inkFaint} keyboardType="numbers-and-punctuation" style={[ui.input, styles.flex]} />
        </View>
        {cMsg ? <Text style={cMsg.includes("✓") ? styles.savedNote : ui.errorText}>{cMsg}</Text> : null}
        <Pressable style={ui.ghostButton} onPress={addCityNow}>
          <MaterialCommunityIcons name="plus" size={18} color={colors.ink} />
          <Text style={ui.ghostButtonText}>Добавить город</Text>
        </Pressable>
      </View>

      <View style={styles.divBlock}>
        <Text style={ui.label}>Добавить услугу</Text>
        <TextInput value={sKey} onChangeText={setSKey} placeholder="key (латиница)" placeholderTextColor={colors.inkFaint} autoCapitalize="none" style={ui.input} />
        <TextInput value={sTitle} onChangeText={setSTitle} placeholder="название" placeholderTextColor={colors.inkFaint} style={ui.input} />
        <TextInput value={sSub} onChangeText={setSSub} placeholder="подзаголовок" placeholderTextColor={colors.inkFaint} style={ui.input} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.placeRow}>
          {CATALOG_ICONS.map((ic) => (
            <Pressable key={ic} onPress={() => setSIcon(ic)} style={[styles.iconChoice, sIcon === ic && { borderColor: colors.ink, borderWidth: 2 }]}>
              <MaterialCommunityIcons name={ic as keyof typeof MaterialCommunityIcons.glyphMap} size={22} color={colors.ink} />
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.rowGap}>
          <View style={[styles.colorSwatch, { backgroundColor: /^#[0-9a-fA-F]{6}$/.test(sAccent) ? sAccent : colors.line }]} />
          <TextInput value={sAccent} onChangeText={setSAccent} placeholder="#RRGGBB" placeholderTextColor={colors.inkFaint} autoCapitalize="none" style={[ui.input, styles.flex]} />
        </View>
        <View style={styles.pillWrap}>
          {(catalog.categories ?? []).map((cat) => (
            <Pressable key={cat.key} onPress={() => setSCat(cat.key)} style={[ui.pill, sCat === cat.key && ui.pillActive]}>
              <Text style={[ui.pillText, sCat === cat.key && ui.pillTextActive]}>{cat.title}</Text>
            </Pressable>
          ))}
        </View>
        {sMsg ? <Text style={sMsg.includes("✓") ? styles.savedNote : ui.errorText}>{sMsg}</Text> : null}
        <Pressable style={ui.ghostButton} onPress={addServiceNow}>
          <MaterialCommunityIcons name="plus" size={18} color={colors.ink} />
          <Text style={ui.ghostButtonText}>Добавить услугу</Text>
        </Pressable>
      </View>

      <View style={styles.divBlock}>
        <Text style={ui.label}>Доступность услуг в городе</Text>
        <Pressable style={styles.selectButton} onPress={() => setAvailPickerOpen(true)}>
          <MaterialCommunityIcons name="map-marker-outline" size={18} color={colors.ink} />
          <Text style={styles.selectButtonText}>{availCityObj?.name ?? "Город"}</Text>
          <MaterialCommunityIcons name="chevron-down" size={18} color={colors.inkFaint} />
        </Pressable>
        {catalog.services.map((s) => {
          const on = availCityObj?.services.includes(s.key) ?? false;
          return (
            <View key={s.key} style={styles.pricingRow}>
              <MaterialCommunityIcons name={s.icon} size={18} color={s.accent} />
              <Text style={styles.pricingService} numberOfLines={1}>{s.title}</Text>
              <Switch
                value={on}
                onValueChange={(v) => toggleAvail(s.key, v)}
                trackColor={{ true: colors.ink, false: colors.line }}
                thumbColor={colors.surface}
              />
            </View>
          );
        })}
        <CityPicker
          visible={availPickerOpen}
          cities={catalog.cities}
          selectedId={availCity}
          onSelect={(id) => {
            setAvailCity(id);
            setAvailPickerOpen(false);
          }}
          onClose={() => setAvailPickerOpen(false)}
        />
      </View>
    </View>
  );
}

// Жалобы на модерации.
function AdminComplaintsPanel() {
  const [list, setList] = useState<Complaint[]>([]);
  const load = useCallback(async () => {
    try {
      setList(await fetchAdminComplaints("open"));
    } catch {
      // тихо
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(id: string) {
    try {
      await decideComplaint(id, "рассмотрено");
      void load();
    } catch {
      // тихо
    }
  }

  return (
    <View style={ui.card}>
      <Text style={styles.panelTitle}>Жалобы ({list.length})</Text>
      {list.length === 0 ? (
        <Text style={styles.panelSubtitle}>Нет открытых жалоб.</Text>
      ) : (
        list.map((c) => (
          <View key={c.id} style={styles.adminUserRow}>
            <View style={styles.flex}>
              <Text style={styles.adminUserName} numberOfLines={2}>
                {c.text}
              </Text>
              <Text style={styles.adminUserMeta}>
                {c.fromName} → {c.toName}
              </Text>
            </View>
            <Pressable style={styles.acceptButton} onPress={() => resolve(c.id)}>
              <Text style={styles.acceptButtonText}>Закрыть</Text>
            </Pressable>
          </View>
        ))
      )}
    </View>
  );
}

function AdminScreen({ catalog, onCatalogChanged }: { catalog: Catalog; onCatalogChanged: () => void }) {
  const [pending, setPending] = useState<PendingVerificationRequest[]>([]);
  const [analytics, setAnalytics] = useState<DemandAnalytics | null>(null);
  const [days, setDays] = useState(30);
  const [cityFilter, setCityFilter] = useState<string | null>(null);
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const [zoomPhoto, setZoomPhoto] = useState<string | null>(null);
  const [eqVerifs, setEqVerifs] = useState<EquipmentVerification[]>([]);

  const load = useCallback(async () => {
    try {
      setPending(await fetchPendingVerificationRequests());
    } catch {
      // нет прав / сеть
    }
    try {
      setEqVerifs(await fetchEquipmentVerifications());
    } catch {
      // нет прав / сеть
    }
  }, []);

  async function decideEq(id: string, approve: boolean) {
    try {
      setEqVerifs(await decideEquipmentVerification(id, approve));
    } catch {
      // тихо
    }
  }

  const loadAnalytics = useCallback(async () => {
    try {
      setAnalytics(await fetchAnalytics(days, cityFilter));
    } catch {
      // тихо
    }
  }, [days, cityFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  async function decide(id: string, approve: boolean) {
    try {
      await decideVerificationRequest(id, approve);
      void load();
    } catch {
      // тихо
    }
  }

  const t = analytics?.totals;
  const fillRate = t && t.orders > 0 ? Math.round((t.doneOrders / t.orders) * 100) : 0;
  const maxCatGmv = analytics?.byCategory[0]?.gmv || 1;
  const maxSvcGmv = analytics?.byService[0]?.gmv || 1;
  const cityFilterName = cityFilter ? catalog.cities.find((c) => c.id === cityFilter)?.name ?? "Город" : "Все города";

  return (
    <>
      <View style={ui.card}>
        <Text style={styles.panelTitle}>Аналитика</Text>

        <View style={styles.pillRow}>
          {[7, 30, 90].map((d) => (
            <Pressable key={d} onPress={() => setDays(d)} style={[ui.pill, days === d && ui.pillActive]}>
              <Text style={[ui.pillText, days === d && ui.pillTextActive]}>{d} дн.</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.rowGap}>
          <Pressable style={[styles.selectButton, styles.flex]} onPress={() => setCityPickerOpen(true)}>
            <MaterialCommunityIcons name="map-marker-outline" size={18} color={colors.ink} />
            <Text style={styles.selectButtonText}>{cityFilterName}</Text>
            <MaterialCommunityIcons name="chevron-down" size={18} color={colors.inkFaint} />
          </Pressable>
          {cityFilter ? (
            <Pressable style={ui.ghostButton} onPress={() => setCityFilter(null)}>
              <Text style={ui.ghostButtonText}>Все города</Text>
            </Pressable>
          ) : null}
        </View>

        {!t || t.orders === 0 ? (
          <Text style={styles.panelSubtitle}>Пока нет заказов за этот период.</Text>
        ) : (
          <>
            <View style={styles.metricGrid}>
              <MetricCard label="Оборот, ₽" value={rub.format(t.gmv)} sub={`выполнено ${rub.format(t.doneGmv)} ₽`} />
              <MetricCard label="Заказов" value={String(t.orders)} sub={`выполнено ${fillRate}%`} />
              <MetricCard label="Заказчики" value={String(t.activeClients)} sub={`новых ${t.newClients}`} />
              <MetricCard label="Исполнители" value={String(t.activeDrivers)} sub={`новых ${t.newDrivers}`} />
              <MetricCard label="Посещения" value={String(t.clientLogins + t.driverLogins)} sub={`кл ${t.clientLogins} · исп ${t.driverLogins}`} />
              <MetricCard label="Доход платформы" value={`${rub.format(t.coinRevenue)} мон.`} sub={`≈ ${rub.format(coinsToRub(t.coinRevenue))} ₽`} />
              <MetricCard label="Удержание" value={`${t.repeatRate}%`} sub="повторили заказ" />
            </View>

            {analytics && analytics.byCategory.length > 0 ? (
              <View style={styles.divBlock}>
                <Text style={ui.label}>Оборот по категориям</Text>
                {analytics.byCategory.map((c) => (
                  <View key={c.key} style={styles.analyticsRow}>
                    <Text style={styles.analyticsLabel} numberOfLines={1}>{c.title}</Text>
                    <View style={styles.analyticsBar}>
                      <View style={[styles.analyticsBarFill, { width: `${Math.max(6, Math.round((c.gmv / maxCatGmv) * 100))}%` }]} />
                    </View>
                    <Text style={styles.analyticsMoney}>{rub.format(c.gmv)} ₽</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.divBlock}>
              <Text style={ui.label}>По услугам</Text>
              {analytics!.byService.map((s) => (
                <View key={s.key} style={styles.analyticsRow}>
                  <Text style={styles.analyticsLabel} numberOfLines={1}>{s.title}</Text>
                  <View style={styles.analyticsBar}>
                    <View style={[styles.analyticsBarFill, { width: `${Math.max(6, Math.round((s.gmv / maxSvcGmv) * 100))}%` }]} />
                  </View>
                  <Text style={styles.analyticsMoney}>
                    {s.count} · {rub.format(s.gmv)} ₽
                  </Text>
                </View>
              ))}
            </View>

            {(() => {
              const deficit = (analytics?.matrix ?? []).filter((m) => m.count >= 2 && m.supply < m.count * 0.5);
              return deficit.length > 0 ? (
                <View style={[styles.divBlock, styles.deficitBox]}>
                  <Text style={[ui.label, { color: colors.warning }]}>Дефицит: спрос есть, исполнителей мало</Text>
                  {deficit.slice(0, 5).map((m) => (
                    <View key={`d-${m.cityId}|${m.serviceKey}`} style={styles.rowBetween}>
                      <Text style={styles.panelSubtitle} numberOfLines={1}>
                        {m.cityName} · {m.serviceName}
                      </Text>
                      <Text style={[styles.analyticsMoney, { color: colors.warning }]}>
                        {m.count} зак. · {m.supply} исп.
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null;
            })()}

            {analytics && analytics.matrix.length > 0 ? (
              <View style={styles.divBlock}>
                <Text style={ui.label}>Клетки: город × ниша</Text>
                {analytics.matrix.slice(0, 15).map((m) => (
                  <View key={`${m.cityId}|${m.serviceKey}`} style={styles.cellRow}>
                    <View style={styles.flex}>
                      <Text style={styles.panelSubtitle} numberOfLines={1}>
                        {m.cityName} · {m.serviceName}
                      </Text>
                      <Text style={styles.cellMeta}>
                        {m.fillRate >= 80 ? "✓" : m.fillRate >= 40 ? "~" : "✗"} выполнено {m.fillRate}% · откл. {m.avgBids} · исп. {m.supply}
                      </Text>
                    </View>
                    <Text style={styles.analyticsMoney}>
                      {m.count} · {rub.format(m.gmv)} ₽
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        )}

        <CityPicker
          visible={cityPickerOpen}
          cities={catalog.cities}
          selectedId={cityFilter ?? ""}
          onSelect={(id) => {
            setCityFilter(id);
            setCityPickerOpen(false);
          }}
          onClose={() => setCityPickerOpen(false)}
        />
      </View>

      <AdminPricingPanel cities={catalog.cities} />

      <View style={ui.card}>
        <Text style={styles.panelTitle}>Заявки на верификацию</Text>
        {pending.length === 0 ? (
          <Text style={styles.panelSubtitle}>Нет заявок на модерации.</Text>
        ) : (
          pending.map((r) => {
            const svc = serviceByKey(r.serviceKey);
            return (
              <View key={r.id} style={styles.verifAdminCard}>
                <Pressable onPress={() => setZoomPhoto(r.photo)}>
                  <Image source={{ uri: r.photo }} style={styles.verifThumb} resizeMode="cover" />
                </Pressable>
                <View style={styles.flex}>
                  <Text style={styles.bidDriver}>{r.accountName}</Text>
                  <Text style={styles.bidMeta}>
                    {svc.title} · {r.docType}
                  </Text>
                  <Text style={styles.bidMeta}>{r.accountPhone || r.accountEmail}</Text>
                  <View style={styles.rowGap}>
                    <Pressable style={styles.rejectButton} onPress={() => decide(r.id, false)}>
                      <Text style={styles.rejectButtonText}>Отклонить</Text>
                    </Pressable>
                    <Pressable style={styles.acceptButton} onPress={() => decide(r.id, true)}>
                      <Text style={styles.acceptButtonText}>Одобрить</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </View>

      <View style={ui.card}>
        <Text style={styles.panelTitle}>Техника на проверке (СТС)</Text>
        {eqVerifs.length === 0 ? (
          <Text style={styles.panelSubtitle}>Нет техники на проверке по СТС.</Text>
        ) : (
          eqVerifs.map((e) => {
            const svc = serviceByKey(e.serviceKey);
            return (
              <View key={e.id} style={styles.verifAdminCard}>
                <Pressable onPress={() => setZoomPhoto(e.stsPhoto)}>
                  <Image source={{ uri: e.stsPhoto }} style={styles.verifThumb} resizeMode="cover" />
                </Pressable>
                <View style={styles.flex}>
                  <Text style={styles.bidDriver}>{e.executorName}</Text>
                  <Text style={styles.bidMeta}>
                    {svc.title}
                    {e.title ? ` · ${e.title}` : ""}
                  </Text>
                  <Text style={styles.bidMeta}>{summarizeSpecs(e.serviceKey, e.specs) || "без ТТХ"}</Text>
                  <View style={styles.rowGap}>
                    <Pressable style={styles.rejectButton} onPress={() => decideEq(e.id, false)}>
                      <Text style={styles.rejectButtonText}>Отклонить</Text>
                    </Pressable>
                    <Pressable style={styles.acceptButton} onPress={() => decideEq(e.id, true)}>
                      <Text style={styles.acceptButtonText}>Подтвердить</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </View>

      <Modal visible={Boolean(zoomPhoto)} transparent animationType="fade" onRequestClose={() => setZoomPhoto(null)}>
        <Pressable style={styles.photoZoomBackdrop} onPress={() => setZoomPhoto(null)}>
          {zoomPhoto ? <Image source={{ uri: zoomPhoto }} style={styles.photoZoomImage} resizeMode="contain" /> : null}
        </Pressable>
      </Modal>

      <AdminComplaintsPanel />

      <AdminOrdersFeed cities={catalog.cities} />

      <AdminTransactionsFeed />

      <AdminUsersPanel />

      <AdminCatalogPanel catalog={catalog} onChanged={onCatalogChanged} />
    </>
  );
}

function SchedulesCard() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchSchedules()
      .then((s) => {
        if (!cancelled) {
          setSchedules(s);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function cancel(id: string) {
    try {
      await deleteScheduleOnServer(id);
      setSchedules((cur) => cur.filter((s) => s.id !== id));
    } catch {
      // тихо
    }
  }

  return (
    <View style={ui.card}>
      <Text style={styles.panelTitle}>Регулярная доставка</Text>
      {schedules.length === 0 ? (
        <Text style={styles.panelSubtitle}>
          Нет подписок. Создайте заявку и выберите регулярность — она будет повторяться сама.
        </Text>
      ) : (
        schedules.map((s) => {
          const service = serviceByKey(s.service);
          return (
            <View key={s.id} style={styles.scheduleRow}>
              <View style={[styles.dot, { backgroundColor: service.accent }]} />
              <View style={styles.flex}>
                <Text style={styles.bidDriver}>
                  {service.title} · каждые {s.intervalDays} дн.
                </Text>
                <Text style={styles.bidMeta} numberOfLines={1}>
                  {s.from} · {rub.format(s.price)} ₽
                </Text>
              </View>
              <Pressable style={styles.rejectButton} onPress={() => cancel(s.id)}>
                <Text style={styles.rejectButtonText}>Отменить</Text>
              </Pressable>
            </View>
          );
        })
      )}
    </View>
  );
}

function ChatSection({ orderId, accountId }: { orderId: string; accountId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchMessages(orderId)
        .then((m) => {
          if (!cancelled) {
            setMessages(m);
          }
        })
        .catch(() => {});
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [orderId]);

  async function send() {
    const value = text.trim();
    if (!value || sending) {
      return;
    }
    setSending(true);
    setText("");
    try {
      const msg = await sendMessage(orderId, value);
      setMessages((cur) => [...cur, msg]);
    } catch {
      // не отправилось — вернём текст в поле, чтобы не потерять
      setText(value);
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.divBlock}>
      <Text style={ui.label}>Чат по заказу</Text>
      <View style={styles.chatBox}>
        {messages.length === 0 ? (
          <Text style={styles.empty}>Сообщений пока нет. Напишите первым.</Text>
        ) : (
          messages.map((m) => {
            const mine = m.fromId === accountId;
            return (
              <View key={m.id} style={[styles.msgRow, mine ? styles.msgRowMine : styles.msgRowTheir]}>
                <View style={[styles.msgBubble, mine ? styles.msgMine : styles.msgTheir]}>
                  <Text style={[styles.msgText, mine && styles.msgTextMine]}>{m.text}</Text>
                </View>
              </View>
            );
          })
        )}
      </View>
      <View style={styles.bidRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Сообщение…"
          placeholderTextColor={colors.inkFaint}
          style={[ui.input, styles.flex]}
          onSubmitEditing={send}
        />
        <Pressable style={styles.sendBtn} onPress={send}>
          <MaterialCommunityIcons name="send" size={18} color={colors.accentText} />
        </Pressable>
      </View>
    </View>
  );
}

function WalletCard({
  account,
  bidFee,
  onBalanceChange
}: {
  account: Account;
  bidFee: number;
  onBalanceChange: (balance: number) => void;
}) {
  const [balance, setBalance] = useState(account.balance ?? 0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [stats, setStats] = useState({ jobs: 0, earned: 0 });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchWallet()
      .then((w) => {
        if (!cancelled) {
          setBalance(w.balance);
          setTransactions(w.transactions);
        }
      })
      .catch(() => {});
    void fetchStats()
      .then((s) => {
        if (!cancelled) {
          setStats(s);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function topUp(amount: number) {
    setBusy(true);
    try {
      const w = await topUpWallet(amount);
      // ЮKassa: открываем оплату в браузере, баланс обновится по вебхуку.
      if (w.confirmationUrl) {
        await Linking.openURL(w.confirmationUrl);
      } else if (typeof w.balance === "number") {
        setBalance(w.balance);
        setTransactions(w.transactions);
        onBalanceChange(w.balance);
      }
    } catch {
      // тихо
    } finally {
      setBusy(false);
    }
  }

  async function withdrawAll() {
    if (balance <= 0) {
      return;
    }
    setBusy(true);
    try {
      const w = await withdrawWallet(balance);
      setBalance(w.balance);
      setTransactions(w.transactions);
      onBalanceChange(w.balance);
    } catch {
      // тихо
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={ui.card}>
      <View style={styles.rowBetween}>
        <View>
          <Text style={ui.label}>Баланс</Text>
          <View style={styles.balanceRow}>
            <CoinIcon size={22} />
            <Text style={styles.balanceValue}>{rub.format(balance)}</Text>
          </View>
          <Text style={styles.panelSubtitle}>≈ {rub.format(coinsToRub(balance))} ₽ · 1 монета = {COIN_RATE} ₽</Text>
        </View>
        <MaterialCommunityIcons name="wallet-outline" size={26} color={colors.inkSoft} />
      </View>
      <Text style={styles.panelSubtitle}>
        Монеты списываются за отклик в платных нишах. В остальных откликаться бесплатно.
      </Text>
      <View style={styles.pillRow}>
        {[300, 500, 1000].map((a) => (
          <Pressable
            key={a}
            style={[ui.pill, busy && styles.disabledBtn]}
            onPress={() => topUp(a)}
            disabled={busy}
          >
            <Text style={ui.pillText}>+{a} ₽</Text>
          </Pressable>
        ))}
        <Pressable
          style={[ui.pill, (busy || balance <= 0) && styles.disabledBtn]}
          onPress={withdrawAll}
          disabled={busy || balance <= 0}
        >
          <Text style={ui.pillText}>Вывести</Text>
        </Pressable>
      </View>

      <View style={styles.statsRow}>
        <Stat icon="check-circle-outline" value={String(stats.jobs)} label="выполнено" />
        <Stat icon="cash-multiple" value={`${rub.format(stats.earned)} ₽`} label="заработано" />
      </View>

      {transactions.length > 0 ? (
        <View style={styles.txList}>
          {transactions.slice(0, 5).map((t) => (
            <View key={t.id} style={styles.txRow}>
              <Text style={styles.txNote} numberOfLines={1}>
                {t.note}
              </Text>
              <Text style={[styles.txAmount, { color: t.amount < 0 ? colors.warning : colors.positive }]}>
                {t.amount > 0 ? "+" : ""}
                {rub.format(t.amount)} ₽
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <Text style={styles.locationNote}>Пополнение тестовое (без реальной оплаты).</Text>
    </View>
  );
}

function Stat({
  icon,
  value,
  label
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  value: string;
  label: string;
}) {
  return (
    <View style={styles.stat}>
      <MaterialCommunityIcons name={icon} size={16} color={colors.inkSoft} />
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function notifIcon(type: string): keyof typeof MaterialCommunityIcons.glyphMap {
  switch (type) {
    case "bid":
      return "hand-wave-outline";
    case "accepted":
      return "check-circle-outline";
    case "rejected":
      return "close-circle-outline";
    case "message":
      return "message-text-outline";
    case "finished":
      return "flag-checkered";
    case "confirmed":
      return "check-decagram-outline";
    case "review":
      return "star-outline";
    case "quick":
      return "clipboard-arrow-down-outline";
    case "offer_interest":
      return "eye-outline";
    case "verify":
      return "shield-check-outline";
    case "cancelled":
      return "cancel";
    case "enroute":
      return "truck-fast-outline";
    case "refund":
    case "topup":
    case "balance":
      return "wallet-outline";
    case "referral":
      return "gift-outline";
    case "reminder":
    case "schedule":
      return "clock-outline";
    case "complaint":
      return "alert-octagon-outline";
    default:
      return "bell-outline";
  }
}

function statusLabel(status: Order["status"]) {
  switch (status) {
    case "open":
      return "открыта";
    case "matched":
      return "в работе";
    case "enroute":
      return "в пути";
    case "finished":
      return "ждёт подтверждения";
    case "cancelled":
      return "отменена";
    default:
      return "выполнена";
  }
}

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return one;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return few;
  }
  return many;
}

function tint(hex: string) {
  return `${hex}18`;
}

// Формат телефона: +7 (XXX) XXX-XX-XX по мере ввода.
function formatPhone(input: string) {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("8")) {
    digits = "7" + digits.slice(1);
  }
  if (!digits.startsWith("7")) {
    digits = "7" + digits;
  }
  digits = digits.slice(0, 11);
  const d = digits.slice(1); // без ведущей 7
  let out = "+7";
  if (d.length > 0) out += " (" + d.slice(0, 3);
  if (d.length >= 3) out += ") " + d.slice(3, 6);
  if (d.length >= 6) out += "-" + d.slice(6, 8);
  if (d.length >= 8) out += "-" + d.slice(8, 10);
  return out;
}

// Telegram-ник под стандарт @...
function formatTelegram(input: string) {
  const handle = input.replace(/[^a-zA-Z0-9_]/g, "");
  return handle ? "@" + handle : "";
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1, flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowCenter: { flexDirection: "row", alignItems: "center", gap: 12 },
  header: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  kicker: {
    color: colors.inkFaint,
    fontSize: 11,
    textTransform: "uppercase",
    fontWeight: "700",
    letterSpacing: 0.4
  },
  title: { color: colors.ink, fontSize: 28, fontWeight: "800" },
  accountChip: {
    maxWidth: 150,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  accountChipText: { color: colors.ink, fontSize: 13, fontWeight: "700", flexShrink: 1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  bellBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center"
  },
  bellBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.favorite,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4
  },
  bellBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  notifRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line
  },
  notifText: { flex: 1, color: colors.ink, fontSize: 14 },
  topControls: { paddingHorizontal: 18, gap: 8, paddingBottom: 10 },
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    padding: 4,
    position: "relative"
  },
  segPill: {
    position: "absolute",
    top: 4,
    bottom: 4,
    left: 0,
    borderRadius: 999,
    backgroundColor: colors.surface
  },
  segmentButton: {
    flex: 1,
    minHeight: 38,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6
  },
  segmentText: { color: colors.inkSoft, fontSize: 13, fontWeight: "700" },
  segmentTextActive: { color: colors.ink },
  content: { paddingHorizontal: 18, paddingBottom: 32, gap: 16 },
  panelTitle: { color: colors.ink, fontSize: 18, fontWeight: "800" },
  panelSubtitle: { color: colors.inkSoft, fontSize: 13, marginTop: 2 },
  serviceRow: { gap: 8, paddingVertical: 2 },
  serviceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 2 },
  categoryRow: { gap: 8, paddingVertical: 2, paddingRight: 8 },
  categoryTab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.line
  },
  categoryTabActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  categoryTabText: { color: colors.inkSoft, fontSize: 13, fontWeight: "700" },
  categoryTabTextActive: { color: colors.accentText },
  serviceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 9
  },
  serviceChipText: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  megaSelect: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    borderRadius: radius - 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 6
  },
  megaSelectText: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  megaMenu: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    borderRadius: radius - 4,
    overflow: "hidden"
  },
  megaOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 13
  },
  megaOptionDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  megaOptionText: { color: colors.inkSoft, fontSize: 15, fontWeight: "700" },
  megaOptionTextActive: { color: colors.ink, fontWeight: "800" },
  svcList: { gap: 8, paddingVertical: 2 },
  svcRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    borderRadius: radius - 4,
    paddingHorizontal: 12,
    paddingVertical: 11
  },
  svcIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  svcTitle: { color: colors.ink, fontSize: 15, fontWeight: "700" },
  svcSub: { color: colors.inkSoft, fontSize: 12, marginTop: 2 },
  specGroupTitle: { color: colors.inkSoft, fontSize: 12, fontWeight: "700", marginTop: 4 },
  portfolioItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius - 4,
    padding: 12
  },
  portfolioTitle: { color: colors.ink, fontSize: 14, fontWeight: "700" },
  portfolioLink: { color: colors.inkFaint, fontSize: 12, marginTop: 2 },
  equipAction: { padding: 2 },
  equipField: { gap: 6 },
  equipButtons: { flexDirection: "row", gap: 8, alignItems: "center" },
  equipIcon: { marginTop: 2 },
  equipPublished: { color: colors.positive, fontSize: 12, fontWeight: "700", marginTop: 3 },
  equipPublishRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  equipThumb: { width: 54, height: 54, borderRadius: radius - 6, backgroundColor: colors.surfaceMuted },
  equipVerified: { color: colors.verified, fontSize: 12, fontWeight: "700", marginTop: 3 },
  equipPending: { color: colors.inkSoft, fontSize: 12, fontWeight: "600", marginTop: 3 },
  equipStsLink: { color: colors.accent, fontSize: 12, fontWeight: "700", marginTop: 3 },
  offerPhoto: { width: "100%", height: 170, borderRadius: radius - 4, backgroundColor: colors.surfaceMuted, marginBottom: 10 },
  offerVerifyBadge: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  offerVerifyText: { color: colors.verified, fontSize: 12, fontWeight: "700" },
  offerPriceSoft: { color: colors.inkSoft, fontWeight: "700", fontSize: 13 },
  offerRequestBtn: { marginTop: 12 },
  offerContactRowGap: {},
  offerComplain: { color: colors.inkFaint, fontSize: 12, marginTop: 10, textAlign: "center" },
  offerStatusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  offerStatusText: { color: colors.inkSoft, fontSize: 12, fontWeight: "600" },
  reqMark: { color: colors.warning, fontSize: 11, fontWeight: "700" },
  verifiedFilter: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, alignSelf: "flex-start" },
  offerHead: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  offerPrice: { color: colors.ink, fontWeight: "800" },
  offerExecRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  offerExecName: { color: colors.ink, fontSize: 13, fontWeight: "700", flexShrink: 1 },
  offerRating: { color: colors.star, fontSize: 13, fontWeight: "700", marginLeft: "auto" },
  offerNote: { color: colors.inkSoft, fontSize: 13, marginTop: 8 },
  offerContactRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  analyticsRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 5 },
  analyticsLabel: { color: colors.ink, fontSize: 13, fontWeight: "700", width: 96 },
  analyticsBar: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceMuted,
    overflow: "hidden"
  },
  analyticsBarFill: { height: "100%", backgroundColor: colors.ink, borderRadius: 4 },
  analyticsCount: { color: colors.inkSoft, fontSize: 13, fontWeight: "700", minWidth: 28, textAlign: "right" },
  analyticsMoney: { color: colors.ink, fontSize: 12, fontWeight: "700", minWidth: 84, textAlign: "right" },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metricCard: {
    flexGrow: 1,
    flexBasis: "47%",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius - 4,
    padding: 12,
    gap: 2
  },
  metricValue: { color: colors.ink, fontSize: 18, fontWeight: "800" },
  metricLabel: { color: colors.inkSoft, fontSize: 12, fontWeight: "700" },
  metricSub: { color: colors.inkFaint, fontSize: 11, fontWeight: "600" },
  cellRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 5 },
  cellMeta: { color: colors.inkFaint, fontSize: 11, fontWeight: "600", marginTop: 2 },
  deficitBox: { backgroundColor: colors.warningBg, borderRadius: radius - 4, padding: 12 },
  savedNote: { color: colors.positive, fontSize: 13, fontWeight: "700" },
  iconChoice: {
    width: 46,
    height: 46,
    borderRadius: radius - 6,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center"
  },
  colorSwatch: { width: 46, height: 46, borderRadius: radius - 6, borderWidth: 1, borderColor: colors.line },
  photoPreview: { width: "100%", height: 180, borderRadius: radius - 4, backgroundColor: colors.surfaceMuted },
  portfolioPhoto: { width: "100%", height: 160, borderRadius: radius - 6, backgroundColor: colors.surfaceMuted, marginTop: 6 },
  verifRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  verifRowText: { color: colors.ink, fontSize: 13, fontWeight: "600", flex: 1 },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.positive,
    backgroundColor: colors.positiveBg,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  verifiedBadgeText: { color: colors.positive, fontSize: 12, fontWeight: "700" },
  verifAdminCard: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line
  },
  verifThumb: { width: 72, height: 72, borderRadius: radius - 6, backgroundColor: colors.surfaceMuted },
  rowGap: { flexDirection: "row", gap: 8, marginTop: 8 },
  photoZoomBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.9)", alignItems: "center", justifyContent: "center", padding: 16 },
  photoZoomImage: { width: "100%", height: "80%" },
  pricingRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  pricingService: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: "600" },
  pricingInput: {
    width: 64,
    minHeight: 40,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius - 6,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 10,
    color: colors.ink,
    fontSize: 14,
    textAlign: "center"
  },
  pricingUnit: { color: colors.inkFaint, fontSize: 12, fontWeight: "600" },
  coin: {
    backgroundColor: colors.coinBg,
    borderColor: "#B4832A",
    alignItems: "center",
    justifyContent: "center"
  },
  coinText: { color: colors.coinText, fontWeight: "900" },
  balanceRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  bidFeeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  repeatCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    marginBottom: 12
  },
  repeatIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  repeatKicker: { color: colors.inkFaint, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  repeatSubtitle: { color: colors.ink, fontSize: 14, fontWeight: "700", marginTop: 3 },
  repeatPrice: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  seasonCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius,
    padding: 14,
    marginBottom: 12
  },
  favExecChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  favCallText: { color: colors.positive, fontSize: 12, fontWeight: "800" },
  referralCodeBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius - 4,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  referralCode: { color: colors.ink, fontSize: 20, fontWeight: "900", letterSpacing: 2 },
  legalLinks: { alignItems: "center", gap: 6, paddingVertical: 4 },
  legalLink: { color: colors.inkSoft, fontSize: 13, fontWeight: "600", textDecorationLine: "underline" },
  placeRow: { gap: 8, paddingVertical: 2, marginBottom: 8 },
  placeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 12,
    paddingVertical: 7,
    maxWidth: 160
  },
  placeChipText: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  placeManageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.line
  },
  savePlaceLink: { flexDirection: "row", alignItems: "center", gap: 4 },
  savePlaceText: { color: colors.ink, fontSize: 12, fontWeight: "700" },
  reachBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius - 4,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  reachText: { flex: 1, color: colors.inkSoft, fontSize: 13, fontWeight: "600", lineHeight: 18 },
  centerModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24
  },
  centerModalCard: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: radius,
    padding: 20,
    gap: 12
  },
  driverIntro: { flexDirection: "row", alignItems: "center", gap: 12 },
  driverIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center"
  },
  suggestBox: {
    marginTop: 6,
    borderRadius: radius - 4,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    overflow: "hidden"
  },
  suggestRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 11 },
  suggestDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  suggestText: { flex: 1, color: colors.ink, fontSize: 14 },
  locationRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  locationBtn: {
    minHeight: 46,
    borderRadius: radius - 4,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8
  },
  locationBtnText: { color: colors.ink, fontSize: 14, fontWeight: "600" },
  locationNote: { color: colors.inkFaint, fontSize: 12, marginTop: 6 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: "800" },
  sectionMeta: { color: colors.inkFaint, fontSize: 14, fontWeight: "800" },
  separator: { height: 10 },
  orderCard: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  orderTitle: { color: colors.ink, fontSize: 16, fontWeight: "800" },
  orderPrice: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  orderAddress: { color: colors.inkSoft, fontSize: 13, marginTop: 4 },
  workingRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6 },
  workingText: { color: colors.positive, fontSize: 12, fontWeight: "700", flex: 1 },
  orderFooter: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 8 },
  orderMeta: { color: colors.inkFaint, fontSize: 12, fontWeight: "600" },
  badge: { borderRadius: 999, backgroundColor: colors.surfaceMuted, paddingHorizontal: 10, paddingVertical: 3, marginLeft: "auto" },
  badgeMatched: { backgroundColor: colors.positiveBg },
  badgeText: { color: colors.inkSoft, fontSize: 11, fontWeight: "700" },
  badgeTextMatched: { color: colors.positive },
  alertBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    backgroundColor: colors.ink,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginLeft: "auto"
  },
  alertText: { color: colors.accentText, fontSize: 11, fontWeight: "800" },
  details: { color: colors.ink, fontSize: 15, lineHeight: 21 },
  statsRow: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, minHeight: 70, borderRadius: 12, backgroundColor: colors.surfaceMuted, padding: 10, justifyContent: "space-between" },
  statValue: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  statLabel: { color: colors.inkFaint, fontSize: 11, fontWeight: "600" },
  divBlock: { gap: 8, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 14 },
  bidRow: { flexDirection: "row", gap: 8 },
  etaInput: { width: 110 },
  chatBox: {
    maxHeight: 240,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    padding: 10,
    gap: 6
  },
  msgRow: { flexDirection: "row" },
  msgRowMine: { justifyContent: "flex-end" },
  msgRowTheir: { justifyContent: "flex-start" },
  msgBubble: { maxWidth: "80%", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  msgMine: { backgroundColor: colors.ink, borderBottomRightRadius: 4 },
  msgTheir: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderBottomLeftRadius: 4 },
  msgText: { color: colors.ink, fontSize: 14 },
  msgTextMine: { color: colors.accentText },
  sendBtn: {
    width: 48,
    borderRadius: radius - 4,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center"
  },
  bidsList: { gap: 8 },
  bidCard: {
    minHeight: 60,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  bidCardBest: { borderColor: colors.ink, borderWidth: 2, backgroundColor: colors.surfaceMuted },
  bidNameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  bidDriver: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  bidDriverLink: { textDecorationLine: "underline" },
  bidMeta: { color: colors.inkSoft, fontSize: 12, marginTop: 3 },
  bidStatsRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4, flexWrap: "wrap" },
  bidStat: { flexDirection: "row", alignItems: "center", gap: 3 },
  bidStatText: { color: colors.ink, fontSize: 12, fontWeight: "700" },
  bidVerifText: { color: colors.positive, fontSize: 12, fontWeight: "700" },
  bestBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: colors.ink,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2
  },
  bestBadgeText: { color: colors.accentText, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  bidSide: { alignItems: "flex-end", gap: 6 },
  bidPrice: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  bidActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  acceptButton: { backgroundColor: colors.ink, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  acceptButtonText: { color: colors.accentText, fontSize: 12, fontWeight: "800" },
  rejectButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  rejectButtonText: { color: colors.inkSoft, fontSize: 12, fontWeight: "800" },
  removeLink: { color: colors.warning, fontSize: 13, fontWeight: "700", textAlign: "center", paddingVertical: 4 },
  empty: { color: colors.inkFaint, fontSize: 14, paddingVertical: 8 },
  contactCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceMuted,
    padding: 12,
    gap: 2
  },
  contactName: { color: colors.ink, fontSize: 16, fontWeight: "800" },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  contactLine: { color: colors.inkSoft, fontSize: 14 },
  starRow: { flexDirection: "row", gap: 6, paddingVertical: 4 },
  doneBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.positiveBg,
    borderRadius: 12,
    padding: 12
  },
  doneText: { color: colors.positive, fontSize: 14, fontWeight: "700", flex: 1 },
  enrouteBanner: { backgroundColor: colors.warningBg },
  enrouteMap: { height: 220, borderRadius: radius - 4, overflow: "hidden", marginTop: 4 },
  enrouteMapHint: { position: "absolute", bottom: 8, left: 8, backgroundColor: colors.surface, color: colors.inkSoft, fontSize: 12, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  profileWrap: { gap: 16 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" },
  avatarImg: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surfaceMuted },
  avatarEditBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.surface
  },
  avatarHint: { color: colors.inkFaint, fontSize: 11, marginTop: 2 },
  avatarRemove: { color: colors.warning, fontSize: 11, fontWeight: "700" },
  avatarText: { color: colors.accentText, fontSize: 20, fontWeight: "800" },
  ratingPill: { flexDirection: "row", alignItems: "center", gap: 6 },
  ratingText: { color: colors.ink, fontSize: 14, fontWeight: "700" },
  verifiedRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  verifiedText: { color: colors.positive, fontSize: 13, fontWeight: "600", flex: 1 },
  scheduleRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  adminRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line
  },
  adminUserRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line },
  adminUserName: { color: colors.ink, fontSize: 14, fontWeight: "700" },
  adminUserMeta: { color: colors.inkFaint, fontSize: 12, marginTop: 2 },
  balanceValue: { color: colors.ink, fontSize: 26, fontWeight: "800", marginTop: 2 },
  txList: { gap: 6, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10 },
  txRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  txNote: { flex: 1, color: colors.inkSoft, fontSize: 13 },
  txAmount: { fontSize: 13, fontWeight: "800" },
  syncBar: {
    minHeight: 38,
    borderRadius: 12,
    backgroundColor: colors.positiveBg,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  syncOffline: { backgroundColor: colors.warningBg },
  syncText: { color: colors.inkSoft, fontSize: 12, fontWeight: "600", flex: 1 },
  pillRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  pillWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  selectButton: {
    minHeight: 48,
    borderRadius: radius - 4,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  selectButtonText: { flex: 1, color: colors.ink, fontSize: 15, fontWeight: "600" },
  specChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 9
  },
  specChipText: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  mapScreen: { flex: 1, paddingHorizontal: 18, paddingBottom: 18, gap: 10 },
  pickerSheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    height: "85%",
    paddingBottom: 12
  },
  pickerHint: { color: colors.inkSoft, fontSize: 13, paddingHorizontal: 18, paddingBottom: 8 },
  pickerMap: { flex: 1, marginHorizontal: 18, borderRadius: radius, overflow: "hidden" },
  pickerFooter: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingTop: 12 },
  pickerCoords: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: "700" },
  pickerConfirm: { paddingHorizontal: 28 },
  disabledBtn: { opacity: 0.5 },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 18,
    paddingHorizontal: 14,
    borderRadius: radius - 4,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    minHeight: 48
  },
  searchInput: { flex: 1, color: colors.ink, fontSize: 15 },
  cityList: { marginTop: 10, paddingHorizontal: 18 },
  cityOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    gap: 10
  },
  cityOptionName: { color: colors.ink, fontSize: 16, fontWeight: "700" },
  cityOptionRegion: { color: colors.inkFaint, fontSize: 13, marginTop: 2 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(20,20,20,0.35)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: "90%", paddingBottom: 8 },
  modalHandleRow: { alignItems: "center", paddingTop: 8 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 4
  },
  modalTitle: { color: colors.ink, fontSize: 18, fontWeight: "800" },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center"
  },
  modalContent: { padding: 18, paddingTop: 10 }
});
