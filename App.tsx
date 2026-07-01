import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  acceptBid as acceptBidOnServer,
  apiBaseUrl,
  ApiError,
  confirmOrder as confirmOrderOnServer,
  createBid,
  createOrder as createOrderOnServer,
  createSchedule as createScheduleOnServer,
  decideVerification,
  deleteOrder as deleteOrderOnServer,
  deleteSchedule as deleteScheduleOnServer,
  fetchBourse,
  fetchCatalog,
  fetchConfig,
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
  updateProfile,
  verifyAccount,
  withdrawWallet
} from "./src/api";
import type { GeocodeResult } from "./src/api";
import { AuthScreen } from "./src/AuthScreen";
import { fallbackCatalog, serviceByKey, setServiceRegistry } from "./src/catalog";
import { formatKm, getCurrentPosition, haversineKm } from "./src/geo";
import { MapView } from "./src/MapView";
import { getPushToken } from "./src/push";
import { clearToken, loadToken, saveToken } from "./src/storage";
import { colors, radius, ui } from "./src/theme";
import {
  Account,
  AuthResponse,
  Catalog,
  City,
  Order,
  Role,
  Message,
  Notification,
  Schedule,
  Service,
  ServiceKey,
  Transaction,
  ViewMode,
  Wallet
} from "./src/types";

// Форматирование без Intl (на Hermes/Android Intl ограничен и может падать).
const rub = {
  format(value: number) {
    return Math.round(value)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }
};

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
  const [bidFee, setBidFee] = useState(0);
  const [bidPercent, setBidPercent] = useState(0);
  const [bidError, setBidError] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);

  const currentCity = catalog.cities.find((city) => city.id === cityId) ?? catalog.cities[0];
  const cityServices = useMemo(
    () => catalog.services.filter((service) => currentCity?.services.includes(service.key)),
    [catalog.services, currentCity]
  );
  const selectedServiceData = serviceByKey(selectedService);
  const detailOrder = orders.find((order) => order.id === detailId);

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

  // Избранные исполнители (для заказчика).
  useEffect(() => {
    if (account?.role === "client") {
      void fetchFavorites().then(setFavorites).catch(() => {});
    } else {
      setFavorites([]);
    }
  }, [account]);

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

  async function createOrder(repeatDays = 0) {
    const numericPrice = Number(price.replace(/\D/g, ""));
    if (!from.trim() || !details.trim() || !numericPrice || !currentCity) {
      return;
    }
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
    } catch {
      setServerState("offline");
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

  async function sendBid(orderId: string, bidPrice: number, eta: string) {
    setBidError("");
    try {
      const bid = await createBid(orderId, { price: bidPrice, eta });
      setOrders((current) =>
        current.map((order) =>
          order.id === orderId ? { ...order, bids: [bid, ...order.bids] } : order
        )
      );
      // если была плата за отклик — обновим баланс в профиле
      if (bidFee > 0 && account) {
        setAccount((current) => (current ? { ...current, balance: (current.balance ?? 0) - bidFee } : current));
      }
      setServerState("sync");
    } catch (e) {
      if (e instanceof ApiError && (e.status === 402 || e.status === 409)) {
        setBidError(e.message);
      } else {
        setServerState("offline");
      }
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

  async function saveProfile(next: {
    name: string;
    role: Role;
    cityId: string;
    phone: string;
    telegram: string;
    services: ServiceKey[];
    radiusKm: number;
    available: boolean;
  }) {
    if (!account) {
      return;
    }
    try {
      const updated = await updateProfile(next);
      applyAccount(updated);
      setServerState("sync");
      setViewMode("orders");
    } catch {
      setServerState("offline");
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
          { id: "orders", label: "Заявки" },
          { id: "map", label: "Карта" },
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
              <AdminScreen />
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
                onLogout={handleLogout}
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
              {role === "client" ? (
                <CreateOrderPanel
                  services={cityServices}
                  selectedService={selectedService}
                  onSelectService={setSelectedService}
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
                      bidFee={bidFee + Math.round((detailOrder.price * bidPercent) / 100)}
                      bidError={bidError}
                      favorites={favorites}
                      onToggleFavorite={toggleFavorite}
                      onAcceptBid={(bidId) => chooseBid(detailOrder.id, bidId)}
                      onRejectBid={(bidId) => rejectBid(detailOrder.id, bidId)}
                      onSendBid={(p, eta) => sendBid(detailOrder.id, p, eta)}
                      onDelete={() => removeOrder(detailOrder.id)}
                      onFinish={() => executorFinish(detailOrder.id)}
                      onConfirm={() => clientConfirm(detailOrder.id)}
                      onReview={(rating, text) => submitReview(detailOrder.id, rating, text)}
                      onRepeat={() => repeatOrder(detailOrder)}
                    />
                  ) : null}
                </ScrollView>
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
                          // Переходим на вкладку, где живёт этот заказ, и открываем его.
                          // Исполнителю принятые/рабочие заказы — в «Заказах».
                          if (role === "driver" && n.type !== "bid") {
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

function CreateOrderPanel({
  services,
  selectedService,
  onSelectService,
  service,
  cityName,
  cityId,
  from,
  details,
  price,
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
  selectedService: ServiceKey;
  onSelectService: (key: ServiceKey) => void;
  service: Service;
  cityName: string;
  cityId: string;
  from: string;
  details: string;
  price: string;
  onChangeFrom: (value: string) => void;
  onSelectSuggestion: (item: GeocodeResult) => void;
  onChangeDetails: (value: string) => void;
  onChangePrice: (value: string) => void;
  onSubmit: (repeatDays: number) => void;
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
  const [repeatDays, setRepeatDays] = useState(0);
  const skipNextRef = useRef(false);

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

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.serviceRow}>
        {services.map((item) => {
          const active = item.key === selectedService;
          return (
            <Pressable
              key={item.key}
              onPress={() => onSelectService(item.key)}
              style={[styles.serviceChip, active && { borderColor: item.accent, backgroundColor: tint(item.accent) }]}
            >
              <MaterialCommunityIcons name={item.icon} size={20} color={item.accent} />
              <Text style={styles.serviceChipText}>{item.title}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={ui.inputGroup}>
        <Text style={ui.label}>Адрес</Text>
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
            {suggestions.map((item, index) => (
              <Pressable
                key={`${item.lat},${item.lng},${index}`}
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
          <Pressable onPress={onClearLocation}>
            <Text style={styles.locationNote}>Сбросить точку</Text>
          </Pressable>
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
      </View>

      <View style={ui.inputGroup}>
        <Text style={ui.label}>Регулярность</Text>
        <View style={styles.pillWrap}>
          {repeatOptions.map((opt) => (
            <Pressable
              key={opt.days}
              onPress={() => setRepeatDays(opt.days)}
              style={[ui.pill, repeatDays === opt.days && ui.pillActive]}
            >
              <Text style={[ui.pillText, repeatDays === opt.days && ui.pillTextActive]}>
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
        {repeatDays > 0 ? (
          <Text style={styles.locationNote}>
            Заявка будет повторяться автоматически. Управлять — в профиле.
          </Text>
        ) : null}
      </View>

      <Pressable style={ui.primaryButton} onPress={() => onSubmit(repeatDays)}>
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
  onRepeat
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
  onSendBid: (price: number, eta: string) => void;
  onDelete: () => void;
  onFinish: () => void;
  onConfirm: () => void;
  onReview: (rating: number, text: string) => void;
  onRepeat: () => void;
}) {
  const service = serviceByKey(order.service);
  const [bidPrice, setBidPrice] = useState("");
  const [bidEta, setBidEta] = useState("40 мин");
  const [stars, setStars] = useState(5);
  const [reviewText, setReviewText] = useState("");

  const alreadyBid = order.bids.some((bid) => bid.driverId === accountId);
  const canBid = role === "driver" && order.status === "open" && !alreadyBid;

  function submitBid() {
    const numeric = Number(bidPrice.replace(/\D/g, ""));
    if (!numeric) {
      return;
    }
    onSendBid(numeric, bidEta.trim() || "40 мин");
    setBidPrice("");
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
        <ContactCard title="Исполнитель" person={order.executor} />
      ) : null}
      {order.status !== "open" && role === "driver" && order.customer ? (
        <ContactCard title="Заказчик" person={order.customer} />
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
            <Text style={styles.locationNote}>Отклик платный: {bidFee} ₽ спишется с баланса.</Text>
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

      {/* Заказчик: отклики и выбор */}
      {role === "client" && order.status === "open" ? (
        <View style={styles.bidsList}>
          <Text style={ui.label}>Отклики исполнителей</Text>
          {order.bids.length === 0 ? (
            <Text style={styles.empty}>Пока нет откликов</Text>
          ) : (
            order.bids.map((bid) => (
              <View key={bid.id} style={styles.bidCard}>
                <Pressable hitSlop={6} onPress={() => onToggleFavorite(bid.driverId ?? "")}>
                  <MaterialCommunityIcons
                    name={bid.driverId && favorites.includes(bid.driverId) ? "heart" : "heart-outline"}
                    size={20}
                    color={bid.driverId && favorites.includes(bid.driverId) ? "#C7503A" : colors.inkFaint}
                  />
                </Pressable>
                <View style={styles.flex}>
                  <View style={styles.bidNameRow}>
                    <Text style={styles.bidDriver}>{bid.driver}</Text>
                    {bid.verified ? (
                      <MaterialCommunityIcons name="check-decagram" size={15} color="#2E7D5B" />
                    ) : null}
                  </View>
                  <Text style={styles.bidMeta}>
                    {bid.eta} · ★ {bid.rating ? bid.rating.toFixed(1) : "—"}
                  </Text>
                </View>
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
            ))
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
          <Text style={styles.doneText}>Исполнитель в работе. Кнопка подтверждения появится, когда он завершит.</Text>
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
          <MaterialCommunityIcons name="check-decagram" size={16} color="#2E7D5B" />
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
            color={n <= value ? "#E0A93B" : colors.inkFaint}
          />
        </Pressable>
      ))}
    </View>
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
  onBalanceChange
}: {
  account: Account;
  catalog: Catalog;
  serverState: "sync" | "offline";
  devMode: boolean;
  bidFee: number;
  bidPercent: number;
  onToggleDev: (value: boolean) => void;
  onSave: (next: {
    name: string;
    role: Role;
    cityId: string;
    phone: string;
    telegram: string;
    services: ServiceKey[];
    radiusKm: number;
    available: boolean;
  }) => void;
  onSaveConfig: (fee: number, percent: number) => void;
  onVerify: () => void;
  onLogout: () => void;
  onBalanceChange: (balance: number) => void;
}) {
  const [name, setName] = useState(account.name);
  const [phone, setPhone] = useState(account.phone ?? "");
  const [telegram, setTelegram] = useState(account.telegram ?? "");
  const [role, setRole] = useState<Role>(account.role);
  const [cityId, setCityId] = useState(account.cityId);
  const [services, setServices] = useState<ServiceKey[]>(account.services ?? []);
  const [available, setAvailable] = useState(account.available ?? true);
  const [radiusInput, setRadiusInput] = useState(String(account.radiusKm ?? 0));
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const [feeInput, setFeeInput] = useState(String(bidFee));
  const [percentInput, setPercentInput] = useState(String(bidPercent));

  const city = catalog.cities.find((c) => c.id === cityId);
  const rating = account.rating ?? 0;

  function toggleService(key: ServiceKey) {
    setServices((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
    );
  }

  return (
    <View style={styles.profileWrap}>
      <View style={ui.card}>
        <View style={styles.rowCenter}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{account.name.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.panelTitle}>{account.name}</Text>
            <Text style={styles.panelSubtitle}>{account.email}</Text>
          </View>
        </View>
        <View style={styles.ratingPill}>
          <MaterialCommunityIcons name="star" size={16} color="#E0A93B" />
          <Text style={styles.ratingText}>
            {rating > 0 ? `${rating.toFixed(1)} · ${account.ratingCount} ${plural(account.ratingCount ?? 0, "отзыв", "отзыва", "отзывов")}` : "пока нет отзывов"}
          </Text>
        </View>
        <View style={[styles.syncBar, serverState === "offline" && styles.syncOffline]}>
          <MaterialCommunityIcons
            name={serverState === "sync" ? "cloud-check-outline" : "cloud-off-outline"}
            size={16}
            color={serverState === "sync" ? colors.positive : colors.warning}
          />
          <Text style={styles.syncText}>
            {serverState === "sync" ? `На связи · ${apiBaseUrl}` : "Сервер недоступен"}
          </Text>
        </View>
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
            <View style={styles.pillWrap}>
              {catalog.services.map((s) => {
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

            <View style={ui.inputGroup}>
              <Text style={ui.label}>Верификация</Text>
              {account.verified ? (
                <View style={styles.verifiedRow}>
                  <MaterialCommunityIcons name="check-decagram" size={18} color="#2E7D5B" />
                  <Text style={styles.verifiedText}>Аккаунт проверен — заказчики видят значок.</Text>
                </View>
              ) : account.verifyStatus === "pending" ? (
                <View style={styles.verifiedRow}>
                  <MaterialCommunityIcons name="progress-clock" size={18} color={colors.inkSoft} />
                  <Text style={styles.verifiedText}>Заявка на проверке у модератора.</Text>
                </View>
              ) : (
                <Pressable style={ui.ghostButton} onPress={onVerify}>
                  <MaterialCommunityIcons name="shield-check-outline" size={18} color={colors.ink} />
                  <Text style={ui.ghostButtonText}>
                    {account.verifyStatus === "rejected" ? "Отклонено — подать снова" : "Пройти верификацию"}
                  </Text>
                </Pressable>
              )}
            </View>
          </>
        ) : null}

        <Pressable
          style={ui.primaryButton}
          onPress={() =>
            onSave({
              name,
              role,
              cityId,
              phone,
              telegram,
              services,
              radiusKm: Math.max(0, Math.round(Number(radiusInput) || 0)),
              available
            })
          }
        >
          <MaterialCommunityIcons name="check" size={18} color={colors.accentText} />
          <Text style={ui.primaryButtonText}>Сохранить</Text>
        </Pressable>
      </View>

      {role === "driver" ? (
        <WalletCard account={account} bidFee={bidFee} onBalanceChange={onBalanceChange} />
      ) : null}

      {role === "client" ? <SchedulesCard /> : null}

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
            <Text style={ui.label}>Монетизация (dev)</Text>
            <View style={styles.bidRow}>
              <View style={styles.flex}>
                <Text style={styles.locationNote}>Цена отклика, ₽</Text>
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
                Math.round((4000 * (Number(percentInput) || 0)) / 100)} ₽. 0/0 — бесплатно.
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

function AdminScreen() {
  const [pending, setPending] = useState<Account[]>([]);
  const [users, setUsers] = useState<Account[]>([]);

  const load = useCallback(async () => {
    try {
      const [p, u] = await Promise.all([fetchPendingVerifications(), fetchUsers()]);
      setPending(p);
      setUsers(u);
    } catch {
      // нет прав / сеть
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, approve: boolean) {
    try {
      await decideVerification(id, approve);
      void load();
    } catch {
      // тихо
    }
  }

  return (
    <>
      <View style={ui.card}>
        <Text style={styles.panelTitle}>Заявки на верификацию</Text>
        {pending.length === 0 ? (
          <Text style={styles.panelSubtitle}>Нет заявок на модерации.</Text>
        ) : (
          pending.map((u) => (
            <View key={u.id} style={styles.adminRow}>
              <View style={styles.flex}>
                <Text style={styles.bidDriver}>{u.name}</Text>
                <Text style={styles.bidMeta}>
                  {u.phone || u.email} · {(u.services ?? []).join(", ") || "услуги не указаны"}
                </Text>
              </View>
              <Pressable style={styles.rejectButton} onPress={() => decide(u.id ?? "", false)}>
                <Text style={styles.rejectButtonText}>Отклонить</Text>
              </Pressable>
              <Pressable style={styles.acceptButton} onPress={() => decide(u.id ?? "", true)}>
                <Text style={styles.acceptButtonText}>Одобрить</Text>
              </Pressable>
            </View>
          ))
        )}
      </View>

      <View style={ui.card}>
        <Text style={styles.panelTitle}>Пользователи ({users.length})</Text>
        {users.slice(0, 50).map((u) => (
          <View key={u.id} style={styles.adminUserRow}>
            <Text style={styles.adminUserName} numberOfLines={1}>
              {u.verified ? "✓ " : ""}
              {u.name}
            </Text>
            <Text style={styles.adminUserMeta} numberOfLines={1}>
              {u.role === "driver" ? "исполнитель" : "заказчик"} · {u.phone || u.email}
            </Text>
          </View>
        ))}
      </View>
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
    if (!value) {
      return;
    }
    setText("");
    try {
      const msg = await sendMessage(orderId, value);
      setMessages((cur) => [...cur, msg]);
    } catch {
      // тихо
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
      setBalance(w.balance);
      setTransactions(w.transactions);
      onBalanceChange(w.balance);
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
          <Text style={styles.balanceValue}>{rub.format(balance)} ₽</Text>
        </View>
        <MaterialCommunityIcons name="wallet-outline" size={26} color={colors.inkSoft} />
      </View>
      <Text style={styles.panelSubtitle}>
        {bidFee > 0
          ? `Отклик стоит ${bidFee} ₽ — пополняйте баланс, чтобы откликаться на заказы.`
          : "Сейчас отклики бесплатны. Баланс понадобится, когда включится плата за отклик."}
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
    case "finished":
      return "ждёт подтверждения";
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
    backgroundColor: "#C7503A",
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
  bidNameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  bidDriver: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  bidMeta: { color: colors.inkSoft, fontSize: 12, marginTop: 3 },
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
  profileWrap: { gap: 16 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" },
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
