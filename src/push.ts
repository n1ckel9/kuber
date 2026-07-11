import Constants from "expo-constants";
import { Platform } from "react-native";

// Получить Expo push-токен. Только на устройстве (native); на web и при любой
// ошибке возвращает null. expo-notifications импортируется динамически, чтобы
// не влиять на web-сборку. Для боевых пушей нужен dev/prod build (в Expo Go
// поддержка ограничена).
export async function getPushToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    return null;
  }
  try {
    const Notifications = await import("expo-notifications");
    // Показывать уведомление, даже когда приложение открыто (иначе в foreground молчит).
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        // старые версии SDK ждут это поле — вреда нет:
        shouldShowAlert: true
      })
    });
    let status = (await Notifications.getPermissionsAsync()).status;
    if (status !== "granted") {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== "granted") {
      return null;
    }
    // projectId нужен для получения Expo push-токена в собранном приложении.
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
    const token = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return token?.data ?? null;
  } catch {
    return null;
  }
}

// Подписка на тап по push-уведомлению: открываем нужный заказ (orderId из payload).
// Возвращает функцию отписки. На web — no-op.
export async function onNotificationTap(cb: (orderId: string) => void): Promise<() => void> {
  if (Platform.OS === "web") {
    return () => {};
  }
  try {
    const Notifications = await import("expo-notifications");
    // Если приложение открыли тапом по уведомлению (было закрыто) — обрабатываем сразу.
    const last = await Notifications.getLastNotificationResponseAsync();
    const lastOrderId = last?.notification?.request?.content?.data?.orderId;
    if (lastOrderId) {
      cb(String(lastOrderId));
    }
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const orderId = resp?.notification?.request?.content?.data?.orderId;
      if (orderId) {
        cb(String(orderId));
      }
    });
    return () => sub.remove();
  } catch {
    return () => {};
  }
}
